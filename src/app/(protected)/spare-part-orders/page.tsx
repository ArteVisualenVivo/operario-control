"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/SearchInput"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAllSparePartOrders } from "@/hooks/useAllSparePartOrders"
import { SparePartOrderBadge } from "@/components/repairs/SparePartOrderBadge"
import { formatDate } from "@/lib/ui"
import type { SparePartOrderStatus } from "@/types"

type Filter = "todos" | SparePartOrderStatus | "pendientes" | "recibidos-sin-usar" | "parciales" | "atrasados" | "utilizados"

// Timestamp capturado a nivel de módulo (no durante el render) para los cálculos de "atrasos".
const MODULE_LOAD_TS = Date.now()

const STATUS_LABELS: Record<SparePartOrderStatus, string> = {
  SOLICITADO: "Solicitados",
  PEDIDO: "Pedidos",
  RECIBIDO: "Recibidos",
  UTILIZADO: "Utilizados",
  CANCELADO: "Cancelados",
}

export default function SparePartOrdersPage() {
  const router = useRouter()
  const { orders, loading } = useAllSparePartOrders()
  const [filter, setFilter] = useState<Filter>("todos")
  const [search, setSearch] = useState("")
  const [orderSearch, setOrderSearch] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const daysOld = (d: Date): number => {
    return Math.floor((MODULE_LOAD_TS - new Date(d).getTime()) / (1000 * 60 * 60 * 24))
  }

  const matchesFilter = (o: (typeof orders)[number]): boolean => {
    switch (filter) {
      case "todos":
        return true
      case "SOLICITADO":
      case "PEDIDO":
      case "RECIBIDO":
      case "UTILIZADO":
      case "CANCELADO":
        return o.status === filter
      case "pendientes":
        return o.status === "SOLICITADO" || o.status === "PEDIDO"
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
    const recibidosSinUsar = orders.filter((o) => o.status === "RECIBIDO").length
    const parciales = orders.filter((o) => (o.status === "SOLICITADO" || o.status === "PEDIDO" || o.status === "RECIBIDO") && (o.quantityReceived < o.quantityRequested || (o.quantityUsed > 0 && o.quantityUsed < o.quantityReceived))).length
    const atrasados = orders.filter((o) => (o.status === "SOLICITADO" || o.status === "PEDIDO") && daysOld(o.requestedAt) > 7).length
    const utilizados = orders.filter((o) => o.status === "UTILIZADO").length
    const cancelados = orders.filter((o) => o.status === "CANCELADO").length
    return { pendientes, recibidosSinUsar, parciales, atrasados, utilizados, cancelados, total: orders.length }
  }, [orders])

  if (loading) return <p className="text-muted-foreground">Cargando pedidos...</p>

  return (
<div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Pedidos de Repuestos</h1>
      </div>

      {/* Resumen semanal (clic para filtrar) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
        <Card onClick={() => setFilter("todos")} className={filter === "todos" ? "ring-2 ring-ring cursor-pointer" : "cursor-pointer"}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{counts.total}</p></CardContent>
        </Card>
        <Card onClick={() => setFilter("pendientes")} className={filter === "pendientes" ? "ring-2 ring-ring cursor-pointer" : "cursor-pointer"}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pendientes</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-amber-600">{counts.pendientes}</p></CardContent>
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
        {(["todos", "pendientes", "recibidos-sin-usar", "parciales", "SOLICITADO", "PEDIDO", "RECIBIDO", "UTILIZADO", "CANCELADO"] as Filter[]).map((f) => (
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
{visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay pedidos que coincidan con el filtro.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
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
                    <td className="py-2 px-3 font-medium">{o.orderNumber || "—"}</td>
                    <td className="py-2 px-3">{o.machineName}</td>
                    <td className="py-2 px-3">{o.description}{parcial && <span className="ml-1 text-xs text-violet-600 font-semibold">parcial</span>}</td>
                    <td className="py-2 px-3 font-mono text-xs">{o.code}</td>
                    <td className="py-2 px-3 text-right">{o.quantityRequested}</td>
                    <td className="py-2 px-3 text-right">{o.quantityReceived}</td>
                    <td className="py-2 px-3 text-right">{o.quantityUsed}</td>
                    <td className="py-2 px-3"><SparePartOrderBadge status={o.status} /></td>
                    <td className="py-2 px-3 text-xs">{formatDate(o.requestedAt)}</td>
                    <td className="py-2 px-3 text-right">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => router.push(`/spare-part-orders/${o.id}`)}>Ver</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}