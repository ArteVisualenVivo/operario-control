"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { loadScaffoldRentalStats, type ScaffoldRentalStats } from "@/lib/dashboardStats"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SearchInput } from "@/components/ui/SearchInput"
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/ui"

export default function RentalsPage() {
  const { machines, loading } = useMachines()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [scaffold, setScaffold] = useState<ScaffoldRentalStats | null>(null)
  const [scaffoldLoading, setScaffoldLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadScaffoldRentalStats()
      .then((s) => { if (!cancelled) setScaffold(s) })
      .catch(() => { if (!cancelled) setScaffold(null) })
      .finally(() => { if (!cancelled) setScaffoldLoading(false) })
    return () => { cancelled = true }
  }, [])

  const rentedMachines = useMemo(() => {
    return machines.filter((m) => {
      if (!m.rental) return false
      const q = search.toLowerCase()
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        (m.rental.clientName ?? "").toLowerCase().includes(q) ||
        (m.rental.projectName ?? "").toLowerCase().includes(q)
      )
    })
  }, [machines, search])

  // Alquileres de andamios según 3C (Excel de alquileres pendientes)
  const scaffoldDetail = useMemo(() => {
    const detail = scaffold?.detalle ?? []
    const q = search.toLowerCase()
    if (!q) return detail
    return detail.filter((d) =>
      d.descripcion.toLowerCase().includes(q) ||
      (d.cliente ?? "").toLowerCase().includes(q) ||
      (d.clienteId ?? "").toLowerCase().includes(q) ||
      d.remito.toLowerCase().includes(q) ||
      d.codigo.toLowerCase().includes(q)
    )
  }, [scaffold, search])

  const cuerposAlquilados = scaffold?.cuerposAlquilados ?? 0

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Alquileres activos</h1>
        <Button onClick={() => router.push("/machines")}>Ver máquinas</Button>
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        className="max-w-sm mb-4"
      />

      {/* ============================================================
          ANDAMIOS ALQUILADOS (desde 3C — Excel de alquileres pendientes)
          ============================================================ */}
      <Card className="border-2 border-amber-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold">
            🚧 Andamios y materiales alquilados (según 3C)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Cuerpos alquilados: <span className="font-bold text-amber-700">{cuerposAlquilados}</span>
            {scaffold?.fechaSync && (
              <> · Última sincronización: {formatDate(new Date(scaffold.fechaSync))}</>
            )}
          </p>
        </CardHeader>
        <CardContent>
          {scaffoldLoading ? (
            <p className="text-sm text-muted-foreground">Cargando alquileres de 3C...</p>
          ) : scaffoldDetail.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay alquileres de andamios pendientes según 3C.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Remito</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Devolución</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scaffoldDetail.map((d, i) => (
                  <TableRow key={`${d.remito}-${d.codigo}-${i}`}>
                    <TableCell className="font-mono text-xs">{d.codigo}</TableCell>
                    <TableCell className="max-w-xs truncate" title={d.descripcion}>
                      {d.descripcion}
                    </TableCell>
                    <TableCell className="font-bold">{d.cantidad}</TableCell>
                    <TableCell>
                      {d.cliente || d.clienteId || "—"}
                      {d.cliente && d.clienteId ? (
                        <span className="text-xs text-muted-foreground"> ({d.clienteId})</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.remito || "—"}</TableCell>
                    <TableCell>{d.fecha || "—"}</TableCell>
                    <TableCell>
                      {d.devolucion ? (
                        <Badge variant="outline" className="text-green-700 border-green-300">
                          {d.devolucion}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold">Máquinas alquiladas</h2>
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
