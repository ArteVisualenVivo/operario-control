"use client"

import { useRouter } from "next/navigation"
import { useState, useMemo } from "react"
import { useMachines } from "@/hooks/useMachines"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import SeedInventory from "@/components/machines/SeedInventory"
import type { MachineStatus } from "@/types"
import { CATEGORY_LABELS, CATEGORY_COLORS } from "@/lib/categories"

const statusColors: Record<MachineStatus, string> = {
  available: "bg-green-100 text-green-800 hover:bg-green-100",
  rented: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  maintenance: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
}

const statusLabels: Record<MachineStatus, string> = {
  available: "Disponible",
  rented: "Alquilada",
  maintenance: "Mantenimiento",
}

const locationLabels: Record<string, string> = {
  taller: "Taller", deposito: "Depósito", obra: "Obra",
}

export default function DashboardPage() {
  const { machines, loading } = useMachines()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<MachineStatus | "all">("all")

  const filteredMachines = useMemo(() => {
    return machines.filter((m) => {
      const q = search.toLowerCase()
      const matchesSearch = !q || m.name.toLowerCase().includes(q) || m.model.toLowerCase().includes(q)
      const matchesStatus = statusFilter === "all" || m.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [machines, search, statusFilter])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  const renderExtra = (m: typeof machines[0]) => {
    if (m.rental) return (
      <>
        <p><span className="text-muted-foreground">Cliente:</span> {m.rental.client}</p>
        {m.rental.returnDate && <p><span className="text-muted-foreground">Retorno:</span> {new Date(m.rental.returnDate).toLocaleDateString("es-ES")}</p>}
      </>
    )
    if (m.maintenance) return <p><span className="text-muted-foreground">Motivo:</span> {m.maintenance.reason}</p>
    return null
  }

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
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">En mantenimiento</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{machines.filter((m) => m.status === "maintenance").length}</p></CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Input placeholder="Buscar máquina por nombre o modelo..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <div className="flex gap-2">
          {(["all", "available", "rented", "maintenance"] as const).map((s) => (
            <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
              {s === "all" ? "Todos" : statusLabels[s]}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredMachines.map((machine) => (
          <Card key={machine.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push(`/machines/${machine.id}`)}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-lg">{machine.name}</CardTitle>
                <Badge className={statusColors[machine.status]}>{statusLabels[machine.status]}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p><span className="text-muted-foreground">Modelo:</span> {machine.model}</p>
              <p><span className="text-muted-foreground">Ubicación:</span> {locationLabels[machine.location] ?? machine.location}</p>
              {machine.category && (
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[machine.category] ?? ""}`}>
                  {CATEGORY_LABELS[machine.category] ?? machine.category}
                  {machine.subcategory && ` > ${machine.subcategory}`}
                </span>
              )}
              {renderExtra(machine)}
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredMachines.length === 0 && <p className="text-center text-muted-foreground">No se encontraron máquinas</p>}
    </div>
  )
}
