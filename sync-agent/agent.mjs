#!/usr/bin/env node

import dotenv from "dotenv"
import { fileURLToPath } from "url"

dotenv.config({
  path: fileURLToPath(new URL("../.env.local", import.meta.url)),
})

import { Redis } from "@upstash/redis"
import { spawn, execSync } from "child_process"
import fs from "fs"
import path from "path"
import { parseExcel } from "../src/lib/sync-3c/parser.ts"
import { syncItems, syncRepairsToMaintenance } from "../src/lib/sync-3c/engine.ts"

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
process.on("SIGINT", () => {
  logStream.end()
  process.exit(0)
})
process.on("SIGTERM", () => {
  logStream.end()
  process.exit(0)
})

const MACHINE_NAME =
  process.env.COMPUTERNAME ||
  process.env.HOSTNAME ||
  "unknown-pc"

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
    console.error("[AGENT] Redis env vars missing")
    process.exit(1)
  }

  return new Redis({ url, token })
}

function findAhkExe() {
  for (const p of CANDIDATE_PATHS) {
    try {
      const result = execSync(`where ${p} 2>nul`, { encoding: "utf-8" }).trim()
      if (result) return result.split("\n")[0]
    } catch {}

    if (fs.existsSync(p)) return p
  }
  return null
}

function runAhk(scriptPath: string) {
  return new Promise<void>((resolve, reject) => {
    const exe = findAhkExe()
    if (!exe) return reject(new Error("AutoHotkey not found"))

    const child = spawn(exe, [scriptPath], {
      cwd: AHK_DIR,
      windowsHide: true,
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error("AHK timeout"))
    }, AHK_TIMEOUT_MS)

    child.on("close", (code) => {
      clearTimeout(timeout)
      code === 0 ? resolve() : reject(new Error("AHK failed"))
    })

    child.on("error", reject)
  })
}

async function waitForExport() {
  for (let i = 0; i < EXPORT_RETRIES; i++) {
    const file = findLatestExport()
    if (file) return file
    await new Promise(r => setTimeout(r, EXPORT_RETRY_DELAY_MS))
  }
  throw new Error("No export found")
}

function findLatestExport() {
  if (!fs.existsSync(EXPORTS_DIR)) return null

  const files = fs.readdirSync(EXPORTS_DIR)
    .filter(f => f.endsWith(".xls") || f.endsWith(".xlsx"))
    .map(f => {
      const full = path.join(EXPORTS_DIR, f)
      return { full, mtime: fs.statSync(full).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)

  return files[0] ?? null
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
  }
}

function safeWriteJson(file: string, data: any) {
  try {
    ensureCacheDir()
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
  } catch {}
}

function buildMachineSeedFromStock(items: any[]) {
  return items
    .filter(i => String(i.name).toLowerCase().includes("andamio"))
    .map((i, idx) => ({
      id: `local-${i.codigo || idx}`,
      name: i.name,
      model: i.codigo || "3C",
      category: "scaffold",
      status: "available",
    }))
}

function buildSparePartsSeedFromStock(items: any[]) {
  return items.slice(0, 50).map((i, idx) => ({
    id: `local-part-${i.codigo || idx}`,
    machineId: `local-${i.codigo || idx}`,
    partName: i.name,
    stockTotal: i.stockTotal || 0,
  }))
}

async function processCommand(redis: any, commandId: string, module: string) {
  isProcessing = true

  try {
    const scriptName = MODULE_SCRIPTS[module]
    const scriptPath = path.join(AHK_DIR, scriptName)

    await runAhk(scriptPath)

    const latest = await waitForExport()
    const buffer = fs.readFileSync(latest.full).buffer

    let result: any

    if (module === "reparaciones") {
      result = await syncRepairsToMaintenance(buffer)
    } else {
      const { items } = parseExcel(buffer)
      result = await syncItems(items)
    }

    if (module === "stock") {
      safeWriteJson(STOCK_CACHE_FILE, result.items || [])
    }

    await redis.hset(`sync-3c:command:${commandId}`, {
      status: "completed",
      result: JSON.stringify(result),
    })
  } catch (err: any) {
    console.error(err)
  } finally {
    isProcessing = false
  }
}

async function main() {
  const redis = getRedis()
  console.log("Agent started")
}

main()