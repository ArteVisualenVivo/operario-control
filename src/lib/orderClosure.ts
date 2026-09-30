import type { MaintenanceRecord } from "@/services/maintenance"
import type { SparePartOrder } from "@/types"

// orderClosure.ts — ¿El pedido sigue vigente según la línea de tiempo de 3C?
// REGLA (2026-09-28): ocultar en Pedidos las máquinas cuya orden ya se cerró,
// mirando FECHA + ESTADO de `states[]`:
//  - Terminales: Reparada(5), Entreg./Factur.(6), Retirada(13), No Reparada(7).
//  - Reapertura: Recepcion(1), en Taller(8) o A la Espera Repuestos con fecha
//    POSTERIOR al cierre (garantía) → el pedido reaparece.
// Módulo client-safe: sin fs/path/xlsx.

export interface OrderClosureInfo {
  closed: boolean
  terminalStatus?: string
  terminalDate?: Date | null
  reopenedAfterTerminal?: boolean
}

function normStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
}

/** Terminales. "No Reparada" se matchea primero y exacto, sin confundirla con "Reparada". */
export function isTerminalRepairState(status: unknown): boolean {
  const t = normStatus(status)
  if (!t) return false
  if (t.includes("no reparad")) return true
  if (t.includes("reparad")) return true
  if (t.includes("entreg") || t.includes("factur")) return true
  if (t.includes("retirad")) return true
  return false
}

/** Reaperturas: reingreso posterior al cierre. Los terminales nunca reabren. */
export function isReopenRepairState(status: unknown): boolean {
  const t = normStatus(status)
  if (!t || isTerminalRepairState(status)) return false
  if (t.includes("recepcion")) return true
  if (t.includes("taller")) return true
  if (t.includes("espera") && t.includes("repuest")) return true
  if (t.includes("reingreso")) return true
  return false
}
/** Parsea fechas de 3C (ISO, dd/mm/aaaa, Date) sin inventar "ahora". */
export function parseClosureDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string") {
    const t = value.trim()
    if (!t) return null
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
    if (m) {
      let y = Number(m[3])
      if (y < 100) y += 2000
      const d = new Date(y, Number(m[2]) - 1, Number(m[1]))
      return Number.isNaN(d.getTime()) ? null : d
    }
    const parsed = new Date(t)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** Dia calendario (UTC): 3C solo informa el dia, la hora es artificial. */
function dayKey(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Misma normalizacion que el agrupamiento visual de pedidos.
 *
 * El prefijo "X" de 3C ("X 0001-00010867") es una marca de la fuente y NO parte
 * del numero: la misma orden aparece escrita con y sin el (47 de 48 pedidos lo
 * traen, los 1140 registros de mantenimiento tambien). Si no se ignora, la
 * busqueda del registro de 3C falla y la regla de cierre NO se aplica: la orden
 * ya reparada/entregada queda como vigente y se sigue mostrando (e imprimiendo).
 * Se normaliza igual que `normOrderKey()` de sparePartOrders.ts.
 */
export function normOrderKey(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/^X\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function buildMaintenanceByOrder(records: MaintenanceRecord[]): Map<string, MaintenanceRecord> {
  const map = new Map<string, MaintenanceRecord>()
  for (const r of records) {
    const key = normOrderKey(r.orderNumber)
    if (key && !map.has(key)) map.set(key, r)
  }
  return map
}

interface StateLike {
  status?: unknown
  statusDate?: unknown
}

/**
 * Determina si el pedido esta cerrado por la linea de tiempo de 3C.
 * Recorre los estados con fecha >= requestedAt en orden cronologico:
 * terminal -> closed=true; reapertura posterior -> closed=false.
 * Empates del mismo dia se resuelven por orden de aparicion.
 * Sin estados de 3C, el ULTIMO estado conocido (status consolidado) manda:
 * los excels de estados ("Reparaciones del ...") actualizan status/statusDate
 * aunque la orden todavia no tenga states[] (caso 11154: "Reparada" 28/09).
 */
export function getOrderClosure(
  order: Pick<SparePartOrder, "orderNumber" | "requestedAt">,
  record?: MaintenanceRecord | null,
): OrderClosureInfo {
  if (!record) return { closed: false }
  const req = order.requestedAt instanceof Date && !Number.isNaN(order.requestedAt.getTime())
    ? order.requestedAt
    : null
  const reqDay = req ? dayKey(req) : Number.NEGATIVE_INFINITY
  const raw = (record as { states?: unknown }).states
  const states: StateLike[] = Array.isArray(raw) ? (raw as StateLike[]) : []
  if (states.length > 0) {
    const events = states
      .map((s, i) => ({ status: String(s?.status ?? ""), date: parseClosureDate(s?.statusDate), i }))
      .filter((e) => e.date !== null || reqDay === Number.NEGATIVE_INFINITY)
      .sort((a, b) => {
        const ta = a.date ? dayKey(a.date) : Number.POSITIVE_INFINITY
        const tb = b.date ? dayKey(b.date) : Number.POSITIVE_INFINITY
        if (ta !== tb) return ta - tb
        // MISMO DÍA: decide la HORA de lectura (statusDate), no la posición en el
        // array. `states[]` sigue el orden en que se procesaron los Excel del día,
        // no el reloj: la orden 11174 tenía "Entreg./Factur. 19:37" ANTES en el
        // array que el "A la Espera Repuestos 20:01" que 3C muestra como último
        // estado. Sin esto, un cierre observado ANTES del repuesto nuevo escondía
        // el pedido pedido por garantía/reingreso: el repuesto existía, tenía la
        // fecha del día y NO aparecía en la web ni en la hoja de compra.
        const ha = a.date ? a.date.getTime() : Number.POSITIVE_INFINITY
        const hb = b.date ? b.date.getTime() : Number.POSITIVE_INFINITY
        if (ha !== hb) return ha - hb
        return a.i - b.i
      })
    let closed = false
    let terminalStatus: string | undefined
    let terminalDate: Date | null = null
    let reopened = false
    for (const e of events) {
      const day = e.date ? dayKey(e.date) : Number.POSITIVE_INFINITY
      if (day < reqDay) continue
      if (isTerminalRepairState(e.status)) {
        closed = true
        terminalStatus = e.status
        terminalDate = e.date
        reopened = false
      } else if (isReopenRepairState(e.status)) {
        if (closed) reopened = true
        closed = false
      }
    }
    return { closed, terminalStatus, terminalDate, reopenedAfterTerminal: reopened }
  }
  if (isTerminalRepairState(record.status)) {
    const stDate = parseClosureDate(record.statusDate) ?? parseClosureDate(record.entryDate)
    if (!req || !stDate || dayKey(stDate) >= dayKey(req)) {
      return { closed: true, terminalStatus: record.status, terminalDate: stDate }
    }
  }
  return { closed: false }
}

