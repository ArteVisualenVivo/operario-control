"use client"

import { useRouter } from "next/navigation"
import { useRentals } from "@/hooks/useRentals"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

export default function RentalsPage() {
  const { rentals, loading, close } = useRentals()
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
        <h1 className="text-2xl font-bold">Alquileres</h1>
        <Button onClick={() => router.push("/rentals/new")}>Nuevo alquiler</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Máquina</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Inicio</TableHead>
            <TableHead>Retorno</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rentals.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{getMachineName(r.machineId)}</TableCell>
              <TableCell>{r.client}</TableCell>
              <TableCell>{formatDate(r.startDate)}</TableCell>
              <TableCell>{formatDate(r.returnDate)}</TableCell>
              <TableCell>
                <Badge variant={r.status === "active" ? "default" : "outline"}>
                  {r.status === "active" ? "Activo" : "Cerrado"}
                </Badge>
              </TableCell>
              <TableCell>
                {r.status === "active" && (
                  <Button variant="outline" size="sm" onClick={() => close(r.id)}>
                    Cerrar
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {rentals.length === 0 && (
        <p className="text-center text-muted-foreground">No hay alquileres registrados</p>
      )}
    </div>
  )
}
