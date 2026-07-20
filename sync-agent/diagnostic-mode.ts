#!/usr/bin/env node

/**
 * MODO DIAGNÓSTICO
 * 
 * Ejecuta los 3 módulos (stock, artículos, alquileres) y analiza:
 * - Cantidad de códigos por módulo
 * - Códigos únicos por módulo
 * - Unión e intersección
 * - Decisión automática: inventoryIndex compartido (A) o independiente (B)
 * 
 * Uso: npx tsx diagnostic-mode.ts <commandId_stock> <commandId_articulos> <commandId_alquileres>
 */

import * as dotenv from "dotenv"
dotenv.config({ path: fileURLToPath(new URL("../.env.local", import.meta.url)) })
import { Redis } from "@upstash/redis"
import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import { parseExcel } from "../src/lib/sync-3c/parser"
import { loadInventoryIndexByCodes } from "../src/lib/sync-3c/engine"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const AHK_DIR = path.join(PROJECT_ROOT, "automation")
const EXPORTS_DIR = path.resolve(PROJECT_ROOT, "automation-watcher", "3c_exports")

const MACHINE_NAME = process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown-pc"

const MODULE_SCRIPTS = {
    stock: "sync_3c.ahk",
    articulos: "sync_articulos.ahk",
    alquileres: "sync_alquileres.ahk",
}

const AHK_TIMEOUT_MS = 120_000
const EXPORT_RETRIES = 10
const EXPORT_RETRY_DELAY_MS = 1000

function getRedis() {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) {
        console.error("[DIAG] UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN son requeridos")
        process.exit(1)
    }
    return new Redis({ url, token })
}

function findAhkExe() {
    const candidates = [
        "AutoHotkey64.exe",
        "AutoHotkey32.exe",
        "AutoHotkey.exe",
        path.join("C:", "Program Files", "AutoHotkey", "AutoHotkey64.exe"),
        path.join("C:", "Program Files", "AutoHotkey", "AutoHotkey32.exe"),
    ]
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p
        } catch { /* skip */ }
    }
    return null
}

async function runAhk(scriptPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const exe = findAhkExe()
        if (!exe) {
            reject(new Error("AutoHotkey no encontrado"))
            return
        }

        const child = spawn(exe, [scriptPath], {
            cwd: AHK_DIR,
            windowsHide: true,
            shell: false,
        })

        const timeout = setTimeout(() => {
            child.kill()
            reject(new Error("AHK timeout después de 120s"))
        }, AHK_TIMEOUT_MS)

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

async function waitForExport(): Promise<string> {
    for (let attempt = 0; attempt < EXPORT_RETRIES; attempt++) {
        if (!fs.existsSync(EXPORTS_DIR)) {
            await new Promise((r) => setTimeout(r, EXPORT_RETRY_DELAY_MS))
            continue
        }

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

        if (files.length > 0) return files[0].fullPath
        await new Promise((r) => setTimeout(r, EXPORT_RETRY_DELAY_MS))
    }
    throw new Error(`No se encontró archivo Excel en ${EXPORTS_DIR}`)
}

async function processModule(module: string): Promise<Set<string>> {
    const scriptName = MODULE_SCRIPTS[module as keyof typeof MODULE_SCRIPTS]
    if (!scriptName) {
        console.error(`[DIAG] Módulo desconocido: ${module}`)
        return new Set()
    }

    console.log(`[DIAG] Procesando módulo: ${module}`)
    const scriptPath = path.join(AHK_DIR, scriptName)
    await runAhk(scriptPath)
    const excelPath = await waitForExport()
    console.log(`[DIAG] Export encontrado: ${path.basename(excelPath)}`)

    const buffer = fs.readFileSync(excelPath).buffer
    const parsed = parseExcel(buffer)
    const items = parsed.items

    const codes = new Set<string>()
    for (const item of items) {
        if (item.codigo) {
            codes.add(item.codigo)
        }
    }

    console.log(`[DIAG] ${module}: ${items.length} ítems, ${codes.size} códigos únicos`)
    return codes
}

async function main() {
    const modules = process.argv.slice(2)
    
    if (modules.length < 3) {
        console.error("Uso: npx tsx diagnostic-mode.ts <stock> <articulos> <alquileres>")
        console.error("Ejemplo: npx tsx diagnostic-mode.ts cmd-001 cmd-002 cmd-003")
        process.exit(1)
    }

    console.log(`[DIAG] ════════════════════════════════════════`)
    console.log(`[DIAG] MODO DIAGNÓSTICO`)
    console.log(`[DIAG] ════════════════════════════════════════\n`)

    const redis = getRedis()
    const results: Record<string, Set<string>> = {}

    // Ejecutar los 3 módulos
    for (let i = 0; i < modules.length; i++) {
        const moduleName = ["stock", "articulos", "alquileres"][i]
        const commandId = modules[i]

        // Marcar comando como diagnóstico en Redis
        await redis.hset(`sync-3c:command:${commandId}`, {
            status: "running",
            startedAt: Date.now(),
            agent: MACHINE_NAME,
            diagnostic: "true",
        })

        try {
            const codes = await processModule(moduleName)
            results[moduleName] = codes
        } catch (err) {
            console.error(`[DIAG] Error en módulo ${moduleName}:`, err)
            results[moduleName] = new Set()
        }
    }

    // Calcular unión e intersección
    const stockCodes = results["stock"] || new Set()
    const articulosCodes = results["articulos"] || new Set()
    const alquileresCodes = results["alquileres"] || new Set()

    const union = new Set([...stockCodes, ...articulosCodes, ...alquileresCodes])
    const intersection = new Set([...stockCodes].filter(code => articulosCodes.has(code) && alquileresCodes.has(code)))

    // Generar reporte
    console.log(`\n[DIAG] ════════════════════════════════════════`)
    console.log(`[DIAG] REPORTE DIAGNÓSTICO`)
    console.log(`[DIAG] ════════════════════════════════════════`)
    console.log(`[DIAG] Stock........${stockCodes.size}`)
    console.log(`[DIAG] Artículos....${articulosCodes.size}`)
    console.log(`[DIAG] Alquileres...${alquileresCodes.size}`)
    console.log(`[DIAG] Unión........${union.size}`)
    console.log(`[DIAG] Intersección.${intersection.size}`)
    console.log(`[DIAG] ════════════════════════════════════════\n`)

    // Decisión automática
    const overlapRatio = union.size > 0 ? intersection.size / union.size : 0
    const decision = overlapRatio > 0.8 ? "A" : "B"

    console.log(`[DIAG] Decisión: inventoryIndex ${decision === "A" ? "COMPARTIDO" : "INDEPENDIENTE"}`)
    console.log(`[DIAG] Ratio de superposición: ${(overlapRatio * 100).toFixed(1)}%`)
    console.log(`[DIAG] Criterio: overlap > 80% → compartido (A), independiente (B)\n`)

    // Guardar decisión en Redis
    await redis.hset("sync-3c:diagnostic", {
        stock: stockCodes.size.toString(),
        articulos: articulosCodes.size.toString(),
        alquileres: alquileresCodes.size.toString(),
        union: union.size.toString(),
        intersection: intersection.size.toString(),
        overlapRatio: overlapRatio.toString(),
        decision: decision,
        timestamp: Date.now().toString(),
    })

    console.log(`[DIAG] Resultado guardado en Redis key: sync-3c:diagnostic`)
    console.log(`[DIAG] Diagnóstico completado.`)
}

main().catch((err) => {
    console.error("[DIAG] Fatal error:", err)
    process.exit(1)
})