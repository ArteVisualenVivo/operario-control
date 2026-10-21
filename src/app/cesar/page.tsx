"use client"

import { useEffect, useState } from "react"
import { getLaborBreakdownByOrder } from "@/services/laborRecords"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

type CesarOrderItem = {
  type: "mano_obra"
  code: string | null
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

type CesarOrder = {
  orderNumber: string
  totalFacturado: number
  items: CesarOrderItem[]
}

type CesarBreakdown = {
  success: boolean
  orders: CesarOrder[]
  totalGeneral: number
  source: string
  recordCount?: number
  error?: string
}

export default function CesarPage() {
  const [breakdown, setBreakdown] = useState<{ orders: any[]; totalGeneral: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      // 1° Intentar leer desde Redis (donde el agente guarda cuando Firebase está bloqueado)
      try {
        const res = await fetch("/api/cesar-data", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        })
        if (res.ok) {
          const data: CesarBreakdown = await res.json()
          if (data.success && data.orders.length > 0) {
            setBreakdown({
              orders: data.orders,
              totalGeneral: data.totalGeneral,
            })
            setLoading(false)
            console.log("[CESAR] Datos cargados desde Redis:", data.source, data.recordCount, "registros")
            return
          }
        }
      } catch (err) {
        console.warn("[CESAR] No se pudo leer desde Redis:", err)
      }

      // 2° Fallback: leer desde Firestore
      try {
        const data = await getLaborBreakdownByOrder()
        setBreakdown(data)
      } catch (err) {
        toast.error("Error al cargar la liquidación de CESAR")
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return <div className="p-6">Cargando liquidación CESAR...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">CESAR — Liquidación de Mano de Obra</h1>
        <Button variant="outline" size="sm">
          Exportar a Excel
        </Button>
      </div>

      {breakdown && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Resumen General</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-lg">
              <div>
                <p className="text-muted-foreground text-sm">Órdenes con mano de obra</p>
                <p className="font-semibold">{breakdown.orders.length}</p>
              </div>
              <div className="text-right">
                <p className="text-muted-foreground text-sm">Total general facturado</p>
                <p className="font-bold text-primary">
                  $ {breakdown.totalGeneral.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {breakdown.orders.map((order) => (
              <Card key={order.orderNumber}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Orden {order.orderNumber}
                  </CardTitle>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Total facturado</p>
                    <p className="font-semibold">
                      $ {order.totalFacturado.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="border-b bg-muted/50 text-muted-foreground">
                          <th className="p-3">Código</th>
                          <th className="p-3">Descripción</th>
                          <th className="p-3 text-right">Cantidad / hs</th>
                          <th className="p-3 text-right">Precio Unit.</th>
                          <th className="p-3 text-right">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.items.map((item: any) => (
                          <tr key={`${order.orderNumber}-${item.code}-${item.description}`} className="border-b border-muted/30 last:border-0">
                            <td className="p-3 font-mono">{item.code}</td>
                            <td className="p-3">{item.description}</td>
                            <td className="p-3 text-right">{item.quantity.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className="p-3 text-right">$ {item.unitPrice.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className="p-3 text-right font-semibold">$ {item.totalPrice.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}