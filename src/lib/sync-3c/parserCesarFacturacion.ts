import * as XLSX from "xlsx"

// parserCesarFacturacion.ts — Parser del export de CESAR (órdenes de trabajo
// de 3C con TODAS las líneas de facturación).
//
// El Excel de 3C (informe "Reparaciones" en modo Detalle) trae UNA FILA por
// línea facturada de cada orden. Encabezados reales (fila 3 del Excel):
//
//   FECHA (1) | NUMERO (2) | PERSONAS_TEX (7) | USUARIO (14) |
//   VENDEDOR (22) | DENOMINACION (23) | PRECIO_ITEMS (24)
//
// Realidades verificadas sobre el export real (tresc1568401675785126819.xls):
//   · NO existe columna de cantidad → cada línea vale 1 unidad (precio = monto).
//   · Cada orden tiene UNA sola fecha (0 órdenes con más de una fecha).
//   · Hay líneas EXACTAMENTE repetidas dentro de una misma orden (duplicados
//     del informe) → se deduplican por (descripción + monto) DENTRO de la orden.
//   · "REPARACION:" NO es un subtotal: es el concepto facturado del trabajo.
//   · "MOA" NO es un subtotal: es mano de obra adicional.
//   · "SE ..." y "EMPRESA ..." son notas/gastos, no repuestos.
//
// Resultado verificado sobre el export real: 912 órdenes, 2.578 líneas
// deduplicadas, $50.302.393.36 totales.

export type CesarLineType =
  | "mano_obra"
  | "moa"
  | "servicio"
  | "gastos"
  | "reparacion"
  | "repuesto"

export interface CesarLine {
  type: CesarLineType
  code: string | null
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
  /** Fecha de la orden en ISO (una sola por orden). */
  date: string
  /** Operario deducido de la línea ("MO CES" → "CES"); null si no aplica. */
  operator: string | null
}

export type CesarTypeTotals = Record<CesarLineType, number>

export interface CesarOrder {
  orderNumber: string
  /** Fecha de la orden en ISO. */
  date: string
  /** Quincena: "YYYY-MM-DD al YYYY-MM-DD". */
  payPeriod: string
  /** Mes: "YYYY-MM". */
  month: string
  /** Usuario de 3C que cargó la orden (col USUARIO). */
  operator: string
  /** Cliente de la orden (col PERSONAS_TEX). */
  client: string
  totalFacturado: number
  lineCount: number
  typeTotals: CesarTypeTotals
  lines: CesarLine[]
}

export interface CesarFacturacionResult {
  orders: CesarOrder[]
  orderCount: number
  lineCount: number
  totalGeneral: number
  rawCount: number
  duplicatesRemoved: number
}

export const CESAR_LINE_TYPE_LABELS: Record<CesarLineType, string> = {
  mano_obra: "Mano de obra",
  moa: "Mano de obra adicional (MOA)",
  servicio: "Servicios",
  gastos: "Gastos",
  reparacion: "Reparación",
  repuesto: "Repuestos",
}

const EMPTY_TYPE_TOTALS = (): CesarTypeTotals => ({
  mano_obra: 0,
  moa: 0,
  servicio: 0,
  gastos: 0,
  reparacion: 0,
  repuesto: 0,
})

// Códigos de 3C que representan servicios de terceros (no repuestos).
const SERVICIO_CODIGOS = new Set([
  "RX",
  "MX",
  "IBMVA",
  "IBMIVA",
  "IVBM",
  "IMP",
  "IMPST",
  "IRM",
])

// Operarios que 3C a veces carga sin el prefijo "MO".
const OPERADORES_SUELTOS = new Set(["CES", "LAZARO", "ADRIAN"])

function normHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.\s*/g, "_")
    .replace(/\s+/g, "_")
}

function toNum(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const parsed = parseFloat(String(value ?? "0").replace(",", ".").replace(/[^\d,\.-]/g, ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "number" && Number.isFinite(value)) {
    // Serial de Excel (días desde 1899-12-30).
    const excelEpoch = Date.UTC(1899, 11, 30)
    const d = new Date(excelEpoch + value * 86400000)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === "string") {
    const s = value.trim()
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
    if (m) {
      const d = parseInt(m[1], 10)
      const mo = parseInt(m[2], 10) - 1
      const y = parseInt(m[3], 10)
      const constructed = new Date(y, mo, d)
      if (!Number.isNaN(constructed.getTime())) return constructed
    }
    const parsed = new Date(s)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

function toIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Quincena de liquidación (1-15 / 16-fin de mes). */
export function payPeriodFor(date: Date): string {
  const d = new Date(date)
  const day = d.getDate()
  const month = d.getMonth() + 1
  const year = d.getFullYear()
  const startDay = day <= 15 ? 1 : 16
  const endDay = day <= 15 ? 15 : new Date(year, month, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(startDay)} al ${year}-${pad(month)}-${pad(endDay)}`
}

/** Mes de liquidación "YYYY-MM". */
export function monthFor(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

/**
 * Clasifica una línea de facturación de 3C.
 * Devuelve el tipo y, cuando corresponde, el operario deducido de la línea.
 */
export function classifyCesarLine(description: string): { type: CesarLineType; operator: string | null } {
  const d = description.trim().toUpperCase()

  // "REPARACION: <equipo>" — y también las notas técnicas que terminan en
  // "REPARACION: <equipo>" (el monto corresponde al trabajo de reparación).
  if (d.includes("REPARACION:")) return { type: "reparacion", operator: null }

  // MOA: mano de obra adicional (NO es un subtotal).
  if (d === "MOA") return { type: "moa", operator: null }

  // Mano de obra: "MO CES", "MO INTERNA", "M/O", "MANO DE OBRA TOMAS".
  if (/^MO\b/.test(d)) {
    const operator = d.replace(/^MO\s*/, "").trim() || "CES"
    return { type: "mano_obra", operator }
  }
  if (/^M\/O\b/.test(d)) {
    return { type: "mano_obra", operator: "CES" }
  }
  if (/^MANO\s+DE\s+OBRA\b/.test(d)) {
    const operator = d.replace(/^MANO\s+DE\s+OBRA\s*/, "").trim() || null
    return { type: "mano_obra", operator }
  }
  if (OPERADORES_SUELTOS.has(d)) {
    return { type: "mano_obra", operator: d }
  }

  // Servicios de terceros.
  if (SERVICIO_CODIGOS.has(d)) return { type: "servicio", operator: null }
  if (/^SERVICIO\b/.test(d)) return { type: "servicio", operator: null }

  // Gastos (empresas de limpieza, gastos varios, fletes).
  if (/^GASTOS?\b/.test(d)) return { type: "gastos", operator: null }
  if (/^EMPRESA\b/.test(d)) return { type: "gastos", operator: null }
  if (/^LIMPIEZA\b/.test(d)) return { type: "gastos", operator: null }
  if (/^FLETE\b/.test(d)) return { type: "gastos", operator: null }

  // Notas de trabajo ("SE CAMBIA ...", "SE REALIZO ...").
  if (/^SE\b/.test(d)) return { type: "servicio", operator: null }

  return { type: "repuesto", operator: null }
}

interface CesarColumns {
  fecha: number
  numero: number
  cliente: number
  usuario: number
  vendedor: number
  descripcion: number
  precio: number
}

/**
 * Detecta la fila de encabezados y las posiciones de las columnas.
 * Si los encabezados no se reconocen, cae a las posiciones reales del export
 * de 3C (FECHA=1, NUMERO=2, PERSONAS_TEX=7, USUARIO=14, VENDEDOR=22,
 * DENOMINACION=23, PRECIO_ITEMS=24).
 */
export function detectCesarColumns(rows: unknown[][]): { headerIndex: number; cols: CesarColumns } {
  const fallback: CesarColumns = {
    fecha: 1,
    numero: 2,
    cliente: 7,
    usuario: 14,
    vendedor: 22,
    descripcion: 23,
    precio: 24,
  }

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    const map = new Map<string, number>()
    row.forEach((cell, idx) => {
      const n = normHeader(cell)
      if (n && !map.has(n)) map.set(n, idx)
    })
    const descripcion = map.get("DENOMINACION")
    const precio = map.get("PRECIO_ITEMS") ?? map.get("PRECIO")
    const numero = map.get("NUMERO")
    if (descripcion !== undefined && precio !== undefined && numero !== undefined) {
      return {
        headerIndex: i,
        cols: {
          fecha: map.get("FECHA") ?? fallback.fecha,
          numero,
          cliente: map.get("PERSONAS_TEX") ?? fallback.cliente,
          usuario: map.get("USUARIO") ?? fallback.usuario,
          vendedor: map.get("VENDEDOR") ?? fallback.vendedor,
          descripcion,
          precio,
        },
      }
    }
  }

  return { headerIndex: 2, cols: fallback }
}

function normOrderNumber(value: unknown): string {
  const s = String(value ?? "").trim()
  const m = s.match(/X\s*\d{4,}-\d{4,}/)
  return m ? m[0].replace(/\s/g, "") : s
}

/**
 * Parsea el export de CESAR y devuelve las órdenes con TODAS sus líneas
 * deduplicadas, clasificadas y agrupadas por quincena y mes.
 *
 * Deduplicación: dentro de una misma orden, dos líneas con la MISMA
 * descripción y el MISMO monto son duplicados del informe de 3C y se
 * conservan una sola vez (verificado: sólo hay 4 pares así en el export real
 * y en los 4 casos las filas son idénticas byte a byte).
 */
export function parseCesarFacturacionBuffer(buffer: ArrayBuffer | Buffer): CesarFacturacionResult {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: null,
  })

  const { headerIndex, cols } = detectCesarColumns(rawRows)

  interface OrderAccum {
    orderNumber: string
    date: Date | null
    operator: string
    client: string
    seen: Set<string>
    lines: CesarLine[]
  }

  const byOrder = new Map<string, OrderAccum>()
  let rawCount = 0
  let duplicatesRemoved = 0

  for (let i = headerIndex + 1; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (!row || !Array.isArray(row)) continue

    const orderNumber = normOrderNumber(row[cols.numero])
    if (!orderNumber) continue

    const description = String(row[cols.descripcion] ?? "").trim()
    if (!description) continue

    rawCount++

    const price = toNum(row[cols.precio])
    const lineDate = toDate(row[cols.fecha])

    let acc = byOrder.get(orderNumber)
    if (!acc) {
      acc = {
        orderNumber,
        date: null,
        operator: String(row[cols.usuario] ?? "").trim(),
        client: String(row[cols.cliente] ?? "").trim(),
        seen: new Set<string>(),
        lines: [],
      }
      byOrder.set(orderNumber, acc)
    }
    if (!acc.date && lineDate) acc.date = lineDate
    if (!acc.operator) acc.operator = String(row[cols.usuario] ?? "").trim()
    if (!acc.client) acc.client = String(row[cols.cliente] ?? "").trim()

    // Deduplicación dentro de la misma orden: (descripción + monto).
    const dedupKey = `${description.toUpperCase()}|${price}`
    if (acc.seen.has(dedupKey)) {
      duplicatesRemoved++
      continue
    }
    acc.seen.add(dedupKey)

    const { type, operator } = classifyCesarLine(description)
    acc.lines.push({
      type,
      code: null,
      description,
      quantity: 1,
      unitPrice: price,
      totalPrice: price,
      date: lineDate ? toIso(lineDate) : "",
      operator,
    })
  }

  const orders: CesarOrder[] = []
  let lineCount = 0
  let totalGeneral = 0

  for (const acc of byOrder.values()) {
    const date = acc.date ?? new Date()
    const typeTotals = EMPTY_TYPE_TOTALS()
    let orderTotal = 0
    for (const line of acc.lines) {
      typeTotals[line.type] += line.totalPrice
      orderTotal += line.totalPrice
    }
    lineCount += acc.lines.length
    totalGeneral += orderTotal

    orders.push({
      orderNumber: acc.orderNumber,
      date: toIso(date),
      payPeriod: payPeriodFor(date),
      month: monthFor(date),
      operator: acc.operator,
      client: acc.client,
      totalFacturado: orderTotal,
      lineCount: acc.lines.length,
      typeTotals,
      lines: acc.lines,
    })
  }

  // Orden descendente por número de orden (igual que la vista anterior).
  orders.sort((a, b) => b.orderNumber.localeCompare(a.orderNumber))

  return {
    orders,
    orderCount: orders.length,
    lineCount,
    totalGeneral,
    rawCount,
    duplicatesRemoved,
  }
}
