"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { getAllOrders, splitMachineIdentification } from "@/services/sparePartOrders"
import { buildSparePartOrderGroups, type SparePartOrderGroup } from "@/lib/sparePartOrderGroups"
import { updateOrderSupplier } from "@/services/sparePartOrderSupplier"
import { getRepairs } from "@/services/repairs"
import type { SparePartOrder, MachineRepair } from "@/types"

/**
 * Extrae el número real del N° de Orden.
 * Ej: "X 0001-00011154" -> 11154
 *
 * IMPORTANTE: se toma el ÚLTIMO grupo de dígitos, NO el primero.
 * El formato "X 0001-NNNNNNNN" arranca con "0001" (prefijo), que NO es el
 * número de orden; el número real está después del guion.
 */
function extractNumericOrder(orderNumber: string | null | undefined): number {
  const matches = (orderNumber ?? "").match(/\d+/g)
  if (matches && matches.length > 0) {
    return parseInt(matches[matches.length - 1], 10)
  }
  return 0
}

/**
 * Agrupamiento SOLO visual por N° de Orden (igual criterio que la pantalla
 * principal de Pedidos).
 *
 * - Se usa buildSparePartOrderGroups() para agrupar por el texto normalizado.
 * - Como refuerzo, se fusionan los grupos que comparten el mismo número real
 *   (por si el texto original difiere por espacios o caracteres invisibles).
 * - Cada repuesto conserva su propio registro: orderNumber/machineName/
 *   machineModel/description/code/requestedAt/receivedAt nunca se copian ni se
 *   inventan entre documentos.
 * - El N° de Orden y la máquina que se muestran son siempre el texto ORIGINAL
 *   del primer registro del grupo (no se reformatea el dato de la fuente).
 */
function groupOrdersByNumber(list: SparePartOrder[]): SparePartOrderGroup[] {
  const groups = buildSparePartOrderGroups(list)
  const merged: SparePartOrderGroup[] = []
  const positions = new Map<string, number>()

  for (const group of groups) {
    const num = extractNumericOrder(group.orderNumber)
    // Sin número reconocible se respeta la clave original (no se fusiona).
    const key = num > 0 ? `#${num}` : group.key
    const position = positions.get(key)

    if (position === undefined) {
      positions.set(key, merged.length)
      merged.push({ ...group, parts: [...group.parts], ids: [...group.ids] })
    } else {
      const target = merged[position]
      target.parts.push(...group.parts)
      target.ids.push(...group.ids)
      target.totalParts = target.parts.length
    }
  }

  return merged
}

/**
 * Lista de "casas de repuesto" ya usadas, para el desplegable de sugerencias.
 *
 * Se arma con los pedidos que la página YA descarga: NO hace ninguna consulta
 * extra a la base.
 *
 * - Sin repetidos, comparando sin mayúsculas ni espacios dobles
 *   ("Casa Bosch" = "casa bosch"): se conserva el primer texto tal cual.
 * - Ordenada alfabéticamente en español.
 */
function buildStoreList(orders: SparePartOrder[]): string[] {
  const byKey = new Map<string, string>()
  for (const o of orders) {
    const name = (o.supplier ?? "").trim().replace(/\s+/g, " ")
    if (!name) continue
    const key = name.toLocaleUpperCase("es")
    if (!byKey.has(key)) byKey.set(key, name)
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "es"))
}

/**
 * Fecha tal como se IMPRIME en la hoja de compra (`dd/mm/aaaa`), o `—` cuando el
 * pedido todavía no tiene esa fecha.
 *
 * Las fechas se cargan a mano en "Pedidos Rep." (pantalla principal, panel de la
 * reparación o detalle del pedido): la hoja de compra SÓLO las muestra, no las
 * edita.
 */
function formatSheetDate(d: Date | null | undefined): string {
  if (!d) return "—"
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return "—"
  const day = String(dt.getDate()).padStart(2, "0")
  const month = String(dt.getMonth() + 1).padStart(2, "0")
  return `${day}/${month}/${dt.getFullYear()}`
}

export default function PurchaseListPage() {
  const [orders, setOrders] = useState<SparePartOrder[]>([])
  const [encargados, setEncargados] = useState<SparePartOrder[]>([])
  const [repairsMap, setRepairsMap] = useState<Map<string, MachineRepair>>(new Map())
  const [loading, setLoading] = useState(true)
  /** Casas de repuesto ya usadas, para el desplegable de sugerencias. */
  const [knownStores, setKnownStores] = useState<string[]>([])

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
        // Sugerencias del desplegable: casas ya usadas en CUALQUIER pedido
        // (no solo los de esta hoja). No genera consultas extra: usa `ords`.
        setKnownStores(buildStoreList(ords))
      } catch (err) {
        console.error("[PurchaseList]", err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const today = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })
    const hasContent = orders.length > 0 || encargados.length > 0


  // Agrupamiento SOLO visual por N° de Orden (mismo criterio que la pantalla
  // principal de Pedidos). Cada repuesto conserva su propio documento.
  const pendingGroups = useMemo(() => groupOrdersByNumber(orders), [orders])
  const encargadosGroups = useMemo(() => groupOrdersByNumber(encargados), [encargados])

  // ---------------------------------------------------------------------------
  // "Casa de repuesto" (dónde se compró o encargó). Se guarda en el campo
  // `supplier` que ya existía en el pedido. Solo se usa en esta hoja.
  // ---------------------------------------------------------------------------
  /** Texto que se está tipeando (por id de pedido), todavía sin guardar. */
  const [supplierDraft, setSupplierDraft] = useState<Record<string, string>>({})
  const [savingSupplierId, setSavingSupplierId] = useState<string | null>(null)
  const [savedSupplierId, setSavedSupplierId] = useState<string | null>(null)
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Limpieza: no dejar timers vivos si se sale de la página.
  useEffect(
    () => () => {
      for (const t of saveTimers.current.values()) clearTimeout(t)
      saveTimers.current.clear()
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current)
    },
    [],
  )

  /** Guarda una celda. No escribe en Firestore si el texto no cambió. */
  const persistSupplier = useCallback(
    async (orderId: string, value: string, original: string | undefined) => {
      const pending = saveTimers.current.get(orderId)
      if (pending) {
        clearTimeout(pending)
        saveTimers.current.delete(orderId)
      }

      const trimmed = value.trim()
      // Sin cambios → no se escribe (no gasta cuota de Firestore).
      if (trimmed === (original ?? "").trim()) return

      setSavingSupplierId(orderId)
      try {
        await updateOrderSupplier(orderId, trimmed)
        const next = trimmed || undefined
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, supplier: next } : o)))
        setEncargados((prev) => prev.map((o) => (o.id === orderId ? { ...o, supplier: next } : o)))
        setSupplierDraft((prev) => {
          if (!(orderId in prev)) return prev
          const copy = { ...prev }
          delete copy[orderId]
          return copy
        })
        // Si es una casa nueva, queda disponible en el desplegable al instante.
        if (trimmed) {
          const storeKey = trimmed.toLocaleUpperCase("es")
          setKnownStores((prev) =>
            prev.some((s) => s.toLocaleUpperCase("es") === storeKey)
              ? prev
              : [...prev, trimmed].sort((a, b) => a.localeCompare(b, "es")),
          )
        }
        setSavedSupplierId(orderId)
        if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current)
        savedFlashTimer.current = setTimeout(() => setSavedSupplierId(null), 2500)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo guardar la casa de repuesto")
      } finally {
        setSavingSupplierId(null)
      }
    },
    [],
  )

  const handleSupplierChange = (orderId: string, value: string, original: string | undefined) => {
    setSupplierDraft((prev) => ({ ...prev, [orderId]: value }))
    // Respaldo: si se cierra o recarga la pestaña sin salir de la celda, igual
    // se guarda al cabo de un momento de inactividad.
    const pending = saveTimers.current.get(orderId)
    if (pending) clearTimeout(pending)
    saveTimers.current.set(
      orderId,
      setTimeout(() => {
        void persistSupplier(orderId, value, original)
      }, 1500),
    )
  }

  const handleSupplierBlur = (orderId: string, original: string | undefined) => {
    const draft = supplierDraft[orderId]
    if (draft === undefined) return
    void persistSupplier(orderId, draft, original)
  }

  const handleSupplierKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, orderId: string, original: string | undefined) => {
    if (e.key === "Enter") {
      e.preventDefault()
      void persistSupplier(orderId, e.currentTarget.value, original)
    }
  }

  // La hoja de compra NO edita fechas: se cargan a mano en "Pedidos Rep." y acá
  // sólo se imprimen (ver `formatSheetDate`). La única celda editable de la hoja
  // es "Casa de repuesto" (ver `persistSupplier`).

  const displayCode = (code: string | null | undefined) =>
    code && code.trim() !== "" && code.trim().toUpperCase() !== "S/C" ? code : "—"
  // Modelo a mostrar: el guardado; si falta, se deriva con el mismo divisor del
  // importador (conserva el modelo completo, sin recortar ni duplicar).
  const displayModel = (o: SparePartOrder) =>
    o.machineModel ?? splitMachineIdentification(o.machineName).model

  const printCols = ["", "N° Orden", "Máquina", "Modelo", "Repuesto", "Código repuesto", "Le pedí al dueño", "Lo pidió en la casa", "Me lo trajo", "Casa de repuesto"]
  const thStyle = { border: "1px solid #999", padding: "4px 6px", textAlign: "left" as const, background: "#f3f3f3" }
  const tdStyle = { border: "1px solid #999", padding: "4px 6px", verticalAlign: "top" as const }
  // Celda de "Casa de repuesto": sin padding, para que el input la llene.
  const supplierCellStyle = { ...tdStyle, padding: 0, width: 120 }
  // El input NO tiene borde ni fondo: en pantalla se ve como texto y al imprimir
  // sale solo el texto. Si está vacío, queda el borde de la celda como renglón
  // para escribir a mano con lapicera.
  const supplierInputStyle = {
    width: "100%",
    border: 0,
    outline: 0,
    background: "transparent",
    font: "inherit",
    color: "inherit",
    padding: "4px 6px",
    display: "block",
  }

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
                            <td rowSpan={g.parts.length} style={tdStyle}>{g.orderNumber || "—"}</td>
                          )}
                          {idx === 0 && (
                            <td rowSpan={g.parts.length} style={tdStyle}>{g.machineName}</td>
                          )}
                          {idx === 0 && (
                            <td rowSpan={g.parts.length} style={tdStyle}>{model ?? "—"}</td>
                          )}
                          <td style={tdStyle}>{part.description || "—"}</td>
                          <td style={{ ...tdStyle, fontFamily: "monospace" }}>{code}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatSheetDate(o.ownerRequestedAt)}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatSheetDate(o.orderedAt)}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatSheetDate(o.receivedAt)}</td>
                          <td style={supplierCellStyle}>
                            <input
                              value={supplierDraft[o.id] ?? o.supplier ?? ""}
                              onChange={(e) => handleSupplierChange(o.id, e.target.value, o.supplier)}
                              onBlur={() => handleSupplierBlur(o.id, o.supplier)}
                              onKeyDown={(e) => handleSupplierKeyDown(e, o.id, o.supplier)}
                              aria-label="Casa de repuesto"
list="casas-repuesto"
                              autoComplete="off"
                              style={supplierInputStyle}
                            />
                            {savingSupplierId === o.id && (
                              <span className="print:hidden" style={{ fontSize: 9, color: "#666", padding: "0 6px 4px" }}>
                                guardando…
                              </span>
                            )}
                            {savedSupplierId === o.id && savingSupplierId !== o.id && (
                              <span className="print:hidden" style={{ fontSize: 9, color: "#16a34a", padding: "0 6px 4px" }}>
                                guardado ✓
                              </span>
                            )}
                          </td>
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
                            <td rowSpan={g.parts.length} style={tdStyle}>{g.orderNumber || "—"}</td>
                          )}
                          {idx === 0 && (
                            <td rowSpan={g.parts.length} style={tdStyle}>{g.machineName}</td>
                          )}
                          {idx === 0 && (
                            <td rowSpan={g.parts.length} style={tdStyle}>{model ?? "—"}</td>
                          )}
                          <td style={tdStyle}>{part.description || "—"}</td>
                          <td style={{ ...tdStyle, fontFamily: "monospace" }}>{code}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatSheetDate(o.ownerRequestedAt)}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatSheetDate(o.orderedAt)}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatSheetDate(o.receivedAt)}</td>
                          <td style={supplierCellStyle}>
                            <input
                              value={supplierDraft[o.id] ?? o.supplier ?? ""}
                              onChange={(e) => handleSupplierChange(o.id, e.target.value, o.supplier)}
                              onBlur={() => handleSupplierBlur(o.id, o.supplier)}
                              onKeyDown={(e) => handleSupplierKeyDown(e, o.id, o.supplier)}
                              aria-label="Casa de repuesto"
list="casas-repuesto"
                              autoComplete="off"
                              style={supplierInputStyle}
                            />
                            {savingSupplierId === o.id && (
                              <span className="print:hidden" style={{ fontSize: 9, color: "#666", padding: "0 6px 4px" }}>
                                guardando…
                              </span>
                            )}
                            {savedSupplierId === o.id && savingSupplierId !== o.id && (
                              <span className="print:hidden" style={{ fontSize: 9, color: "#16a34a", padding: "0 6px 4px" }}>
                                guardado ✓
                              </span>
                            )}
                          </td>

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

            {/* Sugerencias de "Casa de repuesto". Vive fuera de #purchase-print, así
          NUNCA se imprime: solo alimenta el desplegable de las celdas. */}
      <datalist id="casas-repuesto">
        {knownStores.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

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