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
import type { MaintenanceRecord } from "@/services/maintenance"

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

/** Valor del desplegable de CLIENTE cuando NO se excluye nada. */
const TODOS_LOS_CLIENTES = "__todos_clientes__"

/**
 * Normaliza el nombre de cliente para comparar (mayúsculas, espacios simples).
 * "COCREAR (100)" y "  cocrear (100) " quedan iguales.
 */
function normClient(value?: string | null): string {
  return (value ?? "").toUpperCase().replace(/\s+/g, " ").trim()
}

/**
 * Grupos rápidos del desplegable de ESTADO: combinan varios estados de 3C en
 * una sola opción (ej: "Reparada/Retirada" muestra las reparadas Y las
 * retiradas juntas). Son atajos sobre los mismos estados, no cambian datos.
 */
const ESTADO_GROUPS: { key: string; label: string; match: RegExp }[] = [
  { key: "__grupo_reparada_retirada__", label: "Reparada/Retirada", match: /reparada/i },
]

/** Valor del desplegable de ESTADO cuando NO hay filtro. */
const TODOS_LOS_ESTADOS = "__todos__"

/**
 * ¿La reparación pasa el filtro de ESTADO? Vale para un estado puntual
 * ("Reparada") o para un grupo ("Reparada/Retirada" = cualquiera de los dos).
 */
function matchesEstado(repair: MachineRepair, filter: string): boolean {
  if (filter === TODOS_LOS_ESTADOS) return true
  const label = estadoLabel(repair)
  const group = ESTADO_GROUPS.find((g) => g.key === filter)
  if (group) return group.match.test(label)
  return label === filter
}

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



/**
 * Facturación de 3C por orden: ¿tiene fila "Entreg./Factur." en su línea de
 * tiempo (states) y con qué fecha? En 3C la factura es UN ESTADO MÁS de la
 * orden ("Entreg./Factur."), no un campo aparte, así que "No facturada" =
 * la orden no tiene esa fila en todo su historial.
 *
 * La fecha es `observedAt` (cuándo el sync vio ese estado = fecha real de
 * facturación, a precisión de la frecuencia de sync). Ver NOTA DE FECHAS en
 * src/lib/sync-3c/consolidated.ts.
 */
function facturaInfo(
  orderNumber: string,
  byOrder: Map<string, MaintenanceRecord>,
): { facturada: boolean; facturaDate: Date | null } {
  const key = normKey(orderNumber)
  if (!key) return { facturada: false, facturaDate: null }
  const rec = byOrder.get(key)
  const states = rec?.states ?? []
  let fecha: Date | null = null
  for (const s of states) {
    if (!/factur/i.test(String(s.status ?? ""))) continue
    const raw = s.statusDate ? new Date(s.statusDate) : null
    const d = raw && !Number.isNaN(raw.getTime()) ? raw : null
    if (d && (!fecha || d.getTime() > fecha.getTime())) fecha = d
  }
  if (fecha) return { facturada: true, facturaDate: fecha }
  // Sin línea de tiempo (orden manual): el estado actual es lo único que hay.
  const current = (rec?.status ?? "").trim()
  if (/factur/i.test(current)) {
    const raw = rec?.statusDate ? new Date(rec.statusDate) : null
    const d = raw && !Number.isNaN(raw.getTime()) ? raw : null
    return { facturada: true, facturaDate: d }
  }
  return { facturada: false, facturaDate: null }
}

/**
 * Fecha de facturación de 3C por orden (la fecha de la fila "Entreg./Factur.").
 * Es `observedAt`: cuándo el sync vio ese estado = fecha real de facturación,
 * a precisión de la frecuencia de sync. null si no está facturada.
 */
/** Valor del desplegable de FACTURACIÓN cuando NO hay filtro. */
const TODAS_FACTURACION = "__todas__"

type FacturaFilter = typeof TODAS_FACTURACION | "facturada" | "nofacturada"

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
  // Filtro de facturación: "No facturada" = sin fila "Entreg./Factur." en la
  // línea de tiempo de 3C. Por defecto muestra todo (no cambia lo actual).
  const [facturaFilter, setFacturaFilter] = useState<FacturaFilter>(TODAS_FACTURACION)
  // Cliente a EXCLUIR de la lista/impresión (ej: COCREAR (100), máquinas de la
  // empresa). Por defecto no se excluye nada. Es exclusión, no filtro: todo lo
  // demás sigue apareciendo igual.
  const [excludeClient, setExcludeClient] = useState<string>(TODOS_LOS_CLIENTES)
  // Línea de tiempo de 3C por orden (para el filtro de facturación y su fecha).
  // Misma fuente que la pestaña "Estado 3C" (Redis/Firestore vía local-sync).
  const [maintByOrder, setMaintByOrder] = useState<Map<string, MaintenanceRecord>>(new Map())

  useEffect(() => {
    let cancelled = false
    import("@/lib/local-sync").then(async ({ loadMaintenanceRecords }) => {
      try {
        const records = await loadMaintenanceRecords()
        if (cancelled) return
        const map = new Map<string, MaintenanceRecord>()
        for (const rec of records) {
          const key = normKey(rec.orderNumber)
          if (key && !map.has(key)) map.set(key, rec)
        }
        if (!cancelled) setMaintByOrder(map)
      } catch {
        // Sin línea de tiempo: el filtro de facturación usa solo el estado actual.
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
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

  /** Fila visible: sin filtros = la base completa. */
  const filtered = useMemo(
    () =>
      (
        statusFilter === TODOS_LOS_ESTADOS ? base : base.filter((r) => matchesEstado(r, statusFilter))
      )
        .filter((r) => {
          if (facturaFilter === TODAS_FACTURACION) return true
          const info = facturaInfo(orderNumberFor(r), maintByOrder)
          return facturaFilter === "facturada" ? info.facturada : !info.facturada
        })
        // Exclusión de cliente (ej: COCREAR): se aplica DESPUÉS, para que las
        // opciones y conteos de los otros desplegables no cambien al excluir.
        .filter((r) => excludeClient === TODOS_LOS_CLIENTES || normClient(r.clientName) !== excludeClient),
    [base, statusFilter, facturaFilter, maintByOrder, excludeClient],
  )

  /** Clientes PRESENTES en lo que se está viendo, con su cantidad. */
  const clientesDisponibles = useMemo(() => {
    const conteo = new Map<string, { label: string; cantidad: number }>()
    for (const r of base) {
      const key = normClient(r.clientName)
      if (!key) continue
      const prev = conteo.get(key)
      if (prev) prev.cantidad += 1
      else conteo.set(key, { label: (r.clientName ?? "").trim() || key, cantidad: 1 })
    }
    return [...conteo.entries()]
      .map(([key, v]) => ({ key, label: v.label, cantidad: v.cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad || a.label.localeCompare(b.label))
  }, [base])

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
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button onClick={() => router.push("/repairs/new")}>Nueva reparación</Button>
        <Button variant="outline" onClick={() => window.print()} disabled={filtered.length === 0}>
          {`Imprimir (${filtered.length})`}
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end print:hidden">
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
            {ESTADO_GROUPS.map((g) => {
              const cantidad = base.filter((r) => g.match.test(estadoLabel(r))).length
              return (
                <SelectItem key={g.key} value={g.key}>
                  {`${g.label} (${cantidad})`}
                </SelectItem>
              )
            })}
            {estadosDisponibles.map((o) => (
              <SelectItem key={o.estado} value={o.estado}>
                {`${o.estado} (${o.cantidad})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={facturaFilter}
          onValueChange={(v) => setFacturaFilter(v === "facturada" || v === "nofacturada" ? v : TODAS_FACTURACION)}
        >
          <SelectTrigger size="sm" className="w-[220px]" aria-label="Filtrar por facturación">
            <SelectValue placeholder="Filtrar facturación" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS_FACTURACION}>{`Todas (${base.length})`}</SelectItem>
            <SelectItem value="facturada">Facturada</SelectItem>
            <SelectItem value="nofacturada">No facturada</SelectItem>
          </SelectContent>
        </Select>

        <Select value={excludeClient} onValueChange={(v) => setExcludeClient(typeof v === "string" ? v : TODOS_LOS_CLIENTES)}>
          <SelectTrigger size="sm" className="w-[260px]" aria-label="Excluir cliente">
            <SelectValue placeholder="Excluir cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS_LOS_CLIENTES}>Sin excluir (todos)</SelectItem>
            {clientesDisponibles.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {`Excluir: ${c.label} (${c.cantidad})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {orderFilter && (
        <div className="flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm print:hidden">
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

      {/* Encabezado SOLO de impresión: qué filtros se usaron. */}
      <div className="hidden print:block">
        <h2 className="text-lg font-bold">Reparaciones</h2>
        <p className="text-sm">
          {[
            statusFilter === TODOS_LOS_ESTADOS
              ? "Todos los estados"
              : `Estado: ${ESTADO_GROUPS.find((g) => g.key === statusFilter)?.label ?? statusFilter}`,
            facturaFilter === TODAS_FACTURACION
              ? "Todas (facturadas y no facturadas)"
              : facturaFilter === "facturada"
                ? "Solo facturadas"
                : "Solo no facturadas",
            search.trim() ? `Búsqueda: ${search.trim()}` : null,
            dateFrom ? `Desde: ${dateFrom}` : null,
            dateTo ? `Hasta: ${dateTo}` : null,
            orderFilter ? `Orden: ${orderFilter}` : null,
            excludeClient !== TODOS_LOS_CLIENTES
              ? `Sin: ${clientesDisponibles.find((c) => c.key === excludeClient)?.label ?? excludeClient}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          {` — ${filtered.length} ${filtered.length === 1 ? "orden" : "órdenes"}`}
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>N° Orden</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Máquina</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead>Ingreso</TableHead>
            <TableHead>Egreso</TableHead>
            <TableHead>Facturada</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="print:hidden">Mantenimiento</TableHead>
            <TableHead className="print:hidden">Acción</TableHead>
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
              <TableCell>
                {(() => {
                  const info = facturaInfo(orderNumberFor(r), maintByOrder)
                  return info.facturada && info.facturaDate ? formatDate(info.facturaDate) : "—"
                })()}
              </TableCell>
              <TableCell>{estadoLabel(r)}</TableCell>
              <TableCell className="print:hidden">
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

              <TableCell className="print:hidden">
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
