"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input
import { SearchInput } from "@/components/ui/SearchInput"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { getAllInventoryMovements } from "@/services/inventoryMovements"
import { getStockItems } from "@/services/inventoryStock"
import { formatDate } from "@/lib/ui"
import type { InventoryMovement, InventoryStock } from "@/types"

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  ALQUILER: { label: "Alquiler", color: "bg-blue-200 text-blue-800" },
  DEVOLUCION: { label: "DevoluciÃ³n", color: "bg-green-200 text-green-800" },
  AJUSTE: { label: "Ajuste", color: "bg-amber-200 text-amber-800" },
}

export default function InventoryMovementsPage() {
  const router = useRouter()
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [materials, setMaterials] = useState<InventoryStock[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")

  useEffect(() => {
    Promise.all([getAllInventoryMovements(), getStockItems()]).then(([mov, mat]) => {
      setMovements(mov)
      setMaterials(mat)
      setLoading(false)
    })
  }, [])

  const materialMap = useMemo(() => {
    const map = new Map<string, InventoryStock>()
    for (const m of materials) map.set(m.id, m)
    return map
  }, [materials])

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      const d = m.date
      const matchesFrom = !dateFrom || d >= new Date(dateFrom)
      const matchesTo = !dateTo || d <= new Date(dateTo + "T23:59:59")
      const matchesType = typeFilter === "all" || m.type === typeFilter
      const mat = materialMap.get(m.materialId)
      const q = search.toLowerCase()
      const matchesSearch =
        !q ||
        (mat?.name ?? "").toLowerCase().includes(q) ||
        (m.clientName ?? "").toLowerCase().includes(q) ||
        (m.projectName ?? "").toLowerCase().includes(q)
      return matchesFrom && matchesTo && matchesType && matchesSearch
    })
  }, [movements, dateFrom, dateTo, typeFilter, search, materialMap])

  const summary = useMemo(() => {
    const total = movements.length
    const alquileres = movements.filter((m) => m.type === "ALQUILER").length
    const devoluciones = movements.filter((m) => m.type === "DEVOLUCION").length
    const materiales = new Set(movements.map((m) => m.materialId)).size
    return { total, alquileres, devoluciones, materiales }
  }, [movements])

  if (loading) return <p className="text-muted-foreground">Cargando movimientos...</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Movimientos de materiales</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total movimientos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Alquileres</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-blue-600">{summary.alquileres}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Devoluciones</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{summary.devoluciones}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Materiales afectados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.materiales}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar por material, cliente u obra..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-2 items-center">
          <label className="text-xs text-muted-foreground">Desde:</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
          <label className="text-xs text-muted-foreground">Hasta:</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
        </div>
        <div className="flex gap-1">
          {(["all", "ALQUILER", "DEVOLUCION", "AJUSTE"] as const).map((t) => (
            <Button
              key={t}
              variant={typeFilter === t ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter(t)}
            >
              {t === "all" ? "Todos" : TYPE_CONFIG[t]?.label ?? t}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No se encontraron movimientos.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Obra</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead className="w-20">AcciÃ³n</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => {
                const mat = materialMap.get(m.materialId)
                return (
                  <TableRow key={m.id}>
                    <TableCell>{formatDate(m.date)}</TableCell>
                    <TableCell>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${TYPE_CONFIG[m.type]?.color ?? ""}`}>
                        {TYPE_CONFIG[m.type]?.label ?? m.type}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {mat ? (
                        <span
                          className="cursor-pointer hover:underline"
                          onClick={() => router.push(`/inventory/${mat.id}`)}
                        >
                          {mat.name}{mat.size ? ` (${mat.size})` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Material eliminado</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{m.quantity}</TableCell>
                    <TableCell>{m.clientName ?? "â€”"}</TableCell>
                    <TableCell>{m.projectName ?? "â€”"}</TableCell>
                    <TableCell>
                      {m.reference ? (
                        <span
                          className="cursor-pointer hover:underline text-blue-600"
                          onClick={() => router.push(`/machines/${m.reference}`)}
                        >
                          {m.reference.slice(0, 8)}...
                        </span>
                      ) : "â€”"}
                    </TableCell>
                    <TableCell>
                      {mat && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => router.push(`/inventory/${mat.id}`)}
                        >
                          Ver
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
