import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"
import { randomUUID } from "crypto"

export const runtime = "nodejs"
export const maxDuration = 120

// Orden de ejecución del pipeline de sincronización
// Dependencias: stock → articulos → alquileres → reparaciones
const SYNC_PIPELINE: string[] = ["stock", "articulos", "alquileres", "reparaciones"]

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const module = body.module || "stock"

    if (!SYNC_PIPELINE.includes(module)) {
      return NextResponse.json(
        { success: false, error: `Módulo inválido. Usar: ${SYNC_PIPELINE.join(", ")}` },
        { status: 400 },
      )
    }

    const redis = getRedis()
    const now = Date.now()

    // Determinar el punto de inicio en el pipeline
    const startIndex = SYNC_PIPELINE.indexOf(module)
    const modulesToEnqueue = SYNC_PIPELINE.slice(startIndex)

    // Crear comandos para todos los módulos del pipeline desde el punto de inicio
    const commandIds: string[] = []
    for (const mod of modulesToEnqueue) {
      const commandId = randomUUID()
      await redis.hset(`sync-3c:command:${commandId}`, {
        module: mod,
        status: "pending",
        createdAt: now,
        startedAt: "",
        completedAt: "",
        agent: "",
        result: "",
        error: "",
      })
      await redis.lpush("sync-3c:queue", commandId)
      commandIds.push(commandId)
    }

    return NextResponse.json({
      commandId: commandIds[0],
      autoEnqueued: commandIds.slice(1),
      pipeline: modulesToEnqueue,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}