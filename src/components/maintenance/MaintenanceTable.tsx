"use client"

import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SearchInput } from "@/components/ui/SearchInput"
import { formatDate } from "@/lib/ui"
import { getRepairsForMaintenanceOrder } from "@/lib/machine-links"
import type { MaintenanceRecord } from "@/services/maintenance"
import type { MachineRepair } from "@/types"

// Status badges configuration
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  "Recepcionado": { label: "Recepcionado", className: "bg-gray-100 text-gray-800 border border-gray-300" },
  "En reparación": { label: "En reparación", className: "bg-blue-100 text-blue-800 border border-blue-300" },
  "Esperando repuestos": { label: "Esperando repuestos", className: "bg-yellow-100 text-yellow-800 border border-yellow-300" },
  "Esperando aprobación": { label: "Esperando aprobación", className: "bg-purple-100 text-purple-800 border border-purple-300" },
  "Reparado": { label: "Reparado", className: "bg-green-100 text-green-800 border border-green-300" },
  "Entregado": { label: "Entregado", className: "bg-emerald-100 text-emerald-800 border border-emerald-300" },
  "No reparado": { label: "No reparado", className: "bg-red-100 text-red-800 border border-red-300" },
}

interface Props {
  initialOrders: MaintenanceRecord[]
}

export function MaintenanceTable({ initialOrders }: Props) {
  const [search, setSearch] = useState("")
  const [selectedOrder, setSelectedOrder] = useState<MaintenanceRecord | null>(null)
  const [repairs, setRepairs] = useState<MachineRepair[]>([])

  useEffect(() => {
    const fetchRepairs = async () => {
      try {
        const { getRepairs } = await import("@/services/repairs")
        const data = await getRepairs()
        setRepairs(data)
      } catch (err) {
        console.warn("[MaintenanceTable] Failed to fetch repairs:", err)
      }
    }
    fetchRepairs()
  }, [])

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return initialOrders
    return initialOrders.filter((order) => {
      return (
        order.orderNumber.toLowerCase().includes(q) ||
        order.clientName.toLowerCase().includes(q) ||
        order.machineName.toLowerCase().includes(q)
      )
    })
  }, [initialOrders, search])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>Órdenes de mantenimiento</CardTitle>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por orden, máquina o cliente"
            className="max-w-md"
          />
        </CardHeader>
        <CardContent>
          {visibleOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay órdenes de mantenimiento disponibles.
            </p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-left">Número de Orden</th>
                    <th className="p-2 text-left">Cliente</th>
                    <th className="p-2 text-left">Máquina</th>
                    <th className="p-2 text-left">Tipo</th>
                    <th className="p-2 text-left">Fecha Ingreso</th>
                    <th className="p-2 text-left">Fecha Entrega</th>
                    <th className="p-2 text-left">Fecha Reparación</th>
                    <th className="p-2 text-left">Estado</th>
                    <th className="p-2 text-left">Técnico</th>
                    <th className="p-2 text-left">Doc / Item</th>
                    <th className="p-2 text-left">Reparaciones</th>
                    <th className="p-2 text-left">Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleOrders.map((order) => {
                    const linkedRepairs = getRepairsForMaintenanceOrder(order, repairs)
                    const statusConfig =
                      STATUS_CONFIG[order.status] || {
                        label: order.status,
                        className: "bg-gray-100 text-gray-800 border border-gray-300",
                      }

                    const isNoReparado = order.status === "No reparado"

                    const reason =
                      (order.reason as string) ??
                      (order.originalData?.observaciones as string) ??
                      (order.originalData?.observ as string) ??
                      "—"

                    return (
                      <tr key={order.id} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-mono">{order.orderNumber}</td>
                        <td className="p-2">{order.clientName}</td>
                        <td className="p-2">{order.machineName}</td>
                        <td className="p-2">{order.type ?? " "}</td>
                        <td className="p-2">{formatDate(order.entryDate)}</td>
                        <td className="p-2">{formatDate(order.returnDate)}</td>
                        <td className="p-2">{formatDate(order.repairDate)}</td>

                        <td className="p-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusConfig.className}`}
                          >
                            {statusConfig.label}
                          </span>

                          {isNoReparado && (
                            <span className="ml-2 text-xs text-red-700 font-medium">
                              Motivo: {reason}
                            </span>
                          )}
                        </td>

                        <td className="p-2">{order.technician ?? " "}</td>

                        <td className="p-2">
                          {order.docId ?? " "}
                          {order.itemId != null ? ` / ${order.itemId}` : ""}
                        </td>

                        <td className="p-2">
                          {linkedRepairs.length > 0 ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                window.open(
                                  "/repairs?order=" +
                                    encodeURIComponent(order.orderNumber),
                                  "_self"
                                )
                              }
                            >
                              Ver reparaciones ({linkedRepairs.length})
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>

                        <td className="p-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedOrder(order)}
                          >
                            Ver detalle
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={selectedOrder !== null}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              Detalle de Orden: {selectedOrder?.orderNumber}
            </DialogTitle>
          </DialogHeader>

          {selectedOrder ? (
            <div className="grid grid-cols-1 gap-4 mt-4">
              <div>
                <span className="font-semibold">Tipo de Documento:</span>
                <p className="text-sm">
                  {(selectedOrder.originalData?.tipdoc as string) ??
                    (selectedOrder.originalData?.tipo as string) ??
                    selectedOrder.tipDoc ??
                    "—"}
                </p>
              </div>

              <div>
                <span className="font-semibold">Expediente:</span>
                <p className="text-sm">
                  {(selectedOrder.originalData?.expediente as string) ??
                    selectedOrder.expediente ??
                    "—"}
                </p>
              </div>

              <div>
                <span className="font-semibold">Observaciones:</span>
                <p className="text-sm whitespace-pre-wrap">
                  {(selectedOrder.originalData?.observaciones as string) ??
                    selectedOrder.observations ??
                    selectedOrder.observaciones ??
                    "—"}
                </p>
              </div>

              <div>
                <span className="font-semibold">Garantía:</span>
                <p className="text-sm">
                  {(selectedOrder.originalData?.garantia as string) ??
                    selectedOrder.garantia ??
                    "—"}
                </p>
              </div>

              <div>
                <span className="font-semibold">Presupuesto:</span>
                <p className="text-sm">
                  {(selectedOrder.originalData?.presupuesto as string) ??
                    selectedOrder.presupuesto ??
                    "—"}
                </p>
              </div>

              <div>
                <span className="font-semibold">Vendedor:</span>
                <p className="text-sm">
                  {(selectedOrder.originalData?.vendedor as string) ??
                    selectedOrder.vendedor ??
                    "—"}
                </p>
              </div>

              <div>
                <span className="font-semibold">Costo:</span>
                <p className="text-sm">
                  {(selectedOrder.originalData?.costo as string) ??
                    selectedOrder.costo ??
                    "—"}
                </p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}