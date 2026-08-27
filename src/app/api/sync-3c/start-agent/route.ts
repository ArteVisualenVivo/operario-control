import { NextResponse } from "next/server"
import { spawn } from "child_process"
import path from "path"
import fs from "fs"

// Este endpoint SOLO funciona en desarrollo local
// En producción (Vercel), el agente debe estar prendido
export const runtime = "nodejs"

const LOCK_FILE = "C:\\Users\\Cesar\\Desktop\\operario-control\\sync-agent\\.agent.lock"

function isAgentRunning(): boolean {
    try {
        if (!fs.existsSync(LOCK_FILE)) return false
        
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8"))
        const lockPid = lockData.pid
        const lockTime = lockData.timestamp
        
        // Verificar si el lock expiró
        if (lockTime && Date.now() - lockTime > 60000) {
            return false
        }
        
        // Verificar si el proceso está vivo
        try {
            process.kill(lockPid, 0)
            return true
        } catch {
            return false
        }
    } catch {
        return false
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}))

        // ============================================================
        // MODO LISTENER: iniciar el servicio permanente del agente
        // (usado por el auto-start de la web)
        // ============================================================
        if (body.mode === "listener") {
            if (isAgentRunning()) {
                return NextResponse.json({
                    success: true,
                    message: "Agente ya está corriendo",
                    alreadyRunning: true,
                })
            }

            const projectRoot = path.resolve(process.cwd(), "sync-agent")
            const agentPath = path.join(projectRoot, "agent.ts")

            console.log("[API] Starting agent in LISTENER mode")
            const child = spawn("npx", ["tsx", agentPath], {
                cwd: process.cwd(),
                windowsHide: true,
                shell: true,
                detached: true,
                stdio: "ignore",
            })
            child.unref()

            return NextResponse.json({
                success: true,
                message: "Agente iniciado en modo listener",
                pid: child.pid,
            })
        }

        const commandId = body.commandId
        const module = body.module || "stock"
        const autoEnqueued: string[] = body.autoEnqueued || []

        if (!commandId) {
            return NextResponse.json(
                { success: false, error: "commandId es requerido" },
                { status: 400 }
            )
        }

        // Verificar si el agente ya está corriendo
        if (isAgentRunning()) {
            return NextResponse.json({
                success: true,
                message: "Agente ya está corriendo",
                alreadyRunning: true,
            })
        }

        // Iniciar el agente en modo on-demand
        const projectRoot = path.resolve(process.cwd(), "sync-agent")
        const agentPath = path.join(projectRoot, "agent.ts")

        console.log(`[API] Starting agent for command ${commandId} [module: ${module}]`)
        console.log(`[API] Auto-enqueued: ${autoEnqueued.length} commands`)

        // Construir argumentos: commandId, module, ...autoEnqueued
        const args = ["tsx", agentPath, commandId, module, ...autoEnqueued]

        const child = spawn("npx", args, {
            cwd: process.cwd(),
            windowsHide: true,
            shell: true,
        })

        child.stdout?.on("data", (d) => {
            console.log(`[AGENT] ${d}`)
        })

        child.stderr?.on("data", (d) => {
            console.error(`[AGENT:err] ${d}`)
        })

        return NextResponse.json({
            success: true,
            message: "Agente iniciado",
            pid: child.pid,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido"
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        )
    }
}