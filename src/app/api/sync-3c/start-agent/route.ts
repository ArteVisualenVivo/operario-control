import { NextResponse } from "next/server"
import { spawn, execFileSync } from "child_process"
import path from "path"
import fs from "fs"

// Este endpoint SOLO funciona en desarrollo local (el spawn es local).
// En producción (Vercel) no puede arrancar procesos: devuelve error.
export const runtime = "nodejs"
// Consulta procesos del sistema en cada request: nunca cachear.
export const dynamic = "force-dynamic"

const LOCK_FILE = "C:\\Users\\Cesar\\Desktop\\operario-control\\sync-agent\\.agent.lock"

/**
 * Regex que coincide con la línea de comandos de CUALQUIER capa del agente.
 *
 * En Windows `npx tsx sync-agent/agent.ts` genera un árbol de procesos:
 *   cmd.exe → node npx-cli.js tsx … → node …tsx/dist/cli.mjs sync-agent/agent.ts
 *                                    → node --import …/loader.mjs sync-agent/agent.ts
 * Todas esas líneas contienen `sync-agent/agent.ts`, así que matchearlas todas
 * permite un "hard stop" real (no quedan huérfanos).
 */
const AGENT_CMDLINE_REGEX = "sync-agent[\\\\/]agent\\.ts"

/**
 * PIDs vivos cuyo command line corresponde al agente (excluye este proceso).
 * Devuelve `null` si NO se pudo enumerar (p. ej. PowerShell falló): en ese caso
 * el llamador NO debe asumir que no hay agentes ni tocar el lock.
 */
function listAgentPids(): number[] | null {
    try {
        const ps = [
            "$ErrorActionPreference = 'SilentlyContinue'",
            `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${AGENT_CMDLINE_REGEX}' } | ForEach-Object { $_.ProcessId }`,
        ].join("; ")
        const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
            encoding: "utf-8",
            timeout: 15_000,
        })
        return out
            .split(/\r?\n/)
            .map((line) => Number(line.trim()))
            .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    } catch (err) {
        console.error("[API] listAgentPids falló:", err instanceof Error ? err.message : err)
        return null
    }
}

/** PID dueño del lock (o null si no hay lock / está corrupto / sin PID válido). */
function readLockPid(): number | null {
    try {
        if (!fs.existsSync(LOCK_FILE)) return null
        const raw = JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8")) as { pid?: unknown }
        const pid = Number(raw?.pid)
        return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch {
        return null
    }
}

/** Invalida el lock (proceso muerto / lock corrupto). */
function removeLock(): void {
    try {
        if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE)
    } catch {
        /* ignore */
    }
}

/**
 * Hard stop: mata cada PID y TODO su árbol (`/T`) de forma forzada (`/F`).
 * Matar el árbol garantiza que también caigan las capas npx/tsx/cmd.
 */
function killAgentTrees(pids: number[]): number[] {
    const killed: number[] = []
    for (const pid of pids) {
        try {
            execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 15_000 })
            killed.push(pid)
        } catch {
            /* El proceso ya no existe o no se pudo matar: se ignora. */
        }
    }
    return killed
}

export async function POST(request: Request) {
    try {
        const body = (await request.json().catch(() => ({}))) as {
            commandId?: unknown
            module?: unknown
            autoEnqueued?: unknown
            /** "manual" (click en Sincronizar) | "auto" (corrida programada a pedido). */
            mode?: unknown
        }

        const commandId = typeof body.commandId === "string" ? body.commandId : ""
        const moduleName = typeof body.module === "string" ? body.module : "stock"
        const autoEnqueued = Array.isArray(body.autoEnqueued)
            ? body.autoEnqueued.filter((v): v is string => typeof v === "string")
            : []

        // "manual" = click en "Sincronizar": comando puntual + drenado de cola.
        // "auto"   = corrida programada a pedido: mismos guards que el modo
        //            `--auto` del agente (módulos de Redis `sync-3c:sync-config`),
        //            sin commandId. Lo normal es que la dispare el Programador de
        //            tareas de Windows (ver scripts/install-auto-sync-tasks.ps1).
        const mode = body.mode === "auto" ? "auto" : "manual"

        if (mode === "manual" && !commandId) {
            return NextResponse.json({ success: false, error: "commandId es requerido" }, { status: 400 })
        }

        // =========================================================
        // SOLO LA PC DE 3C PUEDE DESPERTAR AL AGENTE
        // ---------------------------------------------------------
        // `spawn("npx", ...)` lanza un proceso LOCAL. En Vercel (o en
        // cualquier host remoto) eso no puede funcionar: no existe el repo ni
        // tsx. Se avisa explícito en vez de fallar en silencio, así la web
        // puede decirle al usuario que el comando quedó en cola y que el
        // despertador local lo toma en menos de un minuto (ver
        // `scripts/wake-agent-if-pending.ps1`).
        // =========================================================
        if (process.env.VERCEL) {
            return NextResponse.json({
                success: false,
                remote: true,
                error:
                    "El agente no se puede iniciar desde este sitio (host remoto): corre en la PC de 3C. " +
                    "El pedido quedó en cola y el despertador de la PC lo toma en menos de un minuto.",
            })
        }

        // ============================================================
        // HARD STOP DE INSTANCIAS VIEJAS
        // ------------------------------------------------------------
        // Antes de arrancar se limpia el terreno: si quedó un agente huérfano
        // (proceso vivo sin lock válido) se mata el árbol completo; si el lock
        // apunta a un proceso muerto se invalida. Así NUNCA se acumulan
        // procesos stale entre corridas.
        // ============================================================
        const livePids = listAgentPids()

        if (livePids === null) {
            // No se pudo enumerar procesos: NO se toca el lock ni se mata nada.
            // El propio agente resuelve el lock (si hay un dueño vivo, sale solo).
            console.warn("[API] Enumeración de procesos no disponible; se delega el control del lock al agente")
        } else {
            const lockPid = readLockPid()

            // Agente legítimo en curso = proceso vivo Y dueño del lock.
            // En ese caso el agente ya está drenando la cola: no se toca.
            if (lockPid !== null && livePids.includes(lockPid)) {
                return NextResponse.json({
                    success: true,
                    message: "Agente ya está corriendo",
                    alreadyRunning: true,
                    pids: livePids,
                })
            }

            // Procesos del agente sin lock válido = huérfanos/stale → hard stop.
            if (livePids.length > 0) {
                console.log(`[API] Hard-stop de agentes stale: ${livePids.join(", ")}`)
                const killed = killAgentTrees(livePids)
                if (killed.length > 0) console.log(`[API] Agentes stale terminados: ${killed.join(", ")}`)
            }

            // Lock sin proceso vivo (o corrupto) → se invalida antes del spawn.
            removeLock()
        }

        // ============================================================
        // ARRANQUE ON-DEMAND
        // ------------------------------------------------------------
        // El agente procesa el comando + el resto de la cola y TERMINA solo.
        // Se lanza detached + stdio ignore para que sobreviva a recargas del
        // dev server; su salida queda en `sync-agent/agent.log`.
        // ============================================================
        const agentPath = path.join(path.resolve(process.cwd(), "sync-agent"), "agent.ts")
        const args = mode === "auto"
            ? ["tsx", agentPath, "--auto"]
            : ["tsx", agentPath, commandId, moduleName, ...autoEnqueued]

        console.log(
            mode === "auto"
                ? "[API] Starting scheduled auto-sync agent (--auto)"
                : `[API] Starting on-demand agent for command ${commandId} [module: ${moduleName}]`,
        )
        if (mode === "manual") console.log(`[API] Auto-enqueued: ${autoEnqueued.length} commands`)

        const child = spawn("npx", args, {
            cwd: process.cwd(),
            windowsHide: true,
            shell: true,
            detached: true,
            stdio: "ignore",
        })
        child.unref()

        return NextResponse.json({
            success: true,
            message: mode === "auto" ? "Auto-sync iniciado (corrida programada)" : "Agente iniciado (on-demand)",
            pid: child.pid,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido"
        return NextResponse.json({ success: false, error: message }, { status: 500 })
    }
}