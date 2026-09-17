"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { getAllOrders, splitMachineModel } from "@/services/sparePartOrders"
import { buildSparePartOrderGroups } from "@/lib/sparePartOrderGroups"
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

  const fmtDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("es-AR") : "—")
  const today = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })
    const hasContent = orders.length > 0 || encargados.length > 0

    // Extrae el número numérico del N° de Orden para ordenar de forma determinista.
  // Ej: "X 0001-00011154" -> 11154
  // IMPORTANTE: extrae el ÚLTIMO grupo de dígitos, no el primero.
  // El formato "X 0001-NNNNNNNN" contiene "0001" como primer match (prefijo),
  // y el número real está después del guion.
    const extractNumericOrder = (orderNumber: string | null | undefined): number => {
    const matches = (orderNumber ?? "").match(/\d+/g)
    if (matches && matches.length > 0) {
      return parseInt(matches[matches.length - 1], 10)
    }
    return 0
  }

  // Normaliza el orderNumber a solo el número (string) para agrupar.
  // Esto asegura que buildSparePartOrderGroups() una todos los repuestos
  // del mismo número, incluso si el string original tiene caracteres invisibles.
  const normalizeOrderNumber = (orderNumber: string | null | undefined): string => {
    const num = extractNumericOrder(orderNumber)
    return num > 0 ? num.toString() : (orderNumber ?? "").trim().toUpperCase() || ""
  }

  // Formatea el número normalizado para display: "11271" -> "X 0001-00011271"
  const formatOrderNumber = (orderNumber: string): string => {
    const num = extractNumericOrder(orderNumber)
    if (num > 0) {
      return `X 0001-${num.toString().padStart(8, "0")}`
    }
    const trimmed = (orderNumber ?? "").trim()
    return trimmed || "—"
  }


  // Agrupamiento SOLO visual por N° de Orden (igual que la pantalla principal).
  // Cada repuesto conserva su propio documento: orderNumber/machineName/machineModel/
  // description/code/requestedAt/receivedAt nunca se copian entre documentos.
  // Se ordenan los pedidos por N° de Orden (numérico, descendente) antes de agrupar
  // para garantizar que buildSparePartOrderGroups() mantenga juntos todos los
  // repuestos de cada orden y que los grupos aparezcan en orden determinista.
    const pendingGroups = useMemo(() => {
    const normalized = orders
      .map((o) => ({ ...o, orderNumber: normalizeOrderNumber(o.orderNumber) }))
      .sort((a, b) => extractNumericOrder(b.orderNumber) - extractNumericOrder(a.orderNumber))
    return buildSparePartOrderGroups(normalized)
  }, [orders])
  const encargadosGroups = useMemo(() => {
    const normalized = encargados
      .map((o) => ({ ...o, orderNumber: normalizeOrderNumber(o.orderNumber) }))
      .sort((a, b) => extractNumericOrder(b.orderNumber) - extractNumericOrder(a.orderNumber))
    return buildSparePartOrderGroups(normalized)
  }, [encargados])

  const displayCode = (code: string | null | undefined) =>
    code && code.trim() !== "" && code.trim().toUpperCase() !== "S/C" ? code : "—"
  const displayModel = (o: SparePartOrder) =>
    o.machineModel ?? splitMachineModel(o.machineName).model

  const printCols = ["", "N° Orden", "Máquina", "Modelo", "Repuesto", "Código repuesto", "Pedido", "Entrega"]
  const thStyle = { border: "1px solid #999", padding: "4px 6px", textAlign: "left" as const, background: "#f3f3f3" }
  const tdStyle = { border: "1px solid #999", padding: "4px 6px", verticalAlign: "top" as const }

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
                    {printCols.map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pendingGroups.map((g) =>
                    g.parts.map((part, idx) => {
                      const o = part.order
                      const model = displayModel(o)
                      const code = displayCode(o.code)
                      return (
                      <tr key={o.id}>
                        <td style={{ border: "1px solid #999", padding: "4px 6px", width: 24 }}></td>
                                                  {idx === 0 && (
                            <td rowSpan={g.parts.length} style={tdStyle}>{formatOrderNumber(g.orderNumber)}</td>
                          )}
                          {idx === 0 && (
                            <td rowSpan={g.parts.length} style={tdStyle}>{g.machineName}</td>
                          )}
                          {idx === 0 && (
                            <td rowSpan={g.parts.length} style={tdStyle}>{model ?? "—"}</td>
                          )}
                          <td style={tdStyle}>{part.description || "—"}</td>
                          <td style={{ ...tdStyle, fontFamily: "monospace" }}>{code}</td>
                                                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{fmtDate(o.requestedAt)}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{fmtDate(o.receivedAt)}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
              <div style={{ marginTop: 8, fontSize: 11 }}>
                Total items: {orders.length}
              </div>
            </>
          )}

          {encargados.length > 0 && (
            <>
              <h3 style={{ fontSize: 12, fontWeight: 700, marginTop: 24, marginBottom: 4 }}>2. ANEXO - ENCARGADOS ESTA SEMANA (seguimiento de retiros)</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                                        {printCols.map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                                    {encargadosGroups.map((g) =>
                    g.parts.map((part, idx) => {
                      const o = part.order
                      const model = displayModel(o)
                      const code = displayCode(o.code)
                      return (
                                              <tr key={o.id}>
                          <td style={{ border: "1px solid #999", padding: "4px 6px", width: 24 }}></td>
                          {idx === 0 && (
                            <td rowSpan={g.parts.length} style={tdStyle}>{formatOrderNumber(g.orderNumber)}</td>
                          )}
                          {idx === 0 && (
                            <td rowSpan={g.parts.length} style={tdStyle}>{g.machineName}</td>
                          )}
                          {idx === 0 && (
                            <td rowSpan={g.parts.length} style={tdStyle}>{model ?? "—"}</td>
                          )}
                          <td style={tdStyle}>{part.description || "—"}</td>
                          <td style={{ ...tdStyle, fontFamily: "monospace" }}>{code}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{fmtDate(o.requestedAt)}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{fmtDate(o.receivedAt)}</td>
                        </tr>
                      )
                    })
                  )}
                                </tbody>
              </table>
              <div style={{ marginTop: 8, fontSize: 11 }}>
                Total items: {encargados.length}
              </div>
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