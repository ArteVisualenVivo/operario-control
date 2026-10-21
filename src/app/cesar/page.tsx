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
  date: string | Date
}

type CesarOrder = {
  orderNumber: string
  totalFacturado: number
  items: CesarOrderItem[]
  payPeriod: string
  month: string
}

type QuincenaGroup = {
  payPeriod: string
  payPeriodLabel: string
  total: number
  orders: CesarOrder[]
}

type MonthGroup = {
  month: string
  monthLabel: string
  total: number
  quincenas: QuincenaGroup[]
}

type CesarBreakdown = {
  success: boolean
  orders: CesarOrder[]
  groups: MonthGroup[]
  totalGeneral: number
  source: string
  recordCount?: number
  error?: string
}

function formatMoney(value: number) {
  return value.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function CesarPage() {
  const [breakdown, setBreakdown] = useState<CesarBreakdown | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/cesar-data", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        })
        if (res.ok) {
          const data: CesarBreakdown = await res.json()
          if (data.success && data.orders.length > 0) {
            setBreakdown(data)
            setLoading(false)
            console.log("[CESAR] Datos cargados desde Redis:", data.source, data.recordCount, "registros")
            return
          }
        }
      } catch (err) {
        console.warn("[CESAR] No se pudo leer desde Redis:", err)
      }
      try {
        const data = await getLaborBreakdownByOrder()
        setBreakdown(data as CesarBreakdown)
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
                  $ {formatMoney(breakdown.totalGeneral)}
                </p>
              </div>
            </CardContent>
          </Card>

          {breakdown.groups.map((monthGroup) => (
            <section key={monthGroup.month} className="space-y-4">
              <Card className="border-l-4 border-primary">
                <CardHeader>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <span className="text-sm font-mono">{monthGroup.month}</span>
                    {monthGroup.monthLabel}
                  </CardTitle>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Total mes</p>
                    <p className="font-bold text-primary">$ {formatMoney(monthGroup.total)}</p>
                  </div>
                </CardHeader>
              </Card>

              {monthGroup.quincenas.map((quincena) => (
                <div key={quincena.payPeriod} className="space-y-2">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">{quincena.payPeriodLabel}</CardTitle>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Total quincena</p>
                        <p className="font-semibold">$ {formatMoney(quincena.total)}</p>
                      </div>
                    </CardHeader>
                  </Card>

                  <div className="grid gap-3">
                    {quincena.orders.map((order) => (
                      <Card key={order.orderNumber}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">
                            Orden {order.orderNumber}
                          </CardTitle>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Total facturado</p>
                            <p className="font-semibold">
                              $ {formatMoney(order.totalFacturado)}
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
                                {order.items.map((item) => (
                                  <tr key={`${order.orderNumber}-${item.code}-${item.description}`} className="border-b border-muted/30 last:border-0">
                                    <td className="p-3 font-mono">{item.code}</td>
                                    <td className="p-3">{item.description}</td>
                                    <td className="p-3 text-right">{item.quantity.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-3 text-right">$ {formatMoney(item.unitPrice)}</td>
                                    <td className="p-3 text-right font-semibold">$ {formatMoney(item.totalPrice)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  )
}