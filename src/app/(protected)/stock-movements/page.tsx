"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { getAllMovements } from "@/services/stockMovements"
import { getAllSpareParts } from "@/services/spareParts"
import { formatDate } from "@/lib/ui"
import type { StockMovement, SparePart } from "@/types"

const TYPE_CONFIG = {
  INGRESO: { label: "Ingreso", color: "bg-green-200 text-green-800" },
  EGRESO: { label: "Egreso", color: "bg-red-200 text-red-800" },
} as const

const SOURCE_LABELS: Record<string, string> = {
  REPARACION: "Reparación",
  REPOSICION: "Reposición",
}

export default function StockMovementsPage() {
  const router = useRouter()
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [parts, setParts] = useState<SparePart[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [partFilter, setPartFilter] = useState("")

  useEffect(() => {
    Promise.all([getAllMovements(), getAllSpareParts()]).then(([mov, pts]) => {
      setMovements(mov)
      setParts(pts)
      setLoading(false)
    })
  }, [])

  const partMap = useMemo(() => {
    const map = new Map<string, SparePart>()
    for (const p of parts) map.set(p.id, p)
    return map
  }, [parts])

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      const d = m.date
      const matchesFrom = !dateFrom || d >= new Date(dateFrom)
      const matchesTo = !dateTo || d <= new Date(dateTo + "T23:59:59")
      const matchesType = typeFilter === "all" || m.type === typeFilter
      const part = partMap.get(m.partId)
      const matchesPart =
        !partFilter ||
        (part?.partName ?? "").toLowerCase().includes(partFilter.toLowerCase()) ||
        (part?.partCode ?? "").toLowerCase().includes(partFilter.toLowerCase())
      return matchesFrom && matchesTo && matchesType && matchesPart
    })
  }, [movements, dateFrom, dateTo, typeFilter, partFilter, partMap])

  if (loading) return <p className="text-muted-foreground">Cargando movimientos...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Movimientos de stock</h1>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex gap-2 items-center">
          <label className="text-xs text-muted-foreground">Desde:</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
          <label className="text-xs text-muted-foreground">Hasta:</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
        <div className="flex gap-1">
          {(["all", "INGRESO", "EGRESO"] as const).map((t) => (
            <Button
              key={t}
              variant={typeFilter === t ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter(t)}
            >
              {t === "all" ? "Todos" : TYPE_CONFIG[t].label}
            </Button>
          ))}
        </div>
        <Input
          placeholder="Filtrar por repuesto..."
          value={partFilter}
          onChange={(e) => setPartFilter(e.target.value)}
          className="max-w-xs"
        />
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
                <TableHead>Origen</TableHead>
                <TableHead>Repuesto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Stock actual</TableHead>
                <TableHead>Referencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => {
                const part = partMap.get(m.partId)
                return (
                  <TableRow key={m.id}>
                    <TableCell>{formatDate(m.date)}</TableCell>
                    <TableCell>
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${TYPE_CONFIG[m.type].color}`}>
                        {TYPE_CONFIG[m.type].label}
                      </span>
                    </TableCell>
                    <TableCell>{SOURCE_LABELS[m.source] ?? m.source}</TableCell>
                    <TableCell>
                      {part ? (
                        <span
                          className="cursor-pointer hover:underline"
                          onClick={() => router.push(`/machines/${part.machineId}/parts`)}
                        >
                          {part.partCode} — {part.partName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Repuesto eliminado</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{m.quantity}</TableCell>
                    <TableCell className="text-right font-mono">
                      {part !== undefined ? (
                        <span className={part.stockAvailable === 0 ? "text-red-600 font-semibold" : ""}>
                          {part.stockAvailable} uds.
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {m.source === "REPARACION" ? (
                        <span
                          className="cursor-pointer hover:underline text-blue-600"
                          onClick={() => router.push(`/repairs/${m.referenceId}`)}
                        >
                          Ver reparación
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{m.referenceId}</span>
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
