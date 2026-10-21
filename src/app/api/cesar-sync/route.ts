import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { spawn } from "child_process"
import path from "path"

export const runtime = "nodejs"
export const maxDuration = 120

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      password?: string
    }

    // Validar contraseña de CESAR
    const expectedPassword = process.env.NEXT_PUBLIC_CESAR_PASSWORD ?? "cesar2026"
    if (!body.password || body.password !== expectedPassword) {
      return NextResponse.json(
        { success: false, error: "Clave incorrecta" },
        { status: 401 }
      )
    }

    const redis = getRedis()
    const now = Date.now()

    // Crear comando independiente para el módulo "cesar"
    // No se mezcla con el pipeline de reparaciones_facturadas existente.
    const commandId = randomUUID()
    await redis.hset(`sync-3c:command:${commandId}`, {
      module: "cesar",
      status: "pending",
      createdAt: now,
      startedAt: "",
      completedAt: "",
      agent: "",
      result: "",
      error: "",
    })
    await redis.lpush("sync-3c:queue", commandId)

    // ── Lanzar el agente local automáticamente (igual que hace el dashboard con "Sincronizar Rep. Facturadas") ──
    // Esto hace que aparezca la ventana CMD y el agente procese el comando inmediatamente.
    try {
      const agentPath = path.join(path.resolve(process.cwd(), "sync-agent"), "agent.ts")
      const args = ["tsx", agentPath, commandId, "cesar"]

      spawn("npx", args, {
        cwd: process.cwd(),
        windowsHide: true,
        shell: true,
        detached: true,
        stdio: "ignore",
      }).unref()

      console.log(`[CESAR] Agente lanzado para command ${commandId} [module: cesar]`)
    } catch (spawnErr) {
      // Si falla el spawn, el comando sigue en la cola y el despertador lo procesará
      console.warn(`[CESAR] No se pudo lanzar el agente automáticamente:`, spawnErr instanceof Error ? spawnErr.message : String(spawnErr))
    }

    return NextResponse.json({
      success: true,
      commandId,
      message: "Comando CESAR encolado y agente lanzado automáticamente.",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}