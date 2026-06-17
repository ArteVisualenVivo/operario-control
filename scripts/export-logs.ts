/**
 * Script de exportación de audit_logs desde Firebase
 *
 * Uso:
 *   1. Descargar service-account.json desde Firebase Console > Project Settings > Service Accounts
 *   2. Colocar en la raíz del proyecto (agregado a .gitignore)
 *   3. Ejecutar: npx tsx scripts/export-logs.ts
 *
 * Genera archivos .txt en local_exports/logs/
 */

import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import * as fs from "fs"
import * as path from "path"

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "..", "service-account.json")
const OUTPUT_DIR = path.resolve(__dirname, "..", "local_exports", "logs")

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
  const logsRef = db.collection("audit_logs")
  const snapshot = await logsRef.orderBy("timestamp", "asc").get()

  if (snapshot.empty) {
    console.log("No hay audit_logs en Firestore.")
    return
  }

  // Asegurar que el directorio de salida existe
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filename = `audit_logs_${timestamp}.txt`
  const filepath = path.join(OUTPUT_DIR, filename)

  const lines: string[] = []

  snapshot.forEach((doc) => {
    const data = doc.data()
    const date = data.timestamp?.toDate?.()?.toISOString() ?? "unknown"
    const before = data.before ? JSON.stringify(data.before, null, 2) : "null"
    const after = data.after ? JSON.stringify(data.after, null, 2) : "null"

    lines.push("=".repeat(50))
    lines.push(`[DATE]: ${date}`)
    lines.push(`ACTION: ${data.action}`)
    lines.push(`ENTITY: ${data.entity}`)
    lines.push(`ID: ${data.entityId}`)
    lines.push(`BEFORE:`)
    lines.push(before)
    lines.push(`AFTER:`)
    lines.push(after)
    lines.push(`USER: ${data.userId}`)
    lines.push("")
  })

  fs.writeFileSync(filepath, lines.join("\n"), "utf-8")
  console.log(`Exportación completada: ${filepath}`)
  console.log(`Total de registros: ${snapshot.size}`)
}

main().catch(console.error)
