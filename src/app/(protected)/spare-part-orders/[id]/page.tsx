"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SparePartOrderBadge } from "@/components/repairs/SparePartOrderBadge"
import { getOrderById } from "@/services/sparePartOrders"
import { formatDate } from "@/lib/ui"
import type { SparePartOrder } from "@/types"

export default function SparePartOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<SparePartOrder | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getOrderById(id).then((o) => { setOrder(o); setLoading(false) })
  }, [id])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>
  if (!order) return <p className="text-muted-foreground">Pedido no encontrado</p>

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5 border-b last:border-0">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  )

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => router.back()}>← Volver</Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-xl">{order.description}</CardTitle>
              <p className="text-sm text-muted-foreground font-mono">{order.code}</p>
            </div>
            <SparePartOrderBadge status={order.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {row("Orden", order.orderNumber || "—")}
          {row("Máquina", order.machineName || "—")}
          {row("Solicitado", order.quantityRequested)}
          {row("Recibido", order.quantityReceived)}
          {row("Utilizado", order.quantityUsed)}
          {row("Disponible", Math.max(0, order.quantityReceived - order.quantityUsed))}
          {row("Pendiente de recibir", Math.max(0, order.quantityRequested - order.quantityReceived))}
          {order.supplier && row("Proveedor", order.supplier)}
          {row("Fecha de pedido", formatDate(order.requestedAt))}
          {order.receivedAt && row("Fecha de recepción", formatDate(order.receivedAt))}
          {order.usedAt && row("Fecha de utilización", formatDate(order.usedAt))}
          {order.notes && (
            <div className="pt-2">
              <span className="text-sm text-muted-foreground">Observaciones</span>
              <p className="text-sm whitespace-pre-wrap rounded-lg bg-muted/30 p-3 mt-1">{order.notes}</p>
            </div>
          )}
          <div className="flex gap-2 pt-3">
            <Button variant="outline" size="sm" onClick={() => router.push(`/repairs/${order.repairId}`)}>
              Ver orden de trabajo
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}