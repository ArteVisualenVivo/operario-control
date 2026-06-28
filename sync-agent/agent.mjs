#!/usr/bin/env node

import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore, Timestamp } from "firebase-admin/firestore"
import { spawn, execSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { parseExcel } from "../src/lib/sync-3c/parser.js"
import { syncItems } from "../src/lib/sync-3c/engine.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const AHK_DIR = path.join(PROJECT_ROOT, "automation")

const MODULE_SCRIPTS = {
  stock: "sync_3c.ahk",
  reparaciones: "sync_reparaciones.ahk",
}
const EXPORTS_DIR = path.resolve(PROJECT_ROOT, "automation-watcher", "3c_exports")
const SA_PATH = path.join(__dirname, "service-account.json")

const LOG_FILE = path.join(__dirname, "agent.log")
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" })
const origLog = console.log
const origError = console.error
console.log = (...args) => {
  const msg = `[${new Date().toISOString()}] ${args.join(" ")}`
  logStream.write(msg + "\n")
  origLog.apply(console, args)
}
console.error = (...args) => {
  const msg = `[${new Date().toISOString()}] [ERROR] ${args.join(" ")}`
  logStream.write(msg + "\n")
  origError.apply(console, args)
}

process.on("exit", () => logStream.end())
process.on("SIGINT", () => { logStream.end(); process.exit(0) })
process.on("SIGTERM", () => { logStream.end(); process.exit(0) })

const MACHINE_NAME = process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown-pc"
const COMMANDS_COLLECTION = "sync-3c-commands"
const AGENT_DOC_REF = "sync-3c-agent/production"

const AHK_TIMEOUT_MS = 120_000
const HEARTBEAT_INTERVAL_MS = 30_000
const EXPORT_RETRIES = 10
const EXPORT_RETRY_DELAY_MS = 1000
const STALE_THRESHOLD_MINUTES = 10

const CANDIDATE_PATHS = [
  "AutoHotkey64.exe",
  "AutoHotkey32.exe",
  "AutoHotkey.exe",
  path.join("C:", "Program Files", "AutoHotkey", "AutoHotkey64.exe"),
  path.join("C:", "Program Files", "AutoHotkey", "AutoHotkey32.exe"),
  path.join("C:", "Program Files", "AutoHotkey", "v2", "AutoHotkey64.exe"),
]

let isProcessing = false

function getDb() {
  if (getApps().length === 0) {
    const saJson =
      process.env.FIREBASE_SERVICE_ACCOUNT ||
      (fs.existsSync(SA_PATH) ? fs.readFileSync(SA_PATH, "utf-8") : null)

    if (!saJson) {
      console.error("[AGENT] FIREBASE_SERVICE_ACCOUNT no configurada.")
      console.error(`[AGENT] Crear archivo service-account.json en sync-agent/ o setear env var.`)
      process.exit(1)
    }

    const serviceAccount = JSON.parse(saJson)
    initializeApp({ credential: cert(serviceAccount) })
    console.log("[AGENT] Firebase Admin initialized")
  }
  return getFirestore()
}

function findAhkExe() {
  for (const p of CANDIDATE_PATHS) {
    try {
      const result = execSync(`where ${p} 2>nul`, { encoding: "utf-8" }).trim()
      if (result) return result.split("\n")[0].trim()
    } catch {
      // not in PATH
    }
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // skip
    }
  }
  return null
}

function runAhk(scriptPath) {
  return new Promise((resolve, reject) => {
    const exe = findAhkExe()
    if (!exe) {
      reject(new Error("AutoHotkey no encontrado. Instalalo desde https://www.autohotkey.com/"))
      return
    }

    const child = spawn(exe, [scriptPath], {
      cwd: AHK_DIR,
      windowsHide: true,
      shell: false,
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error("AHK timeout después de 120s — 3C puede no haber respondido"))
    }, AHK_TIMEOUT_MS)

    child.stdout?.on("data", (d) => process.stdout.write(`[AHK] ${d}`))
    child.stderr?.on("data", (d) => process.stderr.write(`[AHK:err] ${d}`))

    child.on("close", (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(`AHK terminó con código ${code}`))
    })

    child.on("error", (err) => {
      clearTimeout(timeout)
      reject(new Error(`Error al ejecutar AHK: ${err.message}`))
    })
  })
}

async function waitForExport() {
  for (let attempt = 0; attempt < EXPORT_RETRIES; attempt++) {
    const latest = findLatestExport()
    if (latest) return latest
    await new Promise((r) => setTimeout(r, EXPORT_RETRY_DELAY_MS))
  }
  throw new Error(
    `No se encontró archivo Excel en ${EXPORTS_DIR} tras ${EXPORT_RETRIES} intentos. ` +
    "Verificá que 3C haya exportado correctamente."
  )
}

function findLatestExport() {
  if (!fs.existsSync(EXPORTS_DIR)) return null

  const files = fs.readdirSync(EXPORTS_DIR)
    .filter((f) => f.endsWith(".xls") || f.endsWith(".xlsx"))
    .map((f) => {
      const fullPath = path.join(EXPORTS_DIR, f)
      try {
        return { name: f, mtime: fs.statSync(fullPath).mtimeMs, fullPath }
      } catch {
        return null
      }
    })
    .filter((f) => f !== null)
    .sort((a, b) => b.mtime - a.mtime)

  return files[0] ?? null
}

async function claimAndExecute(db, doc) {
  const agentRef = db.doc(AGENT_DOC_REF)

  try {
    await agentRef.set({ status: "running", lastHeartbeat: Timestamp.now(), machineName: MACHINE_NAME }, { merge: true })
    console.log(`[AGENT] Processing command ${doc.id}`)

    const data = doc.data()
    const module = data.module || "stock"
    const scriptName = MODULE_SCRIPTS[module]
    if (!scriptName) {
      throw new Error(`Módulo desconocido: "${module}"`)
    }
    const scriptPath = path.join(AHK_DIR, scriptName)
    console.log(`[AGENT] Module: ${module} → ${scriptName}`)

    await runAhk(scriptPath)

    const latest = await waitForExport()
    console.log(`[AGENT] Export found: ${latest.name}`)

    const buffer = fs.readFileSync(latest.fullPath).buffer
    const { items } = parseExcel(buffer)

    let result

    if (items.length === 0) {
      result = {
        success: true, created: 0, updated: 0, skipped: 0,
        warnings: ["El archivo exportado no contiene datos válidos en el formato esperado de 3C"],
      }
    } else {
      result = await syncItems(items)
    }

    await doc.ref.set({
      status: "completed",
      result,
      completedAt: Timestamp.now(),
      agent: MACHINE_NAME,
    }, { merge: true })

    console.log(`[AGENT] Command ${doc.id} completed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido"
    console.error(`[AGENT] Command ${doc.id} failed: ${message}`)

    await doc.ref.set({
      status: "failed",
      error: message,
      completedAt: Timestamp.now(),
      agent: MACHINE_NAME,
    }, { merge: true })
  } finally {
    await agentRef.set({ status: "idle", lastHeartbeat: Timestamp.now(), machineName: MACHINE_NAME }, { merge: true })
  }
}

async function processNextPending(db) {
  if (isProcessing) return
  isProcessing = true

  try {
    while (true) {
      const snapshot = await db.collection(COMMANDS_COLLECTION)
        .where("status", "==", "pending")
        .orderBy("createdAt", "asc")
        .limit(1)
        .get()

      if (snapshot.empty) break

      const doc = snapshot.docs[0]
      const data = doc.data()

      try {
        await db.runTransaction(async (transaction) => {
          const fresh = await transaction.get(doc.ref)
          if (fresh.data()?.status !== "pending") return false
          transaction.update(doc.ref, {
            status: "running",
            startedAt: Timestamp.now(),
            agent: MACHINE_NAME,
          })
          return true
        })
      } catch {
        break
      }

      await claimAndExecute(db, doc)
    }
  } finally {
    isProcessing = false
  }
}

async function recoverStaleCommands(db) {
  console.log("[AGENT] Checking for stale running commands...")
  const snapshot = await db.collection(COMMANDS_COLLECTION)
    .where("status", "==", "running")
    .get()

  const cutoff = Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000
  let recovered = 0

  for (const doc of snapshot.docs) {
    const data = doc.data()
    const startedAt = data.startedAt?.toMillis?.() ?? 0
    if (startedAt > 0 && startedAt >= cutoff) continue

    await doc.ref.update({
      status: "pending",
      startedAt: null,
      agent: null,
    })
    recovered++
    console.log(`[AGENT] Recovered stale command ${doc.id}`)
  }

  if (recovered > 0) console.log(`[AGENT] Recovered ${recovered} stale command(s)`)
  else console.log("[AGENT] No stale commands found")
}

function startHeartbeat(db) {
  const agentRef = db.doc(AGENT_DOC_REF)

  const beat = async () => {
    try {
      await agentRef.set({
        status: isProcessing ? "running" : "idle",
        lastHeartbeat: Timestamp.now(),
        machineName: MACHINE_NAME,
      }, { merge: true })
    } catch (err) {
      console.error("[AGENT] Heartbeat error:", err.message)
    }
  }

  beat()
  setInterval(beat, HEARTBEAT_INTERVAL_MS)
  console.log("[AGENT] Heartbeat started")
}

async function pollForCommands(db) {
  console.log("[AGENT] Command polling started (every 5s)")
  while (true) {
    try {
      await processNextPending(db)
    } catch (err) {
      console.error("[AGENT] Polling error:", err.message)
    }
    await new Promise((r) => setTimeout(r, 30000))
  }
}

async function main() {
  console.log(`[AGENT] Starting — Machine: ${MACHINE_NAME}`)
  const db = getDb()

  await recoverStaleCommands(db)

  startHeartbeat(db)

  void pollForCommands(db)

  console.log("[AGENT] Initial sweep complete, waiting for commands...")
}

main().catch((err) => {
  console.error("[AGENT] Fatal error:", err)
  process.exit(1)
})
