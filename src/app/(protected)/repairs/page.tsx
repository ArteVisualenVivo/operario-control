"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useRepairs } from "@/hooks/useRepairs"
import { Input } from "@/components/ui/input"
import { SearchInput } from "@/components/ui/SearchInput"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/ui"
import { toast } from "sonner"
import { hasMaintenanceLink } from "@/lib/machine-links"

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
        (r.internalNumber ?? "").toLowerCase().includes(q) ||
        (r.clientNumber ?? "").toLowerCase().includes(q)

      const entry = new Date(r.entryDate)
      const matchesFrom = !dateFrom || entry >= new Date(dateFrom)
      const matchesTo = !dateTo || entry <= new Date(dateTo + "T23:59:59")
      const normalizedStatus = r.status.toUpperCase()
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "EN_TALLER" && ["EN_TALLER", "PENDING", "REPAIRING"].includes(normalizedStatus)) ||
        (statusFilter === "FINALIZADO" && ["FINALIZADO", "DONE"].includes(normalizedStatus))

      return matchesSearch && matchesFrom && matchesTo && matchesStatus
    })
  }, [repairs, search, dateFrom, dateTo, statusFilter])

  const handleDelete = async (id: string, machineName: string) => {
    if (!window.confirm(`Eliminar la reparación de ${machineName}?`)) return
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
          <Button variant="outline" onClick={() => router.push("/maintenance")}>
            Mantenimiento
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <SearchInput
          placeholder="Buscar por orden, cliente o máquina"
          value={search}
          onChange={setSearch}
          className="max-w-sm"
        />

        <div className="flex gap-2 items-center">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        <div className="flex gap-2">
          {["all", "EN_TALLER", "FINALIZADO"].map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>Máquina</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead>Ingreso</TableHead>
            <TableHead>Egreso</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Mantenimiento</TableHead>
            <TableHead>Acción</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.id} onClick={() => router.push(`/repairs/${r.id}`)}>
              <TableCell>{r.clientName}</TableCell>
              <TableCell>{r.machineName}</TableCell>
              <TableCell>{r.machineModel}</TableCell>
              <TableCell>{formatDate(r.entryDate)}</TableCell>
              <TableCell>{formatDate(r.exitDate)}</TableCell>
              <TableCell>{r.status}</TableCell>
              <TableCell>
                {hasMaintenanceLink(r) ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      const orderKey = r.externalId ?? r.machineId
                      router.push(`/maintenance?order=${encodeURIComponent(orderKey)}`)
                    }}
                  >
                    Ver orden
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              <TableCell>
                <Button
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(r.id, r.machineName)
                  }}
                >
                  Eliminar
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
