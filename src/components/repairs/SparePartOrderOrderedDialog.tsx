"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SparePartOrder } from "@/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: SparePartOrder | null
  onConfirm: (orderedAt: Date, expectedAt: Date | null, notes?: string) => Promise<void>
}

function toDateInputValue(d: Date | undefined): string {
  if (!d) return ""
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function SparePartOrderOrderedDialog({ open, onOpenChange, order, onConfirm }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!order) return null

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const orderedRaw = String(fd.get("orderedAt") ?? "")
    const expectedRaw = String(fd.get("expectedAt") ?? "")
    const notes = String(fd.get("notes") ?? "").trim()

    if (!orderedRaw) {
      setError("La fecha de encargo es obligatoria")
      return
    }
    const orderedAt = new Date(`${orderedRaw}T12:00:00`)
    const expectedAt = expectedRaw ? new Date(`${expectedRaw}T12:00:00`) : null

    setSaving(true)
    try {
      await onConfirm(orderedAt, expectedAt, notes || undefined)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar encargado</DialogTitle>
          <DialogDescription>
            {order.description} ({order.code}) — cantidad solicitada: {order.quantityRequested}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orderedAt">Fecha en que se encargó *</Label>
            <Input id="orderedAt" name="orderedAt" type="date" defaultValue={toDateInputValue(new Date())} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expectedAt">Fecha aproximada para retirar</Label>
            <Input id="expectedAt" name="expectedAt" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Observaciones</Label>
            <Input id="notes" name="notes" placeholder="Ej: casa Bosch, avisó por WhatsApp..." />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
