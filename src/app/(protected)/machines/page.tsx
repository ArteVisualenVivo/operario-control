"use client"

import { useState, useMemo } from "react"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { SearchInput } from "@/components/ui/SearchInput"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

// Familias de 3C que corresponden a MÁQUINAS.
// Ajustar esta lista si 3C agrega o renombra familias.
const MACHINE_FAMILIAS = [
  "MAQUINAS",
  "GRUPO ELECTROGENO",
  "MOTOBOMBA",
  "HORMIGONERA",
  "PISON CANGURO",
  "PLACA VIBRADORA",
  "SOLDADORAS",
  "ALLANADORA",
  "PULIDORA DE PARQUET",
  "PULIDORA DE GRANITO",
  "AMOLADORA 230-180-110",
  "DESMALEZADORA",
  "PODADORAS",
  "ELECTROGUINCHE",
  "MOTOSIERRA",
  "REGLA VIBRADORA",
  "MOTOHOYADORA",
  "HIDROLAVADORA",
  "ASERRADORA",
  "MOTOGUADAÑAS",
]

const norm = (s: string) => s.toUpperCase().trim().replace(/\s+/g, " ")

export default function MachinesPage() {
  const { items, loading } = useInventoryStock()
  const [search, setSearch] = useState("")

  const machines = useMemo(() => {
    const familias = new Set(MACHINE_FAMILIAS.map(norm))
    return items
      .filter((item) => familias.has(norm(item.category ?? "")))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [items])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return machines
    return machines.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      (m.codigo ?? "").toLowerCase().includes(q) ||
      (m.category ?? "").toLowerCase().includes(q)
    )
  }, [machines, search])

  const totalUnidades = filtered.reduce((sum, m) => sum + m.stockTotal, 0)
  const totalDisponibles = filtered.reduce((sum, m) => sum + m.stockAvailable, 0)

  if (loading) return <p className="text-muted-foreground">Cargando máquinas...</p>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Máquinas</h1>
        <p className="text-sm text-muted-foreground">
          Máquinas según el último Excel de 3C · {machines.length} tipos · {totalUnidades} unidades totales
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Tipos de máquina</p>
          <p className="text-3xl font-bold">{machines.length}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Unidades totales</p>
          <p className="text-3xl font-bold">{totalUnidades}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Unidades disponibles</p>
          <p className="text-3xl font-bold text-green-600">{totalDisponibles}</p>
        </div>
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar por nombre, código o familia..."
        className="max-w-sm"
      />

      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground">
          No se encontraron máquinas. Sincronizá Stock desde el Dashboard para traer los datos de 3C.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Familia</TableHead>
                <TableHead className="text-right">Stock (3C)</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">{m.codigo ?? "—"}</TableCell>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{m.category}</TableCell>
                  <TableCell className={`text-right font-bold ${m.stockTotal < 0 ? "text-red-600" : ""}`}>
                    {m.stockTotal}
                  </TableCell>
                  <TableCell className={`text-right ${m.stockAvailable < 0 ? "text-red-600" : "text-green-600"}`}>
                    {m.stockAvailable}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}