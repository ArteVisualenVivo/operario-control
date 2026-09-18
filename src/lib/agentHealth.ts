// Lógica pura del semáforo (importable/testeable fuera de Next): acepta objeto
// o string JSON crudo de Upstash y distingue online/offline/no-key/error.
/** Criterio de heartbeat: menos de 90s = agente online. */
export const ONLINE_MAX_AGE_MS = 90_000

export type AgentHealthState = "online" | "running" | "offline" | "no-key" | "error"

export interface HeartbeatData {
  status?: unknown
  lastHeartbeat?: unknown
  machineName?: unknown
}

export interface AgentHealth {
  state: AgentHealthState
  online: boolean
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

/**
 * Estado de salud del agente a partir del valor crudo de Redis.
 * - sin key            → "no-key"  (Redis accesible pero el agente no reporta ahí)
 * - valor ilegible     → "error"   (formato inesperado: NO se trata como offline)
 * - heartbeat reciente → "online"/"running"
 * - heartbeat vencido  → "offline"
 */
export function evaluateAgentHealth(raw: unknown, now: number = Date.now()): AgentHealth {
  const { data, reason } = parseHeartbeat(raw)
  const base = { status: "unknown", machineName: null, lastHeartbeat: null, ageSeconds: null }

  if (!data) {
    const keyMissing = reason !== null && reason.startsWith("no hay heartbeat")
    return {
      ...base,
      state: keyMissing ? "no-key" : "error",
      online: false,
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
    status: reported,
    machineName,
    lastHeartbeat: new Date(heartbeatMs).toISOString(),
    ageSeconds,
    keyFound: true,
    reason: fresh
      ? ageMs < -120_000
        ? `heartbeat en el futuro (~${Math.round(-ageMs / 1000)}s): revisar el reloj del agente`
        : null
      : `heartbeat vencido (hace ${ageSeconds}s)`,
  }
}
