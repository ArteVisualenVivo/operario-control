import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { normalizeSyncModules, type SyncModuleId } from "@/lib/sync-3c/syncConfig"

export const runtime = "nodejs"
export const maxDuration = 120

// Orden de ejecución del pipeline de sincronización (NO modificar)
// Dependencias: stock → articulos → alquileres → reparaciones → reparaciones_facturadas
const SYNC_PIPELINE: SyncModuleId[] = ["stock", "articulos", "alquileres", "reparaciones", "reparaciones_facturadas"]

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      module?: unknown
      modules?: unknown
    }
    // Nuevo flujo: selección ÚNICA compartida con el auto-sync del agente.
    // `modules[]` = exactamente los módulos a ejecutar (sin cascada).
    // Legacy: `module` = "todo" (los 5 en orden) o un módulo individual
    // (preserva el comportamiento cascada original: ese + posteriores).
    let modulesToEnqueue: SyncModuleId[]
    if (body.modules !== undefined) {
      modulesToEnqueue = normalizeSyncModules(body.modules)
      if (modulesToEnqueue.length === 0) {
        return NextResponse.json(
          { success: false, error: "Seleccioná al menos un módulo para sincronizar." },
          { status: 400 },
        )
      }
    } else {
      const module = typeof body.module === "string" ? body.module : "stock"
      if (module !== "todo" && !SYNC_PIPELINE.includes(module as SyncModuleId)) {
        return NextResponse.json(
          { success: false, error: `Módulo inválido. Usar: ${SYNC_PIPELINE.join(", ")}, todo` },
          { status: 400 },
        )
      }

      // Determinar el punto de inicio en el pipeline
      // "todo" → la cadena completa; un módulo → ese + posteriores (legacy).
      const startIndex = module === "todo" ? 0 : SYNC_PIPELINE.indexOf(module as SyncModuleId)
      // Encolar los módulos desde el punto de inicio
      modulesToEnqueue = SYNC_PIPELINE.slice(startIndex)
    }

    const redis = getRedis()
    const now = Date.now()

    // Verificar si ya existen comandos pending para los módulos solicitados
    // Usar SCAN en lugar de KEYS para evitar bloqueo
    const pendingCommandIds: string[] = []
    let cursor = "0"
    do {
      const result = await redis.scan(cursor, { match: "sync-3c:command:*", count: 100 })
      cursor = result[0]
      const keys = result[1] as string[]
      for (const key of keys) {
        const data = await redis.hgetall<Record<string, unknown>>(key)
        if (data && data.status === "pending") {
          const existingModule = data.module as SyncModuleId
          if (modulesToEnqueue.includes(existingModule)) {
            const existingCommandId = key.replace("sync-3c:command:", "")
            pendingCommandIds.push(existingCommandId)
          }
        }
      }
    } while (cursor !== "0")

    if (pendingCommandIds.length > 0) {
      return NextResponse.json({
        commandId: pendingCommandIds[0],
        alreadyPending: true,
        pipeline: modulesToEnqueue,
      })
    }

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
      // Agregar a la cola FIFO para el listener
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
