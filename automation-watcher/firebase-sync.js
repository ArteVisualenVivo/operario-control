const fs = require("fs")
const path = require("path")
const { initializeApp, getApps, cert } = require("firebase-admin/app")
const { getFirestore } = require("firebase-admin/firestore")

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "service-account.json")

let db = null

function initFirebase() {
  if (db) return db

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(
      "service-account.json no encontrado en la raíz del proyecto.\n" +
      "Descargar desde Firebase Console → Project Settings → Service Accounts → Generate new private key"
    )
  }

  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"))

  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) })
  }

  db = getFirestore()
  return db
}

async function syncStock(items, config) {
  const db = initFirebase()
  const collection = db.collection("inventory_stock")

  // 1. Agregar items por codigo (sumar stock entre depositos)
  const aggregated = new Map()
  for (const item of items) {
    const key = item.codigo || item.normalizedName
    if (aggregated.has(key)) {
      const existing = aggregated.get(key)
      existing.stockTotal += item.stockTotal
      existing.depositos.push(item.deposito)
      if (item.stockWarning) existing.stockWarning = true
    } else {
      aggregated.set(key, {
        codigo: item.codigo,
        name: item.name,
        normalizedName: item.normalizedName,
        stockTotal: item.stockTotal,
        unit: item.unit,
        source: item.source,
        stockWarning: item.stockWarning,
        depositos: [item.deposito],
      })
    }
  }

  const aggregatedItems = [...aggregated.values()].map(item => ({
    ...item,
    stockAvailable: item.stockTotal,
    stockRented: 0,
  }))

  const snapshot = await collection.get()

  const stockMap = new Map()
  const codeMap = new Map()
  for (const doc of snapshot.docs) {
    const data = doc.data()
    const key = (data.name || "").toLowerCase().trim()
    stockMap.set(key, { id: doc.id, ...data })
    if (data.codigo) {
      codeMap.set(data.codigo.toString().trim(), { id: doc.id, ...data })
    }
  }

  let updated = 0
  let created = 0
  let skipped = 0
  let warnings = []

  for (const item of aggregatedItems) {
    let match = null
    if (item.codigo) {
      match = codeMap.get(item.codigo) || null
    }
    if (!match) {
      match = stockMap.get(item.normalizedName) || null
    }

    const depositoStr = item.depositos ? item.depositos.join(",") : String(item.deposito || "")

    const payload = {
      codigo: item.codigo,
      stockTotal: item.stockTotal,
      stockAvailable: item.stockAvailable,
      stockRented: item.stockRented,
      unit: item.unit,
      deposito: depositoStr,
      source: "3c",
      stockWarning: item.stockWarning || false,
      lastSync: new Date(),
      updatedAt: new Date(),
    }

    if (item.stockWarning) {
      warnings.push(`Stock negativo para "${item.name}" (código: ${item.codigo}): ${item.stockTotal}`)
    }

    if (match) {
      await collection.doc(match.id).set(payload, { merge: true })
      updated++
    } else if (!config.strictMode) {
      await collection.add({
        ...payload,
        name: item.name,
        category: config.defaults.category,
        locationType: config.defaults.locationType,
        subtype: null,
        size: null,
        createdAt: new Date(),
      })
      created++
    } else {
      skipped++
      warnings.push(`Material no encontrado en Firestore: "${item.name}" — omitido (strictMode)`)
    }
  }

  return { updated, created, skipped, warnings }
}

module.exports = { initFirebase, syncStock }
