"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { getAllOrders } from "@/services/sparePartOrders"
import { getRepairs } from "@/services/repairs"
import type { SparePartOrder, MachineRepair } from "@/types"

export default function PurchaseListPage() {
  const [orders, setOrders] = useState<SparePartOrder[]>([])
  const [encargados, setEncargados] = useState<SparePartOrder[]>([])
  const [repairsMap, setRepairsMap] = useState<Map<string, MachineRepair>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const [ords, reps] = await Promise.all([
          getAllOrders(),
          getRepairs().catch(() => [] as MachineRepair[]),
        ])
        const map = new Map<string, MachineRepair>()
        for (const r of reps) map.set(r.id, r)
        setRepairsMap(map)

        const now = new Date()
        const start = new Date(now)
        start.setDate(now.getDate() - (now.getDay() === 0 ? 6 : now.getDay() - 1))
        start.setHours(0, 0, 0, 0)
        const end = new Date(start)
        end.setDate(start.getDate() + 6)
        end.setHours(23, 59, 59, 999)

        const pendientes = ords.filter((o) => o.status === "SOLICITADO" || o.status === "PEDIDO")
        const enc = ords.filter(
          (o) =>
            o.status === "ENCARGADO" &&
            o.orderedAt instanceof Date &&
            o.orderedAt >= start &&
            o.orderedAt <= end,
        )
        setOrders(pendientes)
        setEncargados(enc)
      } catch (err) {
        console.error("[PurchaseList]", err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const fmtDate = (d: Date | undefined) => (d ? d.toLocaleDateString("es-AR") : "—")
  const today = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })
  const hasContent = orders.length > 0 || encargados.length > 0

  return (
    <div className="p-6 space-y-4">
      <div className="print:hidden flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Lista de compra de repuestos</h1>
          <p className="text-sm text-muted-foreground">
            Pendientes ({orders.length}) · Encargados esta semana ({encargados.length})
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/spare-part-orders" className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted">Volver</Link>
          <button
            onClick={() => window.print()}
            disabled={loading || !hasContent}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Imprimir lista
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground print:hidden">Cargando...</p>
      ) : (
        <div id="purchase-print" className="bg-white text-black p-4 rounded-lg border print:border-0 print:p-0 print:rounded-none">
          <div style={{ textAlign: "center" }} className="mb-4">
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>LISTA DE COMPRA DE REPUESTOS</h2>
            <p style={{ fontSize: 12 }}>Pedido realizado: {today}</p>
          </div>

          {orders.length > 0 && (
            <>
              <h3 style={{ fontSize: 12, fontWeight: 700, marginTop: 16, marginBottom: 4 }}>1. PENDIENTES DE ENCARGAR (lo que el dueño debe comprar)</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    {["", "Maquina", "Modelo", "Repuesto", "Codigo", "Cant.", "Orden", "Cliente", "Fecha pedido"].map((h) => (
                      <th key={h} style={{ border: "1px solid #999", padding: "4px 6px", textAlign: "left", background: "#f3f3f3" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const repair = repairsMap.get(o.repairId)
                    return (
                      <tr key={o.id}>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", width: 24 }}></td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px" }}>{o.machineName}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px" }}>{repair?.machineModel ?? ""}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px" }}>{o.description}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", fontFamily: "monospace" }}>{o.code}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", textAlign: "right" }}>{o.quantityRequested}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px" }}>{o.orderNumber || o.repairId.replace("maintenance:", "")}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px" }}>{repair?.clientName ?? ""}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", whiteSpace: "nowrap" }}>{fmtDate(o.requestedAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 8, fontSize: 11 }}>
                Total items: {orders.length} - Total unidades: {orders.reduce((a, o) => a + o.quantityRequested, 0)}
              </div>
            </>
          )}

          {encargados.length > 0 && (
            <>
              <h3 style={{ fontSize: 12, fontWeight: 700, marginTop: 24, marginBottom: 4 }}>2. ANEXO - ENCARGADOS ESTA SEMANA (seguimiento de retiros)</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    {["", "Repuesto", "Codigo", "Cant.", "Orden", "Maquina", "Cliente", "Fecha pedido", "Proveedor", "Fecha encargo", "Retiro estimado"].map((h) => (
                      <th key={h} style={{ border: "1px solid #999", padding: "4px 6px", textAlign: "left", background: "#f3f3f3" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {encargados.map((o) => {
                    const repair = repairsMap.get(o.repairId)
                    return (
                      <tr key={o.id}>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", width: 24 }}></td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px" }}>{o.description}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", fontFamily: "monospace" }}>{o.code}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", textAlign: "right" }}>{o.quantityRequested}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px" }}>{o.orderNumber || o.repairId.replace("maintenance:", "")}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px" }}>{o.machineName}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px" }}>{repair?.clientName ?? ""}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", whiteSpace: "nowrap" }}>{fmtDate(o.requestedAt)}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px" }}>{o.supplier ?? ""}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", whiteSpace: "nowrap" }}>{fmtDate(o.orderedAt)}</td>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", whiteSpace: "nowrap" }}>{fmtDate(o.expectedAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}

          </div>
      )}

      {!loading && !hasContent && (
        <p className="text-sm text-muted-foreground print:hidden">
          No hay pedidos pendientes de encargar esta semana ni encargados registrados.
        </p>
      )}

      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          #purchase-print, #purchase-print * { visibility: visible; }
          #purchase-print { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>
    </div>
  )
}