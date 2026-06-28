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

  const serviceAccountJson =
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    (() => {
      try {
        const fs = require("fs")
        const path = require("path")
        const p = path.resolve(process.cwd(), "service-account.json")
        return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null
      } catch {
        return null
      }
    })()

  if (!serviceAccountJson) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT no configurada. " +
      "En local, colocar service-account.json en la raíz. " +
      "En Vercel, agregar la variable de entorno con el JSON del service account."
    )
  }

  const serviceAccount = JSON.parse(serviceAccountJson)

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
        `Material no encontrado en Firestore: "${item.name}" — omitido (strictMode)`
      )
    }
  }

  return result
}
