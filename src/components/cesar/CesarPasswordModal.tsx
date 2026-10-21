"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"

const CESAR_PASSWORD = process.env.NEXT_PUBLIC_CESAR_PASSWORD ?? "cesar2026"

export interface CesarPasswordModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CesarPasswordModal({ open, onOpenChange, onSuccess }: CesarPasswordModalProps) {
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) {
      toast.error("Ingresá la clave")
      return
    }
    setLoading(true)
    try {
      // Enviar la clave al endpoint de CESAR para encolar el comando independiente
      const res = await fetch("/api/cesar-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Clave incorrecta")
      }
      // Éxito: encolado el comando CESAR
      const commandId = data.commandId

      // Despertar al agente local inmediatamente mediante el puente local
      // (igual que hace el botón de "Sincronizar Rep. Facturadas")
      try {
        const ctl = new AbortController()
        const t = setTimeout(() => ctl.abort(), 1500)
        await fetch("http://127.0.0.1:3033/wake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commandId,
            module: "cesar",
          }),
        })
        clearTimeout(t)
      } catch (wakeErr) {
        // El puente puede no estar disponible si el navegador no está en la PC de 3C.
        // El comando queda en cola y el despertador programado lo procesará.
        console.warn("[CESAR] Puente local no disponible:", wakeErr instanceof Error ? wakeErr.message : String(wakeErr))
      }

      // Navegar a la página de resultados
      onSuccess()
      onOpenChange(false)
      setPassword("")
    } catch (err) {
      setLoading(false)
      toast.error(err instanceof Error ? err.message : "Error al ejecutar CESAR")
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => onOpenChange(false)}>
      <div className="relative w-full max-w-md mx-4 rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Acceso CESAR</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Ingresá la clave para ejecutar la sincronización independiente de CESAR.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="password"
            placeholder="Clave de acceso"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            autoFocus
          />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Verificando…" : "Ingresar"}
          </Button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">
          Esta acción es independiente de la sincronización de Reparaciones + Rep. Facturadas.
        </p>
      </div>
    </div>
  )
}