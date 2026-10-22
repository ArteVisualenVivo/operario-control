"use client"

import { useEffect, useState } from "react"
import { getLaborBreakdownByOrder } from "@/services/laborRecords"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

type CesarLineType =
  | "mano_obra"
  | "moa"
  | "servicio"
  | "gastos"
  | "reparacion"
  | "repuesto"

const LINE_TYPE_LABELS: Record<CesarLineType, string> = {
  mano_obra: "Mano de obra",
  moa: "Mano de obra adicional (MOA)",
  servicio: "Servicios",
  gastos: "Gastos",
  reparacion: "Reparación",
  repuesto: "Repuestos",
}

const LINE_TYPE_ORDER: CesarLineType[] = [
  "mano_obra",
  "moa",
  "servicio",
  "gastos",
  "reparacion",
  "repuesto",
]

type CesarOrderItem = {
  type: string
  code: string | null
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
  date: string | Date
  operator?: string | null
}

type CesarOrder = {
  orderNumber: string
  date?: string
  totalFacturado: number
  items?: CesarOrderItem[]
  lines?: CesarOrderItem[]
  lineCount?: number
  typeTotals?: Partial<Record<CesarLineType, number>>
  operator?: string
  client?: string
  payPeriod: string
  month: string
  status?: string | null
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
  orderCount?: number
  error?: string
  statuses?: Array<{ value: string; label: string; count: number }>
}

function formatMoney(value: number) {
  return value.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(value: string | Date | undefined) {
  if (!value) return "-"
  const d = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00`) : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function linesOf(order: CesarOrder): CesarOrderItem[] {
  return order.lines ?? order.items ?? []
}

export default function CesarPage() {
  const [breakdown, setBreakdown] = useState<CesarBreakdown | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<string>("")
  const [selectedPayPeriod, setSelectedPayPeriod] = useState<string>("")
  const [selectedStatus, setSelectedStatus] = useState<string>("")
  const [showOnly1012, setShowOnly1012] = useState(false)

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

  // Lista plana de quincenas únicas (para el select de filtro)
  const allPayPeriodLabels = new Map(
    breakdown!.groups.flatMap((g) =>
      g.quincenas.map((q) => [q.payPeriodLabel, q.payPeriodLabel])
    )
  )
  const allPayPeriods = Array.from(allPayPeriodLabels.keys())

  const filteredGroups = breakdown!.groups.map((g) => {
    const quincenas = g.quincenas.filter((q) => {
      const matchMonth = !selectedMonth || g.month === selectedMonth
      const matchPayPeriod =
        !selectedPayPeriod || q.payPeriodLabel === selectedPayPeriod

      // Filtrar órdenes por estado y ítem 1012 MO CES
      let filteredQOrders = q.orders
      if (selectedStatus) {
        filteredQOrders = filteredQOrders.filter((o) => o.status === selectedStatus)
      }
      if (showOnly1012) {
        filteredQOrders = filteredQOrders.filter((o) =>
          o.lines?.some(
            (line) => line.code?.includes("1012") || line.description?.includes("MO CES")
          )
        )
      }
      // Solo mostrar quinnena si tiene órdenes después de filtrar
      if (filteredQOrders.length === 0) return null
      q.orders = filteredQOrders
      q.total = filteredQOrders.reduce(
        (s, o) => s + o.totalFacturado,
        0
      )

      return matchMonth && matchPayPeriod
    })
    if (quincenas.length === 0) return null
    return {
      ...g,
      quincenas,
      total: quincenas.reduce((s, q) => s + q.total, 0),
    }
  }).filter((g): g is MonthGroup => g !== null)

  // Órdenes filtradas (plana) para el resumen general
  const filteredOrders = filteredGroups.flatMap((g) =>
    g.quincenas.flatMap((q) => q.orders)
  )

  const filteredRecordCount = filteredOrders.reduce(
    (s, o) => s + linesOf(o).length,
    0
  )
  const filteredTotalGeneral = filteredOrders.reduce(
    (s, o) => s + o.totalFacturado,
    0
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">CESAR – Facturación de Órdenes de Trabajo</h1>
        <Button variant="outline" size="sm">
          Exportar a Excel
        </Button>
      </div>

      {breakdown && (
        <>
          {/* Selector de mes */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground">
                  Filtrar por mes:
                </span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="border border-input bg-background px-3 py-2 text-sm rounded-md focus:ring-2 focus:ring-ring focus:ring-offset-1"
                >
                  <option value="">Todos los meses</option>
                  {breakdown.groups.map((g) => (
                    <option key={g.month} value={g.month}>
                      {g.monthLabel}
                    </option>
                  ))}
                </select>

                <span className="text-sm font-medium text-muted-foreground">
                  Estado:
                </span>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="border border-input bg-background px-3 py-2 text-sm rounded-md focus:ring-2 focus:ring-ring focus:ring-offset-1 w-40"
                >
                  <option value="">Todos los estados</option>
                  {breakdown?.statuses?.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label} ({s.count})
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showOnly1012}
                    onChange={(e) => setShowOnly1012(e.target.checked)}
                    className="border border-input bg-background rounded-md px-2 py-1"
                  />
                  <span className="text-sm text-muted-foreground">
                    Mostrar solo ítem 1012 MO CES
                  </span>
                </div>

                <span className="text-sm font-medium text-muted-foreground">
                  Quincena:
                </span>
                <select
                  value={selectedPayPeriod}
                  onChange={(e) => setSelectedPayPeriod(e.target.value)}
                  className="border border-input bg-background px-3 py-2 text-sm rounded-md focus:ring-2 focus:ring-ring focus:ring-offset-1"
                >
                  <option value="">Todas las quincenas</option>
                  {allPayPeriods.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {(selectedMonth || selectedPayPeriod) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedMonth("")
                    setSelectedPayPeriod("")
                  }}
                >
                  Limpiar filtro
                </Button>
              )}
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resumen General</CardTitle>
            </CardHeader>
                <CardContent className="flex items-center justify-between text-lg">
                  <div>
                    <p className="text-muted-foreground text-sm">
                      Órdenes facturadas
                    </p>
                    <p className="font-semibold">{filteredOrders.length}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground text-sm">
                      Líneas de facturación
                    </p>
                    <p className="font-semibold">
                      {filteredRecordCount}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground text-sm">
                      Total general facturado
                    </p>
                    <p className="font-bold text-primary">
                      $ {formatMoney(filteredTotalGeneral)}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {filteredGroups.map((monthGroup) => (
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
                    {quincena.orders.map((order) => {
                      const orderLines = linesOf(order)
                      const subtotals = LINE_TYPE_ORDER.map((t) => ({
                        type: t,
                        label: LINE_TYPE_LABELS[t],
                        amount: order.typeTotals?.[t] ?? 0,
                      })).filter((s) => s.amount > 0)
                      return (
                      <Card key={order.orderNumber}>
                        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                          <div className="space-y-1">
                            <CardTitle className="text-sm font-medium">
                              Orden {order.orderNumber}
                            </CardTitle>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>Fecha: {formatDate(order.date ?? orderLines[0]?.date)}</span>
                              <span>Quincena: {order.payPeriod}</span>
                              <span>Mes: {order.month}</span>
                              {order.operator ? <span>Usuario: {order.operator}</span> : null}
                              {order.client ? <span>Cliente: {order.client}</span> : null}
                              <span>Líneas: {orderLines.length}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Total facturado</p>
                            <p className="font-semibold">
                              $ {formatMoney(order.totalFacturado)}
                            </p>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                              <thead>
                                <tr className="border-b bg-muted/50 text-muted-foreground">
                                  <th className="p-3">Tipo</th>
                                  <th className="p-3">Código</th>
                                  <th className="p-3">Descripción</th>
                                  <th className="p-3 text-right">Cantidad</th>
                                  <th className="p-3 text-right">Precio Unit.</th>
                                  <th className="p-3 text-right">Monto</th>
                                </tr>
                              </thead>
                              <tbody>
                                {orderLines.map((item, idx) => (
                                  <tr key={`${order.orderNumber}-${idx}-${item.description}`} className="border-b border-muted/30 last:border-0">
                                    <td className="p-3 text-xs uppercase text-muted-foreground">
                                      {LINE_TYPE_LABELS[item.type as CesarLineType] ?? item.type}
                                    </td>
                                    <td className="p-3 font-mono">{item.code ?? "-"}</td>
                                    <td className="p-3">{item.description}</td>
                                    <td className="p-3 text-right">{item.quantity.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-3 text-right">$ {formatMoney(item.unitPrice)}</td>
                                    <td className="p-3 text-right font-semibold">$ {formatMoney(item.totalPrice)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {subtotals.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {subtotals.map((s) => (
                                <div
                                  key={s.type}
                                  className="rounded-md border bg-muted/40 px-3 py-1.5 text-xs"
                                >
                                  <span className="text-muted-foreground">{s.label}: </span>
                                  <span className="font-semibold">$ {formatMoney(s.amount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                      )
                    })}
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
