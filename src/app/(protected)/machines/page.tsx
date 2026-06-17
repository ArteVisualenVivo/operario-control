"use client"

import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import ImportInventory from "@/components/machines/ImportInventory"
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

export default function MachinesPage() {
  const { machines, loading } = useMachines()
  const router = useRouter()

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  const renderExtraInfo = (m: typeof machines[0]) => {
    if (m.rental) return <p><span className="text-muted-foreground">Cliente:</span> {m.rental.client}</p>
    if (m.maintenance) return <p><span className="text-muted-foreground">Motivo:</span> {m.maintenance.reason}</p>
    return null
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Máquinas</h1>
        <div className="flex gap-2">
          <ImportInventory />
          <Button onClick={() => router.push("/machines/new")}>Nueva máquina</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {machines.map((machine) => (
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
              {renderExtraInfo(machine)}
            </CardContent>
          </Card>
        ))}
      </div>

      {machines.length === 0 && <p className="text-center text-muted-foreground">No hay máquinas registradas</p>}
    </div>
  )
}
