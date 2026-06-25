"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { getAllSpareParts } from "@/services/spareParts"
import type { SparePart, PartUsage } from "@/types"

interface PartsSelectorProps {
  selected: PartUsage[]
  onChange: (parts: PartUsage[]) => void
}

export default function PartsSelector({ selected, onChange }: PartsSelectorProps) {
  const [parts, setParts] = useState<SparePart[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAllSpareParts().then((data) => { setParts(data); setLoading(false) })
  }, [])

  const filtered = parts.filter((p) => {
    const q = search.toLowerCase()
    return (
      !q ||
      p.partName.toLowerCase().includes(q) ||
      p.partCode.toLowerCase().includes(q)
    )
  })

  const alreadySelected = (partId: string) => selected.some((s) => s.partId === partId)

  const addPart = (part: SparePart) => {
    if (alreadySelected(part.id)) return
    onChange([...selected, { partId: part.id, code: part.partCode, description: part.partName, quantity: 1 }])
  }

  const removePart = (partId: string) => {
    onChange(selected.filter((s) => s.partId !== partId))
  }

  const updateQuantity = (partId: string, quantity: number) => {
    onChange(selected.map((s) => (s.partId === partId ? { ...s, quantity: Math.max(1, quantity) } : s)))
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Buscá repuestos por código o descripción..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading && <p className="text-sm text-muted-foreground">Cargando repuestos...</p>}

      {!loading && search && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No se encontraron repuestos.</p>
      )}

      {!loading && search && filtered.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border bg-background p-2">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded p-2 text-sm hover:bg-muted/30"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.partName}</p>
                <p className="text-xs text-muted-foreground">
                  {p.partCode} — Stock: {p.stockAvailable}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="ml-2 h-7 text-xs shrink-0"
                disabled={alreadySelected(p.id) || p.stockAvailable <= 0}
                onClick={() => addPart(p)}
              >
                {alreadySelected(p.id) ? "Agregado" : p.stockAvailable <= 0 ? "Sin stock" : "Agregar"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Repuestos seleccionados ({selected.length})</p>
          {selected.map((p) => (
            <div
              key={p.partId}
              className="flex items-center justify-between rounded border bg-muted/20 p-2 text-sm"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.code}</p>
                <p className="text-xs text-muted-foreground truncate">{p.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <Input
                  type="number"
                  min="1"
                  value={p.quantity}
                  onChange={(e) => updateQuantity(p.partId, Number(e.target.value))}
                  className="w-16 h-8 text-xs"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => removePart(p.partId)}
                >
                  Quitar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
