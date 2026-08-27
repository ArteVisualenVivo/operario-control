"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { getAllOrders } from "@/services/sparePartOrders"
import { getRepairs } from "@/services/repairs"
import type { SparePartOrder, MachineRepair } from "@/types"

/**
 * LISTA DE COMPRA DE REPUESTOS — versión para imprimir.
 * Reemplaza el papel semanal que se le entrega al dueño.
 */
export default function PurchaseListPage() {
  const [orders, setOrders] = useState<SparePartOrder[]>([])
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
        // Lista de compra = lo que todavía falta conseguir
        setOrders(ords.filter((o) => o.status === "SOLICITADO" || o.status === "PEDIDO"))
      } catch (err) {
        console.error("[PurchaseList]", err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const fmtDate = (d: Date | undefined) =>
    d ? d.toLocaleDateString("es-AR") : "—"

  const today = new Date().toLocaleDateString("es-AR", {
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
  })

  return (
    <div className="p-6 space-y-4">
      <div className="print:hidden flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Lista de compra de repuestos</h1>
          <p className="text-sm text-muted-foreground">
            Pedidos sin encargar ({orders.length}) — lo que falta entregar al dueño esta semana.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/spare-part-orders" className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted">Volver</Link>
          <button
            onClick={() => window.print()}
            disabled={loading || orders.length === 0}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            🖨️ Imprimir lista
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground print:hidden">Cargando...</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground print:hidden">
          No hay pedidos pendientes de encargar. ¡Nada para imprimir!
        </p>
      ) : (
        <div id="purchase-print" className="bg-white text-black p-4 rounded-lg border print:border-0 print:p-0 print:rounded-none">
          <div style={{ textAlign: "center" }} className="mb-4">
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>LISTA DE COMPRA DE REPUESTOS</h2>
            <p style={{ fontSize: 12 }}>Pedido realizado: {today}</p>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                {["✓", "Máquina", "Modelo", "Repuesto", "Código", "Cant.", "Orden", "Cliente", "Fecha pedido"].map((h) => (
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
            Total ítems: {orders.length} · Total unidades: {orders.reduce((a, o) => a + o.quantityRequested, 0)}
          </div>
          <div style={{ marginTop: 24, fontSize: 10, color: "#555" }}>
            Observaciones del encargo: ________________________________________________________________________
          </div>
        </div>
      )}

      {/* Impresión: solo la lista */}
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
