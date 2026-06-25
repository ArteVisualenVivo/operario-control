"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/ui"
import MaintenanceStatusBadge from "@/components/repairs/MaintenanceStatusBadge"
import { getRepairs } from "@/services/repairs"
import type { MachineRepair } from "@/types"

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

type AlertType = "oil" | "bearing" | "maintenance"

interface AlertEntry {
  repair: MachineRepair
  types: AlertType[]
}

const ALERT_LABELS: Record<AlertType, string> = {
  oil: "Aceite",
  bearing: "Rodamientos",
  maintenance: "Mantenimiento",
}

const ALERT_DATE_FIELDS: Record<AlertType, keyof MachineRepair> = {
  oil: "oilChangeDueDate",
  bearing: "bearingChangeDueDate",
  maintenance: "maintenanceDueDate",
}

function classifyRepairs(repairs: MachineRepair[]) {
  const now = new Date()
  const in7Days = addDays(now, 7)
  const in30Days = addDays(now, 30)

  const vencidos: AlertEntry[] = []
  const proximos7d: AlertEntry[] = []
  const proximos30d: AlertEntry[] = []

  for (const r of repairs) {
    const vencidosTypes: AlertType[] = []
    const proximos7dTypes: AlertType[] = []
    const proximos30dTypes: AlertType[] = []

    for (const t of ["oil", "bearing", "maintenance"] as AlertType[]) {
      const field = ALERT_DATE_FIELDS[t]
      const date = r[field] as Date | undefined
      if (!date) continue
      if (date <= now) {
        vencidosTypes.push(t)
      } else if (date <= in7Days) {
        proximos7dTypes.push(t)
      } else if (date <= in30Days) {
        proximos30dTypes.push(t)
      }
    }

    if (vencidosTypes.length > 0) {
      vencidos.push({ repair: r, types: vencidosTypes })
    } else if (proximos7dTypes.length > 0) {
      proximos7d.push({ repair: r, types: proximos7dTypes })
    } else if (proximos30dTypes.length > 0) {
      proximos30d.push({ repair: r, types: proximos30dTypes })
    }
  }

  return { vencidos, proximos7d, proximos30d }
}

const BADGE_COLORS = {
  vencidos: "border-red-300",
  proximos7d: "border-amber-300",
  proximos30d: "border-green-300",
} as const

function AlertSection({
  title,
  entries,
  emptyText,
  borderColor,
}: {
  title: string
  entries: AlertEntry[]
  emptyText: string
  borderColor: string
}) {
  const router = useRouter()

  return (
    <Card className={`border-t-4 ${borderColor}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.repair.id}
                className="flex items-center justify-between rounded-lg border p-3 text-sm cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => router.push(`/repairs/${entry.repair.id}`)}
              >
                <div className="space-y-1">
                  <p className="font-medium">{entry.repair.machineName}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.repair.clientName} — {entry.repair.technician}
                  </p>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {entry.types.map((t) => (
                      <MaintenanceStatusBadge
                        key={t}
                        dueDate={entry.repair[ALERT_DATE_FIELDS[t]] as Date | undefined}
                        label={ALERT_LABELS[t]}
                        compact
                      />
                    ))}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  {entry.types.map((t) => {
                    const d = entry.repair[ALERT_DATE_FIELDS[t]] as Date | undefined
                    return d ? <p key={t}>{ALERT_LABELS[t]}: {formatDate(d)}</p> : null
                  })}
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
  const [repairs, setRepairs] = useState<MachineRepair[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const data = await getRepairs()
    setRepairs(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const classified = useMemo(() => classifyRepairs(repairs), [repairs])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mantenimiento y Alertas</h1>
        <Button variant="outline" size="sm" onClick={load}>Actualizar</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Alertas automáticas calculadas desde las reparaciones registradas.
        Cada equipo aparece en la sección de mayor urgencia.
      </p>

      <div className="grid grid-cols-1 gap-4">
        <AlertSection
          title={`Vencidos (${classified.vencidos.length})`}
          entries={classified.vencidos}
          emptyText="No hay mantenimientos vencidos."
          borderColor={BADGE_COLORS.vencidos}
        />
        <AlertSection
          title={`Próximos 7 días (${classified.proximos7d.length})`}
          entries={classified.proximos7d}
          emptyText="No hay mantenimientos próximos en 7 días."
          borderColor={BADGE_COLORS.proximos7d}
        />
        <AlertSection
          title={`Próximos 30 días (${classified.proximos30d.length})`}
          entries={classified.proximos30d}
          emptyText="No hay mantenimientos próximos en 30 días."
          borderColor={BADGE_COLORS.proximos30d}
        />
      </div>
    </div>
  )
}
