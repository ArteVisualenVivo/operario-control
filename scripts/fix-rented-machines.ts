import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import * as fs from "fs"
import * as path from "path"

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "service-account.json")
const COLLECTION = "machines"

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

  const snapshot = await colRef.where("status", "==", "rented").get()

  let fixed = 0

  for (const doc of snapshot.docs) {
    const data = doc.data()
    if (!data.rental) {
      console.log(`[FIX] ${doc.id} | ${data.name ?? "sin nombre"} | status: rented → available | rental: null`)
      await doc.ref.update({ status: "available", updatedAt: new Date() })
      fixed++
    } else {
      console.log(`[OK]  ${doc.id} | ${data.name ?? "sin nombre"} | rental existe, sin cambios`)
    }
  }

  console.log(`\n--- Resumen ---`)
  console.log(`Reparadas: ${fixed}`)
  console.log(`Sin cambios: ${snapshot.docs.length - fixed}`)
  console.log(`Total revisadas: ${snapshot.docs.length}`)
}

main().catch(console.error)
