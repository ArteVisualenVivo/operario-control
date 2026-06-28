import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const commandId = searchParams.get("commandId")

    if (!commandId) {
      return NextResponse.json(
        { error: "commandId es requerido" },
        { status: 400 },
      )
    }

    const redis = getRedis()
    const raw = await redis.hgetall(`sync-3c:command:${commandId}`)

    if (!raw || Object.keys(raw).length === 0) {
      return NextResponse.json(
        { error: "Comando no encontrado", status: "not_found" },
        { status: 404 },
      )
    }

    const parsed = { ...raw }
    if (typeof parsed.result === "string" && parsed.result) {
      try {
        parsed.result = JSON.parse(parsed.result)
      } catch {
        // keep as string
      }
    }

    return NextResponse.json(parsed)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
