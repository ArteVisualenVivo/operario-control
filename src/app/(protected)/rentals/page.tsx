"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SearchInput } from "@/components/ui/SearchInput"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/ui"

export default function RentalsPage() {
  const { machines, loading } = useMachines()
  const router = useRouter()
const [search, setSearch] = useState("")`n  const rentedMachines = useMemo(() => {`n    return machines.filter((m) => {`n      if (!m.rental) return false`n      const q = search.toLowerCase()`n      if (!q) return true`n      return (`n        m.name.toLowerCase().includes(q) ||`n        m.model.toLowerCase().includes(q) ||`n        (m.rental.clientName ?? "").toLowerCase().includes(q) ||`n        (m.rental.projectName ?? "").toLowerCase().includes(q)`n      )`n    })`n  }, [machines, search])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Alquileres activos</h1>
        <Button onClick={() => router.push("/machines")}>Ver mÃƒÂ¡quinas</Button>
      </div>

      <SearchInput`n          value={search}`n          onChange={setSearch}`n          className="max-w-sm mb-4"`n        />`n      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>MÃƒÂ¡quina</TableHead>
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
                {m.rental!.isOpenEnded ? "Ã¢â‚¬â€" : formatDate(m.rental!.expectedEndDate)}
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
