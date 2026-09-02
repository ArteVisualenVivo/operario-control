import { NextResponse } from "next/server"
import { getRedis } from "@/lib/sync-3c/redisPrimary"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Stock de andamios/piezas guardado en DEPÓSITO, cargado MANUALMENTE desde la
// web. Se guarda en Redis (fuente primaria); es un dato manual, no se toca con
// las sincronizaciones de 3C.
const KEY = "andamios:deposito:stock"

export async function GET() {
  try {
    const redis = getRedis()
    const raw = await redis.get<Record<string, unknown>>(KEY)
    if (!raw) {
      return NextResponse.json({ available: false, items: {}, updatedAt: null })
    }
    const data = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : raw
    return NextResponse.json({
      available: true,
      items: data.items ?? {},
      updatedAt: data.updatedAt ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { items?: Record<string, unknown> }
    const items: Record<string, number> = {}
    for (const [k, v] of Object.entries(body.items ?? {})) {
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) items[k] = n
    }
    const redis = getRedis()
    const payload = { items, updatedAt: new Date().toISOString() }
    await redis.set(KEY, JSON.stringify(payload))
    return NextResponse.json({ success: true, ...payload })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}