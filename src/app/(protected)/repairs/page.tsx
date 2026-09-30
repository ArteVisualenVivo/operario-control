"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useRepairs } from "@/hooks/useRepairs"
import { Input } from "@/components/ui/input"
import { SearchInput } from "@/components/ui/SearchInput"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/ui"
import { toast } from "sonner"
import { hasMaintenanceLink } from "@/lib/machine-links"
import RepairsTabs, { useRepairsTabNav } from "@/components/repairs/RepairsTabs"
import type { MachineRepair } from "@/types"

// Normaliza la clave de vinculación (externalId/machineId ↔ orderNumber):
// mayúsculas, sin "X " inicial, espacios colapsados. Coincide con la
// normalización usada en src/lib/sync-3c/consolidated.ts.
function normKey(value?: string | null): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/^X\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Mismo vínculo que getRepairsForMaintenanceOrder(): externalId ?? machineId.
function linksToOrder(repair: MachineRepair, orderKey: string): boolean {
  const key = (repair.externalId ?? repair.machineId)?.trim()
  return Boolean(key) && normKey(key) === normKey(orderKey)
}

// N° de orden de 3C. Para reparaciones fuente 3C, externalId (o machineId)
// contiene el número de orden real (ej: "X 0001-00011170"). Para manuales no hay.
function orderNumberFor(repair: MachineRepair): string {
  const v = repair.externalId ?? (repair.source === "3c" ? repair.machineId : "")
  return v ?? ""
}

function daysUntil(date: Date | undefined | null): number | null {
  if (!date) return null
  return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function statusBadge(label: string, days: number | null): string {
  if (days === null) return "bg-muted text-muted-foreground"
  if (days <= 0) return "bg-red-200 text-red-800"
  if (days <= 7) return "bg-amber-200 text-amber-800"
  return "bg-green-200 text-green-800"
}

/** Valor del desplegable de ESTADO cuando NO hay filtro. */
const TODOS_LOS_ESTADOS = "__todos__"

/**
 * Etiqueta de estado que se MUESTRA y se FILTRA en la lista.
 *
 * 1) Órdenes que vienen de 3C: el estado real que informa 3C tal cual
 *    ("Reparada", "Entreg./Factur.", "Retirada", "en Taller", ...). Es el
 *    mismo texto que ya muestra la pestaña "Estado 3C".
 * 2) Reparaciones cargadas a mano (no tienen estado de 3C): el estado propio
 *    de la app, con el sufijo "(cargado a mano)" para no confundirlo con 3C.
 */
function estadoLabel(repair: MachineRepair): string {
  const from3c = (repair.status3c ?? "").trim()
  if (from3c) return from3c
  switch (String(repair.status ?? "").toUpperCase()) {
    case "EN_TALLER":
    case "PENDING":
    case "REPAIRING":
      return "En taller (cargado a mano)"
    case "FINALIZADO":
    case "DONE":
      return "Finalizado (cargado a mano)"
    default:
      return "(sin estado)"
  }
}

export default function RepairsPage() {
  const { repairs, loading, remove } = useRepairs()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Navegación entre las pestañas Taller / Estado 3C (misma pantalla).
  const { gotoEstado3C } = useRepairsTabNav()
  const orderParam = searchParams.get("order")
  const [search, setSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>(TODOS_LOS_ESTADOS)
  // Filtro por orden recibido vía ?order= (botón "Ver reparaciones" en la
  // pestaña Estado 3C). Se inicializa desde el query y el usuario puede limpiarlo.
  const [orderFilter, setOrderFilter] = useState<string | null>(orderParam)

  // ?order= manda: si cambia (por ejemplo al llegar desde "Ver reparaciones" en
  // Estado 3C), el filtro se aplica sin recargar la pantalla.
  useEffect(() => {
    setOrderFilter(orderParam)
  }, [orderParam])

  /** Filas que pasan el buscador, el rango de fechas y el filtro por orden.
   * El filtro de ESTADO se aplica DESPUES (ver `filtered`), para que las
   * opciones del desplegable y su cantidad no cambien al elegir un estado.
   */
  const base = useMemo(() => {
    return repairs.filter((r) => {
      if (orderFilter && !linksToOrder(r, orderFilter)) return false

      const q = search.toLowerCase()
      // Normalización del número de orden (quita prefijo "X", mayúsculas, espacios)
      const qNorm = normKey(q)
      const orderNo = normKey(orderNumberFor(r))
      const matchesOrder = qNorm.length >= 2 && orderNo.length > 0 && orderNo.includes(qNorm)

      const matchesSearch =
        !q ||
        matchesOrder ||
        r.clientName.toLowerCase().includes(q) ||
        r.machineName.toLowerCase().includes(q) ||
        (r.machineModel ?? "").toLowerCase().includes(q) ||
        (r.internalNumber ?? "").toLowerCase().includes(q) ||
        (r.clientNumber ?? "").toLowerCase().includes(q)

      const entry = new Date(r.entryDate)
      const matchesFrom = !dateFrom || entry >= new Date(dateFrom)
      const matchesTo = !dateTo || entry <= new Date(dateTo + "T23:59:59")
      return matchesSearch && matchesFrom && matchesTo
    })
  }, [repairs, search, dateFrom, dateTo, orderFilter])

  /** Opciones del desplegable de ESTADO: solo los estados PRESENTES en lo que
   * se esta viendo, con su cantidad (igual que el filtro de estado del
   * Dashboard: src/components/dashboard/DashboardResults.tsx).
   */
  const estadosDisponibles = useMemo(() => {
    const conteo = new Map<string, number>()
    for (const r of base) {
      const estado = estadoLabel(r)
      conteo.set(estado, (conteo.get(estado) ?? 0) + 1)
    }
    return [...conteo.entries()]
      .map(([estado, cantidad]) => ({ estado, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad || a.estado.localeCompare(b.estado))
  }, [base])

  /** Fila visible: sin filtro = la base completa. */
  const filtered = useMemo(
    () => (statusFilter === TODOS_LOS_ESTADOS ? base : base.filter((r) => estadoLabel(r) === statusFilter)),
    [base, statusFilter],
  )

  const handleDelete = async (id: string, machineName: string) => {
    if (!window.confirm(`Eliminar la reparación de ${machineName}?`)) return
    try {
      await remove(id)
      toast.success("Reparación eliminada")
    } catch {
      toast.error("Error al eliminar")
    }
  }

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  // Contenido de la pestaña "Taller": es la pantalla de siempre, sin cambios.
  // El título y las pestañas (Taller / Estado 3C) los renderiza RepairsTabs.
  const tallerContent = (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => router.push("/repairs/new")}>Nueva reparación</Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <SearchInput
          placeholder="Buscar por orden, cliente o máquina"
          value={search}
          onChange={setSearch}
          className="max-w-sm"
        />

        <div className="flex gap-2 items-center">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(typeof v === "string" ? v : TODOS_LOS_ESTADOS)}
        >
          <SelectTrigger size="sm" className="w-[260px]" aria-label="Filtrar por estado">
            <SelectValue placeholder="Filtrar estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS_LOS_ESTADOS}>{`Todos los estados (${base.length})`}</SelectItem>
            {estadosDisponibles.map((o) => (
              <SelectItem key={o.estado} value={o.estado}>
                {`${o.estado} (${o.cantidad})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {orderFilter && (
        <div className="flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm">
          <span>
            Mostrando reparaciones de la orden <span className="font-mono font-medium">{orderFilter}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOrderFilter(null)
              router.push("/repairs?tab=taller")
            }}
          >
            Ver todas
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>N° Orden</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Máquina</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead>Ingreso</TableHead>
            <TableHead>Egreso</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Mantenimiento</TableHead>
            <TableHead>Acción</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.id} onClick={() => router.push(`/repairs/${r.id}`)}>
              <TableCell className="font-mono text-xs">{orderNumberFor(r) || "—"}</TableCell>
              <TableCell>{r.clientName}</TableCell>
              <TableCell>{r.machineName}</TableCell>
              <TableCell>{r.machineModel}</TableCell>
              <TableCell>{formatDate(r.entryDate)}</TableCell>
              <TableCell>{r.exitDateReal ? formatDate(r.exitDate) : "—"}</TableCell>
              <TableCell>{estadoLabel(r)}</TableCell>
              <TableCell>
                {hasMaintenanceLink(r) ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      const orderKey = r.externalId ?? r.machineId
                      gotoEstado3C(orderKey)
                    }}
                  >
                    Ver orden
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              <TableCell>
                <Button
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(r.id, r.machineName)
                  }}
                >
                  Eliminar
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )

  return <RepairsTabs taller={tallerContent} />
}
