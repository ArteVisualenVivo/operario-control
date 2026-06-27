const { initializeApp, getApps, cert } = require("firebase-admin/app")
const { getFirestore, FieldValue } = require("firebase-admin/firestore")
const fs = require("fs")
const path = require("path")

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "service-account.json")
const COLLECTION = "inventory_stock"

const SEED_ITEMS = [
  { name: "Riendas", size: "largas" },
  { name: "Riendas", size: "cortas" },
  { name: "Puntales", size: "3m" },
  { name: "Puntales", size: "2m" },
  { name: "Tablones", size: "3m" },
]

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
  const colRef = db.collection(COLLECTION)

  let marked = 0
  let skipped = 0
  let notFound = 0

  for (const item of SEED_ITEMS) {
    const snapshot = await colRef
      .where("name", "==", item.name)
      .where("size", "==", item.size)
      .limit(1)
      .get()

    if (snapshot.empty) {
      console.log(`  [NOT FOUND] ${item.name} (${item.size})`)
      notFound++
      continue
    }

    const doc = snapshot.docs[0]
    const data = doc.data()

    if (data.source) {
      console.log(`  [SKIP] ${doc.id} — ${item.name} (${item.size}) ya tiene source="${data.source}"`)
      skipped++
      continue
    }

    await doc.ref.update({ source: "seed", updatedAt: new Date() })
    console.log(`  [MARKED] ${doc.id} — ${item.name} (${item.size}) → source="seed"`)
    marked++
  }

  console.log(`\n--- Resumen ---`)
  console.log(`Marcados:     ${marked}`)
  console.log(`Saltados:     ${skipped}`)
  console.log(`No encontrados: ${notFound}`)
  console.log(`Total items en lista: ${SEED_ITEMS.length}`)
}

main().catch(console.error)
