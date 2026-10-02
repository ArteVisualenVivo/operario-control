// Lógica pura del semáforo (importable/testeable fuera de Next): acepta objeto
// o string JSON crudo de Upstash y distingue online/offline/no-key/error.
/** Criterio de heartbeat: menos de 90s = agente online. */
export const ONLINE_MAX_AGE_MS = 90_000

/**
 * Ventana del reporte PERSISTENTE (`sync-3c:agent:last-seen`, SIN TTL).
 *
 * El agente es on-demand: entre corridas no hay heartbeat efímero. Si su
 * última actividad es más vieja que esta ventana, se considera offline
 * (la PC del agente está apagada o el agente no está instalado).
 */
export const LAST_SEEN_MAX_AGE_MS = 26 * 3600 * 1000

export type AgentHealthState = "online" | "running" | "standby" | "offline" | "no-key" | "error"

export interface HeartbeatData {
  status?: unknown
  lastHeartbeat?: unknown
  machineName?: unknown
}

export interface AgentHealth {
  state: AgentHealthState
  /** Hay heartbeat EFÍMERO fresco (una corrida reportando ahora mismo). */
  online: boolean
  /**
   * El agente puede atender una sincronización: online, running o en espera
   * (reportó hace poco aunque duerma entre corridas).
   */
  available: boolean
  /** Estado tal cual lo reporta el agente (running / listening / idle). */
  status: string
  machineName: string | null
  lastHeartbeat: string | null
  ageSeconds: number | null
  keyFound: boolean | null
  reason: string | null
}

/**
 * Acepta el heartbeat en los DOS formatos que puede devolver Upstash:
 * objeto ya deserializado o string JSON crudo. Nunca falla en silencio:
 * si no puede interpretarlo, devuelve el motivo.
 */
export function parseHeartbeat(raw: unknown): { data: HeartbeatData | null; reason: string | null } {
  if (raw === null || raw === undefined) {
    return { data: null, reason: "no hay heartbeat en Redis (key inexistente)" }
  }

  let value: unknown = raw
  if (typeof raw === "string") {
    const text = raw.trim()
    if (!text) return { data: null, reason: "heartbeat vacío" }
    try {
      value = JSON.parse(text)
    } catch (err) {
      return {
        data: null,
        reason: `heartbeat no es JSON válido: ${err instanceof Error ? err.message : "error de parseo"}`,
      }
    }
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      data: null,
      reason: `formato de heartbeat inesperado (${Array.isArray(value) ? "array" : typeof value})`,
    }
  }
  return { data: value as HeartbeatData, reason: null }
}

/** `lastHeartbeat` puede venir como epoch ms (agente actual) o como ISO string. */
export function parseHeartbeatMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const text = value.trim()
    if (!text) return null
    if (/^\d+$/.test(text)) return Number(text)
    const parsed = Date.parse(text)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/** Edad en formato corto ("12s", "5min", "3h", "2d"). */
export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}min`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/**
 * Estado a partir del heartbeat EFÍMERO (`sync-3c:agent:production`, TTL 120s):
 * "¿hay una corrida AHORA?".
 * - sin key            → "no-key"  (Redis accesible pero el agente no reporta ahí)
 * - valor ilegible     → "error"   (formato inesperado: NO se trata como offline)
 * - heartbeat reciente → "online"/"running"
 * - heartbeat vencido  → "offline"
 */
export function evaluateLiveHeartbeat(raw: unknown, now: number = Date.now()): AgentHealth {
  const { data, reason } = parseHeartbeat(raw)
  const base = { status: "unknown", machineName: null, lastHeartbeat: null, ageSeconds: null }

  if (!data) {
    const keyMissing = reason !== null && reason.startsWith("no hay heartbeat")
    return {
      ...base,
      state: keyMissing ? "no-key" : "error",
      online: false,
      available: false,
      keyFound: keyMissing ? false : true,
      reason,
    }
  }

  const machineName = typeof data.machineName === "string" ? data.machineName : null
  const reported = typeof data.status === "string" ? data.status : "unknown"
  const heartbeatMs = parseHeartbeatMs(data.lastHeartbeat)

  if (heartbeatMs === null) {
    return {
      state: "error",
      online: false,
      available: false,
      status: reported,
      machineName,
      lastHeartbeat: null,
      ageSeconds: null,
      keyFound: true,
      reason: "heartbeat sin 'lastHeartbeat' numérico válido",
    }
  }

  const ageMs = now - heartbeatMs
  const fresh = ageMs < ONLINE_MAX_AGE_MS
  const ageSeconds = Math.round(ageMs / 1000)
  return {
    state: fresh ? (reported === "running" ? "running" : "online") : "offline",
    online: fresh,
    available: fresh,
    status: reported,
    machineName,
    lastHeartbeat: new Date(heartbeatMs).toISOString(),
    ageSeconds,
    keyFound: true,
    reason: fresh
      ? ageMs < -120_000
        ? `heartbeat en el futuro (~${Math.round(-ageMs / 1000)}s): revisar el reloj del agente`
        : null
      : `heartbeat vencido (hace ${formatAge(ageSeconds)})`,
  }
}

/**
 * Estado de salud REAL, combinando las DOS keys que escribe el agente:
 *
 * 1. `sync-3c:agent:production` (TTL 120s) → hay corrida ahora: online/running.
 * 2. `sync-3c:agent:last-seen`  (sin TTL)  → última actividad. Si la efímera
 *    venció pero el reporte persistente está dentro de `LAST_SEEN_MAX_AGE_MS`,
 *    el agente está DORMIDO ("standby"), no caído.
 *
 * Sin el reporte persistente, un agente on-demand se vería "offline" (🔴) entre
 * corridas y la web bloquearía el botón de sincronizar sin salida.
 */
export function evaluateAgentHealth(
  raw: unknown,
  now: number = Date.now(),
  lastSeenRaw?: unknown,
): AgentHealth {
  const live = evaluateLiveHeartbeat(raw, now)
  if (live.state === "online" || live.state === "running") return live

  // La efímera venció (o no existe): se mira la última actividad persistente.
  const { data } = parseHeartbeat(lastSeenRaw)
  const heartbeatMs = data ? parseHeartbeatMs(data.lastHeartbeat) : null
  if (heartbeatMs === null) return live

  const ageMs = now - heartbeatMs
  const ageSeconds = Math.round(ageMs / 1000)
  const withinWindow = ageMs < LAST_SEEN_MAX_AGE_MS
  return {
    state: withinWindow ? "standby" : "offline",
    online: false,
    available: withinWindow,
    status: "idle",
    machineName:
      typeof data?.machineName === "string" ? data.machineName : live.machineName,
    lastHeartbeat: new Date(heartbeatMs).toISOString(),
    ageSeconds,
    keyFound: true,
    reason: withinWindow
      ? `sin corrida activa: el agente está en espera (última actividad hace ${formatAge(ageSeconds)})`
      : `sin actividad desde hace ${formatAge(ageSeconds)}: revisar que la PC del agente esté encendida`,
  }
}
