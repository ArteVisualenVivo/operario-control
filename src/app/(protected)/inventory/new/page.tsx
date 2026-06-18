"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { StockCategory, StockUnit, StockSize } from "@/types"
import { toast } from "sonner"

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
  { value: "1m", label: "1 metro" },
  { value: "1.5m", label: "1.5 metros" },
  { value: "2m", label: "2 metros" },
  { value: "2.5m", label: "2.5 metros" },
  { value: "3m", label: "3 metros" },
  { value: "4m", label: "4 metros" },
  { value: "6m", label: "6 metros" },
  { value: "custom", label: "Otra medida" },
]

export default function NewStockPage() {
  const { create } = useInventoryStock()
  const router = useRouter()

  const [name, setName] = useState("")
  const [category, setCategory] = useState<StockCategory>("puntales")
  const [unit, setUnit] = useState<StockUnit>("unidad")
  const [stockTotal, setStockTotal] = useState(1)
  const [size, setSize] = useState<StockSize | "">("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      await create({ name, category, unit, stockTotal, size: size || null })
      toast.success("Material creado")
      router.push("/dashboard")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear material")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">Nuevo material</h1>
      <Card>
        <CardHeader>
          <CardTitle>Datos del material</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
              <p className="text-xs text-muted-foreground">Seleccionar medida para control de stock por tamaño</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stockTotal">Stock total</Label>
              <Input
                id="stockTotal"
                type="number"
                min={1}
                value={stockTotal}
                onChange={(e) => setStockTotal(Math.max(1, parseInt(e.target.value) || 1))}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar"}</Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancelar</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
