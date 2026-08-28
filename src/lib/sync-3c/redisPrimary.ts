import { Redis } from "@upstash/redis"

// redisPrimary.ts — Fuente primaria de datos (Upstash Redis) + OUTBOX Firestore.
// La WEB lee PRIMERO de Redis. Firestore queda como copia secundaria mediante
// outbox. El agente y Vercel comparten el mismo Upstash Redis.

export const OUTBOX_MAX_ATTEMPTS = 12

/** Clasifica un error de Firestore como "transitorio" (debe reintentarse). */
export function isTransientFirestoreError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = `${err.name}: ${err.message}`
    if (/RESOURCE_EXHAUSTED|quota exceeded/i.test(msg)) return true
    if (/UNAUTHENTICATED|PERMISSION_DENIED|7|16/i.test(msg)) return true
    if (/UNAVAILABLE|UNKNOWN|14|DEADLINE_EXCEEDED|4|ABORTED|10|CANCELLED|1/i.test(msg)) return true
  }
  return true
}

export type PrimaryModuleId = "stock" | "articulos" | "maintenance" | "alquileres"

export interface PrimaryDataEnvelope {
  module: PrimaryModuleId
  syncId: string
  updatedAt: string
  source: "3c" | "manual"
  recordCount: number
  degraded: boolean
  firestoreStatus: "synced" | "pending" | "degraded"
  exportInfo?: Record<string, unknown> | null
  data: unknown
}

export interface OutboxEntry {
  syncId: string
  module: PrimaryModuleId
  target: "inventory_stock" | "maintenance" | "dashboard_stats/scaffold_rentals"
  createdAt: number
  attempts: number
  lastAttemptAt: number
  nextRetryAt: number
  lastError: string
  dataKey?: string
  bufferBase64?: string
}

const META_KEY = (m: PrimaryModuleId) => `sync-3c:data:${m}:meta`
const CHUNK_KEY = (m: PrimaryModuleId, i: number) => `sync-3c:data:${m}:chunk:${i}`
// Límite seguro por valor (Upstash REST ~1MB; usamos un margen conservador).
const CHUNK_MAX_CHARS = 700 * 1024
const OUTBOX_PENDING_LIST = "sync-3c:outbox:pending"
const OUTBOX_ITEM_KEY = (syncId: string) => `sync-3c:outbox:${syncId}`

function splitString(value: string, size: number): string[] {
  if (!value) return []
  const chunks: string[] = []
  for (let i = 0; i < value.length; i += size) {
    chunks.push(value.slice(i, i + size))
  }
  return chunks
}

// Upstash Redis `get` auto-deserializa valores válidos de JSON. Para leer el
// string crudo guardado aceptamos tanto el string como el objeto ya parseado.
async function getRaw(client: Redis, key: string): Promise<string | null> {
  const val = await client.get<unknown>(key)
  if (val === null || val === undefined) return null
  if (typeof val === "string") return val
  if (val === true || val === false || typeof val === "number") return String(val)
  // objeto/array ya deserializado por Upstash: volver a serializarlo idéntico
  return JSON.stringify(val)
}

export function getRedis(): Redis {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error("[REDIS] Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN")
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

/** Guarda (o reemplaza) el estado primario completo de un módulo. Particionado. */
export async function saveModuleData(
  redis: Redis,
  input: {
    module: PrimaryModuleId
    syncId: string
    data: unknown
    recordCount: number
    degraded?: boolean
    firestoreStatus?: PrimaryDataEnvelope["firestoreStatus"]
    exportInfo?: Record<string, unknown> | null
  },
): Promise<void> {
  // Serialización determinista: las fechas van como ISO (JSON.stringify lo hace).
  const dataJson = JSON.stringify(input.data ?? null)

  // Leer la cantidad previa de chunks para limpiar sobrantes.
  let prevChunks = 0
  try {
    const prevMeta = await getRaw(redis, META_KEY(input.module))
    if (prevMeta) {
      const prev = JSON.parse(prevMeta) as { chunkCount?: number }
      prevChunks = typeof prev.chunkCount === "number" ? prev.chunkCount : 0
    }
  } catch {
    prevChunks = 0
  }

  const chunks = splitString(dataJson, CHUNK_MAX_CHARS)

  const meta: Omit<PrimaryDataEnvelope, "data"> & { chunkCount: number } = {
    module: input.module,
    syncId: input.syncId,
    updatedAt: new Date().toISOString(),
    source: "3c",
    recordCount: input.recordCount,
    degraded: input.degraded ?? false,
    firestoreStatus: input.firestoreStatus ?? "pending",
    exportInfo: input.exportInfo ?? null,
    chunkCount: chunks.length,
  }

  try {
    await redis.set(META_KEY(input.module), JSON.stringify(meta))
    // Escribir chunks
    for (let i = 0; i < chunks.length; i++) {
      await redis.set(CHUNK_KEY(input.module, i + 1), chunks[i])
    }
    // Limpiar chunks sobrantes de una versión anterior más grande
    for (let i = chunks.length + 1; i <= prevChunks; i++) {
      await redis.del(CHUNK_KEY(input.module, i)).catch(() => {})
    }
  } catch (err) {
    console.error(`[REDIS] saveModuleData(${input.module}) falló (sincronización no se bloquea):`, err)
  }
}

  /** Reconstruye un estado primario a partir de meta + chunks. */
  export async function readModuleData(
    module: PrimaryModuleId,
    redis?: Redis,
  ): Promise<PrimaryDataEnvelope | null> {
    const client = redis ?? getRedis()
    try {
      const metaRaw = await getRaw(client, META_KEY(module))
      if (!metaRaw) return null
      const meta = JSON.parse(metaRaw) as Omit<PrimaryDataEnvelope, "data"> & { chunkCount: number }
      const chunkCount = typeof meta.chunkCount === "number" ? meta.chunkCount : 1

      const chunks: string[] = []
      for (let i = 1; i <= chunkCount; i++) {
        const chunk = await getRaw(client, CHUNK_KEY(module, i))
        if (chunk) chunks.push(chunk)
      }
      // Integridad: si falta algún chunk, NO devolver datos parciales (se
      // tratarán como "no disponibles"; Firestore será el fallback).
      if (chunks.length !== chunkCount) {
        console.error(`[REDIS] readModuleData(${module}) incompleto: ${chunks.length}/${chunkCount} chunks`)
        return null
      }

      const dataJson = chunks.join("")
      let data: unknown = null
      if (dataJson) {
        data = JSON.parse(dataJson)
      }

      const envelope: PrimaryDataEnvelope = {
        module,
        syncId: meta.syncId,
        updatedAt: meta.updatedAt,
        source: meta.source,
        recordCount: meta.recordCount,
        degraded: meta.degraded,
        firestoreStatus: meta.firestoreStatus,
        exportInfo: meta.exportInfo ?? null,
        data,
      }
      return envelope
    } catch (err) {
      console.error(`[REDIS] readModuleData(${module}) falló:`, err)
      return null
    }
  }

function retryDelayMs(attempt: number): number {
  // backoff exponencial: 15s, 30s, 1m, 2m ... tope 1h
  const base = 15_000
  const exp = Math.pow(2, Math.max(0, attempt - 1))
  return Math.min(base * exp, 60 * 60 * 1000)
}

/** Registra un item de outbox pendiente (Firestore no disponible / falló). */
export async function enqueueOutbox(redis: Redis, entry: OutboxEntry): Promise<void> {
  const existing = await getRaw(redis, OUTBOX_ITEM_KEY(entry.syncId)).catch(() => null)
  const shouldPush = !existing
  entry.attempts = entry.attempts ?? 0
  entry.nextRetryAt = Date.now() + retryDelayMs(entry.attempts + 1)
  if (shouldPush) {
    await redis.rpush(OUTBOX_PENDING_LIST, entry.syncId).catch(() => {})
  }
  await redis.set(OUTBOX_ITEM_KEY(entry.syncId), JSON.stringify(entry)).catch(() => {})
}

/** Devuelve los syncIds pendientes. */
export async function listOutboxPending(redis: Redis): Promise<string[]> {
  try {
    return (await redis.lrange<string>(OUTBOX_PENDING_LIST, 0, -1)) ?? []
  } catch {
    return []
  }
}

/** Actualiza un item de outbox. */
export async function updateOutboxItem(redis: Redis, entry: OutboxEntry): Promise<void> {
  await redis.set(OUTBOX_ITEM_KEY(entry.syncId), JSON.stringify(entry)).catch(() => {})
}

/** Marca como procesado y lo quita de la cola. */
export async function removeOutboxItem(redis: Redis, syncId: string): Promise<void> {
  await redis.del(OUTBOX_ITEM_KEY(syncId)).catch(() => {})
  await redis.lrem(OUTBOX_PENDING_LIST, 0, syncId).catch(() => {})
}

/** Lee un item de outbox por id. */
export async function readOutboxItem(redis: Redis, syncId: string): Promise<OutboxEntry | null> {
  try {
    const raw = await getRaw(redis, OUTBOX_ITEM_KEY(syncId))
    return raw ? (JSON.parse(raw) as OutboxEntry) : null
  } catch {
    return null
  }
}

/** Cuenta pendientes (para monitoreo). */
export async function countOutboxPending(redis: Redis): Promise<number> {
  try {
    return (await listOutboxPending(redis)).length
  } catch {
    return 0
  }
}

