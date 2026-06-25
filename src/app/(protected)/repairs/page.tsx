"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useRepairs } from "@/hooks/useRepairs"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/ui"
import { toast } from "sonner"

function daysUntil(date: Date | undefined | null): number | null {
  if (!date) return null
  return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function statusBadge(label: string, days: number | null): string {
  if (days === null) return "bg-muted text-muted-foreground"
  if (days <= 0) return "bg-red-200 text-red-800"
  if (days <= 7) return "bg-amber-200 text-amber-800"
  return "bg-green-200 text-green-800"
}

export default function RepairsPage() {
  const { repairs, loading, remove } = useRepairs()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const filtered = useMemo(() => {
    return repairs.filter((r) => {
      const q = search.toLowerCase()
      const matchesSearch =
        !q ||
        r.clientName.toLowerCase().includes(q) ||
        r.machineName.toLowerCase().includes(q) ||
        (r.machineModel ?? "").toLowerCase().includes(q) ||
        r.technician.toLowerCase().includes(q) ||
        r.reportedIssue.toLowerCase().includes(q)
      const entry = new Date(r.entryDate)
      const matchesFrom = !dateFrom || entry >= new Date(dateFrom)
      const matchesTo = !dateTo || entry <= new Date(dateTo + "T23:59:59")
      const matchesStatus = statusFilter === "all" || r.status === statusFilter
      return matchesSearch && matchesFrom && matchesTo && matchesStatus
    })
  }, [repairs, search, dateFrom, dateTo, statusFilter])

  const handleDelete = async (id: string, machineName: string) => {
    if (!window.confirm(`¿Eliminar la reparación de ${machineName}?`)) return
    try {
      await remove(id)
      toast.success("Reparación eliminada")
    } catch {
      toast.error("Error al eliminar")
    }
  }

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Reparaciones</h1>
        <div className="flex gap-2">
          <Button onClick={() => router.push("/repairs/new")}>Nueva reparación</Button>
          <Button variant="outline" onClick={() => router.push("/maintenance")}>Panel de mantenimiento</Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Input
          placeholder="Buscar por cliente, máquina, técnico..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-2 items-center">
          <label className="text-xs text-muted-foreground">Desde:</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
          <label className="text-xs text-muted-foreground">Hasta:</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
        <div className="flex gap-1">
          {(["all", "EN_TALLER", "FINALIZADO"] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "Todos" : s === "EN_TALLER" ? "En taller" : "Finalizados"}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Máquina</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead>Ingreso</TableHead>
              <TableHead>Egreso</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Repuestos</TableHead>
              <TableHead>Garantía</TableHead>
              <TableHead>Próx. aceite</TableHead>
              <TableHead>Próx. rodamientos</TableHead>
              <TableHead>Próx. mantenimiento</TableHead>
              <TableHead className="w-24">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground">
                  No se encontraron reparaciones
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => router.push(`/repairs/${r.id}`)}
              >
                <TableCell className="font-medium">{r.clientName}</TableCell>
                <TableCell>{r.machineName}</TableCell>
                <TableCell>{r.machineModel ?? "—"}</TableCell>
                <TableCell>{formatDate(r.entryDate)}</TableCell>
                <TableCell>{formatDate(r.exitDate)}</TableCell>
                <TableCell>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                    r.status === "EN_TALLER" ? "bg-blue-200 text-blue-800" : "bg-green-200 text-green-800"
                  }`}>
                    {r.status === "EN_TALLER" ? "En taller" : "Finalizado"}
                  </span>
                </TableCell>
                <TableCell>
                  {r.partsUsed?.length ? `${r.partsUsed.length} repuesto${r.partsUsed.length > 1 ? "s" : ""}` : "—"}
                </TableCell>
                <TableCell>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${statusBadge("Garantía", daysUntil(r.warrantyUntil))}`}>
                    {daysUntil(r.warrantyUntil) !== null
                      ? daysUntil(r.warrantyUntil)! <= 0
                        ? "Vencida"
                        : `${daysUntil(r.warrantyUntil)}d`
                      : "—"}
                  </span>
                </TableCell>
                <TableCell>
                  {r.oilChangeDueDate ? (
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${statusBadge("Aceite", daysUntil(r.oilChangeDueDate))}`}>
                      {daysUntil(r.oilChangeDueDate)! <= 0 ? "Vencido" : `${daysUntil(r.oilChangeDueDate)}d`}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell>
                  {r.bearingChangeDueDate ? (
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${statusBadge("Rodamientos", daysUntil(r.bearingChangeDueDate))}`}>
                      {daysUntil(r.bearingChangeDueDate)! <= 0 ? "Vencido" : `${daysUntil(r.bearingChangeDueDate)}d`}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell>
                  {r.maintenanceDueDate ? (
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${statusBadge("Mantenimiento", daysUntil(r.maintenanceDueDate))}`}>
                      {daysUntil(r.maintenanceDueDate)! <= 0 ? "Vencido" : `${daysUntil(r.maintenanceDueDate)}d`}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); handleDelete(r.id, r.machineName) }}
                  >
                    Eliminar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
