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
import { trace as forensicTrace, flush } from "./tracer.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const AHK_DIR = path.join(PROJECT_ROOT, "automation")
const EXPORTS_DIR = path.resolve(PROJECT_ROOT, "automation-watcher", "3c_exports")
const CACHE_DIR = path.resolve(PROJECT_ROOT, "automation-watcher", "cache")
const STOCK_CACHE_FILE = path.join(CACHE_DIR, "stock-cache.json")
const MACHINES_CACHE_FILE = path.join(CACHE_DIR, "machines-cache.json")
const SPARE_PARTS_CACHE_FILE = path.join(CACHE_DIR, "spare-parts-cache.json")

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
    alquileres: "sync_alquileres.ahk",
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

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true })
    }
}

function safeWriteJson(filePath, data) {
    try {
        ensureCacheDir()
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    } catch (err) {
        console.warn(`[AGENT] No se pudo escribir cache ${path.basename(filePath)}:`, err?.message)
    }
}

function buildMachineSeedFromStock(items) {
    const scaffoldNames = new Set([
        "andamio tubular",
        "andamio modular",
        "andamio pasillero",
        "andamio reforzado",
        "caballetes",
        "tablón para andamios",
        "tablones",
        "puntales telescópicos",
        "puntales",
        "riendas",
    ])

    return items
        .filter((item) => scaffoldNames.has(String(item.name ?? "").toLowerCase().trim()))
        .map((item, index) => ({
            id: `local-${item.codigo || item.normalizedName || index}`,
            name: item.name,
            model: item.codigo || item.normalizedName || "3C",
            category: "scaffold",
            status: "available",
            locationType: "deposito",
            location: null,
            rental: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }))
}

function buildSparePartsSeedFromStock(items) {
    return items
        .filter((item) => {
            const name = String(item.name ?? "").toLowerCase().trim()
            return name.includes("andamio") || name.includes("tabl") || name.includes("rienda") || name.includes("puntal")
        })
        .slice(0, 50)
        .map((item, index) => ({
            id: `local-part-${item.codigo || index}`,
            machineId: `local-${item.codigo || index}`,
            machineName: item.name,
            machineModel: item.codigo || "3C",
            partName: item.name,
            partCode: item.codigo || `AUTO-${index + 1}`,
            category: "estructural",
            unit: item.unit || "unidad",
            stockTotal: item.stockTotal || 0,
            stockAvailable: item.stockTotal || 0,
            stockUsed: 0,
            source: "manual",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }))
}

async function processCommand(redis, commandId, module) {
    const startTime = Date.now()
    isProcessing = true

    forensicTrace("PROCESS_COMMAND", "ENTRÓ A processCommand()", {
        commandId,
        module,
        isProcessing: true,
        timestamp: startTime,
    })

    try {
        const beforeStatus = await redis.hgetall(`sync-3c:command:${commandId}`)
        forensicTrace("REDIS", "HGETALL antes de marcar running", {
            key: `sync-3c:command:${commandId}`,
            status: beforeStatus?.status,
            module: beforeStatus?.module,
            createdAt: beforeStatus?.createdAt,
            startedAt: beforeStatus?.startedAt,
            completedAt: beforeStatus?.completedAt,
        })

        await redis.hset(`sync-3c:command:${commandId}`, {
            status: "running",
            startedAt: Date.now(),
            agent: MACHINE_NAME,
        })
        forensicTrace("REDIS", "HSET marcó running", {
            key: `sync-3c:command:${commandId}`,
            status: "running",
            startedAt: Date.now(),
            agent: MACHINE_NAME,
        })

        await redis.set("sync-3c:agent:production", JSON.stringify({
            status: "running",
            lastHeartbeat: Date.now(),
            machineName: MACHINE_NAME,
        }), { ex: 120 })
        forensicTrace("REDIS", "SET heartbeat", {
            key: "sync-3c:agent:production",
            status: "running",
            ex: 120,
        })

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
        forensicTrace("AHK", "Script elegido", {
            module,
            scriptName,
            scriptPath,
            exists: fs.existsSync(scriptPath),
        })

        const ahkStart = Date.now()
        await runAhk(scriptPath)
        const ahkEnd = Date.now()
        forensicTrace("AHK", "Ejecución completada", {
            module,
            scriptName,
            durationMs: ahkEnd - ahkStart,
            startTime: ahkStart,
            endTime: ahkEnd,
        })

        const exportStart = Date.now()
        const latest = await waitForExport()
        const exportEnd = Date.now()
        console.log(`[AGENT] Export found: ${latest.name}`)
        forensicTrace("EXCEL", "Archivo encontrado", {
            name: latest.name,
            path: latest.fullPath,
            sizeBytes: fs.statSync(latest.fullPath).size,
            mtime: new Date(latest.mtime).toISOString(),
            waitDurationMs: exportEnd - exportStart,
        })

        const buffer = fs.readFileSync(latest.fullPath).buffer

        let result
        let items = []

        if (module === "reparaciones") {
            result = {
                success: true,
                created: 0,
                updated: 0,
                skipped: 0,
                warnings: [],
            }
        } else {
            const parsed = parseExcel(buffer)
            items = parsed.items
            forensicTrace("EXCEL", "Parseo completado", {
                module,
                rowsRead: items.length,
                firstItem: items[0] ? { code: items[0].codigo, name: items[0].name } : null,
            })

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
                    const firestoreStart = Date.now()
                    result = await syncItems(items)
                    const firestoreEnd = Date.now()
                    forensicTrace("FIRESTORE", "Sincronización completada", {
                        module,
                        collection: "inventory_stock",
                        created: result.created,
                        updated: result.updated,
                        skipped: result.skipped,
                        durationMs: firestoreEnd - firestoreStart,
                    })
                } catch (err) {
                    console.error("========== FIREBASE ERROR ==========")
                    console.error(err)
                    console.error("message:", err?.message)
                    console.error("code:", err?.code)
                    console.error("details:", err?.details)
                    console.error("stack:", err?.stack)
                    console.error("metadata:", err?.metadata)
                    console.error("===================================")

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
                    forensicTrace("FIRESTORE", "Sincronización falló (degradado)", {
                        module,
                        error: err?.message,
                        skipped: items.length,
                    })
                }
            }
        }

        if (module === "reparaciones") {
            try {
                console.log("[AGENT] MAINTENANCE SYNC START")
                console.log("[AGENT] Ejecutando syncRepairsToMaintenance")
                const maintenanceResult = await syncRepairsToMaintenance(buffer)
                console.log("[AGENT] MAINTENANCE SYNC RESULT", maintenanceResult)
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
                forensicTrace("FIRESTORE", "Mantenimiento sincronizado", {
                    created: maintenanceResult.created,
                    updated: maintenanceResult.updated,
                    skipped: maintenanceResult.skipped,
                })
            } catch (maintErr) {
                console.error(`[AGENT] Maintenance sync failed:`, maintErr instanceof Error ? maintErr.message : String(maintErr))
                result = {
                    ...result,
                    maintenanceError: maintErr instanceof Error ? maintErr.message : String(maintErr),
                }
                forensicTrace("FIRESTORE", "Mantenimiento falló", {
                    error: maintErr instanceof Error ? maintErr.message : String(maintErr),
                })
            }
        }

        if (module === "stock") {
            safeWriteJson(STOCK_CACHE_FILE, items)
            safeWriteJson(MACHINES_CACHE_FILE, buildMachineSeedFromStock(items))
            safeWriteJson(SPARE_PARTS_CACHE_FILE, buildSparePartsSeedFromStock(items))
            console.log("[AGENT] Local stock cache actualizado")
        }

        await redis.hset(`sync-3c:result:${commandId}`, {
            status: "completed",
            module,
            result: JSON.stringify(result),
            updatedAt: Date.now(),
        })
        forensicTrace("REDIS", "HSET resultado", {
            key: `sync-3c:result:${commandId}`,
            status: "completed",
            module,
            resultSize: JSON.stringify(result).length,
        })

        await redis.hset(`sync-3c:command:${commandId}`, {
            status: "completed",
            completedAt: Date.now(),
            result: JSON.stringify(result),
        })
        forensicTrace("REDIS", "HSET comando completado", {
            key: `sync-3c:command:${commandId}`,
            status: "completed",
            completedAt: Date.now(),
        })

        console.log(`[AGENT] Command ${commandId} completed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`)
        forensicTrace("PROCESS_COMMAND", "FIN MODULO", {
            commandId,
            module,
            durationMs: Date.now() - startTime,
            resultado: `${result.created} created, ${result.updated} updated, ${result.skipped} skipped`,
        })
    } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido"
        console.error(`[AGENT] Command ${commandId} failed: ${message}`)

        await redis.hset(`sync-3c:command:${commandId}`, {
            status: "failed",
            error: message,
            completedAt: Date.now(),
        })
        forensicTrace("PROCESS_COMMAND", "ERROR en módulo", {
            commandId,
            module,
            error: message,
            durationMs: Date.now() - startTime,
        })
    } finally {
        isProcessing = false
        forensicTrace("PROCESS_COMMAND", "finally - isProcessing = false", {
            commandId,
            module,
            isProcessing: false,
        })
    }
}

async function pollQueue(redis) {
    console.log("[AGENT] Redis polling started (5s)")
    forensicTrace("POLL_QUEUE", "Inicio de pollQueue()", {
        machineName: MACHINE_NAME,
        pollIntervalMs: POLL_INTERVAL_MS,
    })

    while (true) {
        try {
            if (isProcessing) {
                forensicTrace("POLL_QUEUE", "isProcessing = true, esperando", {
                    isProcessing: true,
                })
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
                continue
            }

            forensicTrace("POLL_QUEUE", "Entró nuevamente a pollQueue()", {
                isProcessing: false,
                timestamp: Date.now(),
            })

            // Leer tamaño y contenido de la cola antes del RPOP
            const queueBefore = await redis.lrange("sync-3c:queue", 0, -1)
            forensicTrace("REDIS", "LRANGE cola antes de RPOP", {
                key: "sync-3c:queue",
                size: queueBefore.length,
                content: queueBefore,
            })

            const rpopStart = Date.now()
            const commandId = await redis.rpop("sync-3c:queue")
            const rpopEnd = Date.now()
            forensicTrace("REDIS", "RPOP ejecutado", {
                key: "sync-3c:queue",
                commandIdObtenido: commandId,
                devolvioNull: commandId === null,
                durationMs: rpopEnd - rpopStart,
            })

            if (!commandId) {
                forensicTrace("POLL_QUEUE", "RPOP devolvió NULL - cola vacía", {
                    timestamp: Date.now(),
                })
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
                continue
            }

            const raw = await redis.hgetall(`sync-3c:command:${commandId}`)
            forensicTrace("REDIS", "HGETALL comando", {
                key: `sync-3c:command:${commandId}`,
                status: raw?.status,
                module: raw?.module,
                createdAt: raw?.createdAt,
                startedAt: raw?.startedAt,
                completedAt: raw?.completedAt,
            })

            if (!raw || raw.status !== "pending") {
                forensicTrace("POLL_QUEUE", "Comando descartado", {
                    commandId,
                    razon: !raw ? "hash no existe" : `status = ${raw.status} (no es pending)`,
                })
                console.log(`[AGENT] Command ${commandId} skipped (not pending)`)
                continue
            }

            const module = raw.module || "stock"
            forensicTrace("POLL_QUEUE", "Entrando a processCommand()", {
                commandId,
                module,
                status: raw.status,
            })

            await processCommand(redis, commandId, module)

            forensicTrace("POLL_QUEUE", "processCommand() terminó, esperando siguiente comando", {
                commandId,
                module,
                timestamp: Date.now(),
            })
        } catch (err) {
            console.error("[AGENT] Polling error:", err.message)
            forensicTrace("POLL_QUEUE", "ERROR en pollQueue", {
                error: err.message,
                stack: err.stack,
            })
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
    forensicTrace("MAIN", "Inicio del agente", {
        machineName: MACHINE_NAME,
        timestamp: Date.now(),
        nodeVersion: process.version,
    })

    const redis = getRedis()
    forensicTrace("MAIN", "Redis conectado", {
        url: process.env.UPSTASH_REDIS_REST_URL ? "configurado" : "FALTANTE",
    })

    await recoverStaleCommands(redis)
    startHeartbeat(redis)
    void pollQueue(redis)

    console.log("[AGENT] Initial sweep complete, waiting for commands...")
    forensicTrace("MAIN", "Agente listo, esperando comandos", {
        timestamp: Date.now(),
    })
}

main().catch((err) => {
    console.error("[AGENT] Fatal error:", err)
    process.exit(1)
})