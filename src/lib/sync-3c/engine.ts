import * as XLSX from "xlsx"
import type { Sync3CItem, Sync3CResult, Sync3CConfig } from "./types"

const DEFAULTS: Sync3CConfig = {
  unit: "unidad",
  category: "consumibles",
  locationType: "deposito",
  strictMode: false,
}

function getFirebaseAdmin() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const admin = require("firebase-admin")
  const fs = require("fs")
  const path = require("path")
  const serviceAccountPath = path.resolve(process.cwd(), "sync-agent/service-account.json")

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      "[FIREBASE] Missing sync-agent/service-account.json. " +
      "Colocar el archivo en sync-agent/ del proyecto."
    )
  }

  const serviceAccountJson = fs.readFileSync(serviceAccountPath, "utf-8")
  const serviceAccount = JSON.parse(serviceAccountJson)

  console.log("[FIREBASE] Using service account: sync-agent/service-account.json")

  const apps = admin.getApps()
  if (apps.length > 0) {
    for (const app of apps) {
      try {
        app.delete()
      } catch (deleteError) {
        console.warn(
          "[FIREBASE] Failed to delete existing Firebase app:",
          deleteError instanceof Error ? deleteError.message : deleteError,
        )
      }
    }
  }

  admin.initializeApp({
    credential: admin.cert(serviceAccount),
  })

  return admin
}

export interface SyncEngineOptions {
  config?: Partial<Sync3CConfig>
}

export async function syncItems(
  items: Sync3CItem[],
  options?: SyncEngineOptions,
): Promise<Sync3CResult> {
  const config = { ...DEFAULTS, ...options?.config }
  const admin = getFirebaseAdmin()
  const { getFirestore } = require("firebase-admin/firestore")
  const db = getFirestore()
  const collection = db.collection("inventory_stock")

  const result: Sync3CResult = {
    success: true,
    created: 0,
    updated: 0,
    skipped: 0,
    warnings: [],
  }

  if (items.length === 0) return result

  const snapshot = await collection.get()

  const stockMap = new Map<string, { id: string; [key: string]: unknown }>()
  const codeMap = new Map<string, { id: string; [key: string]: unknown }>()

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>
    const key = ((data.name as string) ?? "").toLowerCase().trim()
    stockMap.set(key, { id: doc.id, ...data })
    if (data.codigo) {
      codeMap.set(data.codigo.toString().trim(), { id: doc.id, ...data })
    }
  }

  for (const item of items) {
    let match = item.codigo ? (codeMap.get(item.codigo) ?? null) : null
    if (!match) {
      match = stockMap.get(item.normalizedName) ?? null
    }

    const payload: Record<string, unknown> = {
      codigo: item.codigo,
      stockTotal: item.stockTotal,
      stockAvailable: item.stockTotal,
      stockRented: 0,
      unit: item.unit,
      deposito: item.deposito,
      source: "3c",
      stockWarning: item.stockWarning || false,
      lastSync: new Date(),
      updatedAt: new Date(),
    }

    if (item.stockWarning) {
      result.warnings.push(
        `Stock negativo para "${item.name}" (código: ${item.codigo}): ${item.stockTotal}`
      )
    }

    if (match) {
      await collection.doc(match.id).set(payload, { merge: true })
      result.updated++
    } else if (!config.strictMode) {
      await collection.add({
        ...payload,
        name: item.name,
        category: config.category,
        locationType: config.locationType,
        subtype: null,
        size: null,
        createdAt: new Date(),
      })
      result.created++
    } else {
      result.skipped++
      result.warnings.push(
        `Material no encontrado en Firestore: "${item.name}" omitido (strictMode)`
      )
    }
  }

  return result
}

export async function syncRepairsToMaintenance(
  buffer: ArrayBuffer | Buffer,
): Promise<{ success: boolean; created: number; updated: number; skipped: number; warnings: string[] }> {
  const admin = getFirebaseAdmin()
  const { getFirestore } = require("firebase-admin/firestore")
  const db = getFirestore()

  const BATCH_LIMIT = 400
  let counter = 0
  let batch = db.batch()
  let pendingCreated = 0
  let pendingUpdated = 0

  const result = {
    success: true,
    created: 0,
    updated: 0,
    skipped: 0,
    warnings: [] as string[],
  }

  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

  console.log("[ENGINE] syncRepairsToMaintenance iniciando")
  console.log("[MAINTENANCE BATCH] start")
  const collection = db.collection("maintenance")

  const HEADER_BLACKLIST = [
    "tipo",
    "numero",
    "fecha",
    "fecha_ingreso",
    "fecha_entrega",
    "fecha_reparacion",
    "cliente",
    "razon_social",
    "estado",
    "doc_id",
    "item_id",
    "articu_id",
    "texto",
  ]

  const normalizeToken = (value: unknown): string =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")

  const findHeaderRowIndex = (): number => {
    return rows.findIndex((row) => {
      if (!Array.isArray(row)) return false
      const normalizedCells = row.map(normalizeToken)
      const hasOrder = normalizedCells.some((cell) =>
        ["numero", "nro", "nro_orden"].includes(cell) || cell.includes("numero"),
      )
      const hasDate = normalizedCells.some((cell) =>
        cell.startsWith("fecha") || cell.includes("entrega") || cell.includes("egreso"),
      )
      return hasOrder && hasDate
    })
  }

  const headerRowIndex = findHeaderRowIndex()
  const headerRow = headerRowIndex >= 0 ? rows[headerRowIndex] : []
  const headerIndexes = new Map<string, number>()

  headerRow.forEach((cell, index) => {
    const normalized = normalizeToken(cell).replace(/\s+/g, "_")
    if (normalized) headerIndexes.set(normalized, index)
  })

  const col = (aliases: string[], fallback: number): number => {
    for (const alias of aliases) {
      const index = headerIndexes.get(normalizeToken(alias).replace(/\s+/g, "_"))
      if (typeof index === "number") return index
    }
    return fallback
  }

  // Formato sin "ExcelItems": TIPO, NUMERO, FECHA, ..., ESTADO, ...
  // Formato con "ExcelItems": comparte TIPO/NUMERO/FECHA y agrega columnas de items.
  const COL_TYPE = col(["tipo", "tipdoc", "tipo_doc"], 0)
  const COL_ORDER = col(["numero", "nro", "nro_orden"], 1)
  const COL_ENTRY_DATE = col(["fecha", "fecha_ingreso", "ingreso"], 2)
  const COL_RETURN_DATE = col(["fecha_entrega", "entrega", "egreso", "fecha_retiro", "retiro"], -1)
  const COL_REPAIR_DATE = col(["fecha_reparacion", "reparacion"], -1)
  const COL_CLIENT = col(["razon_social", "cliente_nombre", "nombre_cliente", "cliente"], 4)
  const COL_CLIENT_CODE = col(["cliente", "cod_cliente", "cliente_id"], 3)
  const COL_MACHINE = col(["texto", "maquina", "equipo", "articulo", "descripcion", "descrip", "observ"], 8)
  const COL_STATUS = col(["estado", "estado_repara_txt", "situacion"], -1)
  const COL_DOC_ID = col(["doc_id", "docid"], 5)
  const COL_ITEM_ID = col(["item_id", "itemid"], 6)
  const COL_ARTICLE_ID = col(["articu_id", "articulo_id", "article_id"], 7)
  const COL_QUANTITY = col(["cantidad", "qty", "cantidad_solicitada"], 9)
  const COL_UNIT_PRICE = col(["precio_unitario", "precio"], 10)
  const COL_TOTAL_PRICE = col(["precio_total", "total"], 11)
  const COL_TAXED = col(["gravado"], 12)
  const COL_NOT_TAXED = col(["no_gravado", "no_gravada"], 13)
  const COL_EXEMPT = col(["exento"], 14)
  const COL_CAPITAL_GOOD = col(["bien_capital"], 15)
  const COL_USE_GOOD = col(["bien_uso"], 16)
  const COL_EQUIVALENT_COEFFICIENT = col(["coeficiente_equivalente"], 17)
  const COL_NET_PRICE = col(["precio_neto", "neto"], 18)

  const logSkippedRow = (rowNumber: number, reason: string, details: Record<string, unknown>) => {
    result.skipped++
    result.warnings.push(`Fila ${rowNumber} omitida: ${reason}`)
    console.warn(`[MAINTENANCE ROW] skip row ${rowNumber}: ${reason}`, details)
  }

  const isValidDateObject = (date: Date): boolean =>
    date instanceof Date && Number.isFinite(date.getTime())

  const buildCheckedDate = (
    year: number,
    month: number,
    day: number,
    hours = 0,
    minutes = 0,
    seconds = 0,
  ): Date | null => {
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      year < 1900 ||
      year > 2100 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59 ||
      seconds < 0 ||
      seconds > 59
    ) {
      return null
    }

    const date = new Date(year, month - 1, day, hours, minutes, seconds)
    if (
      !isValidDateObject(date) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null
    }

    return date
  }

  const isValidOrderNumber = (value: string): boolean => {
    if (!value || value.length < 3) return false
    const normalized = normalizeToken(value)
    if (HEADER_BLACKLIST.some((token) => normalized.includes(token))) return false
    return /^x\s?\d{4}-\d{6,8}$/i.test(value.replace(/\s+/g, " "))
  }

  const cleanOptionalText = (value: unknown): string | null => {
    const text = String(value ?? "").trim()
    if (!text) return null
    if (HEADER_BLACKLIST.includes(normalizeToken(text))) return null
    return text
  }

  const cleanOptionalNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value
    const text = String(value ?? "").trim().replace(/\./g, "").replace(/,/g, ".")
    if (!text) return null
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
  }

  const cell = (row: unknown[], index: number): unknown => {
    if (index < 0) return undefined
    return row[index]
  }

  const isHeaderRow = (row: unknown[], orderNumber: string, entryDateRaw: unknown): boolean => {
    const normalizedOrder = normalizeToken(orderNumber)
    if (HEADER_BLACKLIST.some((token) => normalizedOrder.includes(token))) {
      return true
    }

    const normalizedDate = normalizeToken(entryDateRaw)
    if (HEADER_BLACKLIST.some((token) => normalizedDate.includes(token))) {
      return true
    }

    return row.some((cell) => HEADER_BLACKLIST.some((token) => normalizeToken(cell) === token))
  }

  const parseEntryDate = (value: unknown): Date | null => {
    if (value instanceof Date) {
      if (!isValidDateObject(value)) return null
      return buildCheckedDate(
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate(),
        value.getHours(),
        value.getMinutes(),
        value.getSeconds(),
      )
    }

    if (typeof value === "number" && XLSX.SSF && typeof XLSX.SSF.parse_date_code === "function") {
      const parsed = XLSX.SSF.parse_date_code(value)
      if (parsed && parsed.y) {
        return buildCheckedDate(
          parsed.y,
          parsed.m ?? 1,
          parsed.d ?? 1,
          parsed.H ?? 0,
          parsed.M ?? 0,
          parsed.S ?? 0,
        )
      }
      return null
    }

    const normalized = String(value ?? "").trim()
    if (!normalized || HEADER_BLACKLIST.some((token) => normalizeToken(normalized).includes(token))) {
      return null
    }

    const ddmmyyyy = normalized.match(/^([0-3]?\d)[\/\-]([0-1]?\d)[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
    if (ddmmyyyy) {
      const day = Number(ddmmyyyy[1])
      const month = Number(ddmmyyyy[2])
      let year = Number(ddmmyyyy[3])
      if (year < 100) year += 2000
      return buildCheckedDate(
        year,
        month,
        day,
        Number(ddmmyyyy[4] ?? 0),
        Number(ddmmyyyy[5] ?? 0),
        Number(ddmmyyyy[6] ?? 0),
      )
    }

    const iso = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (iso) {
      return buildCheckedDate(
        Number(iso[1]),
        Number(iso[2]),
        Number(iso[3]),
        Number(iso[4] ?? 0),
        Number(iso[5] ?? 0),
        Number(iso[6] ?? 0),
      )
    }

    return null
  }

  const commitBatch = async (lastBatchPayload: Record<string, unknown> | null) => {
    if (counter === 0) return

    console.log("[MAINTENANCE BATCH] commit size:", counter)
    try {
      await batch.commit()
      result.created += pendingCreated
      result.updated += pendingUpdated
      pendingCreated = 0
      pendingUpdated = 0
      batch = db.batch()
      counter = 0
      console.log("Batch OK", { lastPayload: lastBatchPayload })
    } catch (commitErr) {
      console.error("Batch FAILED", { lastPayload: lastBatchPayload })
      console.error(commitErr)
      throw commitErr
    }
  }

  let lastBatchPayload: Record<string, unknown> | null = null

  const startRowIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : 1

  for (let i = startRowIndex; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !Array.isArray(row)) continue

    const rowNumber = i + 1
    const orderNumber = String(cell(row, COL_ORDER) ?? "").trim()
    const entryDateRaw = cell(row, COL_ENTRY_DATE)
    const entryDate = parseEntryDate(entryDateRaw)
    const returnDateRaw = cell(row, COL_RETURN_DATE)
    const repairDateRaw = cell(row, COL_REPAIR_DATE)
    const returnDate = returnDateRaw ? parseEntryDate(returnDateRaw) : null
    const repairDate = repairDateRaw ? parseEntryDate(repairDateRaw) : null

    if (isHeaderRow(row, orderNumber, entryDateRaw)) {
      result.skipped++
      result.warnings.push(
        `Fila ${i + 1} omitida: orderNumber inválido o fila de encabezado (${String(orderNumber)})`,
      )
      console.warn(
        `[MAINTENANCE ROW] skip row ${i + 1}: invalid orderNumber or header`,
        { orderNumber, entryDateRaw },
      )
      continue
    }

    if (!isValidOrderNumber(orderNumber)) {
      logSkippedRow(rowNumber, "orderNumber invalido", { orderNumber, entryDateRaw })
      continue
    }

    if (!entryDate) {
      result.skipped++
      result.warnings.push(
        `Fila ${i + 1} omitida: entryDate inválido (${String(entryDateRaw)})`,
      )
      console.warn(
        `[MAINTENANCE ROW] skip row ${i + 1}: invalid entryDate`,
        { orderNumber, entryDateRaw },
      )
      continue
    }

    const clientName = cleanOptionalText(cell(row, COL_CLIENT)) ?? ""
    const clientCode = cleanOptionalText(cell(row, COL_CLIENT_CODE))
    const machineName = cleanOptionalText(cell(row, COL_MACHINE)) ?? ""
    const docId = cleanOptionalText(cell(row, COL_DOC_ID))
    const itemId = cleanOptionalNumber(cell(row, COL_ITEM_ID))
    const articleId = cleanOptionalText(cell(row, COL_ARTICLE_ID))
    const quantity = cleanOptionalNumber(cell(row, COL_QUANTITY))
    const unitPrice = cleanOptionalNumber(cell(row, COL_UNIT_PRICE))
    const totalPrice = cleanOptionalNumber(cell(row, COL_TOTAL_PRICE))
    const taxed = cleanOptionalNumber(cell(row, COL_TAXED))
    const notTaxed = cleanOptionalNumber(cell(row, COL_NOT_TAXED))
    const exempt = cleanOptionalNumber(cell(row, COL_EXEMPT))
    const capitalGood = cleanOptionalNumber(cell(row, COL_CAPITAL_GOOD))
    const useGood = cleanOptionalNumber(cell(row, COL_USE_GOOD))
    const equivalentCoefficient = cleanOptionalNumber(cell(row, COL_EQUIVALENT_COEFFICIENT))
    const netPrice = cleanOptionalNumber(cell(row, COL_NET_PRICE))
    const now = new Date()
    const status = String(row[COL_STATUS] ?? "").trim() || "Recepción"
    const sourceData: Record<string, unknown> = {}

    if (headerRowIndex >= 0) {
      headerRow.forEach((headerCell, index) => {
        const key = normalizeToken(headerCell).replace(/\s+/g, "_")
        if (key) sourceData[key] = row[index] ?? null
      })
    }
    if (typeof sourceData.entrega !== "undefined" && !returnDate) {
      const parsedEntrega = parseEntryDate(sourceData.entrega)
      if (parsedEntrega) {
        sourceData.fecha_entrega = sourceData.entrega
      }
    }

    const ref = collection.doc(orderNumber)
    const before = await ref.get()
    const payload: Record<string, unknown> = {
      orderNumber,
      entryDate,
      returnDate,
      repairDate,
      clientName,
      clientCode,
      machineName,
      docId,
      itemId,
      articleId,
      quantity,
      unitPrice,
      totalPrice,
      taxed,
      notTaxed,
      exempt,
      capitalGood,
      useGood,
      equivalentCoefficient,
      netPrice,
      status,
      originalData: sourceData,
      sourceRow: rowNumber,
      updatedAt: now,
    }

    if (!before.exists) {
      payload.createdAt = now
    }

    try {
      batch.set(ref, payload, { merge: true })
      if (!before.exists) {
        pendingCreated++
      } else {
        pendingUpdated++
      }
      lastBatchPayload = { ...payload, orderNumber, row: i + 1 }
    } catch (setErr) {
      console.error("ROW FAILED")
      console.error("Número de fila:", i + 1)
      console.error("orderNumber:", orderNumber)
      console.error("Payload completo:", payload)
      console.error("Error completo:", setErr)
      console.error(
        "Stack completo:",
        setErr instanceof Error ? setErr.stack : undefined,
      )
      result.skipped++
      result.warnings.push(`Fila ${i + 1} omitida: error al armar payload`)
      continue
    }

    counter++

    if (counter >= BATCH_LIMIT) {
      await commitBatch(lastBatchPayload)
    }

  }

  if (counter > 0) {
    await commitBatch(lastBatchPayload)
  }

  console.log("[MAINTENANCE BATCH] finished")
  return result
}
