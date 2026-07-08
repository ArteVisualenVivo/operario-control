/**
 * Script temporal de auditoría de la colección maintenance.
 * No modifica datos, solo lee y reporta.
 */

import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

// Firebase Admin
// eslint-disable-next-line @typescript-eslint/no-var-requires
const admin = require("firebase-admin")

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname)
const SERVICE_ACCOUNT_PATH = path.join(PROJECT_ROOT, "sync-agent/service-account.json")

const ORDER_PATTERN = /^X\s?\d{4}-\d{8}$/i

function log(msg: string) {
    console.log(msg)
}

async function main() {
    log("=== AUDITORÍA COLECCIÓN MAINTENANCE ===")
    log(`Service account: ${SERVICE_ACCOUNT_PATH}`)

    if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
        log("ERROR: No existe sync-agent/service-account.json")
        process.exit(1)
    }

    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"))
    const apps = admin.getApps()
    if (apps.length > 0) {
        for (const app of apps) {
            try { await app.delete() } catch { /* noop */ }
        }
    }
    admin.initializeApp({ credential: admin.cert(serviceAccount) })

    const { getFirestore } = require("firebase-admin/firestore")
    const db = getFirestore()
    const collection = db.collection("maintenance")

    // 1. Contar total de documentos
    const snapshot = await collection.get()
    const total = snapshot.size
    log(`\nTotal de documentos en maintenance: ${total}`)

    // 2. Obtener últimas 20 órdenes por entryDate descendente
    const q = collection.orderBy("entryDate", "desc").limit(20)
    const recentSnap = await q.get()
    const docs = recentSnap.docs

    log(`\nÚltimas ${docs.length} órdenes:`)
    log("=".repeat(120))

    let accepted = 0
    let rejected = 0
    const rejectedExamples: Array<{ orderNumber: string; reason: string }> = []

    for (const doc of docs) {
        const data = doc.data()
        const orderNumber = String(data.orderNumber ?? "")
        const entryDate = data.entryDate ? new Date(data.entryDate).toISOString() : "N/A"
        const updatedAt = data.updatedAt ? new Date(data.updatedAt).toISOString() : "N/A"
        const clientName = String(data.clientName ?? "")
        const machineName = String(data.machineName ?? "")

        const matches = ORDER_PATTERN.test(orderNumber)
        const status = matches ? "✓" : "✗"

        if (matches) accepted++
        else {
            rejected++
            rejectedExamples.push({ orderNumber, reason: "No coincide con ORDER_PATTERN" })
        }

        log(`${status} ${orderNumber.padEnd(20)} | ${entryDate} | ${updatedAt} | ${clientName.padEnd(20)} | ${machineName}`)
    }

    log("=".repeat(120))
    log(`\nResumen:`)
    log(`  Aceptadas por ORDER_PATTERN: ${accepted}`)
    log(`  Descartadas por ORDER_PATTERN: ${rejected}`)

    if (rejectedExamples.length > 0) {
        log(`\nEjemplos de órdenes descartadas:`)
        for (const ex of rejectedExamples) {
            log(`  ✗ ${ex.orderNumber} - ${ex.reason}`)
        }
    }

    // 3. Verificar si existen órdenes posteriores al día 03
    log(`\nBuscando órdenes posteriores al día 03 del mes actual...`)
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    const day03 = new Date(currentYear, currentMonth, 3)

    let postDay03Count = 0
    const postDay03Examples: Array<{ orderNumber: string; entryDate: string }> = []

    // Recorrer TODOS los documentos (no solo los últimos 20)
    const allDocs = await collection.orderBy("entryDate", "desc").get()
    for (const doc of allDocs.docs) {
        const data = doc.data()
        const entryDate = data.entryDate ? new Date(data.entryDate) : null
        if (entryDate && entryDate > day03) {
            postDay03Count++
            if (postDay03Examples.length < 10) {
                postDay03Examples.push({
                    orderNumber: String(data.orderNumber ?? ""),
                    entryDate: entryDate.toISOString(),
                })
            }
        }
    }

    log(`\nÓrdenes con entryDate posterior al día 03: ${postDay03Count}`)
    if (postDay03Examples.length > 0) {
        log("Ejemplos:")
        for (const ex of postDay03Examples) {
            log(`  ✓ ${ex.orderNumber} - ${ex.entryDate}`)
        }
    }

    // 4. Análisis de regex
    log(`\n=== ANÁLISIS DE ORDER_PATTERN ===`)
    log(`Patrón usado en web: ${ORDER_PATTERN}`)
    log(`  - X mayúscula`)
    log(`  - Espacio opcional`)
    log(`  - 4 dígitos`)
    log(`  - Guion`)
    log(`  - 8 dígitos`)

    const enginePattern = /^x\s?\d{3,6}-\d{4,10}$/i
    log(`\nPatrón usado en engine: ${enginePattern}`)
    log(`  - x minúscula (case insensitive)`)
    log(`  - Espacio opcional`)
    log(`  - 3-6 dígitos`)
    log(`  - Guion`)
    log(`  - 4-10 dígitos`)

    log(`\nDiferencia:`)
    log(`  Web: 4-8 dígitos antes del guion, 8 dígitos después`)
    log(`  Engine: 3-6 dígitos antes del guion, 4-10 dígitos después`)

    // 5. Verificar ejemplos concretos
    log(`\n=== VERIFICACIÓN DE EJEMPLOS ===`)
    const testCases = [
        "X 1234-20240001",
        "X 123-2024",
        "X1234-20240001",
        "X 1254",
        "X1254",
    ]

    for (const test of testCases) {
        const webMatch = ORDER_PATTERN.test(test)
        const engineMatch = enginePattern.test(test)
        log(`  "${test}"`)
        log(`    Web:    ${webMatch ? "✓" : "✗"}`)
        log(`    Engine: ${engineMatch ? "✓" : "✗"}`)
    }

    log("\n=== FIN AUDITORÍA ===")
    process.exit(0)
}

main().catch((err) => {
    console.error("ERROR:", err)
    process.exit(1)
})