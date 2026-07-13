import * as XLSX from "xlsx"
import type { Sync3CItem, Sync3CResult, Sync3CConfig } from "./types"
import { classifyScaffoldStock } from "@/lib/scaffoldMatcher"

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

  // ─────────── INSTRUMENTACIÓN FORENSE ───────────
  const PROFILING: Record<string, number> = {}
  const PROFILING_START = Date.now()
  // ────────────────────────────────────────────────

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

  const syncId = (Date.now().toString().slice(-6))
  const startTotal = Date.now()
  console.log(`=========================`)
  console.log(`[PROFILE ${syncId}] ======== INICIO syncItems ========`)
  console.log(`[PROFILE ${syncId}] T0 (after Firebase init): ${startTotal}`)
  console.log(`=========================`)

  // ═══════════════════════════════════════════════
  // ETAPA 1: collection.get()
  // ═══════════════════════════════════════════════
  const t0 = Date.now()
  const allDocsSnapshot = await collection.get()
  const t1 = Date.now()
  const performedReads = allDocsSnapshot.size
  PROFILING["collection_get"] = t1 - t0
  console.log(`=========================`);
  console.log(`[PROFILE ${syncId}] ETAPA 1: collection.get()`);
  console.log(`[PROFILE ${syncId}]   INICIO: ${t0}`);
  console.log(`[PROFILE ${syncId}]   FIN:    ${t1}`);
  console.log(`[PROFILE ${syncId}]   ⏱️  DURACIÓN: ${t1 - t0}ms`);
  console.log(`[PROFILE ${syncId}]   📄 DOCUMENTOS: ${performedReads}`);
  console.log(`=========================`);

  // ═══════════════════════════════════════════════
  // ETAPA 2: Construir Map en memoria
  // ═══════════════════════════════════════════════
  const t2 = Date.now()
  const inventoryIndex = new Map<string, { id: string; data: Record<string, unknown> }>()
  for (const doc of allDocsSnapshot.docs) {
    const data = doc.data() as Record<string, unknown>
    if (data.codigo) {
      inventoryIndex.set(String(data.codigo), { id: doc.id, data })
    }
    if (data.name) {
      inventoryIndex.set(String(data.name), { id: doc.id, data })
    }
  }
  const t3 = Date.now()
  PROFILING["build_map"] = t3 - t2
  console.log(`=========================`);
  console.log(`[PROFILE ${syncId}] ETAPA 2: Construir Map`);
  console.log(`[PROFILE ${syncId}]   INICIO: ${t2}`);
  console.log(`[PROFILE ${syncId}]   FIN:    ${t3}`);
  console.log(`[PROFILE ${syncId}]   ⏱️  DURACIÓN: ${t3 - t2}ms`);
  console.log(`[PROFILE ${syncId}]   📦 ENTRADAS MAP: ${inventoryIndex.size}`);
  console.log(`=========================`);

  // ═══════════════════════════════════════════════
  // ETAPA 3: Bucle items (procesamiento + batch commits)
  // ═══════════════════════════════════════════════
  const BATCH_LIMIT = 400
  let batch = db.batch()
  let counter = 0
  let batchCommits = 0
  let totalBatchOps = 0
  let totalFirestoreWriteTime = 0  // ← INSTRUMENTACIÓN: acumula tiempo de batch.commit()

  const t4 = Date.now()
  const T_LOOP_START = t4

  // Tiempo dentro del bucle dedicado SOLO a procesar items (sin contar commits)
  let tLoopBodyStart = t4
  let totalLoopBodyTime = 0

  for (const item of items) {
    const scaffold = classifyScaffoldStock(item.name)
    
    // PASO 4: Buscar en el índice en memoria
    let match: { id: string; [key: string]: unknown } | null = null
    if (item.codigo && inventoryIndex.has(item.codigo)) {
      const entry = inventoryIndex.get(item.codigo)!
      match = { id: entry.id, ...entry.data }
    } else if (inventoryIndex.has(item.name)) {
      const entry = inventoryIndex.get(item.name)!
      match = { id: entry.id, ...entry.data }
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
      category: item.category ?? scaffold.category ?? config.category,
      subtype: item.subtype ?? scaffold.subtype ?? null,
    }

    if (item.stockWarning) {
      result.warnings.push(
        `Stock negativo para "${item.name}" (código: ${item.codigo}): ${item.stockTotal}`
      )
    }

    if (match) {
      batch.set(collection.doc(match.id), payload, { merge: true })
      result.updated++
    } else if (!config.strictMode) {
      const newDocRef = collection.doc()
      batch.set(newDocRef, {
        ...payload,
        name: item.name,
        category: item.category ?? scaffold.category ?? config.category,
        locationType: config.locationType,
        subtype: item.subtype ?? scaffold.subtype ?? null,
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

    counter++
    if (counter >= BATCH_LIMIT) {
      // ═══════════════════════════════════════════
      // ETAPA 3a: batch.commit() #N
      // ═══════════════════════════════════════════
      // Pausar contador de loop body mientras esperamos Firestore
      const loopBodyUntilNow = Date.now() - tLoopBodyStart
      totalLoopBodyTime += loopBodyUntilNow

      const tBatchStart = Date.now()
      await batch.commit()
      const tBatchEnd = Date.now()
      const commitDuration = tBatchEnd - tBatchStart
      totalFirestoreWriteTime += commitDuration

      console.log(`=========================`);
      console.log(`[PROFILE ${syncId}] ETAPA 3a: batch.commit() #${++batchCommits}`);
      console.log(`[PROFILE ${syncId}]   INICIO:             ${tBatchStart}`);
      console.log(`[PROFILE ${syncId}]   FIN:                ${tBatchEnd}`);
      console.log(`[PROFILE ${syncId}]   ⏱️  DURACIÓN COMMIT: ${commitDuration}ms`);
      console.log(`[PROFILE ${syncId}]   📝 OPERACIONES:     ${counter}`);
      console.log(`=========================`);
      totalBatchOps += counter
      batch = db.batch()
      counter = 0

      // Reactivar contador de loop body
      tLoopBodyStart = Date.now()
    }
  }

  // ═══════════════════════════════════════════════
  // ETAPA 3b: batch.commit() final
  // ═══════════════════════════════════════════════
  if (counter > 0) {
    const loopBodyUntilNow = Date.now() - tLoopBodyStart
    totalLoopBodyTime += loopBodyUntilNow

    const tBatchStart = Date.now()
    await batch.commit()
    const tBatchEnd = Date.now()
    const commitDuration = tBatchEnd - tBatchStart
    totalFirestoreWriteTime += commitDuration

    console.log(`=========================`);
    console.log(`[PROFILE ${syncId}] ETAPA 3b: batch.commit() #${++batchCommits} (final)`);
    console.log(`[PROFILE ${syncId}]   INICIO:             ${tBatchStart}`);
    console.log(`[PROFILE ${syncId}]   FIN:                ${tBatchEnd}`);
    console.log(`[PROFILE ${syncId}]   ⏱️  DURACIÓN COMMIT: ${commitDuration}ms`);
    console.log(`[PROFILE ${syncId}]   📝 OPERACIONES:     ${counter}`);
    console.log(`=========================`);
    totalBatchOps += counter
  }

  const t5 = Date.now()
  PROFILING["loop_total"] = t5 - T_LOOP_START
  PROFILING["loop_body"] = totalLoopBodyTime
  PROFILING["firestore_writes"] = totalFirestoreWriteTime

  console.log(`=========================`);
  console.log(`[PROFILE ${syncId}] ETAPA 3: Bucle items completo`);
  console.log(`[PROFILE ${syncId}]   INICIO LOOP:             ${T_LOOP_START}`);
  console.log(`[PROFILE ${syncId}]   FIN LOOP:                ${t5}`);
  console.log(`[PROFILE ${syncId}]   ⏱️  LOOP TOTAL (t4→t5):  ${t5 - T_LOOP_START}ms`);
  console.log(`[PROFILE ${syncId}]   ├── 🔄 Loop body items:  ${totalLoopBodyTime}ms  (${(totalLoopBodyTime / (t5 - T_LOOP_START) * 100).toFixed(1)}%)`);
  console.log(`[PROFILE ${syncId}]   └── 🔥 Firestore writes: ${totalFirestoreWriteTime}ms  (${(totalFirestoreWriteTime / (t5 - T_LOOP_START) * 100).toFixed(1)}%)`);
  console.log(`[PROFILE ${syncId}]   📊 FILAS EXCEL:   ${items.length}`);
  console.log(`[PROFILE ${syncId}]   📊 BATCHES:       ${batchCommits}`);
  console.log(`[PROFILE ${syncId}]   📊 OPS TOTALES:   ${totalBatchOps}`);
  console.log(`=========================`);

  // ═══════════════════════════════════════════════
  // ETAPA 4: return
  // ═══════════════════════════════════════════════
  const endTotal = Date.now()
  PROFILING["total"] = endTotal - PROFILING_START

  console.log(`[SYNC ${syncId}] Excel rows: ${items.length}`)
  console.log(`[SYNC ${syncId}] Updated: ${result.updated}`)
  console.log(`[SYNC ${syncId}] Created: ${result.created}`)
  console.log(`[SYNC ${syncId}] Skipped: ${result.skipped}`)

  // ─────────── INFORME FORENSE FINAL ───────────
  console.log(`\n========================================`)
  console.log(`📊 INFORME DE PROFILING [${syncId}]`)
  console.log(`========================================`)
  console.log(`  T0 (inicio real):          ${PROFILING_START}`)
  console.log(`  T total syncItems:        ${PROFILING["total"]}ms`)
  console.log(`  ──────────────────────────────────`)
  console.log(`  Paso 1: collection.get()  ${PROFILING["collection_get"]}ms  (${(PROFILING["collection_get"] / PROFILING["total"] * 100).toFixed(1)}%)`)
  console.log(`  Paso 2: build Map         ${PROFILING["build_map"]}ms  (${(PROFILING["build_map"] / PROFILING["total"] * 100).toFixed(1)}%)`)
  console.log(`  Paso 3: Loop items        ${PROFILING["loop_total"]}ms  (${(PROFILING["loop_total"] / PROFILING["total"] * 100).toFixed(1)}%)`)
  console.log(`    ├─ Loop body (CPU)      ${PROFILING["loop_body"]}ms  (${(PROFILING["loop_body"] / PROFILING["total"] * 100).toFixed(1)}%)`)
  console.log(`    └─ Firestore writes     ${PROFILING["firestore_writes"]}ms  (${(PROFILING["firestore_writes"] / PROFILING["total"] * 100).toFixed(1)}%)`)
  console.log(`  ──────────────────────────────────`)
  console.log(`  📦 Documentos leídos:     ${performedReads}`)
  console.log(`  📝 Items procesados:      ${items.length}`)
  console.log(`  🔥 Batch commits:         ${batchCommits}`)
  console.log(`  🔥 Ops totales escritas:  ${totalBatchOps}`)
  console.log(`========================================\n`)

  // ─────────── FIRESTORE PROFILE ───────────
  console.log(`\n========================================`)
  console.log(`FIRESTORE PROFILE`)
  console.log(`========================================`)
  console.log(`Collection:`)
  console.log(`inventory_stock`)
  console.log(`Items recibidos:`)
  console.log(`${items.length}`)
  console.log(`Documentos existentes:`)
  console.log(`${performedReads}`)
  console.log(`Lecturas realizadas:`)
  console.log(`${performedReads}`)
  console.log(`Documentos creados:`)
  console.log(`${result.created}`)
  console.log(`Documentos actualizados:`)
  console.log(`${result.updated}`)
  console.log(`Documentos sin cambios:`)
  console.log(`${performedReads - result.updated}`)
  console.log(`Batch commits:`)
  console.log(`${batchCommits}`)
  console.log(`Operaciones escritas:`)
  console.log(`${totalBatchOps}`)
  console.log(`Tiempo lectura:`)
  console.log(`${PROFILING["collection_get"]}ms`)
  console.log(`Tiempo escritura:`)
  console.log(`${PROFILING["firestore_writes"]}ms`)
  console.log(`Tiempo total:`)
  console.log(`${PROFILING["total"]}ms`)
  console.log(`========================================\n`)
  // ─────────────────────────────────────────

  console.log(`[SYNC ${syncId}] END`)
  console.log(`[SYNC ${syncId}] TOTAL: ${Date.now() - startTotal}ms`)

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

  const auditLogs = {
    totalRowsRead: 0,
    validRows: 0,
    discardedRows: 0,
    reasons: {} as Record<string, number>
  }

  const trackSkip = (reason: string) => {
    auditLogs.discardedRows++
    auditLogs.reasons[reason] = (auditLogs.reasons[reason] || 0) + 1
  }

  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

  auditLogs.totalRowsRead = rows.length

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
    "fecha_entrega",
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

    if (HEADER_BLACKLIST.some((token) => normalized.includes(token))) {
      return false
    }

    // 🔧 FIX REAL (solo regex)
    return /^x\s?\d{3,6}-\d{4,10}$/i.test(
      value.replace(/\s+/g, " ").trim()
    )
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

  const dateComparable = (value: unknown): string | null => {
    const date = value instanceof Date ? value : parseEntryDate(value)
    if (!date) return null
    return date.toISOString()
  }

  const normalizable = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString()
    if (value && typeof value === "object") {
      if ("toDate" in value && typeof (value as any).toDate === "function") {
        const d = (value as any).toDate()
        return d instanceof Date ? d.toISOString() : value
      }
    }
    return value
  }

  const payloadSignature = (payload: Record<string, unknown>): string => {
    return JSON.stringify({
      orderNumber: String(payload.orderNumber ?? "").trim(),
      clientName: String(payload.clientName ?? "").trim(),
      machineName: String(payload.machineName ?? "").trim()
    })
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

    const ddmmyyyy = normalized.match(
      /^([0-3]?\d)[\/\-]([0-1]?\d)[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    )

    if (ddmmyyyy) {
      let year = Number(ddmmyyyy[3])
      if (year < 100) year += 2000

      return buildCheckedDate(
        year,
        Number(ddmmyyyy[2]),
        Number(ddmmyyyy[1]),
        Number(ddmmyyyy[4] ?? 0),
        Number(ddmmyyyy[5] ?? 0),
        Number(ddmmyyyy[6] ?? 0),
      )
    }

    const iso = normalized.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
    )

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

    console.log("=== AUDITORIA TEMPORAL SYNC ===")
    console.log(`Filas totales leidas: ${auditLogs.totalRowsRead}`)
    console.log(`Filas validas: ${auditLogs.validRows}`)
    console.log(`Filas descartadas: ${auditLogs.discardedRows}`)
    console.log("Motivos de descarte:", auditLogs.reasons)
    console.log("===============================")

    try {
      await batch.commit()
      result.created += pendingCreated
      result.updated += pendingUpdated
      pendingCreated = 0
      pendingUpdated = 0
      batch = db.batch()
      counter = 0
    } catch (commitErr) {
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
      trackSkip("Header row")
      continue
    }

    if (!isValidOrderNumber(orderNumber)) {
      trackSkip("orderNumber invalido (regex)")
      continue
    }

    if (!entryDate) {
      result.skipped++
      trackSkip("entryDate invalido")
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

    const ref = collection.doc(orderNumber)

    try {
      batch.set(ref, payload, { merge: true })
      counter++
    } catch (err) {
      console.error(err)
      result.skipped++
    }

    auditLogs.validRows++

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