#!/usr/bin/env node

import dotenv from "dotenv"
import { Redis } from "@upstash/redis"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { parseExcel } from "../src/lib/sync-3c/parser"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOCK_FILE = "C:\\Users\\Cesar\\Desktop\\operario-control\\sync-agent\\.agent.lock"

dotenv.config({
    path: fileURLToPath(new URL("../.env.local", import.meta.url)),
})

const MACHINE_NAME = process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown-pc"

function acquireSingletonLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8"))
            const lockPid = lockData.pid
            const lockTime = lockData.timestamp
            const now = Date.now()
            
            if (lockTime && now - lockTime > 60000) {
                console.log(`[TEST] Lock expired, removing stale lock`)
                fs.unlinkSync(LOCK_FILE)
            } else {
                try {
                    process.kill(lockPid, 0)
                    console.error(`[TEST] Another instance is already running (PID ${lockPid})`)
                    process.exit(1)
                } catch (e) {
                    console.log(`[TEST] Lock process (PID ${lockPid}) is dead, removing stale lock`)
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
        console.log(`[TEST] Lock acquired (PID ${process.pid})`)
    } catch (err) {
        console.error("[TEST] Failed to acquire singleton lock:", err.message)
        process.exit(1)
    }
}

function releaseSingletonLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            fs.unlinkSync(LOCK_FILE)
            console.log(`[TEST] Lock released (PID ${process.pid})`)
        }
    } catch (err) {
        console.error("[TEST] Failed to release singleton lock:", err.message)
    }
}

function getRedis() {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    return new Redis({ url, token })
}

async function processModule(redis, commandId, module) {
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

        console.log(`[TEST] Processing command ${commandId} [module: ${module}]`)

        // Simular AutoHotkey - usar archivo existente
        const EXPORTS_DIR = "C:\\Users\\Cesar\\Desktop\\operario-control\\automation-watcher\\3c_exports"
        const files = fs.readdirSync(EXPORTS_DIR)
            .filter((f) => f.endsWith(".xls") || f.endsWith(".xlsx"))
            .map((f) => {
                const fullPath = path.join(EXPORTS_DIR, f)
                return { name: f, mtime: fs.statSync(fullPath).mtimeMs, fullPath }
            })
            .sort((a, b) => b.mtime - a.mtime)

        if (files.length === 0) {
            throw new Error("No Excel files found")
        }

        const latest = files[0]
        console.log(`[TEST] Using existing export: ${latest.name}`)

        const buffer = fs.readFileSync(latest.fullPath).buffer
        const parsed = parseExcel(buffer)
        const items = parsed.items

        console.log(`[TEST] Parsed ${items.length} items from Excel`)

        // Simular syncItems (sin Firebase real)
        const result = {
            success: true,
            created: 0,
            updated: items.length,
            skipped: 0,
            warnings: ["Firebase skipped in test mode"],
        }

        // Guardar resultado
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

        console.log(`[TEST] Command ${commandId} completed: ${result.updated} items processed`)
        return result
    } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido"
        console.error(`[TEST] Command ${commandId} failed: ${message}`)

        await redis.hset(`sync-3c:command:${commandId}`, {
            status: "failed",
            error: message,
            completedAt: Date.now(),
        })
        throw err
    }
}

async function main() {
    const commandId = process.argv[2] || "test-" + Date.now()
    const module = process.argv[3] || "stock"
    const autoEnqueued: string[] = process.argv.slice(4)

    console.log(`[TEST] ON-DEMAND MODE: commandId=${commandId}, module=${module}`)
    console.log(`[TEST] Auto-enqueued commands: ${autoEnqueued.length}`)

    acquireSingletonLock()

    const redis = getRedis()

    // Pipeline
    const pipeline: { commandId: string; module: string }[] = [
        { commandId, module },
        ...autoEnqueued.map((cid, idx) => ({
            commandId: cid,
            module: ["articulos", "alquileres", "reparaciones"][idx] || "stock"
        }))
    ]

    try {
        await redis.set("sync-3c:agent:production", JSON.stringify({
            status: "running",
            lastHeartbeat: Date.now(),
            machineName: MACHINE_NAME,
        }), { ex: 120 })

        for (const { commandId: cmdId, module: mod } of pipeline) {
            console.log(`[TEST] === Processing pipeline step: ${mod} (${cmdId}) ===`)
            await processModule(redis, cmdId, mod)
        }

        await redis.set("sync-3c:agent:production", JSON.stringify({
            status: "idle",
            lastHeartbeat: Date.now(),
            machineName: MACHINE_NAME,
        }), { ex: 120 })

        console.log(`[TEST] ON-DEMAND: Pipeline completed, exiting`)
    } catch (err) {
        console.error("[TEST] Fatal error:", err)
    } finally {
        releaseSingletonLock()
        process.exit(0)
    }
}

main().catch((err) => {
    console.error("[TEST] Fatal error:", err)
    releaseSingletonLock()
    process.exit(1)
})