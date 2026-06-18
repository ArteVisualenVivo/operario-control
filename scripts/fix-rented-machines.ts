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
  let recovered = 0
  let skipped = 0

  for (const doc of snapshot.docs) {
    const data = doc.data()
    const name = data.name ?? "sin nombre"
    const rental = data.rental
    const location = data.location

    // Case 1: rental is null or undefined
    if (!rental) {
      console.log(`[FIX -> AVAILABLE] ${name} | rental es null, marcando como available`)
      await doc.ref.update({
        status: "available",
        rental: null,
        location: null,
        updatedAt: new Date(),
      })
      fixed++
      continue
    }

    // Case 2: rental exists but clientName or projectName is empty
    const clientName = (rental.clientName as string) ?? ""
    const projectName = (rental.projectName as string) ?? ""

    if (!clientName.trim() || !projectName.trim()) {
      console.log(`[FIX -> AVAILABLE] ${name} | rental incompleto (clientName="${clientName}", projectName="${projectName}"), marcando como available`)
      await doc.ref.update({
        status: "available",
        rental: null,
        location: null,
        updatedAt: new Date(),
      })
      fixed++
      continue
    }

    // Case 3: rental is valid but location is missing or incomplete
    const hasValidLocation =
      location &&
      typeof location === "object" &&
      location.client?.name &&
      location.project?.name

    if (!hasValidLocation) {
      const clientAddress = (rental.clientAddress as string) ?? ""
      const projectAddress = (rental.projectAddress as string) ?? ""

      console.log(`[RECOVER] ${name} | location incompleto, reconstruyendo desde rental`)
      await doc.ref.update({
        location: {
          client: { name: clientName, address: clientAddress },
          project: { name: projectName, address: projectAddress },
        },
        updatedAt: new Date(),
      })
      recovered++
      continue
    }

    // Case 4: everything is valid
    console.log(`[OK]  ${name} | rental + location completos, sin cambios`)
    skipped++
  }

  console.log(`\n--- Resumen ---`)
  console.log(`Marcadas como available: ${fixed}`)
  console.log(`Location reconstruido desde rental: ${recovered}`)
  console.log(`Sin cambios (datos válidos): ${skipped}`)
  console.log(`Total revisadas: ${snapshot.docs.length}`)
}

main().catch(console.error)
