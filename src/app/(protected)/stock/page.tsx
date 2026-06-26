"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { useSparePartsCache } from "@/hooks/useSparePartsCache"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import type { Machine } from "@/types"

type StockRowType = "Máquina" | "Andamio" | "Material" | "Repuesto"

interface StockRow {
  type: StockRowType
  id: string
  name: string
  category: string
  total: number
  available: number
  inUse: number
  status: string
  statusColor: string
  link: string
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  completo: { color: "bg-green-200 text-green-800", label: "Completo" },
  parcial: { color: "bg-amber-200 text-amber-800", label: "Parcial" },
  mantenimiento: { color: "bg-blue-200 text-blue-800", label: "En mto." },
  sin_stock: { color: "bg-red-200 text-red-800", label: "Sin stock" },
  vacio: { color: "bg-muted text-muted-foreground", label: "Vacío" },

}

function groupMachines(machines: Machine[], categoryFilter: string): StockRow[] {
  const filtered = machines.filter((m) => {
    if (categoryFilter === "all") return true
    if (categoryFilter === "machine") return m.category === "machine"
    if (categoryFilter === "scaffold") return m.category === "scaffold"
    return true
  })

  const groups = new Map<string, { machines: Machine[]; type: StockRowType }>()
  for (const m of filtered) {
    const type: StockRowType = m.category === "scaffold" ? "Andamio" : "Máquina"
    const key = `${type}||${m.name}||${m.model}`
    if (!groups.has(key)) groups.set(key, { machines: [], type })
    groups.get(key)!.machines.push(m)
  }

  const rows: StockRow[] = []
  for (const [, { machines: ms, type }] of groups) {
    const total = ms.length
    const available = ms.filter((m) => m.status === "available").length
    const rented = ms.filter((m) => m.status === "rented").length
    const maintenance = ms.filter((m) => m.status === "maintenance").length

    let status: string
    if (maintenance > 0 && total === maintenance) {
      status = "mantenimiento"
    } else if (available === 0) {
      status = "sin_stock"
    } else if (available === total) {
      status = "completo"
    } else {
      status = "parcial"
    }

    rows.push({
      type,
      id: ms[0].id,
      name: `${ms[0].name} — ${ms[0].model}`,
      category: type,
      total,
      available,
      inUse: rented + maintenance,
      status,
      statusColor: STATUS_CONFIG[status]?.color ?? "",
      link: `/machines?search=${encodeURIComponent(ms[0].name)}`,
    })
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export default function StockPage() {
  const router = useRouter()
  const { machines, loading: loadingMachines } = useMachines()
  const { items: materials, loading: loadingMaterials } = useInventoryStock()
  const { parts: spareParts, loading: loadingParts } = useSparePartsCache()
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")

  const loading = loadingMachines || loadingMaterials || loadingParts

  const allRows = useMemo(() => {
    const rows: StockRow[] = []

    const machineType = typeFilter === "all" || typeFilter === "Máquina" || typeFilter === "Andamio"
    if (machineType) {
      const categoryForMachines = typeFilter === "Máquina" ? "machine" : typeFilter === "Andamio" ? "scaffold" : "all"
      rows.push(...groupMachines(machines, categoryForMachines))
    }

    if (typeFilter === "all" || typeFilter === "Material") {
      for (const m of materials) {
        const inUse = m.stockRented
        const status = m.stockTotal === 0 ? "vacio" : m.stockAvailable === 0 ? "sin_stock" : m.stockAvailable < m.stockTotal ? "parcial" : "completo"
        rows.push({
          type: "Material",
          id: m.id,
          name: `${m.name}${m.size ? ` (${m.size})` : ""}`,
          category: m.category,
          total: m.stockTotal,
          available: m.stockAvailable,
          inUse,
          status,
          statusColor: STATUS_CONFIG[status]?.color ?? "",
          link: `/inventory/${m.id}`,
        })
      }
    }

    if (typeFilter === "all" || typeFilter === "Repuesto") {
      for (const p of spareParts) {
        const inUse = p.stockUsed
        const status = p.stockTotal === 0 ? "vacio" : p.stockAvailable === 0 ? "sin_stock" : p.stockAvailable < p.stockTotal ? "parcial" : "completo"
        rows.push({
          type: "Repuesto",
          id: p.id,
          name: `${p.partCode} — ${p.partName}`,
          category: p.category,
          total: p.stockTotal,
          available: p.stockAvailable,
          inUse,
          status,
          statusColor: STATUS_CONFIG[status]?.color ?? "",
          link: `/machines/${p.machineId}/parts`,
        })
      }
    }

    return rows
  }, [machines, materials, spareParts, typeFilter])

  const filtered = useMemo(() => {
    return allRows.filter((row) => {
      const q = search.toLowerCase()
      const matchesSearch = !q || row.name.toLowerCase().includes(q)
      const matchesStatus =
        statusFilter === "all" || row.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [allRows, search, statusFilter])

  const summary = useMemo(() => {
    const machineCount = machines.filter((m) => m.category === "machine").length
    const scaffoldCount = machines.filter((m) => m.category === "scaffold").length
    const materialTotal = materials.reduce((s, m) => s + m.stockTotal, 0)
    const partsTotal = spareParts.reduce((s, p) => s + p.stockTotal, 0)
    return { machineCount, scaffoldCount, materialTotal, partsTotal }
  }, [machines, materials, spareParts])

  if (loading) return <p className="text-muted-foreground">Cargando stock global...</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Stock global</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Máquinas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.machineCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Andamios</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.scaffoldCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Materiales</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.materialTotal} <span className="text-sm text-muted-foreground">uds.</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Repuestos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary.partsTotal} <span className="text-sm text-muted-foreground">uds.</span></p>
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
        <div className="flex gap-1 flex-wrap">
          {(["all", "Máquina", "Andamio", "Material", "Repuesto"] as const).map((t) => (
            <Button
              key={t}
              variant={typeFilter === t ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter(t)}
            >
              {t === "all" ? "Todos" : t}
            </Button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {(["all", "completo", "parcial", "sin_stock"] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "Todos" : STATUS_CONFIG[s]?.label ?? s}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No se encontraron resultados.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Tipo</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead className="text-right">En uso</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-20">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row, idx) => (
                <TableRow key={`${row.type}-${row.id}-${idx}`}>
                  <TableCell>{row.type}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell className="text-right">{row.total}</TableCell>
                  <TableCell className="text-right">
                    <span className={row.available === 0 ? "text-red-600 font-semibold" : "text-green-600"}>
                      {row.available}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-blue-600">{row.inUse}</TableCell>
                  <TableCell>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${row.statusColor}`}>
                      {STATUS_CONFIG[row.status]?.label ?? row.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => router.push(row.link)}
                    >
                      Ver
                    </Button>
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
