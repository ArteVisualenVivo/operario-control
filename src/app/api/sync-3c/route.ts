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

    if (!["stock", "reparaciones", "articulos"].includes(module)) {
      return NextResponse.json(
        { success: false, error: "Módulo inválido. Usar: stock, reparaciones, articulos" },
        { status: 400 },
      )
    }

    const redis = getRedis()
    const commandId = randomUUID()
    const now = Date.now()

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

    return NextResponse.json({ commandId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
