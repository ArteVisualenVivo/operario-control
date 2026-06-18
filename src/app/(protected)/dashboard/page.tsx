"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useState, useMemo } from "react"
import { useMachines } from "@/hooks/useMachines"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import SeedInventory from "@/components/machines/SeedInventory"
import MachineCard from "@/components/machines/MachineCard"
import type { MachineStatus } from "@/types"
import { statusLabels } from "@/lib/ui"

export default function DashboardPage() {
  const { machines, loading, update } = useMachines()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<MachineStatus | "all">("all")

  useEffect(() => {
    if (!loading) {
      const rented = machines.filter(m => m.status === "rented")
      rented.forEach(m => {
        console.log(`[DASHBOARD] ${m.name} | status: ${m.status} | rental: ${m.rental ? "OK" : "NULL"} | location: ${m.location ? "OK" : "NULL"}`)
      })
    }
  }, [machines, loading])

  const filteredMachines = useMemo(() => {
    return machines.filter((m) => {
      const q = search.toLowerCase()
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        (m.rental?.clientName ?? "").toLowerCase().includes(q) ||
        (m.rental?.projectName ?? "").toLowerCase().includes(q)
      const matchesStatus = statusFilter === "all" || m.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [machines, search, statusFilter])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <SeedInventory onComplete={() => window.location.reload()} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Disponibles</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{machines.filter((m) => m.status === "available").length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Alquiladas</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{machines.filter((m) => m.status === "rented").length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Mantenimiento</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{machines.filter((m) => m.status === "maintenance").length}</p></CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Input
          placeholder="Buscar por nombre, modelo, cliente u obra..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-2">
          {(["all", "available", "rented", "maintenance"] as const).map((s) => (
            <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
              {s === "all" ? "Todos" : statusLabels[s]}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{filteredMachines.length} de {machines.length} máquinas</span>
        {statusFilter !== "all" && (
          <Badge variant="outline">Filtro: {statusLabels[statusFilter]}</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredMachines.map((machine) => (
          <MachineCard key={machine.id} machine={machine} onRepair={(id) => update(id, { status: "available" })} />
        ))}
      </div>

      {filteredMachines.length === 0 && <p className="text-center text-muted-foreground">No se encontraron máquinas</p>}
    </div>
  )
}
