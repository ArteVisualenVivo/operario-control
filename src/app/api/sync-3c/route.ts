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
    const body = await request.json().catch(() => ({}))
    const module = body.module || "stock"

    if (!["stock", "reparaciones", "articulos", "alquileres"].includes(module)) {
      return NextResponse.json(
        { success: false, error: "Módulo inválido. Usar: stock, reparaciones, articulos, alquileres" },
        { status: 400 },
      )
    }

    const redis = getRedis()
    const now = Date.now()

    // Al sincronizar stock o materiales, también encolar automáticamente
    // los alquileres pendientes de andamios para mantener el Dashboard al día.
    const autoEnqueue: string[] = []
    if (module === "stock" || module === "articulos") {
      autoEnqueue.push("alquileres")
    }

    const commandId = randomUUID()
    await redis.hset(`sync-3c:command:${commandId}`, {
      module,
      status: "pending",
      createdAt: now,
      startedAt: "",
      completedAt: "",
      agent: "",
      result: "",
      error: "",
    })
    await redis.lpush("sync-3c:queue", commandId)

    for (const extra of autoEnqueue) {
      const extraId = randomUUID()
      await redis.hset(`sync-3c:command:${extraId}`, {
        module: extra,
        status: "pending",
        createdAt: now,
        startedAt: "",
        completedAt: "",
        agent: "",
        result: "",
        error: "",
      })
      await redis.lpush("sync-3c:queue", extraId)
    }

    return NextResponse.json({ commandId, autoEnqueued: autoEnqueue })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
