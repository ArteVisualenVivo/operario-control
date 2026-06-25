"use client"

import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/ui"
import MaintenanceStatusBadge from "@/components/repairs/MaintenanceStatusBadge"
import type { MachineRepair } from "@/types"

interface MaintenanceTimelineProps {
  repairs: MachineRepair[]
  machineId: string
}

export default function MaintenanceTimeline({ repairs, machineId }: MaintenanceTimelineProps) {
  const router = useRouter()

  if (repairs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Sin reparaciones registradas.
      </p>
    )
  }

  return (
    <div className="relative space-y-0">
      {repairs.map((r, idx) => (
        <div key={r.id} className="relative flex gap-4 pb-6 last:pb-0">
          <div className="flex flex-col items-center">
            <div
              className={`w-3 h-3 rounded-full z-10 ring-2 ring-background ${
                r.status === "EN_TALLER" ? "bg-blue-500" : "bg-green-500"
              }`}
            />
            {idx < repairs.length - 1 && (
              <div className="w-0.5 flex-1 bg-border min-h-[24px]" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <Card
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => router.push(`/repairs/${r.id}`)}
            >
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {formatDate(r.entryDate)} → {formatDate(r.exitDate)}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {r.technician}
                  </span>
                </div>

                {r.clientName && (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Cliente: </span>
                    {r.clientName}
                  </p>
                )}

                <p className="text-xs">
                  <span className="text-muted-foreground">Falla: </span>
                  {r.reportedIssue}
                </p>

                {r.diagnosis && (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Diagnóstico: </span>
                    {r.diagnosis}
                  </p>
                )}

                <p className="text-xs">
                  <span className="text-muted-foreground">Reparación: </span>
                  {r.repairPerformed}
                </p>

                {r.partsUsed.length > 0 && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Repuestos: </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {r.partsUsed.map((p, i) => (
                        <span
                          key={i}
                          className="inline-block px-1.5 py-0.5 bg-muted rounded text-xs"
                        >
                          {p.code} x{p.quantity}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1 pt-1">
                  <MaintenanceStatusBadge dueDate={r.warrantyUntil} label="Garantía" compact />
                  <MaintenanceStatusBadge dueDate={r.oilChangeDueDate} label="Aceite" compact />
                  <MaintenanceStatusBadge dueDate={r.bearingChangeDueDate} label="Rodamientos" compact />
                  <MaintenanceStatusBadge dueDate={r.maintenanceDueDate} label="Mantenimiento" compact />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ))}

      {repairs.length > 5 && (
        <div className="flex justify-center pt-2">
          <Button
            variant="link"
            size="sm"
            className="text-xs"
            onClick={() => router.push(`/repairs?machine=${machineId}`)}
          >
            Ver todas ({repairs.length})
          </Button>
        </div>
      )}
    </div>
  )
}
