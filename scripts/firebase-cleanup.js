const { initializeApp, getApps, cert } = require("firebase-admin/app")
const { getFirestore } = require("firebase-admin/firestore")
const fs = require("fs")
const path = require("path")

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "service-account.json")
const COLLECTIONS = ["inventory_stock", "inventory_movements"]
const VALID_SOURCES = ["seed", "test"]

async function cleanCollection(db, collectionName) {
  const snapshot = await db.collection(collectionName).get()
  let deleted = 0
  let skipped = 0

  for (const doc of snapshot.docs) {
    const data = doc.data()
    const source = data.source

    if (source && VALID_SOURCES.includes(source)) {
      await doc.ref.delete()
      deleted++
      console.log(`  [DELETE] ${collectionName}/${doc.id} (source="${source}")`)
    } else {
      skipped++
      if (source) {
        console.log(`  [SKIP]  ${collectionName}/${doc.id} (source="${source}" — no coincide)`)
      } else {
        console.log(`  [SKIP]  ${collectionName}/${doc.id} (sin source — seguro)`)
      }
    }
  }

  return { total: snapshot.size, deleted, skipped }
}

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error("ERROR: No se encuentra service-account.json en la raíz del proyecto.")
    process.exit(1)
  }
  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"))
  if (getApps().length === 0) {
    initializeApp({ credential: cert(serviceAccount) })
  }
  const db = getFirestore()

  let globalTotal = 0
  let globalDeleted = 0
  let globalSkipped = 0

  for (const col of COLLECTIONS) {
    const result = await cleanCollection(db, col)
    console.log(`\n[${col}] evaluados: ${result.total}, eliminados: ${result.deleted}, saltados: ${result.skipped}`)
    globalTotal += result.total
    globalDeleted += result.deleted
    globalSkipped += result.skipped
  }

  console.log(`\n=== Resumen global ===`)
  console.log(`Colecciones evaluadas: ${COLLECTIONS.length}`)
  console.log(`Documentos evaluados:  ${globalTotal}`)
  console.log(`Eliminados:            ${globalDeleted}`)
  console.log(`Saltados:              ${globalSkipped}`)
}

main().catch(console.error)
