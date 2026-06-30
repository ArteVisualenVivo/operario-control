"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/ui"
import { getMaintenanceRecords } from "@/services/maintenance"
import type { MaintenanceRecord } from "@/services/maintenance"

export default function MaintenancePage() {
  const [orders, setOrders] = useState<MaintenanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const data = await getMaintenanceRecords()
    setOrders(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const receptionOrders = useMemo(() => {
    return orders.filter(o => o.status === "Recepción")
  }, [orders])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mantenimiento</h1>
        <Button variant="outline" size="sm" onClick={load}>Actualizar</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Órdenes en Recepción</CardTitle>
        </CardHeader>
        <CardContent>
          {receptionOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay órdenes en recepción.</p>
          ) : (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-left">Número de Orden</th>
                    <th className="p-2 text-left">Cliente</th>
                    <th className="p-2 text-left">Máquina</th>
                    <th className="p-2 text-left">Fecha Ingreso</th>
                    <th className="p-2 text-left">Estado</th>
                    <th className="p-2 text-left">Técnico</th>
                  </tr>
                </thead>
                <tbody>
                  {receptionOrders.map((order) => (
                    <tr key={order.id} className="border-b hover:bg-muted/50">
                      <td className="p-2 font-mono">{order.orderNumber}</td>
                      <td className="p-2">{order.clientName}</td>
                      <td className="p-2">{order.machineName}</td>
                      <td className="p-2">{formatDate(order.entryDate)}</td>
                      <td className="p-2">{order.status}</td>
                      <td className="p-2">{order.technician ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Estructura preparada para futuras fases */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Próximas fases</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground list-disc pl-4 space-y-1">
              <li>Fecha de reparación</li>
              <li>Fecha de retiro</li>
              <li>Garantía</li>
              <li>Historial</li>
              <li>Tiempo en taller</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
