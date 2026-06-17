"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getRepair } from "@/services/repairs"
import { getMachine } from "@/services/machines"
import { useRepairs } from "@/hooks/useRepairs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Repair, Machine } from "@/types"

const statusLabels = {
  pending: "Pendiente",
  repairing: "En reparación",
  done: "Completado",
}

const statusVariants = {
  pending: "outline" as const,
  repairing: "default" as const,
  done: "secondary" as const,
}

export default function RepairDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { updateStatus } = useRepairs()
  const [repair, setRepair] = useState<Repair | null>(null)
  const [machine, setMachine] = useState<Machine | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const r = await getRepair(id)
      setRepair(r)
      if (r) {
        setMachine(await getMachine(r.machineId))
      }
      setLoading(false)
    }
    load()
  }, [id])

  const handleUpdate = async (status: "repairing" | "done") => {
    await updateStatus(id, status)
    const r = await getRepair(id)
    setRepair(r)
  }

  if (loading) return <p className="text-muted-foreground">Cargando...</p>
  if (!repair) return <p className="text-muted-foreground">Reparación no encontrada</p>

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Button variant="outline" size="sm" onClick={() => router.back()}>← Volver</Button>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle>Reparación</CardTitle>
            <Badge variant={statusVariants[repair.status]}>{statusLabels[repair.status]}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-muted-foreground">Máquina:</span> {machine?.name ?? repair.machineId}</p>
          <p><span className="text-muted-foreground">Problema:</span> {repair.issue}</p>
          <p><span className="text-muted-foreground">Retorno estimado:</span> {repair.estimatedReturn ? new Date(repair.estimatedReturn).toLocaleDateString("es-ES") : "—"}</p>
          <div className="flex gap-2 pt-4">
            {repair.status === "pending" && (
              <Button onClick={() => handleUpdate("repairing")}>Iniciar reparación</Button>
            )}
            {repair.status === "repairing" && (
              <Button onClick={() => handleUpdate("done")}>Completar reparación</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
