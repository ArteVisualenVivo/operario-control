"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import type { SparePartOrder } from "@/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: "receive" | "use"
  order: SparePartOrder | null
  onConfirm: (quantity: number, date: Date, notes?: string) => Promise<void>
}

function toDateInputValue(d: Date | undefined | null): string {
  if (!d) return ""
  const dt = new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
}

const DEFAULT_DATE = toDateInputValue(new Date())

export function SparePartOrderReceiveUseDialog({ open, onOpenChange, action, order, onConfirm }: Props) {
  const isReceive = action === "receive"
  const diff = order
    ? isReceive
      ? order.quantityRequested - order.quantityReceived
      : order.quantityReceived - order.quantityUsed
    : 0

  const [quantity, setQuantity] = useState(() => order ? String(Math.max(0, diff)) : "")
  const [date, setDate] = useState(DEFAULT_DATE)
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  const title = isReceive ? "Marcar como recibido" : "Marcar como utilizado"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!order) return
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("La cantidad debe ser mayor a 0")
      return
    }
    if (qty > diff) {
      toast.error(`La cantidad no puede superar ${diff}`)
      return
    }
    setSaving(true)
    try {
      await onConfirm(qty, date ? new Date(date + "T12:00:00") : new Date(), notes || undefined)
      toast.success(isReceive ? "Recepción registrada" : "Utilización registrada")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {order ? (
              <>
                {order.description} · {order.code}<br />
                Orden: <strong>{order.orderNumber || order.repairId}</strong>
              </>
            ) : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{isReceive ? "Cantidad recibida" : "Cantidad utilizada"}</Label>
              <Input type="number" min="1" max={diff} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Fecha</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {isReceive
              ? `Pendiente de recibir: ${diff}`
              : `Disponible para utilizar: ${diff}`}
          </p>
          <div className="space-y-1">
            <Label>Observación (opcional)</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="flex min-h-[50px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              placeholder="Nota"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}