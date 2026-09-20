import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"
import { getSyncConfig, saveSyncConfig } from "@/lib/sync-3c/syncConfig"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

/** GET: devuelve la selección única de módulos (la usan web y agente). */
export async function GET() {
  try {
    const redis = getRedis()
    const config = await getSyncConfig(redis)
    return NextResponse.json({ success: true, ...config })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** POST { modules: string[] }: guarda la selección única de módulos. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { modules?: unknown }
    const redis = getRedis()
    const config = await saveSyncConfig(redis, body.modules, "web")
    return NextResponse.json({ success: true, ...config })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
