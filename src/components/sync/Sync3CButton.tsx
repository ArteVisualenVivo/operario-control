"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  SYNC_MODULES,
  DEFAULT_SYNC_MODULES,
  type SyncModuleId,
} from "@/lib/sync-3c/syncConfig"

type SyncState = "idle" | "pending" | "running" | "completed" | "error"
type AgentStatus = "unknown" | "online" | "running" | "standby" | "offline" | "error"
type SyncModule = "stock" | "reparaciones" | "reparaciones_facturadas" | "articulos" | "alquileres" | "todo"

interface Sync3CResult {
  success: boolean
  error?: string
  created: number
  updated: number
  skipped: number
  warnings: string[]
}

interface CommandStatus {
  status: string
  result?: Sync3CResult
  error?: string | null
  startedAt?: string | null
  completedAt?: string | null
  /** Momento en que la web creó el comando (ISO o epoch en ms). */
  createdAt?: string | number
}

interface AgentStatusData {
  /** Estado explícito que calcula /api/sync-3c/agent-status. */
  state?: "online" | "running" | "standby" | "offline" | "no-key" | "error"
  online: boolean
  /** El agente puede atender una sync (online/running/en espera). */
  available?: boolean
  status: string
  machineName: string | null
  lastHeartbeat: string | null
  /** Motivo cuando no está online (key inexistente, formato inesperado, error de Redis). */
  reason?: string | null
  ageSeconds?: number | null
  keyFound?: boolean | null
  redisHost?: string | null
  error?: string
}

interface Sync3CButtonProps {
  onComplete?: () => void
  variant?: "default" | "outline" | "secondary"
  size?: "default" | "sm" | "lg"
  className?: string
}

const AGENT_POLL_INTERVAL = 60_000
const STATUS_POLL_INTERVAL = 10_000
// Si el comando sigue "pending" pasado este margen, el agente no lo tomó (estaba
// ocupado o detenido): se avisa y se deja de esperar en vez de agotar los 25 min.
// Es algo mayor que el descarte del agente (2 min) para que su motivo llegue antes.
const PENDING_NOTICE_TIMEOUT = 150_000
// El agente puede tardar más de 3 min (AHK ~100s + procesamiento + escritura
// Redis). Ampliamos el timeout a 10 min para no cortar sincronizaciones reales.
// El pipeline completo ("Todo") puede tardar más de 15 min (5 módulos × AHK
// ~100s + procesamiento + escritura Redis). Ampliamos a 25 min.
const STATUS_POLL_TIMEOUT = 1_500_000

function formatLastHeartbeat(timestamp: string | null): string {
  if (!timestamp) return "nunca"
  const ms = new Date(timestamp).getTime()
  if (isNaN(ms)) return "desconocido"
  const seconds = Math.floor((Date.now() - ms) / 1000)
  if (seconds < 60) return `hace ${seconds}s`
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)}min`
  return `hace ${Math.floor(seconds / 3600)}h`
}

function agentIndicator(status: AgentStatus): { dot: string; label: string } {
  switch (status) {
    case "online":
      return { dot: "\u{1F7E2}", label: "Online (corrida reciente)" }
    case "running":
      return { dot: "\u{1F7E1}", label: "Ejecutando" }
    // On-demand: sin heartbeat efímero (TTL 120s) el agente está DORMIDO,
    // no caído. Se distingue de "offline" para no bloquear la sincronización.
    case "standby":
      return { dot: "\u{1F7E2}", label: "En espera (sin corrida activa)" }
    case "offline":
      return { dot: "\u{1F534}", label: "Offline (sin actividad reciente)" }
    // Error al CONSULTAR el indicador (fetch/HTTP/Redis/formato): no significa
    // que el agente esté detenido, por eso se distingue de "offline".
    case "error":
      return { dot: "\u{26A0}\u{FE0F}", label: "Error al consultar el estado" }
    default:
      return { dot: "\u{26AA}", label: "Desconocido" }
  }
}

const MODULE_LABELS: Record<string, string> = {
  todo: "Todo",
  stock: "Stock",
  reparaciones: "Reparaciones",
  reparaciones_facturadas: "Rep. Facturadas",
  articulos: "Artículos",
  alquileres: "Alquileres",
}

export default function Sync3CButton({
  onComplete,
  variant = "default",
  size = "default",
  className,
}: Sync3CButtonProps) {
  const [state, setState] = useState<SyncState>("idle")
  // Selección ÚNICA de módulos, compartida con el auto-sync del agente.
  // Fuente de verdad: Redis (`sync-3c:sync-config`) vía /api/sync-3c/config.
  // Sobrevive recarga web, reinicio del agente y reinicio de la PC.
  const [selectedModules, setSelectedModules] = useState<SyncModuleId[]>([...DEFAULT_SYNC_MODULES])
  const [configLoaded, setConfigLoaded] = useState(false)
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("unknown")
  const [agentData, setAgentData] = useState<AgentStatusData | null>(null)
  /** Motivo del último problema detectado al consultar el estado (solo informativo). */
  const [agentIssue, setAgentIssue] = useState<string | null>(null)
  const [result, setResult] = useState<Sync3CResult | null>(null)
  const [pipeline, setPipeline] = useState<string[]>([])
  const [currentPipelineIndex, setCurrentPipelineIndex] = useState(0)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const agentPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const commandIdsRef = useRef<string[]>([])
  const currentIndexRef = useRef(0)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const fetchAgentStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync-3c/agent-status", { cache: "no-store" })

      if (!res.ok) {
        // Falla la CONSULTA del indicador: no es lo mismo que "agente detenido".
        if (!mountedRef.current) return
        setAgentData(null)
        setAgentIssue(`No se pudo consultar el estado del agente (HTTP ${res.status})`)
        setAgentStatus("error")
        return
      }

      const data: AgentStatusData = await res.json()

      if (!mountedRef.current) return

      setAgentData(data)
      setAgentIssue(data.reason ?? data.error ?? null)

      // El endpoint devuelve `state` explícito (online | running | standby |
      // offline | no-key | error). "standby" = el agente on-demand duerme entre
      // corridas: cuenta como disponible, NO como offline.
      if (data.state) {
        if (
          data.state === "online" ||
          data.state === "running" ||
          data.state === "standby"
        )
          setAgentStatus(data.state)
        else if (data.state === "offline" || data.state === "no-key") setAgentStatus("offline")
        else setAgentStatus("error")
        return
      }

      // Compatibilidad con respuestas previas (sin `state`).
      if (data.online && data.status === "running") {
        setAgentStatus("running")
      } else if (data.online) {
        setAgentStatus("online")
      } else {
        setAgentStatus("offline")
      }
    } catch {
      if (mountedRef.current) {
        setAgentData(null)
        setAgentIssue("No se pudo consultar el estado del agente (sin respuesta de la API)")
        setAgentStatus("error")
      }
    }
  }, [])

  const pollStatus = useCallback(async (commandId: string) => {
    try {
      const res = await fetch(`/api/sync-3c/status?commandId=${commandId}`)
      const data: CommandStatus = await res.json()

      if (!mountedRef.current) return

      if (data.status === "completed") {
        const currentIdx = currentIndexRef.current
        const currentModule = pipeline[currentIdx]
        const moduleLabel = MODULE_LABELS[String(currentModule)] || String(currentModule)
        
        // Mostrar toast de progreso
        const r = data.result
        if (r) {
          const parts: string[] = []
          if (r.created > 0) parts.push(`${r.created} creados`)
          if (r.updated > 0) parts.push(`${r.updated} actualizados`)
          if (r.skipped > 0) parts.push(`${r.skipped} omitidos`)

          const message = parts.length > 0
            ? `${moduleLabel}: ${parts.join(", ")}`
            : `${moduleLabel} completado`

          toast.success(message)

          for (const w of (r.warnings ?? []).slice(0, 2)) {
            toast.warning(w)
          }
        }

        // Verificar si hay más módulos en el pipeline
        if (currentIdx < pipeline.length - 1) {
          // Continuar con el siguiente módulo
          const nextIndex = currentIdx + 1
          currentIndexRef.current = nextIndex
          setCurrentPipelineIndex(nextIndex)
          const nextCommandId = commandIdsRef.current[nextIndex]
          
          toast.info(`Iniciando ${MODULE_LABELS[String(pipeline[nextIndex])]}...`)
          
          // Reiniciar polling para el siguiente comando
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
          }
          pollingRef.current = setInterval(() => {
            pollStatus(nextCommandId)
          }, STATUS_POLL_INTERVAL)
        } else {
          // Pipeline completo
          stopPolling()
          setState("completed")
          setResult(data.result ?? null)
          toast.success("Sincronización completa")
          onComplete?.()
        }
      } else if (data.status === "failed") {
        stopPolling()
        setState("error")
        const currentIdx = currentIndexRef.current
        toast.error(data.error ?? `Error en ${MODULE_LABELS[String(pipeline[currentIdx])] || "sincronización"}`)
      } else if (data.status === "not_found") {
        // El comando ya no está en Redis (expirado o borrado): no se realizó.
        stopPolling()
        setState("error")
        toast.error("No se realizó la sincronización. Volvé a intentar.")
      } else if (data.status === "pending") {
        const createdAt = Number(data.createdAt ?? 0)
        if (createdAt > 0 && Date.now() - createdAt > PENDING_NOTICE_TIMEOUT) {
          // El agente nunca lo tomó (ocupado o detenido): se avisa y se corta.
          stopPolling()
          setState("error")
          toast.error("No se realizó la sincronización: el agente no la tomó a tiempo. Volvé a intentar.")
        }
      } else if (data.status === "running") {
        setState("running")
      }
    } catch {
      if (!mountedRef.current) return
      toast.error("Error de conexión al verificar estado")
      stopPolling()
      setState("error")
    }
  }, [stopPolling, onComplete, pipeline])

  const handleSync = useCallback(async () => {
    if (selectedModules.length === 0) {
      toast.error("Seleccioná al menos un módulo para sincronizar.")
      return
    }
    setState("pending")
    setPipeline([])
    setCurrentPipelineIndex(0)
    currentIndexRef.current = 0
    setResult(null)
    commandIdsRef.current = []

    try {
      // 1. Crear el comando en Redis
      const res = await fetch("/api/sync-3c", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: selectedModules }),
      })
      const data = await res.json()

      if (!res.ok || data.error) {
        toast.error(data.error ?? "Error al crear comando")
        setState("idle")
        return
      }

      // Guardar pipeline y commandIds
      setPipeline((data.pipeline || [...selectedModules]) as SyncModule[])
      commandIdsRef.current = [data.commandId, ...(data.autoEnqueued || [])]

       // 2. Iniciar el agente (solo en desarrollo local)
       try {
         const startRes = await fetch("/api/sync-3c/start-agent", {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ 
             commandId: data.commandId, 
             module: selectedModules[0],
             autoEnqueued: data.autoEnqueued || []
           }),
         })
        const startData = await startRes.json()
        if (startData.success) {
          console.log("[SYNC] Agent started:", startData.message)
        } else {
          console.warn("[SYNC] Agent start failed:", startData.error)
          // El agente solo lo puede despertar la PC de 3C (spawn local). Si la
          // web corre en un host remoto (Vercel) el comando queda en cola.
          // El puente local (paso 2b) ya intento despertarlo al instante;
          // solo se informa en consola, sin cartel de error: el polling
          // confirma cuando arranca, y si no hay puente el despertador
          // lo levanta en menos de un minuto.
          if (startData.remote) {
            console.log("[SYNC] Sitio remoto: el agente lo despierta el puente/despertador local.")
          } else if (startData.error) toast.warning(startData.error)
        }
      } catch (startErr) {
        console.warn("[SYNC] Could not start agent (may be running):", startErr)
      }
      // 2b. Puente local (PC de 3C): si el navegador esta en la PC,
      // despierta al agente AL INSTANTE sin esperar al despertador.
      // Si esta en otra PC/celular, falla rapido y no hace nada.
      try {
        const ctl = new AbortController()
        const t = setTimeout(() => ctl.abort(), 1500)
        await fetch("http://127.0.0.1:3033/wake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commandId: data.commandId }),
          signal: ctl.signal,
        }).catch(() => null)
        clearTimeout(t)
      } catch {
        /* sin puente local: lo levanta el despertador (menos de 1 min) */
      }


      setState("running")

      // 3. Iniciar polling del primer comando
      pollingRef.current = setInterval(() => {
        pollStatus(data.commandId)
      }, STATUS_POLL_INTERVAL)

      timeoutRef.current = setTimeout(() => {
        stopPolling()
        if (mountedRef.current) {
          setState("error")
          toast.error("Timeout: el agente no respondió en 25 minutos")
        }
      }, STATUS_POLL_TIMEOUT)
    } catch {
      toast.error("Error de conexión al sincronizar")
      setState("idle")
    }
  }, [selectedModules, pollStatus, stopPolling])

  const reset = useCallback(() => {
    setState("idle")
    setResult(null)
    setPipeline([])
    setCurrentPipelineIndex(0)
    currentIndexRef.current = 0
    commandIdsRef.current = []
  }, [])

  const retry = useCallback(() => {
    reset()
    handleSync()
  }, [reset, handleSync])

  // Cargar la selección única guardada (misma que usa el auto-sync).
  useEffect(() => {
    let cancelled = false
    fetch("/api/sync-3c/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { success?: boolean; modules?: unknown }) => {
        if (cancelled || !data?.success || !Array.isArray(data.modules)) return
        const valid = (data.modules as string[]).filter((m): m is SyncModuleId =>
          (SYNC_MODULES as string[]).includes(m),
        )
        setSelectedModules(SYNC_MODULES.filter((m) => valid.includes(m)))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setConfigLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Tildar/destildar un módulo: persiste en Redis (la lee también el agente).
  const toggleModule = useCallback(async (mod: SyncModuleId) => {
    const next = selectedModules.includes(mod)
      ? selectedModules.filter((m) => m !== mod)
      : SYNC_MODULES.filter((m) => m === mod || selectedModules.includes(m))
    setSelectedModules(next)
    try {
      const res = await fetch("/api/sync-3c/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: next }),
      })
      const data = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !data.success) {
        toast.error(data.error ?? "No se pudo guardar la selección de módulos.")
      }
    } catch {
      toast.error("No se pudo guardar la selección de módulos.")
    }
  }, [selectedModules])

  useEffect(() => {
    mountedRef.current = true
    fetchAgentStatus()

    agentPollRef.current = setInterval(fetchAgentStatus, AGENT_POLL_INTERVAL)

    return () => {
      mountedRef.current = false
      stopPolling()
      if (agentPollRef.current) clearInterval(agentPollRef.current)
    }
  }, [fetchAgentStatus, stopPolling])

  const agentInfo = agentIndicator(agentStatus)
  const isBusy = state === "pending" || state === "running"
  // El semáforo es INFORMATIVO, nunca un candado. El agente es on-demand:
  // entre corridas no hay heartbeat fresco, y deshabilitar el botón por eso
  // dejaba la web sin salida (no se podía sincronizar nunca justo cuando el
  // agente está dormido). Si el agente no está disponible se AVISA abajo y el
  // comando queda en cola para la próxima corrida programada (10/12/15/17).
  const agentAvailable = agentStatus !== "offline" && agentStatus !== "error"
  const hasSelection = selectedModules.length > 0
  const disabled = isBusy || !configLoaded || !hasSelection
  const selectionLabel = !configLoaded
    ? "Cargando módulos…"
    : hasSelection
      ? selectedModules.map((m) => MODULE_LABELS[m]).join(" + ")
      : "Sin módulos seleccionados"
  const currentPipelineModule = pipeline[currentPipelineIndex]
  const progressText = pipeline.length > 1
    ? `${MODULE_LABELS[String(currentPipelineModule)] || currentPipelineModule} (${currentPipelineIndex + 1}/${pipeline.length})`
    : selectionLabel

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <span
        className="cursor-pointer text-lg leading-none select-none"
        title={`Agente: ${agentInfo.label}${agentData?.machineName ? ` | PC: ${agentData.machineName}` : ""} | Último heartbeat: ${formatLastHeartbeat(agentData?.lastHeartbeat ?? null)}${agentIssue ? ` | ${agentIssue}` : ""}${agentData?.redisHost ? ` | Redis: ${agentData.redisHost}` : ""}`}
      >
        {agentInfo.dot}
      </span>

      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Módulos de sincronización (manual y automática)">
        {SYNC_MODULES.map((mod) => (
          <label key={mod} className="flex cursor-pointer items-center gap-1 text-sm select-none">
            <input
              type="checkbox"
              className="h-4 w-4 accent-current"
              checked={selectedModules.includes(mod)}
              onChange={() => toggleModule(mod)}
              disabled={isBusy || !configLoaded}
              aria-label={MODULE_LABELS[mod]}
            />
            <span>{MODULE_LABELS[mod]}</span>
          </label>
        ))}
      </fieldset>

      {state === "idle" && (
        <Button
          variant={variant}
          size={size}
          onClick={handleSync}
          disabled={disabled}
          title={!hasSelection ? "Seleccioná al menos un módulo para sincronizar." : undefined}
        >
          Sincronizar {selectionLabel}
        </Button>
      )}

      {state === "pending" && (
        <Button variant="outline" size={size} disabled>
          En cola...
        </Button>
      )}

      {state === "running" && (
        <Button variant="outline" size={size} disabled>
          Sincronizando {progressText}...
        </Button>
      )}

      {state === "completed" && (
        <Button variant="outline" size={size} onClick={reset}>
          + Nueva sincronización
        </Button>
      )}

      {state === "error" && (
        <Button variant="outline" size={size} onClick={retry}>
          Reintentar
        </Button>
      )}

      {state === "idle" && !agentAvailable && (
        <span className="text-xs text-muted-foreground">
          El agente no está disponible ahora: la sincronización quedará en cola y el despertador de
          la PC de 3C la toma en menos de un minuto (revisa la cola cada minuto).
        </span>
      )}
    </div>
  )
}