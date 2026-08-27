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
import { loadInventoryIndexByCodes, syncItems, syncRepairsToMaintenance } from "../src/lib/sync-3c/engine"
import type { Sync3CItem, Sync3CResult } from "../src/lib/sync-3c/types"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const AHK_DIR = path.join(PROJECT_ROOT, "automation")
const EXPORTS_DIR = path.resolve(PROJECT_ROOT, "automation-watcher", "3c_exports")
const CACHE_DIR = path.resolve(PROJECT_ROOT, "automation-watcher", "cache")
const STOCK_CACHE_FILE = path.join(CACHE_DIR, "stock-cache.json")
const MACHINES_CACHE_FILE = path.join(CACHE_DIR, "machines-cache.json")
const SPARE_PARTS_CACHE_FILE = path.join(CACHE_DIR, "spare-parts-cache.json")
const DIAGNOSTIC_LOGS_DIR = path.resolve(PROJECT_ROOT, "automation-watcher", "logs")
const MAX_DIAGNOSTIC_REPORTS = 20

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
// CONTROL DE CUOTA FIREBASE (plan Spark gratis) + CACHÉ DE ÍNDICE COMPARTIDO
// ============================================================================
// Objetivos:
//  1) Reutilizar un único inventoryIndex en todo el pipeline (leer 1 vez).
//  2) Cache de 10 min para no releer Firestore en corridas seguidas.
//  3) Freno automático: si el día se acerca al cupo, saltar y avisar.
const INDEX_TTL_MS = 10 * 60 * 1000          // copia del índice por 10 minutos
const DAILY_READ_LIMIT = 45000               // margen bajo el tope Spark (50K)

// Horario de sincronización automática (hora local). Fuera de estas horas
// el agente NO corre sync automático (solo heartbeat / cola manual).
const AUTO_SYNC_HOURS = [10, 12, 15, 17]

let sharedInventoryIndex: Map<string, { id: string; data: Record<string, unknown> }> | null = null
let sharedIndexLoadedAt = 0

function firestoreDateKey(d = new Date()): string {
    return d.toISOString().slice(0, 10)
}

async function getDailyReads(redis: Redis): Promise<number> {
    try {
        const v = await redis.get<string>(`sync-3c:reads:${firestoreDateKey()}`)
        return Number(v) || 0
    } catch {
        return 0
    }
}

async function addDailyReads(redis: Redis, reads: number): Promise<void> {
    if (reads <= 0) return
    try {
        await redis.incrby(`sync-3c:reads:${firestoreDateKey()}`, Math.max(1, Math.round(reads)))
        await redis.expire(`sync-3c:reads:${firestoreDateKey()}`, 48 * 3600)
    } catch {
        // si Redis falla, no bloquea el sync
    }
}

/**
 * Devuelve el índice compartido con cache de 10 min. Si la corrida es seguida,
 * reutiliza el mismo para no releer Firestore.
 */
async function getSharedInventoryIndex(
    redis: Redis,
    codes: string[],
): Promise<Map<string, { id: string; data: Record<string, unknown> }>> {
    if (sharedInventoryIndex && Date.now() - sharedIndexLoadedAt < INDEX_TTL_MS) {
        console.log(`[AGENT] Reutilizando inventoryIndex en cache (${sharedInventoryIndex.size} entries, ${Math.round((Date.now() - sharedIndexLoadedAt) / 1000)}s viejos)`)
        return sharedInventoryIndex
    }

    const index = await loadInventoryIndexByCodes(codes)
    sharedInventoryIndex = index
    sharedIndexLoadedAt = Date.now()

    // Contabilizar lecturas estimadas (1 batch de 30 códigos ≈ 1 petición)
    const batchCount = Math.ceil(codes.length / 30)
    await addDailyReads(redis, batchCount)
    console.log(`[AGENT] Índice compartido actualizado (${index.size} entries)`)
    return index
}

/**
 * Verifica si aún queda cupo de lecturas para hoy. false = hay que frenar.
 */
async function canSyncToday(redis: Redis, approxReads = 0): Promise<boolean> {
    const used = await getDailyReads(redis)
    if (used + approxReads >= DAILY_READ_LIMIT) {
        console.warn(`[AGENT] Cuota del día casi agotada (${used}/~${DAILY_READ_LIMIT}). Saltando sync automático.`)
        return false
    }
    return true
}

// ============================================================================
// DIAGNOSTIC MODE - Pure analysis function (no side effects)
// ============================================================================
interface DiagnosticContext {
    stock: { codes: number; unique: number; codeSet: Set<string> }
    articulos: { codes: number; unique: number; codeSet: Set<string> }
    alquileres: { codes: number; unique: number; codeSet: Set<string> }
}

function analyzeItems(module: string, items: Sync3CItem[]): { codes: number; unique: number; codeSet: Set<string> } {
    const codeSet = new Set<string>()
    for (const item of items) {
        if (item.codigo) {
            codeSet.add(item.codigo)
        }
    }
    return {
        codes: items.length,
        unique: codeSet.size,
        codeSet,
    }
}

function calculateDiagnosticReport(context: DiagnosticContext): {
    report: Record<string, unknown>
    reportPath: string
} {
    const stockCodes = context.stock.codeSet
    const articulosCodes = context.articulos.codeSet
    const alquileresCodes = context.alquileres.codeSet

    const union = new Set([...stockCodes, ...articulosCodes, ...alquileresCodes])
    const intersection = new Set([...stockCodes].filter(code => articulosCodes.has(code) && alquileresCodes.has(code)))

    const overlapRatio = union.size > 0 ? intersection.size / union.size : 0
    const decision = overlapRatio > 0.8 ? "A" : "B"

    const BATCH_SIZE = 30
    const stockReadsA = Math.ceil(stockCodes.size / BATCH_SIZE)
    const articulosReadsA = Math.ceil(articulosCodes.size / BATCH_SIZE)
    const alquileresReadsA = Math.ceil(alquileresCodes.size / BATCH_SIZE)
    const totalReadsA = stockReadsA + articulosReadsA + alquileresReadsA

    const allCodes = new Set([...stockCodes, ...articulosCodes, ...alquileresCodes])
    const totalReadsB = Math.ceil(allCodes.size / BATCH_SIZE)

    const readsSaved = totalReadsA - totalReadsB
    const savingsPercentage = totalReadsA > 0 ? ((readsSaved / totalReadsA) * 100).toFixed(1) : "0.0"

    const report = {
        timestamp: new Date().toISOString(),
        modules: {
            stock: {
                codes: context.stock.codes,
                unique: context.stock.unique,
            },
            articulos: {
                codes: context.articulos.codes,
                unique: context.articulos.unique,
            },
            alquileres: {
                codes: context.alquileres.codes,
                unique: context.alquileres.unique,
            },
        },
        union: union.size,
        intersection: intersection.size,
        overlapRatio: parseFloat((overlapRatio * 100).toFixed(1)),
        firestoreAnalysis: {
            scenarioA: {
                description: "3 inventoryIndex independientes",
                stock: stockReadsA,
                articulos: articulosReadsA,
                alquileres: alquileresReadsA,
                total: totalReadsA,
            },
            scenarioB: {
                description: "1 inventoryIndex compartido",
                totalCodes: allCodes.size,
                total: totalReadsB,
            },
            savings: {
                readsSaved: readsSaved,
                percentage: parseFloat(savingsPercentage),
            },
        },
        decision: decision === "A" ? "shared" : "independent",
        decisionReason: `overlapRatio ${(overlapRatio * 100).toFixed(1)}% ${decision === "A" ? "> 80% → compartido" : "≤ 80% → independiente"}`,
    }

    const timestamp = new Date()
    const filename = `diagnostic-${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, "0")}${String(timestamp.getDate()).padStart(2, "0")}-${String(timestamp.getHours()).padStart(2, "0")}${String(timestamp.getMinutes()).padStart(2, "0")}${String(timestamp.getSeconds()).padStart(2, "0")}.json`
    const reportPath = path.join(DIAGNOSTIC_LOGS_DIR, filename)

    return { report, reportPath }
}

function saveDiagnosticReport(report: Record<string, unknown>, reportPath: string): void {
    if (!fs.existsSync(DIAGNOSTIC_LOGS_DIR)) {
        fs.mkdirSync(DIAGNOSTIC_LOGS_DIR, { recursive: true })
    }

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

    // Limpiar reportes antiguos, conservar solo los últimos MAX_DIAGNOSTIC_REPORTS
    try {
        const files = fs.readdirSync(DIAGNOSTIC_LOGS_DIR)
            .filter(f => f.startsWith("diagnostic-") && f.endsWith(".json"))
            .sort()

        if (files.length > MAX_DIAGNOSTIC_REPORTS) {
            const toDelete = files.slice(0, files.length - MAX_DIAGNOSTIC_REPORTS)
            for (const file of toDelete) {
                fs.unlinkSync(path.join(DIAGNOSTIC_LOGS_DIR, file))
            }
        }
    } catch (err) {
        console.warn("[DIAG] No se pudo limpiar reportes antiguos:", err instanceof Error ? err.message : String(err))
    }
}

function printDiagnosticReport(context: DiagnosticContext): void {
    const stockCodes = context.stock.codeSet
    const articulosCodes = context.articulos.codeSet
    const alquileresCodes = context.alquileres.codeSet

    const union = new Set([...stockCodes, ...articulosCodes, ...alquileresCodes])
    const intersection = new Set([...stockCodes].filter(code => articulosCodes.has(code) && alquileresCodes.has(code)))

    const overlapRatio = union.size > 0 ? intersection.size / union.size : 0
    const decision = overlapRatio > 0.8 ? "A" : "B"

    const BATCH_SIZE = 30
    const stockReadsA = Math.ceil(stockCodes.size / BATCH_SIZE)
    const articulosReadsA = Math.ceil(articulosCodes.size / BATCH_SIZE)
    const alquileresReadsA = Math.ceil(alquileresCodes.size / BATCH_SIZE)
    const totalReadsA = stockReadsA + articulosReadsA + alquileresReadsA

    const allCodes = new Set([...stockCodes, ...articulosCodes, ...alquileresCodes])
    const totalReadsB = Math.ceil(allCodes.size / BATCH_SIZE)

    const readsSaved = totalReadsA - totalReadsB
    const savingsPercentage = totalReadsA > 0 ? ((readsSaved / totalReadsA) * 100).toFixed(1) : "0.0"

    console.log(`\n[AGENT] ════════════════════════════════════════`)
    console.log(`[AGENT] REPORTE DIAGNÓSTICO`)
    console.log(`[AGENT] ════════════════════════════════════════`)
    console.log(`[AGENT] Stock........${context.stock.unique} códigos únicos`)
    console.log(`[AGENT] Artículos....${context.articulos.unique} códigos únicos`)
    console.log(`[AGENT] Alquileres...${context.alquileres.unique} códigos únicos`)
    console.log(`[AGENT] Unión........${union.size} códigos`)
    console.log(`[AGENT] Intersección.${intersection.size} códigos`)
    console.log(`[AGENT] Superposición.${(overlapRatio * 100).toFixed(1)}%`)
    console.log(`[AGENT] ════════════════════════════════════════`)
    console.log(`[AGENT] FIRESTORE - Escenario A (3 índices): ${totalReadsA} lecturas`)
    console.log(`[AGENT]   Stock: ${stockReadsA}, Artículos: ${articulosReadsA}, Alquileres: ${alquileresReadsA}`)
    console.log(`[AGENT] FIRESTORE - Escenario B (1 índice): ${totalReadsB} lecturas`)
    console.log(`[AGENT] Ahorro estimado: ${readsSaved} lecturas (${savingsPercentage}%)`)
    console.log(`[AGENT] ════════════════════════════════════════`)
    console.log(`[AGENT] Decisión: inventoryIndex ${decision === "A" ? "COMPARTIDO" : "INDEPENDIENTE"}`)
    console.log(`[AGENT] Criterio: overlap > 80% → compartido (A), ≤ 80% → independiente (B)`)
    console.log(`[AGENT] ════════════════════════════════════════`)
}

// ============================================================================
// LOCK MANAGEMENT
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

type ProcessModuleOptions = {
    diagnosticCallback?: (module: string, items: Sync3CItem[]) => void
}

async function processModule(
    redis: Redis,
    commandId: string,
    module: ModuleName,
    inventoryIndex?: Map<string, { id: string; data: Record<string, unknown> }>,
    options?: ProcessModuleOptions,
) {
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

            // Callback de diagnóstico (observador pasivo)
            if (options?.diagnosticCallback) {
                options.diagnosticCallback(module, items)
            }

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
                // Construir inventoryIndex con caché compartido (leer 1 vez / 10 min)
                if (!inventoryIndex) {
                    const codes = items.map((i) => i.codigo).filter(Boolean) as string[]
                    console.log(`[AGENT] Building shared inventoryIndex from ${codes.length} codes in Excel`)
                    inventoryIndex = await getSharedInventoryIndex(redis, codes)
                }
                try {
                    result = await syncItems(items, undefined, inventoryIndex)
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
// AUTO-SYNC PROGRAMADO — corre el pipeline a horas fijas (10, 12, 15, 17)
// reutilizando el índice compartido para cuidar la cuota de Firestore.
// ============================================================================
let lastAutoSyncHour: number | null = null

async function triggerAutoSync(redis: Redis) {
    const now = new Date()
    const hour = now.getHours()

    if (!AUTO_SYNC_HOURS.includes(hour)) return
    if (lastAutoSyncHour === hour) return

    // Solo corre si estamos dentro de los primeros 5 minutos de la hora fija
    if (now.getMinutes() > 5) return

    if (!(await canSyncToday(redis))) {
        console.log(`[AGENT] Auto-sync saltado: cuota del día casi agotada (${hour}:00)`)
        lastAutoSyncHour = hour
        return
    }

    lastAutoSyncHour = hour

    console.log(`[AGENT] ════════════════════════════════════════`)
    console.log(`[AGENT] AUTO-SYNC programado ${hour}:00`)
    console.log(`[AGENT] ════════════════════════════════════════`)

    // Pipeline de los 3 módulos (cada processModule usa el caché compartido)
    const modules: ModuleName[] = ["stock", "alquileres", "reparaciones"]
    const pipeline: { commandId: string; module: ModuleName }[] = modules.map((m) => ({
        commandId: `auto-${new Date().toISOString().replace(/[:.]/g, "-")}-${m}`,
        module: m,
    }))

    for (const step of pipeline) {
        console.log(`[AGENT] === Auto-sync step: ${step.module} (${step.commandId}) ===`)
        try {
            await processModule(redis, step.commandId, step.module, sharedInventoryIndex ?? undefined)
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            await redis.hset(`sync-3c:command:${step.commandId}`, {
                status: "failed",
                error: msg,
                completedAt: Date.now(),
            })
        }
    }

    console.log(`[AGENT] AUTO-SYNC ${hour}:00 completado`)
}

// ============================================================================
// LISTENER MODE (SERVICE) — corre permanentemente, escucha comandos pending
// ============================================================================
const HEARTBEAT_INTERVAL_MS = 30_000   // cada 30s
const POLL_INTERVAL_MS = 5_000         // cada 5s

async function startAgentListener() {
    acquireSingletonLock()

    console.log(`[AGENT] ============================================`)
    console.log(`[AGENT] LISTENER MODE: Agent service started`)
    console.log(`[AGENT] Machine: ${MACHINE_NAME}`)
    console.log(`[AGENT] Polling Redis every ${POLL_INTERVAL_MS / 1000}s for pending commands`)
    console.log(`[AGENT] Heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s`)
    console.log(`[AGENT] Press Ctrl+C to stop`)
    console.log(`[AGENT] ============================================`)

    const redis = getRedis()
    let running = true

    // === Manejo de señales para cierre limpio ===
    const shutdown = () => {
        if (!running) return
        running = false
        console.log(`[AGENT] Shutting down listener...`)

        // Heartbeat idle antes de salir
        try {
            redis.set("sync-3c:agent:production", JSON.stringify({
                status: "idle",
                lastHeartbeat: Date.now(),
                machineName: MACHINE_NAME,
            }), { ex: 120 }).catch(() => {})
        } catch {
            // ignore
        }

        releaseSingletonLock()
        logStream.end()
        process.exit(0)
    }

    // Remover handlers por defecto y poner los del listener
    process.removeAllListeners("SIGINT")
    process.removeAllListeners("SIGTERM")
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    // === Heartbeat periódico (cada 30s) ===
    setInterval(async () => {
        if (!running) return
        try {
            await redis.set("sync-3c:agent:production", JSON.stringify({
                status: "listening",
                lastHeartbeat: Date.now(),
                machineName: MACHINE_NAME,
            }), { ex: 120 })
        } catch (err) {
            console.error(`[AGENT] Heartbeat error:`, err)
        }
    }, HEARTBEAT_INTERVAL_MS)

    // === Auto-sync programado: revisar cada minuto si toca corrida (10/12/15/17) ===
    setInterval(async () => {
        if (!running) return
        try {
            await triggerAutoSync(redis)
        } catch (err) {
            console.error(`[AGENT] Auto-sync error:`, err)
        }
    }, 60_000)

     // === Bucle principal de escucha (usando cola FIFO) ===
     while (running) {
         try {
             // Obtener command de la cola (RPOP es atómico)
             const commandId = await redis.rpop<string>("sync-3c:queue")

             if (commandId) {
                 // Obtener datos del command
                 const data = await redis.hgetall<Record<string, unknown>>(`sync-3c:command:${commandId}`)

                 if (data && data.status === "pending") {
                     const module = (data.module as string) || "stock"
                     console.log(`[AGENT] === Processing command from queue: ${commandId} [module: ${module}] ===`)
                     try {
                         await processModule(redis, commandId, module as ModuleName)
                         console.log(`[AGENT] Command ${commandId} processed successfully`)
                     } catch (err) {
                         console.error(`[AGENT] Command ${commandId} failed:`, err)
                     }
                 } else {
                     console.log(`[AGENT] Command ${commandId} not pending (status: ${data?.status || "not found"}), skipping`)
                 }
             }
         } catch (err) {
             console.error(`[AGENT] Listener error:`, err)
         }

         // Esperar 5 segundos antes de la próxima búsqueda
         await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
     }
}

// ============================================================================
// MAIN - ON-DEMAND (PIPELINE) o LISTENER (SERVICE)
// ============================================================================
async function main() {
    const commandId = process.argv[2]

    // Si no hay commandId → modo listener (servicio permanente)
    if (!commandId) {
        await startAgentListener()
        return
    }

    // ============================================================
    // MODO ON-DEMAND (compatibilidad hacia atrás)
    // ============================================================
    const module = process.argv[3] || "stock"
    const autoEnqueued: string[] = process.argv.slice(4)

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

    // ═══════════════════════════════════════════════
    // MODO DIAGNÓSTICO (activar con SYNC_DIAGNOSTIC=true)
    // ═══════════════════════════════════════════════
    const DIAGNOSTIC_MODE = process.env.SYNC_DIAGNOSTIC === "true"
    
    if (DIAGNOSTIC_MODE) {
        console.log(`[AGENT] ════════════════════════════════════════`)
        console.log(`[AGENT] MODO DIAGNÓSTICO ACTIVADO`)
        console.log(`[AGENT] ════════════════════════════════════════`)
        
        const diagnosticContext: DiagnosticContext = {
            stock: { codes: 0, unique: 0, codeSet: new Set<string>() },
            articulos: { codes: 0, unique: 0, codeSet: new Set<string>() },
            alquileres: { codes: 0, unique: 0, codeSet: new Set<string>() },
        }
        
        // Callback que acumula datos de diagnóstico (observador pasivo)
        const diagnosticCallback = (mod: string, items: Sync3CItem[]) => {
            if (mod === "reparaciones") return // Reparaciones no tiene códigos de inventario
            
            console.log(`[AGENT] [DIAG] Analizando módulo: ${mod}`)
            const analysis = analyzeItems(mod, items)
            
            diagnosticContext[mod as keyof DiagnosticContext] = {
                codes: analysis.codes,
                unique: analysis.unique,
                codeSet: analysis.codeSet,
            }
            
            console.log(`[AGENT] [DIAG] ${mod}: ${analysis.codes} ítems, ${analysis.unique} códigos únicos`)
        }
        
        // Procesar pipeline normal con callback de diagnóstico
        for (const { commandId: cmdId, module: mod } of pipeline) {
            console.log(`[AGENT] === Processing pipeline step: ${mod} (${cmdId}) ===`)
            try {
                await processModule(redis, cmdId, mod, undefined, {
                    diagnosticCallback,
                })
            } catch (err) {
                console.error(`[AGENT] Command ${cmdId} failed:`, err)
            }
        }
        
        // Generar reporte final
        printDiagnosticReport(diagnosticContext)
        
        const { report, reportPath } = calculateDiagnosticReport(diagnosticContext)
        saveDiagnosticReport(report, reportPath)
        
        console.log(`\n[AGENT] Reporte guardado en: ${reportPath}`)
        console.log(`[AGENT] Diagnóstico completado.`)
        
        return
    }
    
    try {
        // Heartbeat inicial
        await redis.set("sync-3c:agent:production", JSON.stringify({
            status: "running",
            lastHeartbeat: Date.now(),
            machineName: MACHINE_NAME,
        }), { ex: 120 })

        // Procesar cada módulo del pipeline
        // Cada módulo carga su propio inventoryIndex optimizado con los códigos del Excel
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