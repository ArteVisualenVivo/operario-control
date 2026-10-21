import * as XLSX from "xlsx"
import type { LaborRecordInput } from "@/types/laborRecord"

export interface CesarParseResult {
  laborRecords: LaborRecordInput[]
  repuestoRows: { orderNumber: string; codigo: string; descripcion: string; cantidad: number; precioUnitario: number; total: number; fecha: Date }[]
  rawCount: number
}

function normHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.\s*/g, "_")
    .replace(/\s+/g, "_")
}

function toNum(value: unknown): number {
  const parsed = parseFloat(String(value ?? 0).replace(",", ".").replace(/[^\d,\.-]/g, ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
    const s = String(value).trim()
    const m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/)
    if (m) {
      const d = parseInt(m[1], 10)
      const mo = parseInt(m[2], 10) - 1
      const y = parseInt(m[3], 10)
      const constructed = new Date(y, mo, d)
      if (!Number.isNaN(constructed.getTime())) return constructed
    }
  }
  return null
}

function cell(rows: unknown[][], rowIndex: number, idx: number): unknown {
  return rows[rowIndex]?.[idx]
}


function findCesarHeaderRow(rows: unknown[][]): { headerIndex: number; cols: Map<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    const cols = new Map<string, number>()
    row.forEach((cellVal, idx) => {
      const n = normHeader(cellVal)
      if (n && !cols.has(n)) cols.set(n, idx)
    })
    const hasCode = cols.has("codigo") || cols.has("cod") || cols.has("code")
    const hasDesc = cols.has("descripcion") || cols.has("descripcion_articulo") || cols.has("detalle")
    const hasQty = cols.has("cantidad") || cols.has("cant") || cols.has("hs") || cols.has("horas")
    const hasPrice = cols.has("precio_unitario") || cols.has("precio") || cols.has("unitario")
    const hasTotal = cols.has("total") || cols.has("importe") || cols.has("monto")
    if ((hasCode && hasDesc) || (hasQty && hasPrice && hasTotal)) {
      return { headerIndex: i, cols }
    }
  }
  return null
}

function isLaborRow(codigo: string, descripcion: string): boolean {
  const c = codigo.trim()
  const d = descripcion.trim().toUpperCase()
  if (/^\d{3,4}$/.test(c)) return true
  if (/^MO\b/.test(d)) return true
  if (/MANO\s+DE\s+OBRA/.test(d)) return true
  return false
}

function extractOrderNumber(row: unknown[], cols: Map<string, number>, rawRows: unknown[][], rowIndex: number): string {
  for (const [name, idx] of cols) {
    if (name.includes("orden") || name.includes("nro") || name.includes("numero") || name.includes("id")) {
      const val = cell(rawRows, rowIndex, idx)
      if (val !== null && val !== undefined && String(val).trim()) return String(val).trim()
    }
  }
  for (let i = rowIndex - 1; i >= Math.max(0, rowIndex - 10); i--) {
    const r = rawRows[i]
    if (!Array.isArray(r)) continue
    const joined = r.map(String).join(" ").toUpperCase()
    if (/X\s*\d{4,}-\d{4,}/.test(joined)) {
      const m = joined.match(/X\s*\d{4,}-\d{4,}/)
      return m ? m[0].replace(/\s/g, "") : ""
    }
  }
  return ""
}


export function parseCesarBuffer(buffer: ArrayBuffer | Buffer): CesarParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })
  const detected = findCesarHeaderRow(rawRows)
  const cols = detected?.cols ?? new Map<string, number>()
  const idx = {
    codigo: cols.get("codigo") ?? cols.get("cod") ?? cols.get("code") ?? 0,
    descripcion: cols.get("descripcion") ?? cols.get("descripcion_articulo") ?? cols.get("detalle") ?? 1,
    unidad: cols.get("unidad") ?? cols.get("un_med") ?? cols.get("um") ?? 2,
    cantidad: cols.get("cantidad") ?? cols.get("cant") ?? cols.get("hs") ?? cols.get("horas") ?? 3,
    precioUnitario: cols.get("precio_unitario") ?? cols.get("precio") ?? cols.get("unitario") ?? 4,
    total: cols.get("total") ?? cols.get("importe") ?? cols.get("monto") ?? 5,
    fecha: cols.get("fecha") ?? cols.get("fecha_orden") ?? -1,
  }
  const startRow = (detected?.headerIndex ?? 0) + 1
  const laborRecords: LaborRecordInput[] = []
  const repuestoRows: CesarParseResult["repuestoRows"] = []
  let currentOrderNumber = ""

  for (let i = startRow; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (!row || !Array.isArray(row)) continue
    const codigo = (cell(rawRows, i, idx.codigo) ?? "").toString().trim()
    const descripcion = (cell(rawRows, i, idx.descripcion) ?? "").toString().trim()
    if (!codigo && !descripcion) continue
    const ordenDesdeCol = extractOrderNumber(row, cols, rawRows, i)
    if (ordenDesdeCol) currentOrderNumber = ordenDesdeCol
    const cantidad = toNum(cell(rawRows, i, idx.cantidad))
    const precioUnitario = toNum(cell(rawRows, i, idx.precioUnitario))
    const total = toNum(cell(rawRows, i, idx.total))
    const fecha = idx.fecha >= 0 ? toDate(cell(rawRows, i, idx.fecha)) : null

    if (isLaborRow(codigo, descripcion)) {
      const operator = descripcion.toUpperCase().replace(/^MO\s*/, "").trim() || "CES"
      laborRecords.push({
        orderNumber: currentOrderNumber || "",
        operator,
        code: codigo,
        description: descripcion,
        quantity: cantidad > 0 ? cantidad : 1,
        unitPrice: precioUnitario > 0 ? precioUnitario : 0,
        totalPrice: total > 0 ? total : (precioUnitario > 0 && cantidad > 0 ? precioUnitario * cantidad : 0),
        date: fecha ?? new Date(),
      })
    } else {
      repuestoRows.push({
        orderNumber: currentOrderNumber || "",
        codigo,
        descripcion,
        cantidad: cantidad > 0 ? cantidad : 0,
        precioUnitario: precioUnitario > 0 ? precioUnitario : 0,
        total: total > 0 ? total : (precioUnitario > 0 && cantidad > 0 ? precioUnitario * cantidad : 0),
        fecha: fecha ?? new Date(),
      })
    }
  }

  return {
    laborRecords,
    repuestoRows,
    rawCount: rawRows.length,
  }
}
