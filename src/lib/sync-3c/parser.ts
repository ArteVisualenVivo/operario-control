import * as XLSX from "xlsx"
import type { Sync3CItem } from "./types"

const COLUMNS = {
  codigo: 2,
  name: 5,
  stockTotal: 20,
  deposito: 1,
  unidadRaw: 7,
}

const DATA_START_ROW = 6

const UNIT_MAP: Record<string, string> = {
  "UN.": "unidad",
  "1000 KH": "unidad",
}

function mapUnit(raw: unknown): string {
  const u = (raw ?? "").toString().trim().toUpperCase()
  return UNIT_MAP[u] || "unidad"
}

export interface ParseResult {
  items: Sync3CItem[]
  rawCount: number
}

export function parseExcel(buffer: ArrayBuffer | Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

  const items: Sync3CItem[] = []

  for (let i = DATA_START_ROW; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (!row || !Array.isArray(row)) continue

    const codigo = (row[COLUMNS.codigo] ?? "").toString().trim()
    const nameRaw = (row[COLUMNS.name] ?? "").toString().trim()
    if (!codigo && !nameRaw) continue

    const stockTotal = parseFloat(String(row[COLUMNS.stockTotal] ?? 0)) || 0
    const deposito = parseInt(String(row[COLUMNS.deposito] ?? 0)) || 0
    const unidadRaw = (row[COLUMNS.unidadRaw] ?? "").toString().trim()
    const unit = mapUnit(unidadRaw)

    items.push({
      codigo,
      name: nameRaw,
      normalizedName: nameRaw.toLowerCase().trim(),
      stockTotal,
      unit,
      deposito,
      source: "3c",
      stockWarning: stockTotal < 0,
    })
  }

  const aggregated = new Map<string, Sync3CItem & { depositos: number[] }>()

  for (const item of items) {
    const key = item.codigo || item.normalizedName
    const existing = aggregated.get(key)
    if (existing) {
      existing.stockTotal += item.stockTotal
      existing.depositos.push(item.deposito)
      if (item.stockWarning) existing.stockWarning = true
    } else {
      aggregated.set(key, {
        ...item,
        depositos: [item.deposito],
      })
    }
  }

  const result: Sync3CItem[] = []
  for (const item of aggregated.values()) {
    result.push({
      codigo: item.codigo,
      name: item.name,
      normalizedName: item.normalizedName,
      stockTotal: item.stockTotal,
      unit: item.unit,
      deposito: item.depositos[0] ?? 0,
      source: "3c",
      stockWarning: item.stockWarning,
    })
  }

  return { items: result, rawCount: items.length }
}
