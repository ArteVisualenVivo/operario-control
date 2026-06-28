import { NextResponse } from "next/server"
import { spawn } from "child_process"
import path from "path"
import fs from "fs"
import { parseExcel } from "@/lib/sync-3c/parser"
import { syncItems } from "@/lib/sync-3c/engine"

export const runtime = "nodejs"
export const maxDuration = 120

const AHK_DIR = path.resolve(process.cwd(), "automation")
const AHK_SCRIPT = path.join(AHK_DIR, "sync_3c.ahk")
const EXPORTS_DIR = path.resolve(process.cwd(), "automation-watcher", "3c_exports")

const CANDIDATE_PATHS = [
  "AutoHotkey64.exe",
  "AutoHotkey32.exe",
  "AutoHotkey.exe",
  path.join("C:", "Program Files", "AutoHotkey", "AutoHotkey64.exe"),
  path.join("C:", "Program Files", "AutoHotkey", "AutoHotkey32.exe"),
  path.join("C:", "Program Files", "AutoHotkey", "v2", "AutoHotkey64.exe"),
]

function findAhkExe(): string | null {
  for (const p of CANDIDATE_PATHS) {
    const resolved = path.isAbsolute(p) ? p : p
    try {
      const which = require("child_process").execSync(`where ${p} 2>nul`, { encoding: "utf-8" }).trim()
      if (which) return which.split("\n")[0].trim()
    } catch {
      // not in PATH
    }
    try {
      if (fs.existsSync(resolved)) return resolved
    } catch {
      // skip
    }
  }
  return null
}

function runAhk(): Promise<void> {
  return new Promise((resolve, reject) => {
    const exe = findAhkExe()
    if (!exe) {
      reject(new Error("AutoHotkey no encontrado. Instalalo desde https://www.autohotkey.com/"))
      return
    }

    const child = spawn(exe, [AHK_SCRIPT], {
      cwd: AHK_DIR,
      windowsHide: false,
      shell: false,
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error("AHK timeout después de 120s — 3C puede no haber respondido"))
    }, 120_000)

    child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[AHK] ${d}`))
    child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[AHK:err] ${d}`))

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

interface ExportFile {
  name: string
  mtime: number
  fullPath: string
}

function findLatestExport(): ExportFile | null {
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
    .filter((f): f is ExportFile => f !== null)
    .sort((a, b) => b.mtime - a.mtime)

  return files[0] ?? null
}

async function waitForExport(retries = 5, delayMs = 1000): Promise<ExportFile> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const latest = findLatestExport()
    if (latest) return latest
    await new Promise((r) => setTimeout(r, delayMs))
  }
  throw new Error(
    `No se encontró archivo Excel en ${EXPORTS_DIR} tras ${retries} intentos. ` +
    "Verificá que 3C haya exportado correctamente."
  )
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get("mode")

    if (mode !== "auto") {
      return NextResponse.json(
        { success: false, error: 'Modo requerido: POST /api/sync-3c?mode=auto' },
        { status: 400 },
      )
    }

    if (process.env.NODE_ENV !== "development" || process.platform !== "win32") {
      return NextResponse.json(
        {
          success: false,
          error: "Auto sync 3C solo disponible en entorno local Windows (npm run dev)",
        },
        { status: 400 },
      )
    }

    await runAhk()

    const latest = await waitForExport()

    const buffer = fs.readFileSync(latest.fullPath).buffer
    const { items } = parseExcel(buffer)

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        created: 0,
        updated: 0,
        skipped: 0,
        warnings: ["El archivo exportado no contiene datos válidos en el formato esperado de 3C"],
      })
    }

    const result = await syncItems(items)

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      {
        success: false,
        error: message,
        created: 0,
        updated: 0,
        skipped: 0,
        warnings: [message],
      },
      { status: 500 },
    )
  }
}
