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
import { parseExcel } from "../src/lib/sync-3c/parser"
import { syncItems, syncRepairsToMaintenance } from "../src/lib/sync-3c/engine"
import { parseScaffoldRentals, saveScaffoldRentalStats } from "../src/lib/sync-3c/scaffoldRentals"
import type { Sync3CItem } from "../src/lib/sync-3c/types"

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
    return new Promise<void>((resolve, reject) => {
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

type ModuleName = "stock" | "reparaciones" | "articulos" | "alquileres"

// =============================================================================
// PIPELINE INSTRUMENTATION
// =============================================================================
let pipelineId: string | null = null
let pipelineModules: string[] = []
let pipelineStepIndex = 0
let pipelineStartTime = 0
let processedCommandIds = new Set<string>()

function logPipelineStart(modules: string[]) {
    pipelineId = Date.now().toString().slice(-6)
    pipelineModules = modules
    pipelineStepIndex = 0
    pipelineStartTime = Date.now()
    processedCommandIds = new Set<string>()

    console.log("================================================")
    console.log(`PIPELINE START`)
    console.log(`Pipeline ID: ${pipelineId}`)
    console.log(`Módulos:`)
    modules.forEach((mod, idx) => {
        console.log(`${idx + 1}. ${mod}`)
    })
    console.log("================================================")
}

function logPipelineStep(step: number, total: number, module: string, commandId: string) {
    console.log("================================================")
    console.log(`PIPELINE STEP ${step}/${total}`)
    console.log(`Module: ${module}`)
    console.log(`CommandId: ${commandId}`)
    console.log("================================================")
}

function logPipelineStepCompleted(step: number, total: number, module: string, duration: number, result: any) {
    console.log("================================================")
    console.log(`PIPELINE STEP ${step}/${total} COMPLETED`)
    console.log(`Duration: ${duration}ms`)
    console.log(`Created: ${result.created || 0}`)
    console.log(`Updated: ${result.updated || 0}`)
    console.log(`Skipped: ${result.skipped || 0}`)
    if (result.warnings && result.warnings.length > 0) {
        console.log(`Warnings: ${result.warnings.length}`)
    }
    console.log("================================================")
}

function logPipelineFinished(success: boolean, errors: string[]) {
    const totalDuration = Date.now() - pipelineStartTime
    console.log("================================================")
    console.log(`PIPELINE FINISHED`)
    console.log(`Tiempo total: ${totalDuration}ms`)
    console.log(`Módulos ejecutados: ${pipelineStepIndex}/${pipelineModules.length}`)
    console.log(`Errores: ${errors.length > 0 ? errors.join(", ") : "Ninguno"}`)
    console.log("================================================")
}

// =============================================================================
// END PIPELINE INSTRUMENTATION
// =============================================================================

async function processCommand(redis: Redis, commandId: string, module: ModuleName): Promise<any> {
    isProcessing = true

    const tStart = Date.now()
    console.log(`=========================`)
    console.log(`ETAPA: Inicio proceso command ${commandId}`)
    console.log(`INICIO: ${tStart}`)
    console.log(`=========================`)

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

        // ETAPA: AutoHotkey
        const tAhkStart = Date.now()
        await runAhk(scriptPath)
        const tAhkEnd = Date.now()
        console.log(`=========================`)
        console.log(`ETAPA: AutoHotkey`)
        console.log(`INICIO: ${tAhkStart}`)
        console.log(`FIN: ${tAhkEnd}`)
        console.log(`DURACIÓN: ${tAhkEnd - tAhkStart}ms`)
        console.log(`=========================`)

        // ETAPA: waitForExport
        const tExportStart = Date.now()
        const latest = await waitForExport()
        const tExportEnd = Date.now()
        console.log(`=========================`)
        console.log(`ETAPA: waitForExport`)
        console.log(`INICIO: ${tExportStart}`)
        console.log(`FIN: ${tExportEnd}`)
        console.log(`DURACIÓN: ${tExportEnd - tExportStart}ms`)
        console.log(`ARCHIVO: ${latest.name}`)
        console.log(`=========================`)

        // ETAPA: readFileSync
        const tReadStart = Date.now()
        const buffer = fs.readFileSync(latest.fullPath).buffer
        const tReadEnd = Date.now()
        console.log(`=========================`)
        console.log(`ETAPA: readFileSync`)
        console.log(`INICIO: ${tReadStart}`)
        console.log(`FIN: ${tReadEnd}`)
        console.log(`DURACIÓN: ${tReadEnd - tReadStart}ms`)
        console.log(`=========================`)

        let result
        let items: Sync3CItem[] = []

        if (module === "reparaciones") {
            result = {
                success: true,
                created: 0,
                updated: 0,
                skipped: 0,
                warnings: [],
            }
        } else {
            // ETAPA: parseExcel
            const tParseStart = Date.now()
            const parsed = parseExcel(buffer)
            items = parsed.items
            const tParseEnd = Date.now()
            console.log(`=========================`)
            console.log(`ETAPA: parseExcel`)
            console.log(`INICIO: ${tParseStart}`)
            console.log(`FIN: ${tParseEnd}`)
            console.log(`DURACIÓN: ${tParseEnd - tParseStart}ms`)
            console.log(`FILAS EXCEL: ${items.length}`)
            console.log(`=========================`)

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
                    // ETAPA: syncItems
                    const tSyncStart = Date.now()
                    result = await syncItems(items)
                    const tSyncEnd = Date.now()
                    console.log(`=========================`)
                    console.log(`ETAPA: syncItems`)
                    console.log(`INICIO: ${tSyncStart}`)
                    console.log(`FIN: ${tSyncEnd}`)
                    console.log(`DURACIÓN: ${tSyncEnd - tSyncStart}ms`)
                    console.log(`=========================`)
                } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err))
                    console.error("========== FIREBASE ERROR ==========")
                    console.error(error)
                    console.error("message:", error.message)
                    console.error("stack:", error.stack)
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
                }
            }
        }

        // ETAPA: Redis hset result
        const tRedisStart = Date.now()
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
        const tRedisEnd = Date.now()
        console.log(`=========================`)
        console.log(`ETAPA: Redis hset result`)
        console.log(`INICIO: ${tRedisStart}`)
        console.log(`FIN: ${tRedisEnd}`)
        console.log(`DURACIÓN: ${tRedisEnd - tRedisStart}ms`)
        console.log(`=========================`)

        const tEnd = Date.now()
        console.log(`=========================`)
        console.log(`ETAPA: Fin proceso command ${commandId}`)
        console.log(`INICIO: ${tStart}`)
        console.log(`FIN: ${tEnd}`)
        console.log(`DURACIÓN TOTAL: ${tEnd - tStart}ms`)
        console.log(`=========================`)

        console.log(`[AGENT] Command ${commandId} completed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`)

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
            } catch (maintErr) {
                console.error(`[AGENT] Maintenance sync failed:`, maintErr instanceof Error ? maintErr.message : String(maintErr))
                result = {
                    ...result,
                    maintenanceError: maintErr instanceof Error ? maintErr.message : String(maintErr),
                }
            }
        }

        if (module === "stock") {
            safeWriteJson(STOCK_CACHE_FILE, items)
            safeWriteJson(MACHINES_CACHE_FILE, buildMachineSeedFromStock(items))
            safeWriteJson(SPARE_PARTS_CACHE_FILE, buildSparePartsSeedFromStock(items))
            console.log("[AGENT] Local stock cache actualizado")
        }

        if (module === "alquileres") {
            try {
                console.log("[AGENT] SCAFFOLD RENTALS SYNC START")
                const stats = parseScaffoldRentals(buffer)
                console.log(`[AGENT] Cuerpos alquilados calculados: ${stats.cuerposAlquilados} (${stats.detalle.length} renglones)`)
                try {
                    await saveScaffoldRentalStats(stats)
                    console.log("[AGENT] SCAFFOLD RENTALS guardado en Firestore (dashboard_stats/scaffold_rentals)")
                } catch (fbErr) {
                    const error = fbErr instanceof Error ? fbErr : new Error(String(fbErr))
                    console.error("[AGENT] Firebase bloqueado para scaffold_rentals:", error.message)
                    console.warn("[AGENT] Datos de alquileres calculados pero no persistidos (cuota Firebase)")
                }
                result = {
                    ...result,
                    scaffoldRentalBodies: stats.cuerposAlquilados,
                    scaffoldRentalDetailCount: stats.detalle.length,
                }
            } catch (rentErr) {
                console.error(`[AGENT] Scaffold rentals parse failed:`, rentErr instanceof Error ? rentErr.message : String(rentErr))
                result = {
                    ...result,
                    scaffoldRentalError: rentErr instanceof Error ? rentErr.message : String(rentErr),
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
        
        // Log de finalización del paso del pipeline
        const stepDuration = Date.now() - tStart
        logPipelineStepCompleted(pipelineStepIndex, pipelineModules.length, module, stepDuration, result)
        
        return result
    } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido"
        console.error(`[AGENT] Command ${commandId} failed: ${message}`)

        await redis.hset(`sync-3c:command:${commandId}`, {
            status: "failed",
            error: message,
            completedAt: Date.now(),
        })
        
        // Log de fallo del paso
        const stepDuration = Date.now() - tStart
        logPipelineStepCompleted(pipelineStepIndex, pipelineModules.length, module, stepDuration, {
            created: 0,
            updated: 0,
            skipped: 0,
            warnings: [message]
        })
        
        return { success: false, error: message }
    } finally {
        isProcessing = false
    }
}

async function pollQueue(redis: Redis) {
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

            // =============================================================================
            // PIPELINE INSTRUMENTATION: Detectar nuevo pipeline
            // =============================================================================
            const raw = await redis.hgetall(`sync-3c:command:${commandId}`)
            if (!raw || raw.status !== "pending") {
                console.log(`[AGENT] Command ${commandId} skipped (not pending)`)
                continue
            }

            const module = (raw.module || "stock") as ModuleName

            // Si es el primer comando de un pipeline, iniciar log
            if (!processedCommandIds.has(commandId)) {
                // Obtener todos los comandos pendientes para determinar el pipeline completo
                // Esto es una aproximación: usamos el módulo actual para inferir el orden
                const pipelineOrder = ["stock", "articulos", "alquileres", "reparaciones"]
                const currentIndex = pipelineOrder.indexOf(module)
                const remainingModules = currentIndex >= 0 ? pipelineOrder.slice(currentIndex) : [module]
                
                logPipelineStart(remainingModules)
            }

            // Log del paso actual
            pipelineStepIndex++
            logPipelineStep(pipelineStepIndex, pipelineModules.length, module, commandId)
            processedCommandIds.add(commandId)

            // =============================================================================
            // END PIPELINE INSTRUMENTATION
            // =============================================================================

            const commandResult = await processCommand(redis, commandId, module)
            
            // Si el comando falló, detener el pipeline
            if (commandResult && commandResult.success === false) {
                logPipelineFinished(false, [commandResult.error || "Error en módulo"])
                // Reiniciar el pipeline para el próximo ciclo
                pipelineId = null
                pipelineModules = []
                pipelineStepIndex = 0
                processedCommandIds = new Set<string>()
            } else if (pipelineStepIndex >= pipelineModules.length) {
                // Todos los módulos completados exitosamente
                logPipelineFinished(true, [])
                // Reiniciar el pipeline para el próximo ciclo
                pipelineId = null
                pipelineModules = []
                pipelineStepIndex = 0
                processedCommandIds = new Set<string>()
            }
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            console.error("[AGENT] Polling error:", error.message)
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
}

async function recoverStaleCommands(redis: Redis) {
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

                const startedAt = parseInt((data.startedAt as string) ?? "0", 10)
                if (startedAt > 0 && startedAt >= cutoff) continue

                const id = key.replace("sync-3c:command:", "")
                await redis.hset(key, { status: "pending", startedAt: "", agent: "" })
                await redis.lpush("sync-3c:queue", id)
                recovered++
                console.log(`[AGENT] Recovered stale command ${id}`)
            }
        } while (cursor !== 0)
    } catch (err) {
        console.error("[AGENT] Recovery scan error:", err instanceof Error ? err.message : String(err))
    }

    if (recovered > 0) console.log(`[AGENT] Recovered ${recovered} stale command(s)`)
    else console.log("[AGENT] No stale commands found")
}

function startHeartbeat(redis: Redis) {
    const beat = async () => {
        try {
            await redis.set("sync-3c:agent:production", JSON.stringify({
                status: isProcessing ? "running" : "idle",
                lastHeartbeat: Date.now(),
                machineName: MACHINE_NAME,
            }))
        } catch (err) {
            console.error("[AGENT] Heartbeat error:", err instanceof Error ? err.message : String(err))
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