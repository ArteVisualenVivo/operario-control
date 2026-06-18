"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getMachine } from "@/services/machines"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Machine } from "@/types"
import { formatDate, statusLabels, statusColors } from "@/lib/ui"

export default function RentalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { returnMachine } = useMachines()
  const [machine, setMachine] = useState<Machine | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMachine(id).then((m) => { setMachine(m); setLoading(false) })
  }, [id])

  const handleReturn = async () => {
    await returnMachine(id)
    const m = await getMachine(id)
    setMachine(m)
  }

  if (loading) return <p className="text-muted-foreground">Cargando...</p>
  if (!machine) return <p className="text-muted-foreground">Alquiler no encontrado</p>
  if (!machine.rental) return <p className="text-muted-foreground">Esta máquina no está alquilada</p>

  const r = machine.rental

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Button variant="outline" size="sm" onClick={() => router.back()}>← Volver</Button>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle>{machine.name}</CardTitle>
            <Badge className={statusColors[machine.status]}>{statusLabels[machine.status]}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-muted-foreground">Modelo:</span> {machine.model}</p>
          <p><span className="text-muted-foreground">Cliente:</span> {r.clientName}</p>
          {machine.location?.client?.address && (
            <p><span className="text-muted-foreground">Dir. cliente:</span> {machine.location.client.address}</p>
          )}
          <p><span className="text-muted-foreground">Obra:</span> {r.projectName}</p>
          {machine.location?.project?.address && (
            <p><span className="text-muted-foreground">Dir. obra:</span> {machine.location.project.address}</p>
          )}
          <p><span className="text-muted-foreground">Inicio:</span> {formatDate(r.startDate)}</p>
          {!r.isOpenEnded && r.expectedEndDate && (
            <p><span className="text-muted-foreground">Fin estimado:</span> {formatDate(r.expectedEndDate)}</p>
          )}
          {r.isOpenEnded && (
            <p><span className="text-xs text-blue-600">Plazo abierto</span></p>
          )}
          <Button onClick={handleReturn} className="mt-4">Devolver máquina</Button>
        </CardContent>
      </Card>
    </div>
  )
}
