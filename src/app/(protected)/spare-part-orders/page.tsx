"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/SearchInput"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAllSparePartOrders } from "@/hooks/useAllSparePartOrders"
import { importPendingPartsFromMaintenance } from "@/services/sparePartOrders"
import { SparePartOrderBadge } from "@/components/repairs/SparePartOrderBadge"
import { SparePartOrderOrderedDialog } from "@/components/repairs/SparePartOrderOrderedDialog"
import { formatDate } from "@/lib/ui"
import { toast } from "sonner"
import type { SparePartOrderStatus, SparePartOrder } from "@/types"

type Filter = "todos" | SparePartOrderStatus | "pendientes" | "encargados" | "recibidos-sin-usar" | "parciales" | "atrasados" | "utilizados"

// Timestamp capturado a nivel de módulo (no durante el render) para los cálculos de "atrasos".
const MODULE_LOAD_TS = Date.now()

const STATUS_LABELS: Record<SparePartOrderStatus, string> = {
  SOLICITADO: "Solicitados",
  PEDIDO: "Pedidos",
  ENCARGADO: "Encargados",
  RECIBIDO: "Recibidos",
  UTILIZADO: "Utilizados",
  CANCELADO: "Cancelados",
}

export default function SparePartOrdersPage() {
  const router = useRouter()
  const { orders, loading, reload, markAsOrdered, remove } = useAllSparePartOrders()
  const [filter, setFilter] = useState<Filter>("todos")
  const [search, setSearch] = useState("")
  const [orderSearch, setOrderSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [orderedTarget, setOrderedTarget] = useState<SparePartOrder | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`¿Eliminar ${selected.size} pedido(s)? Esta acción no se puede deshacer.`)) return
    setDeleting(true)
    try {
      await remove(Array.from(selected))
      setSelected(new Set())
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Error al eliminar")
    } finally {
      setDeleting(false)
    }
  }

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

  const handleImport = async () => {
    setImporting(true)
    try {
      const res = await importPendingPartsFromMaintenance()
      toast.success(
        `Importados ${res.created} repuesto(s) en espera${res.skippedExisting > 0 ? ` · ${res.skippedExisting} ya existían` : ""}`,
      )
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al importar repuestos en espera")
    } finally {
      setImporting(false)
    }
  }

  const daysOld = (d: Date): number => {
    return Math.floor((MODULE_LOAD_TS - new Date(d).getTime()) / (1000 * 60 * 60 * 24))
  }

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
    const q = search.toLowerCase()
    const oq = orderSearch.toLowerCase()
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null
    const to = dateTo ? new Date(dateTo + "T23:59:59") : null
    return orders
      .filter(matchesFilter)
      .filter((o) => {
        const matchesQ = !q || o.description.toLowerCase().includes(q) || o.code.toLowerCase().includes(q)
        const matchesOq = !oq || o.orderNumber.toLowerCase().includes(oq) || o.machineName.toLowerCase().includes(oq)
        const matchesDates =
          (!from || new Date(o.requestedAt) >= from) &&
          (!to || new Date(o.requestedAt) <= to)
        return matchesQ && matchesOq && matchesDates
      })
  }, [orders, search, orderSearch, dateFrom, dateTo, matchesFilter])

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

  if (loading) return <p className="text-muted-foreground">Cargando pedidos...</p>

  return (
<div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Pedidos de Repuestos</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={handleImport} disabled={importing}>
            {importing ? "Importando..." : "📥 Importar repuestos en espera (3C)"}
          </Button>
          <Button variant="outline" onClick={() => router.push("/spare-part-orders/print")}>
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

      {/* Filtros por estado */}
      <div className="flex gap-1 flex-wrap">
        {(["todos", "pendientes", "encargados", "recibidos-sin-usar", "parciales", "SOLICITADO", "PEDIDO", "ENCARGADO", "RECIBIDO", "UTILIZADO", "CANCELADO"] as Filter[]).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "todos" ? "Todos" : f === "pendientes" ? "Pendientes" : f === "recibidos-sin-usar" ? "Recibidos sin usar" : f === "parciales" ? "Parciales" : STATUS_LABELS[f as SparePartOrderStatus]}
          </Button>
        ))}
      </div>

      {/* Búsquedas */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por repuesto o código" className="max-w-xs" />
        <Input value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="Orden o máquina" className="max-w-xs" />
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
      </div>

      {/* Barra de seleccion / eliminacion */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {selected.size > 0
            ? `${selected.size} seleccionado(s)`
            : `${visible.length} pedido(s) con el filtro actual`}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
            Limpiar
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDeleteSelected} disabled={selected.size === 0 || deleting}>
            {deleting ? "Eliminando..." : `Eliminar seleccionados (${selected.size})`}
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay pedidos que coincidan con el filtro.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="w-10 py-2 px-3"><input type="checkbox" checked={visible.length > 0 && selected.size === visible.length} onChange={(e) => { if (e.target.checked) setSelected(new Set(visible.map((v) => v.id))); else setSelected(new Set()); }} /></th>
<th className="text-left py-2 px-3 font-medium text-muted-foreground">Orden</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Máquina</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Repuesto</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Código</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Ped.</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Rec.</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Uso</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Estado</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">F. pedido</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Acción</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => {
                const parcial = (o.status === "SOLICITADO" || o.status === "PEDIDO" || o.status === "RECIBIDO") && (o.quantityReceived < o.quantityRequested || (o.quantityUsed > 0 && o.quantityUsed < o.quantityReceived))
                return (
                  <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20">
<td className="py-2 px-3"><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleSelect(o.id)} /></td>
                    <td className="py-2 px-3 font-medium">{o.orderNumber || "—"}</td>
                    <td className="py-2 px-3">{o.machineName}</td>
                    <td className="py-2 px-3">{o.description}{parcial && <span className="ml-1 text-xs text-violet-600 font-semibold">parcial</span>}</td>
                    <td className="py-2 px-3 font-mono text-xs">{o.code}</td>
                    <td className="py-2 px-3 text-right">{o.quantityRequested}</td>
                    <td className="py-2 px-3 text-right">{o.quantityReceived}</td>
                    <td className="py-2 px-3 text-right">{o.quantityUsed}</td>
                    <td className="py-2 px-3">
                      <SparePartOrderBadge status={o.status} />
                      {o.status === "ENCARGADO" && (o.orderedAt || o.expectedAt) && (
                        <span className="block text-xs text-muted-foreground mt-1">
                          enc: {formatDate(o.orderedAt!)}{o.expectedAt ? ` · retiro: ${formatDate(o.expectedAt)}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-xs">{formatDate(o.requestedAt)}</td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        {(o.status === "SOLICITADO" || o.status === "PEDIDO") && (
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOrderedTarget(o)}>Encargar</Button>
                        )}
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => router.push(`/spare-part-orders/${o.id}`)}>Ver</Button>
<Button variant="ghost" size="sm" className="h-7 text-xs text-red-600" onClick={() => handleDeleteOne(o.id)} disabled={deleting}>Eliminar</Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
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
    </div>
  )
}