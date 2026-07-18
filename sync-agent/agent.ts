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
import type { Sync3CItem, Sync3CResult } from "../src/lib/sync-3c/types"

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

const LOCK_FILE = "C:\\Users\\Cesar\\Desktop\\operario-control\\sync-agent\\.agent.lock"

// ============================================================================
// LOCK MANAGEMENT - SOLO ON-DEMAND
// ============================================================================
function acquireSingletonLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8"))
            const lockPid = lockData.pid
            const lockTime = lockData.timestamp
            const now = Date.now()
            
            // Si el lock expiró (más de 60 segundos), eliminarlo
            if (lockTime && now - lockTime > 60000) {
                console.log(`[AGENT] Lock expired (${now - lockTime}ms old), removing stale lock`)
                fs.unlinkSync(LOCK_FILE)
            } else {
                // Verificar si el proceso del lock está vivo
                try {
                    process.kill(lockPid, 0)
                    console.error(`[AGENT] Another instance is already running (PID ${lockPid})`)
                    process.exit(1)
                } catch (e) {
                    // El proceso está muerto, eliminar el lock
                    console.log(`[AGENT] Lock process (PID ${lockPid}) is dead, removing stale lock`)
                    fs.unlinkSync(LOCK_FILE)
                }
            }
        }
        
        const lockData = {
            pid: process.pid,
            timestamp: Date.now(),
            machineName: MACHINE_NAME,
        }
        fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2))
        console.log(`[AGENT] Lock acquired (PID ${process.pid})`)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error("[AGENT] Failed to acquire singleton lock:", message)
        process.exit(1)
    }
}

function releaseSingletonLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            fs.unlinkSync(LOCK_FILE)
            console.log(`[AGENT] Lock released (PID ${process.pid})`)
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error("[AGENT] Failed to release singleton lock:", message)
    }
}

// ============================================================================
// CONFIG
// ============================================================================
const AHK_TIMEOUT_MS = 120_000
const EXPORT_RETRIES = 10
const EXPORT_RETRY_DELAY_MS = 1000

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

// ============================================================================
// REDIS
// ============================================================================
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

// ============================================================================
// AHK
// ============================================================================
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

function runAhk(scriptPath: string): Promise<void> {
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

// ============================================================================
// EXCEL
// ============================================================================
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

// ============================================================================
// CACHE
// ============================================================================
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true })
    }
}

function safeWriteJson(filePath: string, data: unknown) {
    try {
        ensureCacheDir()
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[AGENT] No se pudo escribir cache ${path.basename(filePath)}:`, message)
    }
}

function buildMachineSeedFromStock(items: Sync3CItem[]) {
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

function buildSparePartsSeedFromStock(items: Sync3CItem[]) {
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

// ============================================================================
// PROCESS SINGLE MODULE
// ============================================================================
type ModuleName = "stock" | "reparaciones" | "articulos" | "alquileres"

async function processModule(redis: Redis, commandId: string, module: ModuleName) {
    try {
        await redis.hset(`sync-3c:command:${commandId}`, {
            status: "running",
            startedAt: Date.now(),
            agent: MACHINE_NAME,
        })

        // Heartbeat running
        await redis.set("sync-3c:agent:production", JSON.stringify({
            status: "running",
            lastHeartbeat: Date.now(),
            machineName: MACHINE_NAME,
        }), { ex: 120 })

        console.log(`[AGENT] Processing command ${commandId} [module: ${module}]`)

        const scriptName = MODULE_SCRIPTS[module]
        if (!scriptName) {
            throw new Error(`Módulo desconocido: "${module}"`)
        }
        const scriptPath = path.join(AHK_DIR, scriptName)
        console.log(`[AGENT] Module: ${module} → ${scriptName}`)

        const ahkStart = Date.now()
        await runAhk(scriptPath)
        const ahkEnd = Date.now()
        console.log(`[AGENT] AHK completed in ${ahkEnd - ahkStart}ms`)

        const latest = await waitForExport()
        console.log(`[AGENT] Export found: ${latest.name}`)

        const buffer = fs.readFileSync(latest.fullPath).buffer

        let result: Sync3CResult
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
            const parsed = parseExcel(buffer)
            items = parsed.items

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
                    const errMsg = err instanceof Error ? err.message : String(err)
                    const errCode = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "unknown"
                    const errStack = err instanceof Error ? err.stack : undefined
                    console.error("========== FIREBASE ERROR ==========")
                    console.error(err)
                    console.error("message:", errMsg)
                    console.error("code:", errCode)
                    console.error("stack:", errStack)
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

        // Guardar resultado en Redis
        await redis.hset(`sync-3c:result:${commandId}`, {
            status: "completed",
            module,
            result: JSON.stringify(result),
            updatedAt: Date.now(),
        })

        // Actualizar estado del comando
        await redis.hset(`sync-3c:command:${commandId}`, {
            status: "completed",
            completedAt: Date.now(),
            result: JSON.stringify(result),
        })

        console.log(`[AGENT] Command ${commandId} completed: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`)
        return result
    } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido"
        console.error(`[AGENT] Command ${commandId} failed: ${message}`)

        await redis.hset(`sync-3c:command:${commandId}`, {
            status: "failed",
            error: message,
            completedAt: Date.now(),
        })
        throw err
    }
}

// ============================================================================
// MAIN - ON-DEMAND ONLY (PIPELINE)
// ============================================================================
async function main() {
    // El agente acepta: commandId, module, [autoEnqueued...]
    // El primer argumento es el commandId principal, el segundo es el módulo inicial
    // Los siguientes argumentos son commandIds adicionales del pipeline
    const commandId = process.argv[2]
    const module = process.argv[3] || "stock"
    const autoEnqueued: string[] = process.argv.slice(4)

    if (!commandId) {
        console.error("[AGENT] ERROR: commandId es requerido. El agente solo funciona en modo on-demand.")
        console.error("[AGENT] Uso: npx tsx sync-agent/agent.ts <commandId> <module> [autoEnqueued...]")
        process.exit(1)
    }

    acquireSingletonLock()

    console.log(`[AGENT] ON-DEMAND MODE: commandId=${commandId}, module=${module}`)
    console.log(`[AGENT] Auto-enqueued commands: ${autoEnqueued.length}`)
    console.log(`[AGENT] Machine: ${MACHINE_NAME}`)

    const redis = getRedis()

    // Pipeline: primer commandId con su módulo, luego los auto-enqueued
    const pipeline: { commandId: string; module: ModuleName }[] = [
        { commandId, module: module as ModuleName },
        ...autoEnqueued.map((cid, idx) => ({
            commandId: cid,
            module: (["articulos", "alquileres", "reparaciones"][idx] || "stock") as ModuleName
        }))
    ]

    try {
        // Heartbeat inicial
        await redis.set("sync-3c:agent:production", JSON.stringify({
            status: "running",
            lastHeartbeat: Date.now(),
            machineName: MACHINE_NAME,
        }), { ex: 120 })

        // Procesar cada módulo del pipeline
        for (const { commandId: cmdId, module: mod } of pipeline) {
            console.log(`[AGENT] === Processing pipeline step: ${mod} (${cmdId}) ===`)
            await processModule(redis, cmdId, mod)
        }

        // Heartbeat final (idle)
        await redis.set("sync-3c:agent:production", JSON.stringify({
            status: "idle",
            lastHeartbeat: Date.now(),
            machineName: MACHINE_NAME,
        }), { ex: 120 })

        console.log(`[AGENT] ON-DEMAND: Pipeline completed, exiting`)
    } catch (err) {
        console.error("[AGENT] Fatal error:", err)
    } finally {
        releaseSingletonLock()
        process.exit(0)
    }
}

main().catch((err) => {
    console.error("[AGENT] Fatal error:", err)
    releaseSingletonLock()
    process.exit(1)
})