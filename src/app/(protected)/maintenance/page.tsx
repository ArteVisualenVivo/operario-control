"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate } from "@/lib/ui"
import {
  getUpcomingWarranty,
  getUpcomingOilChanges,
  getUpcomingBearingChanges,
  getOverdueMaintenances,
  getRecentRepairs,
} from "@/services/repairs"
import type { MachineRepair } from "@/types"

interface AlertSectionProps {
  title: string
  repairs: MachineRepair[]
  emptyText: string
  badgeColor: "red" | "amber" | "green"
  dateLabel: string
  getDate: (r: MachineRepair) => Date | undefined
}

function AlertSection({ title, repairs, emptyText, badgeColor, dateLabel, getDate }: AlertSectionProps) {
  const router = useRouter()
  const badgeClass =
    badgeColor === "red" ? "bg-red-200 text-red-800" :
    badgeColor === "amber" ? "bg-amber-200 text-amber-800" : "bg-green-200 text-green-800"

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {repairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="space-y-2">
            {repairs.slice(0, 10).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border p-3 text-sm cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => router.push(`/repairs/${r.id}`)}
              >
                <div className="space-y-0.5">
                  <p className="font-medium">{r.machineName}</p>
                  <p className="text-xs text-muted-foreground">{r.clientName} — {r.technician}</p>
                </div>
                <div className="text-right">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${badgeClass}`}>
                    {formatDate(getDate(r))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function MaintenancePage() {
  const [expiredWarranties, setExpiredWarranties] = useState<MachineRepair[]>([])
  const [upcomingWarranties, setUpcomingWarranties] = useState<MachineRepair[]>([])
  const [oilChanges, setOilChanges] = useState<MachineRepair[]>([])
  const [bearingChanges, setBearingChanges] = useState<MachineRepair[]>([])
  const [overdueMaintenances, setOverdueMaintenances] = useState<MachineRepair[]>([])
  const [recentRepairs, setRecentRepairs] = useState<MachineRepair[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const [warranty, oil, bearing, overdue, recent] = await Promise.all([
      getUpcomingWarranty(),
      getUpcomingOilChanges(),
      getUpcomingBearingChanges(),
      getOverdueMaintenances(),
      getRecentRepairs(30),
    ])
    setExpiredWarranties(warranty.expired)
    setUpcomingWarranties(warranty.upcoming7)
    setOilChanges(oil)
    setBearingChanges(bearing)
    setOverdueMaintenances(overdue)
    setRecentRepairs(recent)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mantenimiento y Garantías</h1>
        <Button variant="outline" size="sm" onClick={load}>Actualizar</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Alertas de mantenimiento preventivo basadas en las reparaciones registradas.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AlertSection
          title={`Garantías vencidas (${expiredWarranties.length})`}
          repairs={expiredWarranties}
          emptyText="No hay garantías vencidas."
          badgeColor="red"
          dateLabel="Vence"
          getDate={(r) => r.warrantyUntil}
        />
        <AlertSection
          title={`Garantías próximas a vencer (${upcomingWarranties.length})`}
          repairs={upcomingWarranties}
          emptyText="No hay garantías próximas a vencer."
          badgeColor="amber"
          dateLabel="Vence"
          getDate={(r) => r.warrantyUntil}
        />
        <AlertSection
          title={`Cambios de aceite próximos (${oilChanges.length})`}
          repairs={oilChanges}
          emptyText="No hay cambios de aceite próximos."
          badgeColor="amber"
          dateLabel="Vence"
          getDate={(r) => r.oilChangeDueDate}
        />
        <AlertSection
          title={`Cambios de rodamientos próximos (${bearingChanges.length})`}
          repairs={bearingChanges}
          emptyText="No hay cambios de rodamientos próximos."
          badgeColor="amber"
          dateLabel="Vence"
          getDate={(r) => r.bearingChangeDueDate}
        />
        <AlertSection
          title={`Mantenimientos vencidos (${overdueMaintenances.length})`}
          repairs={overdueMaintenances}
          emptyText="No hay mantenimientos vencidos."
          badgeColor="red"
          dateLabel="Vence"
          getDate={(r) => r.maintenanceDueDate}
        />
        <AlertSection
          title={`Reparaciones recientes (${recentRepairs.length})`}
          repairs={recentRepairs}
          emptyText="No hay reparaciones en los últimos 30 días."
          badgeColor="green"
          dateLabel="Ingreso"
          getDate={(r) => r.entryDate}
        />
      </div>
    </div>
  )
}
