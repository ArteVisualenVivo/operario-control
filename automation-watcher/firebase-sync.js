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

async function syncStock(items) {
  const db = initFirebase()
  const collection = db.collection("inventory_stock")

  // 1. Fetch todo el stock actual en una sola query
  const snapshot = await collection.get()

  // 2. Construir Map por normalizedName
  const stockMap = new Map()
  for (const doc of snapshot.docs) {
    const data = doc.data()
    const key = (data.name || "").toLowerCase().trim()
    stockMap.set(key, { id: doc.id, ...data })
  }

  // 3. Matchear y actualizar
  let updated = 0
  let skipped = 0
  let warnings = []

  for (const item of items) {
    const match = stockMap.get(item.normalizedName)

    if (!match) {
      skipped++
      warnings.push(`Material no encontrado en Firestore: "${item.name}" — skip`)
      continue
    }

    await collection.doc(match.id).set(
      {
        stockTotal: item.stockTotal,
        stockAvailable: item.stockAvailable,
        stockRented: item.stockRented,
        updatedAt: new Date(),
      },
      { merge: true }
    )

    updated++
  }

  return { updated, skipped, warnings }
}

module.exports = { initFirebase, syncStock }
