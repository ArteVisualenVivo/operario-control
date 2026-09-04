import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"
import { randomUUID } from "crypto"

export const runtime = "nodejs"
export const maxDuration = 120

// Orden de ejecución del pipeline de sincronización
// Dependencias: stock → articulos → alquileres → reparaciones → reparaciones_facturadas
const SYNC_PIPELINE: string[] = ["stock", "articulos", "alquileres", "reparaciones", "reparaciones_facturadas"]

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
    // Elegir UN solo módulo (el que pidió el usuario), no arrastrar el resto del pipeline

    if (!SYNC_PIPELINE.includes(module)) {
      return NextResponse.json(
        { success: false, error: `Módulo inválido. Usar: ${SYNC_PIPELINE.join(", ")}` },
        { status: 400 },
      )
    }

    const redis = getRedis()
    const now = Date.now()

    // Determinar el punto de inicio en el pipeline
    const startIndex = SYNC_PIPELINE.indexOf(module)
    // Encolar SOLO el módulo elegido (si el usuario pide uno, solo corre ese)
    const modulesToEnqueue = SYNC_PIPELINE.slice(startIndex, startIndex + 1)

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
           const existingModule = data.module as string
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
