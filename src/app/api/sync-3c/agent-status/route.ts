import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

export async function GET() {
  try {
    const redis = getRedis()
    const raw = await redis.get<Record<string, unknown>>("sync-3c:agent:production")

    if (!raw || typeof raw !== "object") {
      return NextResponse.json({
        online: false,
        status: "unknown",
        machineName: null,
        lastHeartbeat: null,
      })
    }

    const data = raw
    const heartbeat = (data.lastHeartbeat as number) ?? 0
    const online = heartbeat > 0 && (Date.now() - heartbeat) < 90_000

    return NextResponse.json({
      online,
      status: data.status ?? "unknown",
      machineName: data.machineName ?? null,
      lastHeartbeat: new Date(heartbeat).toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message, online: false },
      { status: 500 },
    )
  }
}
