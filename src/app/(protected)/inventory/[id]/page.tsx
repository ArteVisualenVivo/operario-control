"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { StockCategory, StockUnit, StockSize } from "@/types"
import { toast } from "sonner"
import * as inventoryStockService from "@/services/inventoryStock"
import type { InventoryStock } from "@/types"

const categoryOptions: { value: StockCategory; label: string }[] = [
  { value: "puntales", label: "Puntales" },
  { value: "riendas", label: "Riendas" },
  { value: "andamio_accesorios", label: "Andamio Accesorios" },
  { value: "consumibles", label: "Consumibles" },
]

const unitOptions: { value: StockUnit; label: string }[] = [
  { value: "unidad", label: "Unidad" },
  { value: "metro", label: "Metro" },
  { value: "kg", label: "Kg" },
]

const sizeOptions: { value: StockSize | ""; label: string }[] = [
  { value: "", label: "Sin medida" },
  { value: "largas", label: "Largas" },
  { value: "cortas", label: "Cortas" },
  { value: "1m", label: "1 metro" },
  { value: "1.5m", label: "1.5 metros" },
  { value: "2m", label: "2 metros" },
  { value: "2.5m", label: "2.5 metros" },
  { value: "3m", label: "3 metros" },
  { value: "4m", label: "4 metros" },
  { value: "6m", label: "6 metros" },
  { value: "custom", label: "Otra medida" },
]

export default function StockDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { update, remove } = useInventoryStock()

  const [item, setItem] = useState<InventoryStock | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [name, setName] = useState("")
  const [category, setCategory] = useState<StockCategory>("puntales")
  const [unit, setUnit] = useState<StockUnit>("unidad")
  const [stockTotal, setStockTotal] = useState(1)
  const [size, setSize] = useState<StockSize | "">("")
  const [customSize, setCustomSize] = useState("")

  useEffect(() => {
    const id = params.id as string
    inventoryStockService.getStockItem(id).then((data) => {
      if (data) {
        setItem(data)
        setName(data.name)
        setCategory(data.category)
        setUnit(data.unit)
        setStockTotal(data.stockTotal)
        const storedSize = data.size as string | null | undefined
        if (storedSize && !sizeOptions.some((s) => s.value === storedSize)) {
          setSize("custom")
          setCustomSize(storedSize)
        } else {
          setSize((storedSize as StockSize) ?? "")
        }
      }
      setLoading(false)
    })
  }, [params.id])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>
  if (!item) return <p className="text-muted-foreground">Material no encontrado</p>

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const finalSize = size === "custom" ? customSize : size
      await update(item.id, {
        name, category, unit, stockTotal,
        size: finalSize || null,
      })
      toast.success("Material actualizado")
      router.back()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm("¿Eliminar este material? Esta acción no se puede deshacer.")) return
    setDeleting(true)
    try {
      await remove(item.id)
      toast.success("Material eliminado")
      router.push("/dashboard")
    } catch {
      toast.error("Error al eliminar material")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">{item.name}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Editar material</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Categoría</Label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value as StockCategory)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              >
                {categoryOptions.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unidad</Label>
              <select
                id="unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as StockUnit)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              >
                {unitOptions.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="size">Medida</Label>
              <select
                id="size"
                value={size}
                onChange={(e) => setSize(e.target.value as StockSize | "")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              >
                {sizeOptions.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              {size === "custom" && (
                <Input
                  value={customSize}
                  onChange={(e) => setCustomSize(e.target.value)}
                  placeholder="Ej: 5m, 8m, 10m..."
                  className="mt-2"
                />
              )}
              <p className="text-xs text-muted-foreground">Seleccionar medida para control de stock por tamaño</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stockTotal">Stock total</Label>
              <Input
                id="stockTotal"
                type="number"
                min={0}
                value={stockTotal}
                onChange={(e) => setStockTotal(Math.max(0, parseInt(e.target.value) || 0))}
                required
              />
            </div>

            <div className="rounded-lg bg-muted/30 p-4 space-y-1 text-sm">
              <p>Disponibles: <strong>{item.stockAvailable}</strong></p>
              <p>Alquilados: <strong>{item.stockRented}</strong></p>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancelar</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-red-300">
        <CardHeader>
          <CardTitle className="text-red-700">Zona de peligro</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Eliminar este material no se puede deshacer. Los datos de stock se perderán permanentemente.
          </p>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Eliminando..." : "Eliminar material"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
