// syncConfig.ts — Selección única y compartida de módulos de sincronización 3C.
//
// Una sola fuente de verdad en Redis (`sync-3c:sync-config`, sin TTL) que usan
// TANTO la sincronización manual (web) COMO el auto-sync del agente.
// Desmarcado = no se ejecuta por ningún mecanismo. Sin cascada: seleccionar un
// módulo ejecuta únicamente ese módulo.
//
// Persistencia: Upstash Redis (cloud) → sobrevive recarga web, reinicio del
// agente y reinicio de la PC. No usa Firestore (no consume cuota Spark).
import type { Redis } from "@upstash/redis"

// Lectura cruda compatible con la auto-deserialización JSON de Upstash
// (misma técnica que redisPrimary.ts; helper local para no tocar ese archivo).
async function getRaw(client: Redis, key: string): Promise<string | null> {
  const val = await client.get<unknown>(key)
  if (val === null || val === undefined) return null
  if (typeof val === "string") return val
  if (val === true || val === false || typeof val === "number") return String(val)
  return JSON.stringify(val)
}

/** Módulos sincronizables de 3C (los 5 que existen). */
export type SyncModuleId =
  | "stock"
  | "articulos"
  | "alquileres"
  | "reparaciones"
  | "reparaciones_facturadas"

/** Orden canónico de ejecución del pipeline (NO modificar). */
export const SYNC_MODULES: SyncModuleId[] = [
  "stock",
  "articulos",
  "alquileres",
  "reparaciones",
  "reparaciones_facturadas",
]

/**
 * Configuración inicial: preserva el comportamiento actual del auto-sync
 * (stock + alquileres + reparaciones). articulos y reparaciones_facturadas
 * arrancan desmarcados; el usuario los activa desde la web.
 */
export const DEFAULT_SYNC_MODULES: SyncModuleId[] = [
  "stock",
  "alquileres",
  "reparaciones",
]

export interface SyncConfig {
  modules: SyncModuleId[]
  updatedAt: number
  updatedBy: string
}

const SYNC_CONFIG_KEY = "sync-3c:sync-config"

function isSyncModuleId(value: unknown): value is SyncModuleId {
  return (
    typeof value === "string" &&
    (SYNC_MODULES as string[]).includes(value)
  )
}

/** Normaliza una selección arbitraria: solo ids válidos, sin duplicados, en orden canónico. */
export function normalizeSyncModules(value: unknown): SyncModuleId[] {
  if (!Array.isArray(value)) return []
  const set = new Set<SyncModuleId>()
  for (const item of value) {
    if (isSyncModuleId(item)) set.add(item)
  }
  return SYNC_MODULES.filter((m) => set.has(m))
}

/** Lee la configuración compartida. Sin key → default inicial (auto actual). */
export async function getSyncConfig(redis: Redis): Promise<SyncConfig> {
  try {
    const raw = await getRaw(redis, SYNC_CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncConfig>
      return {
        modules: normalizeSyncModules(parsed.modules),
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
        updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : "default",
      }
    }
  } catch (err) {
    console.error("[SYNC-CONFIG] getSyncConfig falló, usando default:", err)
  }
  return { modules: [...DEFAULT_SYNC_MODULES], updatedAt: 0, updatedBy: "default" }
}

/** Guarda la configuración compartida (la leen web y agente). */
export async function saveSyncConfig(
  redis: Redis,
  modules: unknown,
  updatedBy = "web",
): Promise<SyncConfig> {
  const normalized = normalizeSyncModules(modules)
  const config: SyncConfig = {
    modules: normalized,
    updatedAt: Date.now(),
    updatedBy,
  }
  await redis.set(SYNC_CONFIG_KEY, JSON.stringify(config))
  return config
}
