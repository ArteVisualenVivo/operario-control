"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate } from "@/lib/ui"
import { getMaintenanceRecords } from "@/services/maintenance"
import type { MaintenanceRecord } from "@/services/maintenance"

const ORDER_PATTERN = /^X\s?\d{4}-\d{8}$/i

export default function MaintenancePage() {
  const [orders, setOrders] = useState<MaintenanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const data = await getMaintenanceRecords()
    setOrders(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const visibleOrders = useMemo(() => {
    return [...orders]
      .filter((order) => ORDER_PATTERN.test(order.orderNumber))
      .sort((a, b) => {
        const aTime = a.entryDate ? new Date(a.entryDate).getTime() : 0
        const bTime = b.entryDate ? new Date(b.entryDate).getTime() : 0
        return bTime - aTime
      })
  }, [orders])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mantenimiento</h1>
        <Button variant="outline" size="sm" onClick={load}>
          Actualizar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ordenes de mantenimiento</CardTitle>
        </CardHeader>
        <CardContent>
          {visibleOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay ordenes de mantenimiento disponibles.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-left">Numero de Orden</th>
                    <th className="p-2 text-left">Cliente</th>
                    <th className="p-2 text-left">Maquina</th>
                    <th className="p-2 text-left">Tipo</th>
                    <th className="p-2 text-left">Fecha Ingreso</th>
                    <th className="p-2 text-left">Fecha Entrega</th>
                    <th className="p-2 text-left">Fecha Reparacion</th>
                    <th className="p-2 text-left">Estado</th>
                    <th className="p-2 text-left">Tecnico</th>
                    <th className="p-2 text-left">Doc / Item</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((order) => (
                    <tr key={order.id} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-mono">{order.orderNumber}</td>
                      <td className="p-2">{order.clientName}</td>
                      <td className="p-2">{order.machineName}</td>
                      <td className="p-2">{order.type ?? "—"}</td>
                      <td className="p-2">{formatDate(order.entryDate)}</td>
                      <td className="p-2">{formatDate(order.returnDate)}</td>
                      <td className="p-2">{formatDate(order.repairDate)}</td>
                      <td className="p-2">{order.status}</td>
                      <td className="p-2">{order.technician ?? "—"}</td>
                      <td className="p-2">
                        {order.docId ?? "—"}
                        {order.itemId != null ? ` / ${order.itemId}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Proximas fases</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground list-disc pl-4 space-y-1">
              <li>Fecha de reparacion</li>
              <li>Fecha de retiro</li>
              <li>Garantia</li>
              <li>Historial</li>
              <li>Tiempo en taller</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
