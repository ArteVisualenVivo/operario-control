import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"
import { randomUUID } from "crypto"

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

    return NextResponse.json({
      success: true,
      commandId,
      message: "Comando CESAR encolado. El agente lo procesará de forma independiente.",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}