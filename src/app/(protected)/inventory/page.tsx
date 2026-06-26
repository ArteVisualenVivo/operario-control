"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import type { StockCategory } from "@/types"

const CATEGORY_OPTIONS: { value: StockCategory; label: string }[] = [
  { value: "puntales", label: "Puntales" },
  { value: "riendas", label: "Riendas" },
  { value: "andamio_accesorios", label: "Andamio Acc." },
  { value: "consumibles", label: "Consumibles" },
]

const CATEGORY_LABELS: Record<string, string> = {
  puntales: "Puntales",
  riendas: "Riendas",
  andamio_accesorios: "Andamio Acc.",
  consumibles: "Consumibles",
}

export default function InventoryPage() {
  const router = useRouter()
  const { items, loading, remove } = useInventoryStock()
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const q = search.toLowerCase()
      const matchesSearch = !q || item.name.toLowerCase().includes(q)
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter
      return matchesSearch && matchesCategory
    })
  }, [items, search, categoryFilter])

  const summary = useMemo(() => {
    const totalItems = items.length
    const totalAvailable = items.reduce((sum, i) => sum + i.stockAvailable, 0)
    const totalRented = items.reduce((sum, i) => sum + i.stockRented, 0)
    const categories = new Set(items.map((i) => i.category)).size
    return { totalItems, totalAvailable, totalRented, categories }
  }, [items])

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return
    try {
      await remove(id)
      toast.success("Material eliminado")
    } catch {
      toast.error("Error al eliminar material")
    }
  }

  if (loading) return <p className="text-muted-foreground">Cargando inventario...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Inventario</h1>
        <Button onClick={() => router.push("/inventory/new")}>+ Nuevo material</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Totales</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.totalItems}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Disponibles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{summary.totalAvailable}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Alquilados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-blue-600">{summary.totalRented}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Categorías</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.categories}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar por nombre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-1">
          {(["all", ...CATEGORY_OPTIONS.map((o) => o.value)] as const).map((c) => (
            <Button
              key={c}
              variant={categoryFilter === c ? "default" : "outline"}
              size="sm"
              onClick={() => setCategoryFilter(c)}
            >
              {c === "all" ? "Todas" : CATEGORY_LABELS[c]}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No se encontraron materiales.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Subtipo</TableHead>
                <TableHead>Medida</TableHead>
                <TableHead>Unidad</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead className="text-right">Alquilado</TableHead>
                <TableHead className="w-32">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{CATEGORY_LABELS[item.category] ?? item.category}</TableCell>
                  <TableCell>{item.subtype ?? "—"}</TableCell>
                  <TableCell>{item.size ?? "—"}</TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell className="text-right">{item.stockTotal}</TableCell>
                  <TableCell className="text-right">
                    <span className={item.stockAvailable === 0 ? "text-red-600 font-semibold" : "text-green-600"}>
                      {item.stockAvailable}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-blue-600">{item.stockRented}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => router.push(`/inventory/${item.id}`)}
                      >
                        Ver
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id, item.name) }}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
