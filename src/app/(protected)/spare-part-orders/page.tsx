"use client"

import { useState, useMemo, useEffect, useRef, Fragment } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/SearchInput"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAllSparePartOrders } from "@/hooks/useAllSparePartOrders"
import { importPendingPartsFromMaintenance } from "@/services/sparePartOrders"
import { SparePartOrderBadge } from "@/components/repairs/SparePartOrderBadge"
import { SparePartOrderOrderedDialog } from "@/components/repairs/SparePartOrderOrderedDialog"
import { SparePartOrderReceiveUseDialog } from "@/components/repairs/SparePartOrderReceiveUseDialog"
import { SparePartOrderDatesEditor } from "@/components/repairs/SparePartOrderDatesEditor"
import { SparePartOrderCodeInput } from "@/components/repairs/SparePartOrderCodeInput"
import { formatDate } from "@/lib/ui"
import { groupOrdersByRealNumber, fullMachineIdentification, type SparePartOrderGroup } from "@/lib/sparePartOrderGroups"
import { buildMaintenanceByOrder, getOrderClosure, normOrderKey } from "@/lib/orderClosure"
import type { MaintenanceRecord } from "@/services/maintenance"
import { toast } from "sonner"
import type { SparePartOrderStatus, SparePartOrder } from "@/types"

type Filter = "todos" | SparePartOrderStatus | "pendientes" | "encargados" | "recibidos-sin-usar" | "parciales" | "atrasados" | "utilizados"

// Timestamp capturado a nivel de módulo (no durante el render) para los cálculos de "atrasos".
const MODULE_LOAD_TS = Date.now()

// --- buscador GLOBAL: un solo texto matchea repuesto/código + orden/máquina + cliente ---
// Orden: texto completo o últimos dígitos (ej. "11271" → "X 0001-00011271").
// Cliente: viene del cruce con 3C (maintenanceByOrder), no del pedido.
function extractOrderNumber(orderNumber: string | null | undefined): string {
  if (!orderNumber) return ""
  const matches = orderNumber.match(/\d+/g)
  return matches && matches.length > 0 ? matches[matches.length - 1] : ""
}

function normQuery(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

export default function SparePartOrdersPage() {
  const router = useRouter()
  const { orders, loading, reload, markAsOrdered, remove, markAsReceived, markAsUsed, updateDates, updateCode } = useAllSparePartOrders()
  const [filter, setFilter] = useState<Filter>("todos")
  const [query, setQuery] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [orderedTarget, setOrderedTarget] = useState<SparePartOrder | null>(null)
  // Entrega/uso con cantidad directamente desde esta pantalla (mismo diálogo
  // que usa la ficha de la reparación).
  const [action, setAction] = useState<{ type: "receive" | "use"; order: SparePartOrder } | null>(null)
  // Selección por N° DE ORDEN, no por repuesto: tildar una orden selecciona TODOS
  // sus repuestos y cuenta como UNA sola (que es la cantidad de máquinas para las
  // que hay que comprar). La clave es la del grupo (ver groupOrdersByRealNumber).
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  // Ocultar por defecto los pedidos cuya orden en 3C ya se cerro (Reparada /
  // Entregada / Retirada / No Reparada), mirando fecha + estado. El toggle
  // los vuelve a mostrar sin borrar historial.
  const [showClosed, setShowClosed] = useState(false)
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([])

  const handleDeleteOne = async (id: string) => {
    if (!window.confirm("¿Eliminar este pedido? Esta acción no se puede deshacer.")) return
    setDeleting(true)
    try {
      await remove([id])
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Error al eliminar")
    } finally {
      setDeleting(false)
    }
  }

  const handleMarkOrdered = async (orderedAt: Date, expectedAt: Date | null, notes?: string) => {
    if (!orderedTarget) return
    await markAsOrdered(orderedTarget.id, { orderedAt, expectedAt, notes })
    setOrderedTarget(null)
  }

  const handleAction = async (orderId: string, quantity: number, date: Date, notes?: string) => {
    if (!action) return
    if (action.type === "receive") {
      await markAsReceived(orderId, quantity, date, notes)
    } else {
      await markAsUsed(orderId, quantity, date, notes)
    }
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const res = await importPendingPartsFromMaintenance()
      toast.success(
        `Importados ${res.created} repuesto(s) en espera${res.skippedExisting > 0 ? ` · ${res.skippedExisting} ya existían` : ""}${res.datesRepaired > 0 ? ` · ${res.datesRepaired} fecha(s) reparada(s)` : ""}`,
      )
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al importar repuestos en espera")
    } finally {
      setImporting(false)
    }
  }

  // Auto-importa los repuestos en espera que vienen del 3C al cargar la
  // pantalla. Es idempotente: no duplica pedidos ya existentes (orden +
  // repuesto). Solo corre una vez por montaje.
  const autoImportRan = useRef(false)
  useEffect(() => {
    if (autoImportRan.current) return
    autoImportRan.current = true
    importPendingPartsFromMaintenance()
      .then((res) => {
        // También recarga si se repararon fechas pisadas: el listado y el filtro
        // por fechas cambian sin que se haya creado un pedido nuevo.
        if (res.created > 0 || res.datesRepaired > 0) void reload()
      })
      .catch(() => {
        /* silencioso en montaje: ya existe el botón manual */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Rango rápido "Hoy": deja los dos campos con el día de HOY (`YYYY-MM-DD`, el
   * formato del `<input type="date">`). Sirve para trabajar/imprimir sólo con los
   * pedidos que aparecieron hoy, sin volver a ver los de días anteriores.
   */
  const setTodayRange = () => {
    const d = new Date()
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    setDateFrom(iso)
    setDateTo(iso)
  }

  const daysOld = (d: Date | null): number => {
    if (!d) return 0
    return Math.floor((MODULE_LOAD_TS - new Date(d).getTime()) / (1000 * 60 * 60 * 24))
  }

  // Linea de tiempo de 3C por orden (misma fuente primaria que el resto de la
  // web: Redis snapshot -> Firestore). Sin datos no se oculta nada.
  useEffect(() => {
    let cancelled = false
    import("@/lib/local-sync").then(async ({ loadMaintenanceRecords }) => {
      try {
        const records = await loadMaintenanceRecords()
        if (!cancelled) setMaintenance(records)
      } catch {
        if (!cancelled) setMaintenance([])
      }
    })
    return () => { cancelled = true }
  }, [])

  const maintenanceByOrder = useMemo(() => buildMaintenanceByOrder(maintenance), [maintenance])

  const closureById = useMemo(() => {
    const map = new Map<string, { closed: boolean; label: string | null }>()
    for (const o of orders) {
      const rec = maintenanceByOrder.get(normOrderKey(o.orderNumber))
      const info = getOrderClosure(o, rec ?? null)
      map.set(o.id, {
        closed: info.closed,
        label: info.closed && info.terminalStatus
          ? `${info.terminalStatus}${info.terminalDate ? ` ${info.terminalDate.toLocaleDateString("es-AR")}` : ""}`
          : null,
      })
    }
    return map
  }, [orders, maintenanceByOrder])

  const closedHiddenCount = useMemo(
    () => orders.filter((o) => closureById.get(o.id)?.closed).length,
    [orders, closureById],
  )

  const matchesFilter = (o: (typeof orders)[number]): boolean => {
    switch (filter) {
      case "todos":
        return true
      case "SOLICITADO":
      case "PEDIDO":
      case "ENCARGADO":
      case "RECIBIDO":
      case "UTILIZADO":
      case "CANCELADO":
        return o.status === filter
      case "pendientes":
        return o.status === "SOLICITADO" || o.status === "PEDIDO"
      case "encargados":
        return o.status === "ENCARGADO"
      case "recibidos-sin-usar":
        return o.status === "RECIBIDO"
      case "utilizados":
        return o.status === "UTILIZADO"
      case "parciales":
        return o.status === "SOLICITADO" || o.status === "PEDIDO" || o.status === "RECIBIDO"
      case "atrasados":
        return (o.status === "SOLICITADO" || o.status === "PEDIDO") && daysOld(o.requestedAt) > 7
      default:
        return true
    }
  }

  const visible = useMemo(() => {
    const q = normQuery(query)
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null
    const to = dateTo ? new Date(dateTo + "T23:59:59") : null
    return orders
      .filter(matchesFilter)
      .filter((o) => showClosed || !closureById.get(o.id)?.closed)
      .filter((o) => {
        if (q) {
          const rec = maintenanceByOrder.get(normOrderKey(o.orderNumber))
          const hay = [
            o.description,
            o.code,
            o.orderNumber,
            extractOrderNumber(o.orderNumber),
            o.machineName,
            o.machineModel ?? "",
            rec?.clientName ?? "",
            rec?.clientCode ?? "",
          ].map(normQuery)
          if (!hay.some((h) => h.includes(q))) return false
        }
        const matchesDates =
          (!from || (o.requestedAt && new Date(o.requestedAt) >= from)) &&
          (!to || (o.requestedAt && new Date(o.requestedAt) <= to))
        return matchesDates
      })
  }, [orders, query, dateFrom, dateTo, matchesFilter, closureById, showClosed, maintenanceByOrder])

  const counts = useMemo(() => {
    const pendientes = orders.filter((o) => o.status === "SOLICITADO" || o.status === "PEDIDO").length
    const encargados = orders.filter((o) => o.status === "ENCARGADO").length
    const recibidosSinUsar = orders.filter((o) => o.status === "RECIBIDO").length
    const parciales = orders.filter((o) => (o.status === "SOLICITADO" || o.status === "PEDIDO" || o.status === "RECIBIDO") && (o.quantityReceived < o.quantityRequested || (o.quantityUsed > 0 && o.quantityUsed < o.quantityReceived))).length
    const atrasados = orders.filter((o) => (o.status === "SOLICITADO" || o.status === "PEDIDO") && daysOld(o.requestedAt) > 7).length
    const utilizados = orders.filter((o) => o.status === "UTILIZADO").length
    const cancelados = orders.filter((o) => o.status === "CANCELADO").length
    return { pendientes, encargados, recibidosSinUsar, parciales, atrasados, utilizados, cancelados, total: orders.length }
  }, [orders])

  // Agrupamiento SOLO de presentación: una fila visual por N° DE ORDEN real (los
  // repuestos de una misma orden van juntos y cuentan como UNA sola orden, que es
  // lo que se necesita para saber a cuántas máquinas hay que comprarles).
  // No altera los registros originales ni los datos que vienen de la fuente.
  const groups = useMemo(() => groupOrdersByRealNumber(visible), [visible])

  const toggleSelectOrder = (orderKey: string) => {
    setSelectedOrders((prev) => {
      const next = new Set(prev)
      if (next.has(orderKey)) next.delete(orderKey)
      else next.add(orderKey)
      return next
    })
  }

  /** ids de TODOS los repuestos de las órdenes tildadas (para eliminar). */
  const selectedPartIds = (gs: SparePartOrderGroup[]): string[] =>
    gs.filter((g) => selectedOrders.has(g.key)).flatMap((g) => g.ids)

  const handleDeleteSelected = async () => {
    if (selectedOrders.size === 0) return
    // Se eliminan TODOS los repuestos de las órdenes tildadas (la orden completa).
    const ids = selectedPartIds(groups)
    if (ids.length === 0) return
    if (!window.confirm(`¿Eliminar ${ids.length} pedido(s) de ${selectedOrders.size} orden(es)? Esta acción no se puede deshacer.`)) return
    setDeleting(true)
    try {
      await remove(ids)
      setSelectedOrders(new Set())
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Error al eliminar")
    } finally {
      setDeleting(false)
    }
  }

  /**
   * Órdenes que van a la HOJA DE COMPRA cuando se aprieta "🖨️ Lista de compra".
   *
   * POR QUÉ EXISTE (reporte del dueño, 30/09/2026: "selecciono 2 órdenes y en la
   * pantalla de imprimir me aparecen todas"): el botón abría la hoja completa sin
   * pasarle nada, así que la hoja ignoraba el filtro por fechas, el buscador y la
   * selección.
   *
   * Ahora se imprimen SÓLO los pedidos que están en pantalla: lo TILDADO manda; si
   * no hay nada tildado, se imprime lo que dejó el filtro (fechas + buscador +
   * estado + "Ver finalizadas").
   */
  const printTargets = useMemo(
    () => (selectedOrders.size > 0 ? groups.filter((g) => selectedOrders.has(g.key)) : groups),
    [groups, selectedOrders],
  )

  /**
   * Abre la hoja de compra con los pedidos de `printTargets`, identificados por su
   * id de documento (uno por repuesto). La hoja vuelve a agrupar por N° de orden,
   * así que muestra exactamente los mismos repuestos que esta tabla.
   *
   * El parámetro va SIEMPRE, aunque quede vacío: vacío = "no hay nada que
   * imprimir". Si no se mandara, la hoja caería en su modo histórico (todas), que
   * es justo lo que se quiere evitar cuando el filtro no devuelve nada.
   */
  const handlePrintList = () => {
    const ids = [...new Set(printTargets.flatMap((g) => g.ids))]
    router.push(`/spare-part-orders/print?orders=${ids.map(encodeURIComponent).join(",")}`)
  }

  if (loading) return <p className="text-muted-foreground">Cargando pedidos...</p>

  return (
<div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Pedidos de Repuestos</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={handleImport} disabled={importing}>
            {importing ? "Importando..." : "📥 Importar repuestos en espera (3C)"}
          </Button>
          <Button
            variant="outline"
            onClick={handlePrintList}
            disabled={printTargets.length === 0}
            title={printTargets.length < groups.length
              ? `Imprime sólo las ${printTargets.length} orden(es) que se están viendo (no todo el sistema)`
              : "Imprime todas las orden(es) que están en pantalla"}
          >
            🖨️ Lista de compra
          </Button>
        </div>
      </div>

      {/* Resumen semanal (clic para filtrar) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-7">
        <Card onClick={() => setFilter("todos")} className={filter === "todos" ? "ring-2 ring-ring cursor-pointer" : "cursor-pointer"}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{counts.total}</p></CardContent>
        </Card>
        <Card onClick={() => setFilter("pendientes")} className={filter === "pendientes" ? "ring-2 ring-ring cursor-pointer" : "cursor-pointer"}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pendientes</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-amber-600">{counts.pendientes}</p></CardContent>
        </Card>
        <Card onClick={() => setFilter("encargados")} className={filter === "encargados" ? "ring-2 ring-ring cursor-pointer" : "cursor-pointer"}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Encargados</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-purple-600">{counts.encargados}</p></CardContent>
        </Card>
        <Card onClick={() => setFilter("recibidos-sin-usar")} className={filter === "recibidos-sin-usar" ? "ring-2 ring-ring cursor-pointer" : "cursor-pointer"}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Recibidos sin usar</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-blue-600">{counts.recibidosSinUsar}</p></CardContent>
        </Card>
        <Card onClick={() => setFilter("parciales")} className={filter === "parciales" ? "ring-2 ring-ring cursor-pointer" : "cursor-pointer"}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Parciales</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-violet-600">{counts.parciales}</p></CardContent>
        </Card>
        <Card onClick={() => setFilter("atrasados")} className={filter === "atrasados" ? "ring-2 ring-ring cursor-pointer" : "cursor-pointer"}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Atrasados</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-red-600">{counts.atrasados}</p></CardContent>
        </Card>
        <Card onClick={() => setFilter("utilizados")} className={filter === "utilizados" ? "ring-2 ring-ring cursor-pointer" : "cursor-pointer"}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Utilizados</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-green-600">{counts.utilizados}</p></CardContent>
        </Card>
      </div>

      {closedHiddenCount > 0 && !showClosed && (
        <p className="text-xs text-muted-foreground">
          {closedHiddenCount} pedido(s) de órdenes ya cerradas en 3C (reparada / entregada / retirada / no reparada) oculto(s). Activá “Ver finalizadas” para verlos.
        </p>
      )}

      {/* Filtros por estado */}
      <div className="flex gap-1 flex-wrap items-center">
        <Button size="sm" variant={filter === "todos" ? "default" : "outline"} onClick={() => setFilter("todos")}>Todos</Button>
        <Button size="sm" variant={filter === "pendientes" ? "default" : "outline"} onClick={() => setFilter("pendientes")}>Pendientes</Button>
        <Button size="sm" variant={filter === "encargados" ? "default" : "outline"} onClick={() => setFilter("encargados")}>Encargados</Button>
        <Button size="sm" variant={filter === "recibidos-sin-usar" ? "default" : "outline"} onClick={() => setFilter("recibidos-sin-usar")}>Recibidos sin usar</Button>
        <Button size="sm" variant={filter === "parciales" ? "default" : "outline"} onClick={() => setFilter("parciales")}>Parciales</Button>
        <Button size="sm" variant={filter === "SOLICITADO" ? "default" : "outline"} onClick={() => setFilter("SOLICITADO")}>Solicitados</Button>
        <Button size="sm" variant={filter === "PEDIDO" ? "default" : "outline"} onClick={() => setFilter("PEDIDO")}>Pedidos</Button>
        <Button size="sm" variant={filter === "ENCARGADO" ? "default" : "outline"} onClick={() => setFilter("ENCARGADO")}>Encargados</Button>
        <Button size="sm" variant={filter === "RECIBIDO" ? "default" : "outline"} onClick={() => setFilter("RECIBIDO")}>Recibidos</Button>
        <Button size="sm" variant={filter === "UTILIZADO" ? "default" : "outline"} onClick={() => setFilter("UTILIZADO")}>Utilizados</Button>
        <Button size="sm" variant={filter === "CANCELADO" ? "default" : "outline"} onClick={() => setFilter("CANCELADO")}>Cancelados</Button>
        <label className="ml-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Ver finalizadas
        </label>
      </div>

      {/* Buscador global + fechas.
          El rango filtra por FECHA DEL PEDIDO (el día en que 3C informó "A la
          Espera Repuestos" y el pedido apareció por primera vez). Se etiqueta
          porque esa fecha no se muestra en la fila: sin etiqueta no se sabía qué
          estaban filtrando los dos calendarios. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={query} onChange={setQuery} debounce={300} placeholder="Buscar por repuesto, código, orden, máquina o cliente" className="max-w-md" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Pedido desde</span>
          <Input type="date" aria-label="Pedido desde" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
          <span className="text-xs text-muted-foreground">hasta</span>
          <Input type="date" aria-label="Pedido hasta" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
          <Button variant="outline" size="sm" onClick={setTodayRange} title="Pedidos que aparecieron hoy">
            Hoy
          </Button>
        </div>
      </div>

      {/* Barra de seleccion / eliminacion (por N° de Orden) */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {selectedOrders.size > 0
            ? `${selectedOrders.size} orden(es) seleccionada(s) · ${selectedPartIds(groups).length} repuesto(s)`
            : `${groups.length} orden(es) · ${visible.length} repuesto(s) con el filtro actual`}
          {/* La hoja de compra sale SÓLO con lo que se está viendo (o con lo
              tildado, si hay algo tildado). Se avisa acá porque el botón está
              arriba: sin este dato parecía que imprimía todo el sistema. */}
          {printTargets.length < groups.length && (
            <span className="block text-xs text-amber-700">
              La lista de compra saldrá sólo con {printTargets.length} de {groups.length} orden(es): lo que se ve en pantalla.
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelectedOrders(new Set())} disabled={selectedOrders.size === 0}>
            Limpiar
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDeleteSelected} disabled={selectedOrders.size === 0 || deleting}>
            {deleting ? "Eliminando..." : `Eliminar órdenes seleccionadas (${selectedOrders.size})`}
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay pedidos que coincidan con el filtro.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="w-10 py-2 px-3"><input type="checkbox" checked={groups.length > 0 && selectedOrders.size === groups.length} onChange={(e) => { if (e.target.checked) setSelectedOrders(new Set(groups.map((g) => g.key))); else setSelectedOrders(new Set()); }} aria-label="Seleccionar todas las órdenes" /></th>
<th className="text-left py-2 px-3 font-medium text-muted-foreground">Orden</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Máquina</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Repuesto</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Código</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Ped.</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Rec.</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Uso</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Estado</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Fechas</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Acción</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {g.parts.map((part, idx) => {
                    const o = part.order
                    const lastRow = idx === g.parts.length - 1
                    return (
                  <tr key={o.id} className={`hover:bg-muted/20 ${lastRow ? "border-b last:border-0" : ""}`}>
                    {/* UN tilde por N° de Orden: al marcarlo quedan seleccionados
                        TODOS los repuestos de esa orden y cuenta como 1 (la
                        cantidad de órdenes = máquinas para las que se compra). */}
                    {idx === 0 && (
                      <td className="py-2 px-3 align-top" rowSpan={g.parts.length}>
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selectedOrders.has(g.key)}
                          onChange={() => toggleSelectOrder(g.key)}
                          aria-label={`Seleccionar la orden ${g.orderNumber}`}
                        />
                      </td>
                    )}
                    {idx === 0 && (
                      <td className="py-2 px-3 font-medium align-top" rowSpan={g.parts.length}>{g.orderNumber || "—"}</td>
                    )}
                    {idx === 0 && (
                      <td className="py-2 px-3 align-top" rowSpan={g.parts.length}>
                        {/* Identificación COMPLETA de la máquina: el nombre solo no
                            alcanza (3C corta a 30 caracteres y al importar el resto
                            queda en el Modelo). Ver fullMachineIdentification(). */}
                        {fullMachineIdentification(g.machineName, g.machineModel)}
                        {(() => {
                          const rec = maintenanceByOrder.get(normOrderKey(g.orderNumber))
                          const client = rec?.clientName?.trim()
                          return client ? (
                            <span className="block text-xs text-muted-foreground mt-0.5">{client}</span>
                          ) : null
                        })()}
                      </td>
                    )}
                    <td className="py-2 px-3 align-top">{part.description}{part.partial && <span className="ml-1 text-xs text-violet-600 font-semibold">parcial</span>}</td>
                    <td className="py-2 px-3 text-xs align-top">
                      <SparePartOrderCodeInput order={o} onSave={updateCode} />
                    </td>
                    <td className="py-2 px-3 text-right align-top">{o.quantityRequested}</td>
                    <td className="py-2 px-3 text-right align-top">{o.quantityReceived}</td>
                    <td className="py-2 px-3 text-right align-top">{o.quantityUsed}</td>
                    <td className="py-2 px-3 align-top">
                      <SparePartOrderBadge status={o.status} />
                      {closureById.get(o.id)?.closed && closureById.get(o.id)?.label && (
                        <span className="block text-xs text-muted-foreground mt-1">
                          3C: {closureById.get(o.id)?.label}
                        </span>
                      )}
                      {/* Fechas del circuito, tal como quedaron al apretar los
                          botones o al cargar el calendario: enc = día en que se lo
                          encargué al dueño (botón "Encargar") · repuestero = día
                          en que el dueño lo pidió en la casa (calendario "P.
                          repuestero") · traído = día en que me lo trajo (botón
                          "Recibir") · retiro = fecha estimada de retiro. */}
                      {(() => {
                        const fechas = [
                          o.ownerRequestedAt ? `enc: ${formatDate(o.ownerRequestedAt)}` : null,
                          o.orderedAt ? `repuestero: ${formatDate(o.orderedAt)}` : null,
                          o.receivedAt ? `traído: ${formatDate(o.receivedAt)}` : null,
                          o.expectedAt ? `retiro: ${formatDate(o.expectedAt)}` : null,
                        ].filter((f): f is string => f !== null)
                        return fechas.length > 0 ? (
                          <span className="block text-xs text-muted-foreground mt-1">{fechas.join(" · ")}</span>
                        ) : null
                      })()}
                    </td>
                    <td className="py-2 px-3 align-top">
                      {/* Fechas del circuito cargadas a mano (para CORREGIR lo que
                          salió mal al apretar un botón):
                            "P. dueño"      = día en que le pedí/encargué el repuesto
                                              al dueño → la MISMA fecha que pone el
                                              botón "Encargar" (se imprime como
                                              "Le pedí al dueño").
                            "P. repuestero" = día en que el DUEÑO lo pidió en la
                                              casa de repuestos (se imprime como
                                              "Lo pidió en la casa").
                            "Traído"        = día en que me lo trajo → la MISMA
                                              fecha que pone el botón "Recibir"
                                              (se imprime como "Me lo trajo").
                          Los botones las cargan solas; acá se corrigen.

                          "P. dueño" NO se muestra (pedido del dueño, 2026-10-01):
                          el día en que le pedí el repuesto al dueño ya no se carga
                          a mano y la hoja de compra tampoco lo imprime. El dato lo
                          sigue poniendo solo el botón "Encargar" y se conserva
                          porque ordena el anexo (los encargos más viejos primero). */}
                      <SparePartOrderDatesEditor order={o} onSave={updateDates} omit={["ownerRequestedAt"]} />
                    </td>
                    <td className="py-2 px-3 text-right align-top">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        {(o.status === "SOLICITADO" || o.status === "PEDIDO") && (
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOrderedTarget(o)}>Encargar</Button>
                        )}
                        {o.status !== "UTILIZADO" && o.status !== "CANCELADO" && (
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAction({ type: "receive", order: o })}>Recibir</Button>
                        )}
                        {o.status === "RECIBIDO" && (
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAction({ type: "use", order: o })}>Utilizar</Button>
                        )}
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => router.push(`/spare-part-orders/${o.id}`)}>Ver</Button>
<Button variant="ghost" size="sm" className="h-7 text-xs text-red-600" onClick={() => handleDeleteOne(o.id)} disabled={deleting}>Eliminar</Button>
                      </div>
                    </td>
                  </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SparePartOrderOrderedDialog
        open={orderedTarget !== null}
        onOpenChange={(o) => { if (!o) setOrderedTarget(null) }}
        order={orderedTarget}
        onConfirm={handleMarkOrdered}
      />

      <SparePartOrderReceiveUseDialog
        key={action ? `${action.type}-${action.order.id}` : "closed"}
        open={action !== null}
        onOpenChange={(o) => { if (!o) setAction(null) }}
        action={action?.type ?? "receive"}
        order={action?.order ?? null}
        onConfirm={(q, d, n) => handleAction(action!.order.id, q, d, n)}
      />
    </div>
  )
}
