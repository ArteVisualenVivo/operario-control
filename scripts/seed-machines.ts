/**
 * Script de seed para precargar inventario de Cocrear en Firestore.
 *
 * Uso:
 *   1. service-account.json en la raíz del proyecto
 *   2. Ejecutar: npx tsx scripts/seed-machines.ts
 */

import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import * as fs from "fs"
import * as path from "path"

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "service-account.json")
const COLLECTION = "machines"

type MachineCategory = "andamio" | "maquinaria" | "herramienta"

interface SeedMachine {
  name: string
  model: string
  category: MachineCategory
  subcategory?: string
}

const machines: SeedMachine[] = [
  // ANDAMIOS
  { name: "Andamio tubular", model: "estándar obra", category: "andamio", subcategory: "base" },
  { name: "Andamio tubular", model: "reforzado pesado", category: "andamio", subcategory: "base" },
  { name: "Andamio modular", model: "marco europeo", category: "andamio", subcategory: "base" },
  { name: "Andamio modular", model: "heavy duty modular", category: "andamio", subcategory: "reforzado" },
  { name: "Andamio pasillero", model: "pasarela 1m", category: "andamio", subcategory: "pasillero" },
  { name: "Andamio pasillero", model: "pasarela 1.5m", category: "andamio", subcategory: "pasillero" },
  { name: "Andamio reforzado", model: "industrial 3T", category: "andamio", subcategory: "reforzado" },
  { name: "Andamio reforzado", model: "uso profesional pesado", category: "andamio", subcategory: "reforzado" },
  { name: "Caballetes", model: "metálico plegable", category: "andamio", subcategory: "caballetes" },
  { name: "Caballetes", model: "reforzado madera", category: "andamio", subcategory: "caballetes" },
  { name: "Tablón para andamios", model: "madera 3m", category: "andamio", subcategory: "tablón" },
  { name: "Tablón para andamios", model: "metálico antideslizante", category: "andamio", subcategory: "tablón" },
  { name: "Puntales telescópicos", model: "1.5–3m", category: "andamio", subcategory: "puntales" },
  { name: "Puntales telescópicos", model: "2–4m", category: "andamio", subcategory: "puntales" },
  { name: "Puntales telescópicos", model: "heavy duty", category: "andamio", subcategory: "puntales" },
  // MAQUINARIA
  { name: "Pisón canguro", model: "Honda GX160 BS50", category: "maquinaria" },
  { name: "Pisón canguro", model: "Wacker BS50-2i", category: "maquinaria" },
  { name: "Pisón canguro", model: "Bomag BT65", category: "maquinaria" },
  { name: "Pisón canguro", model: "Belle RTX50", category: "maquinaria" },
  { name: "Hormigonera", model: "130L eléctrica", category: "maquinaria" },
  { name: "Hormigonera", model: "350L profesional", category: "maquinaria" },
  { name: "Hormigonera", model: "400L industrial", category: "maquinaria" },
  { name: "Martillo demoledor", model: "Bosch GSH 16-28", category: "maquinaria" },
  { name: "Martillo demoledor", model: "Makita HM1317C", category: "maquinaria" },
  { name: "Martillo demoledor", model: "DeWalt D25980", category: "maquinaria" },
  { name: "Vibrador de hormigón", model: "1.5HP 35mm", category: "maquinaria" },
  { name: "Vibrador de hormigón", model: "2HP 50mm industrial", category: "maquinaria" },
  { name: "Grupo electrógeno", model: "3kVA portátil", category: "maquinaria" },
  { name: "Grupo electrógeno", model: "5kVA diesel", category: "maquinaria" },
  { name: "Grupo electrógeno", model: "10kVA trifásico", category: "maquinaria" },
  { name: "Allanadora", model: "manual", category: "maquinaria" },
  { name: "Allanadora", model: "doble rotor 90cm", category: "maquinaria" },
  { name: "Pulidora", model: "piso hormigón", category: "maquinaria" },
  { name: "Pulidora", model: "industrial diamante", category: "maquinaria" },
  { name: "Compresor", model: "portátil 5m3", category: "maquinaria" },
  { name: "Compresor", model: "industrial 10bar", category: "maquinaria" },
  // HERRAMIENTAS
  { name: "Amoladora", model: "115mm 850W", category: "herramienta" },
  { name: "Amoladora", model: "125mm 1200W", category: "herramienta" },
  { name: "Amoladora", model: "230mm industrial", category: "herramienta" },
  { name: "Taladro percutor", model: "Bosch GSB 13 RE", category: "herramienta" },
  { name: "Taladro percutor", model: "Makita HP1640", category: "herramienta" },
  { name: "Sierra circular", model: "7 1/4\"", category: "herramienta" },
  { name: "Sierra circular", model: "9 1/4\" industrial", category: "herramienta" },
  { name: "Soldadora inverter", model: "160A portátil", category: "herramienta" },
  { name: "Soldadora inverter", model: "200A profesional", category: "herramienta" },
  { name: "Máquina de pintar", model: "airless 3000 PSI", category: "herramienta" },
  { name: "Máquina de pintar", model: "eléctrica 220V", category: "herramienta" },
]

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error("ERROR: No se encuentra service-account.json en la raíz del proyecto.")
    console.error("Descárgalo desde: Firebase Console > Project Settings > Service Accounts > Generate new private key")
    process.exit(1)
  }

  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"))

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
    })
  }

  const db = getFirestore()
  const colRef = db.collection(COLLECTION)

  const existing = await colRef.limit(1).get()
  if (!existing.empty) {
    console.log("La colección ya tiene datos. Verificando duplicados por nombre + modelo...")
  }

  let inserted = 0
  let skipped = 0

  for (const m of machines) {
    const dup = await colRef
      .where("name", "==", m.name)
      .where("model", "==", m.model)
      .limit(1)
      .get()

    if (!dup.empty) {
      console.log(`  [SKIP] ${m.name} (${m.model}) — ya existe`)
      skipped++
      continue
    }

    await colRef.add({
      name: m.name,
      model: m.model,
      category: m.category,
      subcategory: m.subcategory ?? null,
      status: "available",
      location: "deposito",
      rental: null,
      maintenance: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    console.log(`  [OK]   ${m.name} (${m.model}) [${m.category}]`)
    inserted++
  }

  console.log("\n--- Resumen ---")
  console.log(`Insertadas: ${inserted}`)
  console.log(`Omitidas (ya existían): ${skipped}`)
  console.log(`Total en lista: ${machines.length}`)
}

main().catch(console.error)
