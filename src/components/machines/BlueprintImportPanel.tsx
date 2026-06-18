"use client"

import { useState } from "react"
import { useBlueprintDrafts } from "@/hooks/useBlueprintDrafts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { toast } from "sonner"
import type { SparePartCategory } from "@/types"

interface Props {
  machineId: string
  machineName: string
  machineModel: string
  blueprintId: string
  fileUrl: string
  fileType: "pdf" | "image"
  onClose: () => void
}

const CATEGORY_OPTIONS: { value: SparePartCategory; label: string }[] = [
  { value: "motor", label: "Motor" },
  { value: "filtro", label: "Filtro" },
  { value: "electrico", label: "Eléctrico" },
  { value: "estructural", label: "Estructural" },
  { value: "consumible", label: "Consumible" },
  { value: "otro", label: "Otro" },
]

export default function BlueprintImportPanel({
  machineId, machineName, machineModel, blueprintId, fileUrl, fileType, onClose,
}: Props) {
  const { drafts, loading, create, remove, confirm } = useBlueprintDrafts(machineId, blueprintId)

  const [partName, setPartName] = useState("")
  const [partCode, setPartCode] = useState("")
  const [category, setCategory] = useState<SparePartCategory>("otro")
  const [stockTotal, setStockTotal] = useState(1)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handleAddDraft = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!partName.trim()) { toast.error("El nombre del repuesto es obligatorio"); return }
    if (!partCode.trim()) { toast.error("El código de pieza es obligatorio"); return }

    setSaving(true)
    try {
      await create({
        machineId,
        blueprintId,
        partName: partName.trim(),
        partCode: partCode.trim(),
        category,
        unit: "unidad",
        stockTotal,
      })
      setPartName("")
      setPartCode("")
      setCategory("otro")
      setStockTotal(1)
      toast.success("Draft agregado")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear draft")
    } finally { setSaving(false) }
  }

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      const count = await confirm(machineName, machineModel)
      toast.success(`${count} repuesto(s) importados correctamente`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al confirmar importación")
    } finally { setConfirming(false) }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-lg border bg-muted/10 p-2">
        <p className="mb-2 text-xs text-muted-foreground">Vista del despiece</p>
        {fileType === "pdf" ? (
          <embed src={fileUrl} type="application/pdf" className="h-[500px] w-full rounded" />
        ) : (
          <img src={fileUrl} alt="Despiece" className="h-[500px] w-full rounded object-contain" />
        )}
      </div>

      <div className="space-y-4">
        <form onSubmit={handleAddDraft} className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">Agregar repuesto</p>
          <div className="space-y-1">
            <Label htmlFor="partName">Nombre del repuesto</Label>
            <Input id="partName" value={partName} onChange={(e) => setPartName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="partCode">Código de pieza <span className="text-red-500">*</span></Label>
            <Input id="partCode" value={partCode} onChange={(e) => setPartCode(e.target.value)} placeholder="Ej: NGK-BPR6ES" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="category">Categoría</Label>
              <select id="category" value={category} onChange={(e) => setCategory(e.target.value as SparePartCategory)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {CATEGORY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="stockTotal">Stock</Label>
              <Input id="stockTotal" type="number" min={1} value={stockTotal}
                onChange={(e) => setStockTotal(Number(e.target.value))} />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Guardando..." : "Agregar draft"}
          </Button>
        </form>

        <div className="space-y-2">
          <p className="text-sm font-medium">Drafts ({drafts.length})</p>
          {loading ? (
            <p className="text-xs text-muted-foreground">Cargando...</p>
          ) : drafts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay drafts todavía</p>
          ) : (
            <div className="space-y-1">
              {drafts.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded border bg-muted/20 px-3 py-2 text-sm">
                  <div className="flex gap-3">
                    <span className="font-medium">{d.partName}</span>
                    <span className="font-mono text-muted-foreground text-xs">{d.partCode}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      d.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                    }`}>
                      {d.status === "confirmed" ? "Confirmado" : "Draft"}
                    </span>
                  </div>
                  {d.status === "draft" && (
                    <Button variant="ghost" size="sm" onClick={() => remove(d.id)} className="h-6 text-xs">
                      ✕
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={handleConfirm} disabled={confirming || drafts.filter(d => d.status === "draft").length === 0}>
              {confirming ? "Confirmando..." : "Confirmar importación"}
            </Button>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
