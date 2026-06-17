"use client"

import { useRouter } from "next/navigation"
import { useRepairs } from "@/hooks/useRepairs"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

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

export default function RepairsPage() {
  const { repairs, loading, updateStatus } = useRepairs()
  const { machines } = useMachines()
  const router = useRouter()

  const getMachineName = (machineId: string) => {
    return machines.find((m) => m.id === machineId)?.name ?? machineId
  }

  const formatDate = (d: Date | null) => {
    if (!d) return "—"
    return new Date(d).toLocaleDateString("es-ES")
  }

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reparaciones</h1>
        <Button onClick={() => router.push("/repairs/new")}>Nueva reparación</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Máquina</TableHead>
            <TableHead>Problema</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Retorno estimado</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {repairs.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{getMachineName(r.machineId)}</TableCell>
              <TableCell className="max-w-xs truncate">{r.issue}</TableCell>
              <TableCell>
                <Badge variant={statusVariants[r.status]}>{statusLabels[r.status]}</Badge>
              </TableCell>
              <TableCell>{formatDate(r.estimatedReturn)}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {r.status === "pending" && (
                    <Button variant="outline" size="sm" onClick={() => updateStatus(r.id, "repairing")}>
                      Iniciar
                    </Button>
                  )}
                  {r.status === "repairing" && (
                    <Button variant="outline" size="sm" onClick={() => updateStatus(r.id, "done")}>
                      Completar
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => router.push(`/repairs/${r.id}`)}>
                    Ver
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {repairs.length === 0 && (
        <p className="text-center text-muted-foreground">No hay reparaciones registradas</p>
      )}
    </div>
  )
}
