"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

type SyncState = "idle" | "syncing" | "done"

interface Sync3CResult {
  success: boolean
  error?: string
  created: number
  updated: number
  skipped: number
  warnings: string[]
}

interface Sync3CButtonProps {
  onComplete?: () => void
  variant?: "default" | "outline" | "secondary"
  size?: "default" | "sm" | "lg"
  className?: string
}

export default function Sync3CButton({
  onComplete,
  variant = "default",
  size = "default",
  className,
}: Sync3CButtonProps) {
  const [state, setState] = useState<SyncState>("idle")

  const handleSync = useCallback(async () => {
    setState("syncing")

    try {
      const res = await fetch("/api/sync-3c?mode=auto", { method: "POST" })
      const data: Sync3CResult = await res.json()

      if (!res.ok || data.error) {
        toast.error(data.error ?? "Error al sincronizar")
        setState("idle")
        return
      }

      setState("done")

      const parts: string[] = []
      if (data.created > 0) parts.push(`${data.created} creados`)
      if (data.updated > 0) parts.push(`${data.updated} actualizados`)
      if (data.skipped > 0) parts.push(`${data.skipped} omitidos`)

      const message = parts.length > 0
        ? `Sync 3C completado: ${parts.join(", ")}`
        : "Sync 3C completado (sin cambios)"

      toast.success(message)

      if (data.warnings.length > 0) {
        for (const w of data.warnings.slice(0, 3)) {
          toast.warning(w)
        }
        if (data.warnings.length > 3) {
          toast.info(`+${data.warnings.length - 3} advertencias más`)
        }
      }

      onComplete?.()
    } catch {
      toast.error("Error de conexión al sincronizar")
      setState("idle")
    }
  }, [onComplete])

  const reset = useCallback(() => {
    setState("idle")
  }, [])

  return (
    <div className={className}>
      {state === "idle" && (
        <Button variant={variant} size={size} onClick={handleSync}>
          Sincronizar 3C
        </Button>
      )}

      {state === "syncing" && (
        <Button variant="outline" size={size} disabled>
          Sincronizando 3C...
        </Button>
      )}

      {state === "done" && (
        <Button variant="outline" size={size} onClick={reset}>
          + Nueva sincronización
        </Button>
      )}
    </div>
  )
}
