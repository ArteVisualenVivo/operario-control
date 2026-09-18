import { NextResponse } from "next/server"
import {
  getRedis,
  readModuleData,
  saveModuleData,
  type PrimaryModuleId,
} from "@/lib/sync-3c/redisPrimary"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID: PrimaryModuleId[] = ["stock", "articulos", "maintenance", "alquileres", "spare_part_orders"]
const META_KEY = (m: string) => `sync-3c:data:${m}:meta`
const CHUNK_KEY = (m: string, i: number) => `sync-3c:data:${m}:chunk:${i}`

async function invalidateModule(redis: ReturnType<typeof getRedis>, module: string) {
  // borrar meta + chunks del módulo (la web pasará a leer Firestore)
  try {
    // Upstash auto-deserializa JSON en `get`; aceptamos string u objeto.
    const metaVal: unknown = await redis.get(META_KEY(module)).catch(() => null)
    let chunkCount = 0
    if (metaVal) {
      const metaStr = typeof metaVal === "string" ? metaVal : JSON.stringify(metaVal)
      const parsed = JSON.parse(metaStr) as { chunkCount?: number }
      chunkCount = typeof parsed.chunkCount === "number" ? parsed.chunkCount : 0
    }
    await redis.del(META_KEY(module))
    for (let i = 1; i <= chunkCount; i++) {
      await redis.del(CHUNK_KEY(module, i))
    }
  } catch (err) {
    console.error(`[REDIS] invalidateModule(${module}) falló:`, err)
  }
}


export async function GET(
  _request: Request,
  { params }: { params: Promise<{ module: string }> },
) {
  try {
    const { module } = await params
    if (!VALID.includes(module as PrimaryModuleId)) {
      return NextResponse.json({ error: "Módulo inválido" }, { status: 400 })
    }

    const redis = getRedis()
    const envelope = await readModuleData(module as PrimaryModuleId, redis)

    if (!envelope) {
      return NextResponse.json({
        available: false,
        source: "none",
        module,
        data: null,
        updatedAt: null,
        recordCount: 0,
      })
    }

    return NextResponse.json({
      available: true,
      source: "redis",
      module,
      syncId: envelope.syncId,
      updatedAt: envelope.updatedAt,
      recordCount: envelope.recordCount,
      degraded: envelope.degraded,
      firestoreStatus: envelope.firestoreStatus,
      exportInfo: envelope.exportInfo ?? null,
      data: envelope.data,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// POST: publica el snapshot de un módulo en la fuente primaria (Redis) desde la
// web. Se usa para que la pantalla siga leyendo de Redis (no dependa de la cuota
// de Firestore) después de una importación manual. Solo se acepta el módulo
// `spare_part_orders` y un arreglo de registros.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ module: string }> },
) {
  try {
    const { module } = await params
    if (module !== "spare_part_orders") {
      return NextResponse.json({ error: "Módulo no habilitado para publicación" }, { status: 400 })
    }
    const body = (await request.json()) as { data?: unknown; recordCount?: number }
    if (!Array.isArray(body?.data)) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }
    const redis = getRedis()
    await saveModuleData(redis, {
      module: "spare_part_orders",
      syncId: `spare-part-orders-manual-${Date.now()}`,
      data: body.data,
      recordCount: typeof body.recordCount === "number" ? body.recordCount : body.data.length,
      degraded: false,
      firestoreStatus: "synced",
    })
    return NextResponse.json({ success: true, module, recordCount: body.data.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// DELETE: invalida la fuente primaria de un módulo (tras una mutación manual
// de la web) para que la web vuelva a leer Firestore y no muestre datos
// obsoletos. REGLA 22.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ module: string }> },
) {
  try {
    const { module } = await params
    if (!VALID.includes(module as PrimaryModuleId)) {
      return NextResponse.json({ error: "Módulo inválido" }, { status: 400 })
    }
    const redis = getRedis()
    await invalidateModule(redis, module)
    return NextResponse.json({ success: true, module, invalidated: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
