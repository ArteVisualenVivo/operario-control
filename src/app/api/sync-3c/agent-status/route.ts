import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"
import {
  evaluateAgentHealth,
  type AgentHealthState,
} from "@/lib/agentHealth"

export const runtime = "nodejs"
// La ruta consulta Redis en cada request: nunca debe servir una respuesta cacheada.
export const dynamic = "force-dynamic"

/** Key del heartbeat del agente (la escribe sync-agent/agent.ts). NO cambiar. */
const HEARTBEAT_KEY = "sync-3c:agent:production"

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

/** Host de Redis en uso (sin token), para detectar desfasajes de configuración. */
function redisHost(): string | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export async function GET() {
  const host = redisHost()
  try {
    const redis = getRedis()
    const raw = await redis.get(HEARTBEAT_KEY)
    const health = evaluateAgentHealth(raw)

    if (health.state === "no-key" || health.state === "error") {
      console.error(
        `[agent-status] ${health.state} (redis=${host ?? "sin UPSTASH_REDIS_REST_URL"}): ${health.reason ?? "sin detalle"}`,
      )
    }

    return NextResponse.json({ ...health, redisHost: host })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    console.error(
      `[agent-status] no se pudo consultar Redis (redis=${host ?? "sin UPSTASH_REDIS_REST_URL"}): ${message}`,
    )
    // Error de conexión/config: diferenciable de "no-key" y de "offline".
    return NextResponse.json({
      state: "error" as AgentHealthState,
      online: false,
      status: "error",
      machineName: null,
      lastHeartbeat: null,
      ageSeconds: null,
      keyFound: null,
      reason: `no se pudo consultar Redis: ${message}`,
      error: message,
      redisHost: host,
    })
  }
}
