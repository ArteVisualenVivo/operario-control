"use client"

import { useState, useMemo, useCallback } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSparePartsCache } from "@/hooks/useSparePartsCache"
import { toast } from "sonner"
import type { CreateSparePartOrderInput } from "@/types"

interface PartPick {
  id: string
  code: string
  description: string
  unit: string
  stockAvailable: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  repair: {
    repairId: string
    orderNumber: string
    machineId: string
    machineName: string
  }
  onCreate: (input: CreateSparePartOrderInput) => Promise<void>
}

function toDateInputValue(d: Date | undefined | null): string {
  if (!d) return ""
  const dt = new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
}

export function SparePartOrderDialog({ open, onOpenChange, repair, onCreate }: Props) {
  const { parts, loading } = useSparePartsCache()
  const [mode, setMode] = useState<"search" | "manual">("search")
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState<PartPick | null>(null)
  const [manualCode, setManualCode] = useState("")
  const [manualDesc, setManualDesc] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [supplier, setSupplier] = useState("")
  const [requestedAt, setRequestedAt] = useState(() => toDateInputValue(new Date()))
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return parts.slice(0, 20)
    return parts
      .filter((p) => p.partName.toLowerCase().includes(q) || p.partCode.toLowerCase().includes(q))
      .slice(0, 30)
  }, [parts, search])

  const reset = useCallback(() => {
    setMode("search")
    setSearch("")
    setPicked(null)
    setManualCode("")
    setManualDesc("")
    setQuantity("1")
    setSupplier("")
    setNotes("")
    setRequestedAt(toDateInputValue(new Date()))
    setSaving(false)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("La cantidad debe ser mayor a 0")
      return
    }
    const code = picked?.code ?? manualCode.trim()
    const description = picked?.description ?? manualDesc.trim()
    if (!picked && !code) {
      toast.error("Indicá el código del repuesto")
      return
    }
    if (!picked && !description) {
      toast.error("Indicá la descripción del repuesto")
      return
    }
    if (!repair.repairId) {
      toast.error("El pedido debe estar asociado a una orden")
      return
    }

    setSaving(true)
    try {
      await onCreate({
        repairId: repair.repairId,
        orderNumber: repair.orderNumber,
        machineId: repair.machineId,
        machineName: repair.machineName,
        sparePartId: picked?.id,
        code: code || "S/C",
        description: description || code || "Repuesto",
        unit: picked?.unit ?? "unidad",
        quantity: qty,
        supplier: supplier || undefined,
        requestedAt: requestedAt ? new Date(requestedAt + "T12:00:00") : new Date(),
        notes: notes || undefined,
      })
      toast.success("Pedido creado")
      reset()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear el pedido")
    } finally {
      setSaving(false)
    }
  }

  return (
<Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pedir repuesto</DialogTitle>
          <DialogDescription>
            Orden: <strong>{repair.orderNumber || repair.repairId}</strong> · Máquina: <strong>{repair.machineName}</strong>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2">
            {(["search", "manual"] as const).map((m) => (
              <Button key={m} type="button" size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>
                {m === "search" ? "Repuesto existente" : "Cargar manual"}
              </Button>
            ))}
          </div>

          {mode === "search" ? (
            <div className="space-y-2">
              <Label>Buscar repuesto</Label>
              <div className="relative">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre o código..."
                />
              </div>
              {!picked && search.trim() && (
                <div className="max-h-52 overflow-y-auto rounded-lg border bg-popover">
                  {filtered.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">Sin resultados. Usá “Cargar manual”.</p>
                  ) : (
                    filtered.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setPicked({ id: p.id, code: p.partCode, description: p.partName, unit: p.unit, stockAvailable: p.stockAvailable })
                          setSearch("")
                          setManualCode(p.partCode)
                          setManualDesc(p.partName)
                        }}
                      >
                        <span>
                          <span className="font-medium">{p.partName}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{p.partCode}</span>
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">Disp: {p.stockAvailable}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {picked && (
                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  <p className="font-medium">{picked.description}</p>
                  <p className="text-xs text-muted-foreground">{picked.code} · Disp: {picked.stockAvailable}</p>
                  <Button type="button" variant="ghost" size="sm" className="mt-1 h-6 text-xs" onClick={() => setPicked(null)}>
                    Quitar selección
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Descripción</Label>
                <Input value={manualDesc} onChange={(e) => setManualDesc(e.target.value)} placeholder="Ej: Rodamiento" />
              </div>
              <div className="space-y-1">
                <Label>Código</Label>
                <Input value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Ej: 6205-2RS" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cantidad</Label>
              <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Fecha del pedido</Label>
              <Input type="date" value={requestedAt} onChange={(e) => setRequestedAt(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Proveedor (opcional)</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Ej: Distribuidora X" />
          </div>

          <div className="space-y-1">
            <Label>Observaciones (opcional)</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="flex min-h-[50px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              placeholder="Notas del pedido"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); reset() }}>Cancelar</Button>
            <Button type="submit" disabled={saving || loading}>{saving ? "Guardando..." : "Guardar pedido"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
