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

  if (admin.getApps().length > 0) return admin

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

  const result = {
    success: true,
    created: 0,
    updated: 0,
    skipped: 0,
    warnings: [] as string[],
  }

  try {
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

    console.log("[ENGINE] syncRepairsToMaintenance iniciando")
    const collection = db.collection("maintenance")

    // Columnas del Excel de Reparaciones (0-indexed)
    // Ajustar segun el formato real exportado por 3C
    const COL_ORDER = 0
    const COL_ENTRY_DATE = 1
    const COL_CLIENT = 2
    const COL_MACHINE = 3
    const COL_BRAND = 4
    const COL_MODEL = 5
    const COL_SERIAL = 6
    const COL_STATUS = 7
    const COL_TECHNICIAN = 8
    const COL_OBSERVATIONS = 9

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || !Array.isArray(row)) continue

      const orderNumber = String(row[COL_ORDER] ?? "").trim()
      if (!orderNumber) {
        result.skipped++
        continue
      }

      const entryDateRaw = row[COL_ENTRY_DATE]
      const entryDate = entryDateRaw ? new Date(String(entryDateRaw)) : new Date()

      const clientName = String(row[COL_CLIENT] ?? "").trim()
      const machineName = String(row[COL_MACHINE] ?? "").trim()
      const brand = String(row[COL_BRAND] ?? "").trim() || undefined
      const model = String(row[COL_MODEL] ?? "").trim() || undefined
      const serial = String(row[COL_SERIAL] ?? "").trim() || undefined
      const status = String(row[COL_STATUS] ?? "").trim() || "Recepción"
      const technician = String(row[COL_TECHNICIAN] ?? "").trim() || undefined
      const observations = String(row[COL_OBSERVATIONS] ?? "").trim() || undefined

      const ref = collection.doc(orderNumber)
      const before = await ref.get()
      const payload: Record<string, unknown> = {
        orderNumber,
        entryDate,
        clientName,
        machineName,
        brand: brand ?? null,
        model: model ?? null,
        serial: serial ?? null,
        status,
        technician: technician ?? null,
        observations: observations ?? null,
        repairDate: null,
        returnDate: null,
        warranty: null,
        history: null,
        shopTime: null,
        updatedAt: new Date(),
      }

      if (!before.exists) {
        await ref.set({
          ...payload,
          createdAt: new Date(),
        })
        result.created++
      } else {
        await ref.set(payload, { merge: true })
        result.updated++
      }
    }
  } catch (err) {
    result.success = false
    result.warnings.push(err instanceof Error ? err.message : String(err))
  }

  return result
}
