"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"

type SyncState = "idle" | "pending" | "running" | "completed" | "error"
type AgentStatus = "unknown" | "online" | "running" | "offline"
type SyncModule = "stock" | "reparaciones" | "articulos"

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
}

interface AgentStatusData {
  online: boolean
  status: string
  machineName: string | null
  lastHeartbeat: string | null
}

interface Sync3CButtonProps {
  onComplete?: () => void
  variant?: "default" | "outline" | "secondary"
  size?: "default" | "sm" | "lg"
  className?: string
}

const AGENT_POLL_INTERVAL = 60_000
const STATUS_POLL_INTERVAL = 10_000
const STATUS_POLL_TIMEOUT = 180_000

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
      return { dot: "\u{1F7E2}", label: "Online" }
    case "running":
      return { dot: "\u{1F7E1}", label: "Ejecutando" }
    case "offline":
      return { dot: "\u{1F534}", label: "Offline" }
    default:
      return { dot: "\u{26AA}", label: "Desconocido" }
  }
}

const MODULE_LABELS: Record<SyncModule, string> = {
  stock: "Stock",
  reparaciones: "Reparaciones",
  articulos: "Artículos",
}

export default function Sync3CButton({
  onComplete,
  variant = "default",
  size = "default",
  className,
}: Sync3CButtonProps) {
  const [state, setState] = useState<SyncState>("idle")
  const [module, setModule] = useState<SyncModule>("stock")
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("unknown")
  const [agentData, setAgentData] = useState<AgentStatusData | null>(null)
  const [result, setResult] = useState<Sync3CResult | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const agentPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

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
      const res = await fetch("/api/sync-3c/agent-status")
      const data: AgentStatusData = await res.json()

      if (!mountedRef.current) return

      setAgentData(data)

      if (data.online && data.status === "running") {
        setAgentStatus("running")
      } else if (data.online) {
        setAgentStatus("online")
      } else {
        setAgentStatus("offline")
      }
    } catch {
      if (mountedRef.current) {
        setAgentStatus("offline")
      }
    }
  }, [])

  const pollStatus = useCallback(async (commandId: string) => {
    try {
      const res = await fetch(`/api/sync-3c/status?commandId=${commandId}`)
      const data: CommandStatus = await res.json()

      if (!mountedRef.current) return

      if (data.status === "completed") {
        stopPolling()
        setState("completed")
        setResult(data.result ?? null)

        const r = data.result
        if (r) {
          const parts: string[] = []
          if (r.created > 0) parts.push(`${r.created} creados`)
          if (r.updated > 0) parts.push(`${r.updated} actualizados`)
          if (r.skipped > 0) parts.push(`${r.skipped} omitidos`)

          const message = parts.length > 0
            ? `Sync 3C completado: ${parts.join(", ")}`
            : "Sync 3C completado (sin cambios)"

          toast.success(message)

          for (const w of (r.warnings ?? []).slice(0, 3)) {
            toast.warning(w)
          }
          if ((r.warnings ?? []).length > 3) {
            toast.info(`+${r.warnings.length - 3} advertencias más`)
          }
        }

        onComplete?.()
      } else if (data.status === "failed") {
        stopPolling()
        setState("error")
        toast.error(data.error ?? "Sync 3C falló")
      } else if (data.status === "running") {
        setState("running")
      }
    } catch {
      if (!mountedRef.current) return
      toast.error("Error de conexión al verificar estado")
      stopPolling()
      setState("error")
    }
  }, [stopPolling, onComplete])

  const handleSync = useCallback(async () => {
    setState("pending")

    try {
      const res = await fetch("/api/sync-3c", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module }),
      })
      const data = await res.json()

      if (!res.ok || data.error) {
        toast.error(data.error ?? "Error al crear comando")
        setState("idle")
        return
      }

      setState("running")

      pollingRef.current = setInterval(() => {
        pollStatus(data.commandId)
      }, STATUS_POLL_INTERVAL)

      timeoutRef.current = setTimeout(() => {
        stopPolling()
        if (mountedRef.current) {
          setState("error")
          toast.error("Timeout: el agente no respondió en 3 minutos")
        }
      }, STATUS_POLL_TIMEOUT)
    } catch {
      toast.error("Error de conexión al sincronizar")
      setState("idle")
    }
  }, [pollStatus, stopPolling, module])

  const reset = useCallback(() => {
    setState("idle")
    setResult(null)
  }, [])

  const retry = useCallback(() => {
    reset()
    handleSync()
  }, [reset, handleSync])

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
  const disabled = agentStatus === "offline" || isBusy
  const moduleLabel = MODULE_LABELS[module]

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <span
        className="cursor-pointer text-lg leading-none select-none"
        title={`Agente: ${agentInfo.label}${agentData?.machineName ? ` | PC: ${agentData.machineName}` : ""} | Último heartbeat: ${formatLastHeartbeat(agentData?.lastHeartbeat ?? null)}`}
      >
        {agentInfo.dot}
      </span>

      <Select
        value={module}
        onValueChange={(val: string | null) => {
          if (val === "stock" || val === "reparaciones" || val === "articulos") setModule(val)
        }}
        disabled={disabled || state !== "idle"}
      >
        <SelectTrigger className="w-[140px]" aria-label="Módulo de sincronización">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="stock">Stock</SelectItem>
          <SelectItem value="reparaciones">Reparaciones</SelectItem>
          <SelectItem value="articulos">Artículos</SelectItem>
        </SelectContent>
      </Select>

      {state === "idle" && (
        <Button variant={variant} size={size} onClick={handleSync} disabled={disabled}>
          Sincronizar {moduleLabel}
        </Button>
      )}

      {state === "pending" && (
        <Button variant="outline" size={size} disabled>
          En cola...
        </Button>
      )}

      {state === "running" && (
        <Button variant="outline" size={size} disabled>
          Sincronizando {moduleLabel}...
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
    </div>
  )
}
