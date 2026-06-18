"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import type { SparePart } from "@/types"

const CATEGORY_LABELS: Record<string, string> = {
  motor: "Motor", filtro: "Filtro", electrico: "Eléctrico",
  estructural: "Estructural", consumible: "Consumible", otro: "Otro",
}

interface Props {
  part: SparePart
  onUse: (id: string, qty: number) => Promise<void>
  onRestock: (id: string, qty: number) => Promise<void>
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
}

export default function SparePartCard({ part, onUse, onRestock, onEdit, onDelete }: Props) {
  const [showRestock, setShowRestock] = useState(false)
  const [restockQty, setRestockQty] = useState(1)
  const [busy, setBusy] = useState(false)

  const handleUse = async () => {
    setBusy(true)
    try {
      await onUse(part.id, 1)
      toast.success("Repuesto usado")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al usar repuesto")
    } finally { setBusy(false) }
  }

  const handleRestock = async () => {
    if (restockQty <= 0) { toast.error("La cantidad debe ser mayor a 0"); return }
    setBusy(true)
    try {
      await onRestock(part.id, restockQty)
      toast.success("Stock repuesto")
      setShowRestock(false)
      setRestockQty(1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al reponer stock")
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{part.partName}</CardTitle>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">
              Código: <span className="font-semibold">{part.partCode}</span>
            </p>
          </div>
          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
            {CATEGORY_LABELS[part.category] ?? part.category}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-4 text-sm">
          <p>Total: <strong>{part.stockTotal}</strong></p>
          <p className="text-green-600">Disp: <strong>{part.stockAvailable}</strong></p>
          <p className="text-blue-600">Uso: <strong>{part.stockUsed}</strong></p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline" size="sm"
            onClick={handleUse}
            disabled={busy || part.stockAvailable <= 0}
          >
            + Usar
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={() => setShowRestock(!showRestock)}
            disabled={busy}
          >
            ↻ Reponer
          </Button>
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={() => onEdit(part.id)}>
              Editar
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(part.id)}>
              Eliminar
            </Button>
          )}
        </div>

        {showRestock && (
          <div className="flex items-center gap-2 pt-1">
            <Input
              type="number" min={1}
              value={restockQty}
              onChange={(e) => setRestockQty(Number(e.target.value))}
              className="w-20 h-8 text-sm"
            />
            <Button size="sm" onClick={handleRestock} disabled={busy}>
              Confirmar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowRestock(false)}>
              Cancelar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
