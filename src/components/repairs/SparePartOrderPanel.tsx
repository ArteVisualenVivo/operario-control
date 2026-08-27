"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useSparePartOrders } from "@/hooks/useSparePartOrders"
import { SparePartOrderDialog } from "./SparePartOrderDialog"
import { SparePartOrderReceiveUseDialog } from "./SparePartOrderReceiveUseDialog"
import { SparePartOrderOrderedDialog } from "./SparePartOrderOrderedDialog"
import { SparePartOrderBadge } from "./SparePartOrderBadge"
import { toast } from "sonner"
import type { MachineRepair, CreateSparePartOrderInput, SparePartOrder } from "@/types"

interface Props {
  repair: MachineRepair
}

export function SparePartOrderPanel({ repair }: Props) {
  const router = useRouter()
  const { orders, loading, create, markOrdered, markReceived, markUsed, cancel } = useSparePartOrders(repair.id)
  const [createOpen, setCreateOpen] = useState(false)
  const [action, setAction] = useState<{ type: "receive" | "use"; order: SparePartOrder } | null>(null)
  const [orderedTarget, setOrderedTarget] = useState<SparePartOrder | null>(null)

  const orderNumber = repair.externalId ?? repair.id

  const handleCreate = async (input: CreateSparePartOrderInput) => {
    await create(input)
  }

  const handleAction = async (orderId: string, quantity: number, date: Date, notes?: string) => {
    if (!action) return
    if (action.type === "receive") {
      await markReceived(orderId, quantity, date, notes)
    } else {
      await markUsed(orderId, quantity, date, notes)
    }
  }

  const handleMarkOrdered = async (orderedAt: Date, expectedAt: Date | null, notes?: string) => {
    if (!orderedTarget) return
    await markOrdered(orderedTarget.id, { orderedAt, expectedAt, notes })
  }

  const handleCancel = async (id: string) => {
    if (!window.confirm("¿Cancelar este pedido? Se conservará en el historial.")) return
    try {
      await cancel(id)
      toast.success("Pedido cancelado")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error")
    }
  }

  return (
    <div className="border-t pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Repuestos ({orders.length})</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>+ Pedir repuesto</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando pedidos...</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay pedidos de repuestos para esta orden.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Repuesto</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Código</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Cantidad</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Estado</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="py-2 px-3">
                    {o.description}
                    {(o.quantityReceived > 0 || o.quantityUsed > 0) && (
                      <span className="block text-xs text-muted-foreground">
                        rec: {o.quantityReceived} · usó: {o.quantityUsed}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 font-mono text-xs">{o.code}</td>
                  <td className="py-2 px-3 text-right">{o.quantityRequested}</td>
                  <td className="py-2 px-3"><SparePartOrderBadge status={o.status} /></td>
                  <td className="py-2 px-3">
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
                      {o.status !== "UTILIZADO" && o.status !== "CANCELADO" && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600" onClick={() => handleCancel(o.id)}>Cancelar</Button>
                      )}
                      <Button variant="link" size="sm" className="h-7 text-xs" onClick={() => router.push(`/spare-part-orders/${o.id}`)}>Ver</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SparePartOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        repair={{ repairId: repair.id, orderNumber, machineId: repair.machineId, machineName: repair.machineName }}
        onCreate={handleCreate}
      />

      <SparePartOrderReceiveUseDialog
        key={action ? `${action.type}-${action.order.id}` : "closed"}
        open={action !== null}
        onOpenChange={(o) => { if (!o) setAction(null) }}
        action={action?.type ?? "receive"}
        order={action?.order ?? null}
        onConfirm={(q, d, n) => handleAction(action!.order.id, q, d, n)}
      />

      <SparePartOrderOrderedDialog
        open={orderedTarget !== null}
        onOpenChange={(o) => { if (!o) setOrderedTarget(null) }}
        order={orderedTarget}
        onConfirm={handleMarkOrdered}
      />
    </div>
  )
}