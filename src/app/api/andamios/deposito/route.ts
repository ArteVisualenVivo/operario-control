import { NextResponse } from "next/server"
import { getRedis } from "@/lib/sync-3c/redisPrimary"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// TOTAL FÍSICO real de andamios/piezas por familia, cargado UNA sola vez desde
// la web. Se guarda en Redis (fuente primaria); es un dato manual, no se toca
// con las sincronizaciones de 3C.
// - KEY NUEVA: "andamios:total:stock" (total físico, fórmula disponible = total − alquilados).
// - KEY VIEJA: "andamios:deposito:stock" (solo lectura, para migrar el valor
//   inicial: total = depósito viejo + alquilados actuales).
const KEY = "andamios:total:stock"
const LEGACY_KEY = "andamios:deposito:stock"

async function readPayload(key: string): Promise<Record<string, unknown> | null> {
  const redis = getRedis()
  const raw = await redis.get<Record<string, unknown>>(key)
  if (!raw) return null
  return typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : raw
}

export async function GET() {
  try {
    const data = await readPayload(KEY)
    if (data) {
      return NextResponse.json({
        available: true,
        items: data.items ?? {},
        updatedAt: data.updatedAt ?? null,
        migrated: false,
      })
    }
    // Fallback: si aún no se cargó el total físico, exponer el depósito viejo
    // para que la web lo use como base de la migración inicial.
    const legacy = await readPayload(LEGACY_KEY)
    if (legacy) {
      return NextResponse.json({
        available: true,
        items: legacy.items ?? {},
        updatedAt: legacy.updatedAt ?? null,
        migrated: true,
      })
    }
    return NextResponse.json({ available: false, items: {}, updatedAt: null })
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