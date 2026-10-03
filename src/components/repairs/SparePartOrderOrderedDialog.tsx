"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SparePartOrder } from "@/types"
import { displaySparePartCode } from "@/services/sparePartOrders"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Pedido SUELTO: botón "Encargar" de la fila (lista de Pedidos Rep.) y de la
   * ficha de la reparación.
   */
  order?: SparePartOrder | null
  /**
   * VARIOS pedidos con LA MISMA fecha de encargo: es el botón "Encargar
   * seleccionadas" de "Pedidos Rep.", pensado para el caso real de una orden
   * (= una máquina) con 5-6 repuestos que se le encargan al dueño el mismo día.
   * Si viene con datos, MANDA sobre `order`.
   */
  orders?: SparePartOrder[] | null
  onConfirm: (orderedAt: Date, expectedAt: Date | null, notes?: string) => Promise<void>
}

function toDateInputValue(d: Date | undefined): string {
  if (!d) return ""
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function SparePartOrderOrderedDialog({ open, onOpenChange, order, orders, onConfirm }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A quién se le escribe la fecha: uno (flujo de siempre, `order`) o varios con
  // la misma fecha (`orders`, encargo en lote desde la lista).
  const targets = orders && orders.length > 0 ? orders : order ? [order] : []
  if (targets.length === 0) return null

  const isBulk = targets.length > 1
  // ÓRDENES distintas del lote: un mismo N° de orden puede traer varios repuestos,
  // así que se avisa cuántas máquinas se están encargando, no cuántas filas.
  const orderNumbers = [...new Set(targets.map((o) => o.orderNumber).filter(Boolean))]

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
          <DialogTitle>
            {isBulk ? `Marcar ${targets.length} repuesto(s) como encargados` : "Marcar encargado"}
          </DialogTitle>
          <DialogDescription>
            {isBulk
              ? `${targets.length} repuesto(s) de ${orderNumbers.length || 1} orden(es)${orderNumbers.length > 0 ? ` (${orderNumbers.slice(0, 3).join(", ")}${orderNumbers.length > 3 ? "…" : ""})` : ""} con la MISMA fecha de encargo.`
              : `${targets[0].description} (${displaySparePartCode(targets[0].code)}) — cantidad solicitada: ${targets[0].quantityRequested}`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orderedAt">
              {isBulk ? "Fecha en que se encargaron (la misma para todos) *" : "Fecha en que se encargó *"}
            </Label>
            <Input id="orderedAt" name="orderedAt" type="date" defaultValue={toDateInputValue(new Date())} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expectedAt">Fecha aproximada para retirar</Label>
            <Input id="expectedAt" name="expectedAt" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">{isBulk ? "Observaciones (se guardan en todos)" : "Observaciones"}</Label>
            <Input id="notes" name="notes" placeholder="Ej: casa Bosch, avisó por WhatsApp..." />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? "Guardando..."
                : isBulk ? `Marcar ${targets.length} como encargados` : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
