"use client"

import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Machine } from "@/types"
import { statusColors, statusLabels, locationLabels, formatDate } from "@/lib/ui"
import { CATEGORY_LABELS, CATEGORY_COLORS } from "@/lib/categories"

interface MachineCardProps {
  machine: Machine
  onRepair?: (id: string) => void
}

export default function MachineCard({ machine, onRepair }: MachineCardProps) {
  const router = useRouter()

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => router.push(`/machines/${machine.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{machine.name}</CardTitle>
            <p className="text-xs text-muted-foreground">{machine.model}</p>
            {machine.category && (
              <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[machine.category] ?? ""}`}>
                {CATEGORY_LABELS[machine.category] ?? machine.category}
              </span>
            )}
          </div>
          <Badge className={statusColors[machine.status]}>{statusLabels[machine.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {machine.status === "rented" ? (
          <>
            {machine.rental ? (
              <>
                <p><span className="text-muted-foreground">Cliente:</span> {machine.rental.clientName}</p>
                {machine.location?.client?.address && (
                  <p><span className="text-muted-foreground">Dir. cliente:</span> {machine.location.client.address}</p>
                )}
                <p><span className="text-muted-foreground">Obra:</span> {machine.rental.projectName}</p>
                {machine.location?.project?.address && (
                  <p><span className="text-muted-foreground">Dir. obra:</span> {machine.location.project.address}</p>
                )}
                <p><span className="text-muted-foreground">Inicio:</span> {formatDate(machine.rental.startDate)}</p>
                {!machine.rental.isOpenEnded && machine.rental.expectedEndDate && (
                  <p><span className="text-muted-foreground">Fin estimado:</span> {formatDate(machine.rental.expectedEndDate)}</p>
                )}
                {machine.rental.isOpenEnded && (
                  <p><span className="text-xs text-blue-600">Plazo abierto</span></p>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-amber-600">Alquilada sin datos de rental.</p>
                {onRepair && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRepair(machine.id) }}
                    className="text-xs text-blue-600 underline hover:text-blue-800"
                  >
                    Reparar (marcar como disponible)
                  </button>
                )}
              </div>
            )}
          </>
        ) : machine.status === "maintenance" ? (
          <>
            <p><span className="text-muted-foreground">Ubicación:</span> {locationLabels[machine.locationType] ?? machine.locationType}</p>
            {machine.location?.client?.name && (
              <p><span className="text-muted-foreground">Cliente:</span> {machine.location.client.name}</p>
            )}
            {machine.location?.project?.name && (
              <p><span className="text-muted-foreground">Obra:</span> {machine.location.project.name}</p>
            )}
          </>
        ) : (
          <>
            <p><span className="text-muted-foreground">Ubicación:</span> {locationLabels[machine.locationType] ?? machine.locationType}</p>
            {machine.location?.client?.name && (
              <p><span className="text-muted-foreground">Cliente:</span> {machine.location.client.name}</p>
            )}
            {machine.location?.project?.name && (
              <p><span className="text-muted-foreground">Obra:</span> {machine.location.project.name}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
