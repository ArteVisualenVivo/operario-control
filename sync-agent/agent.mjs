#!/usr/bin/env node

import dotenv from "dotenv"

dotenv.config({
  path: fileURLToPath(new URL("../.env.local", import.meta.url)),
})
import { Redis } from "@upstash/redis"
import { spawn, execSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { parseExcel } from "../src/lib/sync-3c/parser.js"
import { syncItems, syncRepairsToMaintenance } from "../src/lib/sync-3c/engine.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const AHK_DIR = path.join(PROJECT_ROOT, "automation")
const EXPORTS_DIR = path.resolve(PROJECT_ROOT, "automation-watcher", "3c_exports")

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

const AHK_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 30_000
const EXPORT_RETRIES = 10
const EXPORT_RETRY_DELAY_MS = 1000
const STALE_THRESHOLD_MINUTES = 10

const MODULE_SCRIPTS = {
  stock: "sync_3c.ahk",
  reparaciones: "sync_reparaciones.ahk",
  articulos: "sync_articulos.ahk",
}

const CANDIDATE_PATHS = [
  "AutoHotkey64.exe",
  "AutoHotkey32.exe",
  "AutoHotkey.exe",
  path.join("C:", "Program Files", "AutoHotkey", "AutoHotkey64.exe"),
  path.join("C:", "Program Files", "AutoHotkey", "AutoHotkey32.exe"),
  path.join("C:", "Program Files", "AutoHotkey", "v2", "AutoHotkey64.exe"),
]

let isProcessing = false

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    console.error("[AGENT] UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN son requeridos")
    console.error("[AGENT] Crear cuenta en https://upstash.com y configurar env vars")
    process.exit(1)
  }

  return new Redis({ url, token })
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

async function processCommand(redis, commandId, module) {
  isProcessing = true

  try {
    await redis.hset(`sync-3c:command:${commandId}`, {
      status: "running",
      startedAt: Date.now(),
      agent: MACHINE_NAME,
    })

    await redis.set("sync-3c:agent:production", JSON.stringify({
      status: "running",
      lastHeartbeat: Date.now(),
      machineName: MACHINE_NAME,
    }), { ex: 120 })

    console.log(`[AGENT] Processing command ${commandId} [module: ${module}]`)
    if (module === "reparaciones") {
      console.log("[AGENT] Reparaciones module recibido")
    }

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

    let result

    if (module === "reparaciones") {
      result = {
        success: true,
        created: 0,
        updated: 0,
        skipped: 0,
        warnings: [],
      }
    } else {
      const { items } = parseExcel(buffer)

      if (items.length === 0) {
        result = {
          success: true,
          created: 0,
          updated: 0,
          skipped: 0,
          warnings: [
            "El archivo exportado no contiene datos válidos en el formato esperado de 3C",
          ],
        }
      } else {
        try {
          result = await syncItems(items)
        } catch (err) {
          console.error("[AGENT] Firebase sync failed (temporary quota block):", err.message)

          result = {
            success: true,
            created: 0,
            updated: 0,
            skipped: items.length,
            warnings: [
              "Firebase temporalmente bloqueado por cuota (24h)",
              "Datos procesados pero no persistidos en inventario",
            ],
            degraded: true,
          }
        }
      }
    }

    if (module === "reparaciones") {
      try {
        console.log("[AGENT] Ejecutando syncRepairsToMaintenance")
        const maintenanceResult = await syncRepairsToMaintenance(buffer)
        console.log(`[AGENT] Resultado mantenimiento: created=${maintenanceResult.created}, updated=${maintenanceResult.updated}, skipped=${maintenanceResult.skipped}`)
        console.log(`[AGENT] Maintenance sync: ${maintenanceResult.created} created, ${maintenanceResult.updated} updated, ${maintenanceResult.skipped} skipped`)
        if (maintenanceResult.warnings.length > 0) {
          console.warn(`[AGENT] Maintenance warnings:`, maintenanceResult.warnings)
        }
        result = {
          ...result,
          maintenanceCreated: maintenanceResult.created,
          maintenanceUpdated: maintenanceResult.updated,
          maintenanceSkipped: maintenanceResult.skipped,
          maintenanceWarnings: maintenanceResult.warnings,
        }
      } catch (maintErr) {
        console.error(`[AGENT] Maintenance sync failed:`, maintErr instanceof Error ? maintErr.message : String(maintErr))
        result = {
          ...result,
          maintenanceError: maintErr instanceof Error ? maintErr.message : String(maintErr),
        }
      }
    }

    await redis.hset(`sync-3c:result:${commandId}`, {
      status: "completed",
      module,
      result: JSON.stringify(result),
      updatedAt: Date.now(),
    })

    await redis.hset(`sync-3c:command:${commandId}`, {
      status: "completed",
      completedAt: Date.now(),
      result: JSON.stringify(result),
    })

    console.log(`[AGENT] Command ${commandId} completed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido"
    console.error(`[AGENT] Command ${commandId} failed: ${message}`)

    await redis.hset(`sync-3c:command:${commandId}`, {
      status: "failed",
      error: message,
      completedAt: Date.now(),
    })
  } finally {
    isProcessing = false
  }
}

async function pollQueue(redis) {
  console.log("[AGENT] Redis polling started (5s)")

  while (true) {
    try {
      if (isProcessing) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        continue
      }

      const commandId = await redis.rpop("sync-3c:queue")
      if (!commandId) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        continue
      }

      const raw = await redis.hgetall(`sync-3c:command:${commandId}`)
      if (!raw || raw.status !== "pending") {
        console.log(`[AGENT] Command ${commandId} skipped (not pending)`)
        continue
      }

      const module = raw.module || "stock"
      await processCommand(redis, commandId, module)
    } catch (err) {
      console.error("[AGENT] Polling error:", err.message)
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

async function recoverStaleCommands(redis) {
  console.log("[AGENT] Checking for stale running commands...")
  let cursor = 0
  let recovered = 0
  const cutoff = Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000

  try {
    do {
      const result = await redis.scan(cursor, { match: "sync-3c:command:*" })
      const nextCursor = result[0]
      const keys = result[1]
      cursor = parseInt(nextCursor, 10)

      for (const key of keys) {
        const data = await redis.hgetall(key)
        if (data?.status !== "running") continue

        const startedAt = parseInt(data.startedAt ?? "0", 10)
        if (startedAt > 0 && startedAt >= cutoff) continue

        const id = key.replace("sync-3c:command:", "")
        await redis.hset(key, { status: "pending", startedAt: "", agent: "" })
        await redis.lpush("sync-3c:queue", id)
        recovered++
        console.log(`[AGENT] Recovered stale command ${id}`)
      }
    } while (cursor !== 0)
  } catch (err) {
    console.error("[AGENT] Recovery scan error:", err.message)
  }

  if (recovered > 0) console.log(`[AGENT] Recovered ${recovered} stale command(s)`)
  else console.log("[AGENT] No stale commands found")
}

function startHeartbeat(redis) {
  const beat = async () => {
    try {
      await redis.set("sync-3c:agent:production", JSON.stringify({
        status: isProcessing ? "running" : "idle",
        lastHeartbeat: Date.now(),
        machineName: MACHINE_NAME,
      }))
    } catch (err) {
      console.error("[AGENT] Heartbeat error:", err.message)
    }
  }

  beat()
  setInterval(beat, HEARTBEAT_INTERVAL_MS)
  console.log("[AGENT] Heartbeat started (Redis)")
}

async function main() {
  console.log(`[AGENT] Starting — Machine: ${MACHINE_NAME}`)
  const redis = getRedis()

  await recoverStaleCommands(redis)
  startHeartbeat(redis)
  void pollQueue(redis)

  console.log("[AGENT] Initial sweep complete, waiting for commands...")
}

main().catch((err) => {
  console.error("[AGENT] Fatal error:", err)
  process.exit(1)
})
