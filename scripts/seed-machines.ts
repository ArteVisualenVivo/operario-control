import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import * as fs from "fs"
import * as path from "path"

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "service-account.json")
const COLLECTION = "machines"

interface SeedItem {
  name: string
  model: string
  category: "machine" | "scaffold" | "tool"
}

const INVENTORY: SeedItem[] = [
  { name: "Andamio tubular", model: "estándar obra", category: "scaffold" },
  { name: "Andamio tubular", model: "reforzado pesado", category: "scaffold" },
  { name: "Andamio modular", model: "marco europeo", category: "scaffold" },
  { name: "Andamio modular", model: "heavy duty", category: "scaffold" },
  { name: "Andamio pasillero", model: "pasarela 1m", category: "scaffold" },
  { name: "Andamio pasillero", model: "pasarela 1.5m", category: "scaffold" },
  { name: "Andamio reforzado", model: "industrial 3T", category: "scaffold" },
  { name: "Caballetes", model: "metálico plegable", category: "scaffold" },
  { name: "Caballetes", model: "reforzado madera", category: "scaffold" },
  { name: "Tablón para andamios", model: "madera 3m", category: "scaffold" },
  { name: "Tablón para andamios", model: "metálico antideslizante", category: "scaffold" },
  { name: "Puntales telescópicos", model: "1.5–3m", category: "scaffold" },
  { name: "Puntales telescópicos", model: "2–4m", category: "scaffold" },
  { name: "Puntales telescópicos", model: "heavy duty", category: "scaffold" },
  { name: "Pisón canguro", model: "Honda GX160", category: "machine" },
  { name: "Pisón canguro", model: "Wacker BS50-2i", category: "machine" },
  { name: "Pisón canguro", model: "Bomag BT65", category: "machine" },
  { name: "Hormigonera", model: "130L eléctrica", category: "machine" },
  { name: "Hormigonera", model: "350L profesional", category: "machine" },
  { name: "Martillo demoledor", model: "Bosch GSH 16-28", category: "machine" },
  { name: "Martillo demoledor", model: "Makita HM1317C", category: "machine" },
  { name: "Martillo demoledor", model: "DeWalt D25980", category: "machine" },
  { name: "Vibrador de hormigón", model: "1.5HP 35mm", category: "machine" },
  { name: "Vibrador de hormigón", model: "2HP 50mm", category: "machine" },
  { name: "Grupo electrógeno", model: "5kVA diesel", category: "machine" },
  { name: "Grupo electrógeno", model: "10kVA trifásico", category: "machine" },
  { name: "Allanadora", model: "doble rotor 90cm", category: "machine" },
  { name: "Pulidora", model: "piso hormigón", category: "machine" },
  { name: "Compresor", model: "portátil 5m3", category: "machine" },
  { name: "Amoladora", model: "115mm 850W", category: "tool" },
  { name: "Amoladora", model: "230mm industrial", category: "tool" },
  { name: "Taladro percutor", model: "Bosch GSB 13 RE", category: "tool" },
  { name: "Sierra circular", model: "7 1/4\"", category: "tool" },
  { name: "Sierra circular", model: "9 1/4\" industrial", category: "tool" },
  { name: "Soldadora inverter", model: "160A portátil", category: "tool" },
  { name: "Soldadora inverter", model: "200A profesional", category: "tool" },
  { name: "Máquina de pintar", model: "airless", category: "tool" },
  { name: "Escalera extensible", model: "5m", category: "tool" },
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

  let inserted = 0
  let skipped = 0

  for (const m of INVENTORY) {
    const dup = await colRef
      .where("name", "==", m.name)
      .where("model", "==", m.model)
      .limit(1)
      .get()
    if (!dup.empty) {
      console.log(`  [SKIP] ${m.name} (${m.model})`)
      skipped++
      continue
    }
    await colRef.add({
      name: m.name,
      model: m.model,
      category: m.category,
      status: "available",
      locationType: "deposito",
      rental: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    console.log(`  [OK]   ${m.name} (${m.model}) [${m.category}]`)
    inserted++
  }

  console.log(`\n--- Resumen ---`)
  console.log(`Insertadas: ${inserted}`)
  console.log(`Omitidas: ${skipped}`)
  console.log(`Total: ${INVENTORY.length}`)
}

main().catch(console.error)
