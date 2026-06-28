"use client"

import { useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

type SyncState = "idle" | "uploading" | "processing" | "done"

interface Sync3CResult {
  success: boolean
  created: number
  updated: number
  skipped: number
  warnings: string[]
  rawRows?: number
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
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<SyncState>("idle")
  const [result, setResult] = useState<Sync3CResult | null>(null)

  const handleClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (!["xls", "xlsx"].includes(ext)) {
        toast.error(`Formato no soportado: .${ext}. Seleccioná un archivo .xls o .xlsx`)
        return
      }

      setState("uploading")
      setResult(null)

      const formData = new FormData()
      formData.append("file", file)

      try {
        setState("processing")

        const res = await fetch("/api/sync-3c", {
          method: "POST",
          body: formData,
        })

        const data: Sync3CResult & { error?: string } = await res.json()

        if (!res.ok || data.error) {
          toast.error(data.error ?? "Error al sincronizar")
          setState("idle")
          return
        }

        setResult(data)
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
      } catch (err) {
        toast.error("Error de conexión al sincronizar")
        setState("idle")
      }
    },
    [onComplete],
  )

  const reset = useCallback(() => {
    setState("idle")
    setResult(null)
  }, [])

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx"
        className="hidden"
        onChange={handleFile}
      />

      {state === "idle" && (
        <Button variant={variant} size={size} onClick={handleClick}>
          Sincronizar desde 3C
        </Button>
      )}

      {state === "uploading" && (
        <Button variant={variant} size={size} disabled>
          Subiendo archivo...
        </Button>
      )}

      {state === "processing" && (
        <Button variant={variant} size={size} disabled>
          Sincronizando con Firebase...
        </Button>
      )}

      {state === "done" && result && (
        <div className="flex items-center gap-3">
          <Button variant="outline" size={size} onClick={reset}>
            + Nueva sincronización
          </Button>
          <span className="text-sm text-muted-foreground">
            {result.created > 0 && <span className="text-green-600">{result.created} creados </span>}
            {result.updated > 0 && <span className="text-blue-600">{result.updated} actualizados </span>}
            {result.skipped > 0 && <span className="text-muted-foreground">{result.skipped} omitidos</span>}
            {result.created === 0 && result.updated === 0 && result.skipped === 0 && (
              <span className="text-muted-foreground">Sin cambios</span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
