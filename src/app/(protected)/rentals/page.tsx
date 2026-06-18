"use client"

import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/ui"

export default function RentalsPage() {
  const { machines, loading } = useMachines()
  const router = useRouter()
  const rentedMachines = machines.filter((m) => m.rental)

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Alquileres activos</h1>
        <Button onClick={() => router.push("/machines")}>Ver máquinas</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Máquina</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Obra</TableHead>
            <TableHead>Inicio</TableHead>
            <TableHead>Retorno estimado</TableHead>
            <TableHead>Plazo</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rentedMachines.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">{m.name}</TableCell>
              <TableCell>{m.rental!.clientName}</TableCell>
              <TableCell>{m.rental!.projectName}</TableCell>
              <TableCell>{formatDate(m.rental!.startDate)}</TableCell>
              <TableCell>
                {m.rental!.isOpenEnded ? "—" : formatDate(m.rental!.expectedEndDate)}
              </TableCell>
              <TableCell>
                {m.rental!.isOpenEnded && (
                  <Badge variant="outline" className="text-blue-600 border-blue-300">Abierto</Badge>
                )}
              </TableCell>
              <TableCell>
                <Button variant="outline" size="sm" onClick={() => router.push(`/machines/${m.id}`)}>
                  Ver
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {rentedMachines.length === 0 && (
        <p className="text-center text-muted-foreground">No hay alquileres activos</p>
      )}
    </div>
  )
}
