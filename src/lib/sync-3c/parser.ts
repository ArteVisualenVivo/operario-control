import * as XLSX from "xlsx"
import type { Sync3CItem } from "./types"
import { classifyScaffoldStock } from "@/lib/scaffoldMatcher"

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

/** Normaliza un texto de celda para comparar encabezados. */
function normHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.\s*/g, "_")
    .replace(/\s+/g, "_")
}

/**
 * Localiza la fila de encabezados (la que contiene "articulo") y devuelve
 * un mapa nombre-normalizado → índice de columna.
 */
export function findHeaderRow(
  rows: unknown[][]
): { headerIndex: number; cols: Map<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    const cols = new Map<string, number>()
    row.forEach((cell, idx) => {
      const n = normHeader(cell)
      if (n && !cols.has(n)) cols.set(n, idx)
    })
    if (cols.has("articulo") && (cols.has("stock") || cols.has("cod_barra"))) {
      return { headerIndex: i, cols }
    }
  }
  return null
}

function toNum(value: unknown): number {
  const parsed = parseFloat(String(value ?? 0).replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

function cell(rows: unknown[][], rowIndex: number, idx: number): unknown {
  return rows[rowIndex]?.[idx]
}

/**
 * Parser del Excel de STOCK (Existencias por depósito).
 * Usa detección dinámica de encabezados y cae al mapeo posicional histórico.
 * Extrae además: familia, marca, tipo, precio, stock mínimo y ubicación.
 */
export function parseExcel(buffer: ArrayBuffer | Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })

  const detected = findHeaderRow(rawRows)
  const useHeader = detected !== null && detected.cols.has("stock")

  const idx = {
    codigo: useHeader ? detected!.cols.get("articulo")! : COLUMNS.codigo,
    name: useHeader ? detected!.cols.get("denominacion")! : COLUMNS.name,
    stockTotal: useHeader ? detected!.cols.get("stock")! : COLUMNS.stockTotal,
    deposito: useHeader ? detected!.cols.get("deposito")! : COLUMNS.deposito,
    unidadRaw: useHeader
      ? (detected!.cols.get("unimed") ?? detected!.cols.get("um") ?? COLUMNS.unidadRaw)
      : COLUMNS.unidadRaw,
    familia: useHeader ? (detected!.cols.get("denominacion_familia") ?? -1) : -1,
    marca: useHeader ? (detected!.cols.get("denominacion_marca") ?? -1) : -1,
    tipo: useHeader ? (detected!.cols.get("denominacion_tipo__desc") ?? -1) : -1,
    precio: useHeader ? (detected!.cols.get("precio_unitario") ?? -1) : -1,
    stockMinimo: useHeader ? (detected!.cols.get("stock_minimo") ?? -1) : -1,
    ubicacion: useHeader ? (detected!.cols.get("ubicacion") ?? -1) : -1,
  }
  const startRow = useHeader ? detected!.headerIndex + 1 : DATA_START_ROW

  const items: Sync3CItem[] = []

  for (let i = startRow; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (!row || !Array.isArray(row)) continue

    const codigo = (cell(rawRows, i, idx.codigo) ?? "").toString().trim()
    const nameRaw = (cell(rawRows, i, idx.name) ?? "").toString().trim()
    if (!codigo && !nameRaw) continue

    const stockTotal = toNum(cell(rawRows, i, idx.stockTotal))
    const deposito = parseInt(String(cell(rawRows, i, idx.deposito) ?? 0)) || 0
    const unidadRaw = (cell(rawRows, i, idx.unidadRaw) ?? "").toString().trim()
    const unit = mapUnit(unidadRaw)
    const scaffold = classifyScaffoldStock(nameRaw)
    const familia = idx.familia >= 0 ? (cell(rawRows, i, idx.familia) ?? "").toString().trim() : ""
    const marca = idx.marca >= 0 ? (cell(rawRows, i, idx.marca) ?? "").toString().trim() : ""
    const tipo = idx.tipo >= 0 ? (cell(rawRows, i, idx.tipo) ?? "").toString().trim() : ""
    const precio = idx.precio >= 0 ? toNum(cell(rawRows, i, idx.precio)) : 0
    const stockMinimo = idx.stockMinimo >= 0 ? toNum(cell(rawRows, i, idx.stockMinimo)) : 0
    const ubicacion = idx.ubicacion >= 0 ? (cell(rawRows, i, idx.ubicacion) ?? "").toString().trim() : ""

    items.push({
      codigo,
      name: nameRaw,
      normalizedName: nameRaw.toLowerCase().trim(),
      stockTotal,
      unit,
      deposito,
      source: "3c",
      stockWarning: stockTotal < 0,
      category: scaffold.category !== "consumibles" ? scaffold.category : familia || scaffold.category,
      subtype: scaffold.subtype ?? (tipo || undefined),
      scaffoldKind: scaffold.kind,
      familia: familia || undefined,
      marca: marca || undefined,
      precioUnitario: precio || undefined,
      stockMinimo: stockMinimo || undefined,
      ubicacion: ubicacion || undefined,
    })
  }

  const aggregated = new Map<string, Sync3CItem & { depositos: number[] }>()

  for (const item of items) {
    const key = item.codigo || item.normalizedName
    const existing = aggregated.get(key)
    if (existing) {
      existing.stockTotal += item.stockTotal
      existing.depositos.push(item.deposito ?? 0)
      if (item.stockWarning) existing.stockWarning = true
    } else {
      aggregated.set(key, {
        ...item,
        depositos: [item.deposito ?? 0],
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
      category: item.category,
      subtype: item.subtype,
      scaffoldKind: item.scaffoldKind,
      familia: item.familia,
      marca: item.marca,
      precioUnitario: item.precioUnitario,
      stockMinimo: item.stockMinimo,
      ubicacion: item.ubicacion,
    })
  }

  return { items: result, rawCount: items.length }
}

/**
 * Parser del Excel de ARTÍCULOS (catálogo sin stock).
 * Encabezado real: IDD|ARTICULO|COD_BARRA|COD_CATALOGO|UM_ID|UM|...|
 *                  FAMILIA_DENOM|SUBFAMILIA_DENOM|MARCAS_DENOM|TIPO_DENOM|...
 * El `codigo` usa IDD, que es el mismo código que usa el Excel de STOCK
 * (columna ARTICULO) → permite fusionar catálogo + stock en la web.
 */
export function parseArticulos(buffer: ArrayBuffer | Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })

  const detected = findHeaderRow(rawRows)
  if (!detected || !detected.cols.has("cod_barra")) {
    // No es el Excel de catálogo de artículos → nada que cargar.
    return { items: [], rawCount: 0 }
  }
  const cols = detected.cols
  const idx = {
    codigo: cols.get("idd") ?? cols.get("articulo")!,
    name: cols.get("articulo")!,
    codBarra: cols.get("cod_barra") ?? -1,
    codCatalogo: cols.get("cod_catalogo") ?? -1,
    unidad: cols.get("um") ?? -1,
    familia: cols.get("familia_denom") ?? -1,
    subfamilia: cols.get("subfamilia_denom") ?? -1,
    marca: cols.get("marcas_denom") ?? -1,
    tipo: cols.get("tipo_denom") ?? -1,
    subtipo: cols.get("subtipo_denom") ?? -1,
    proveedor: cols.get("proveedor") ?? -1,
  }
  const startRow = detected.headerIndex + 1

  const items: Sync3CItem[] = []
  for (let i = startRow; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (!row || !Array.isArray(row)) continue

    const codigo = (cell(rawRows, i, idx.codigo) ?? "").toString().trim()
    const nameRaw = (cell(rawRows, i, idx.name) ?? "").toString().trim()
    if (!codigo && !nameRaw) continue

    const familia = idx.familia >= 0 ? (cell(rawRows, i, idx.familia) ?? "").toString().trim() : ""
    const subfamilia = idx.subfamilia >= 0 ? (cell(rawRows, i, idx.subfamilia) ?? "").toString().trim() : ""
    const marca = idx.marca >= 0 ? (cell(rawRows, i, idx.marca) ?? "").toString().trim() : ""
    const tipo = idx.tipo >= 0 ? (cell(rawRows, i, idx.tipo) ?? "").toString().trim() : ""
    const subtipo = idx.subtipo >= 0 ? (cell(rawRows, i, idx.subtipo) ?? "").toString().trim() : ""
    const proveedor = idx.proveedor >= 0 ? (cell(rawRows, i, idx.proveedor) ?? "").toString().trim() : ""

    const scaffold = classifyScaffoldStock(nameRaw)

    items.push({
      codigo,
      name: nameRaw,
      normalizedName: nameRaw.toLowerCase().trim(),
      stockTotal: 0, // el catálogo no trae stock; el stock real lo aporta el módulo STOCK
      unit: mapUnit((cell(rawRows, i, idx.unidad) ?? "").toString()),
      source: "3c",
      category: scaffold.category !== "consumibles" ? scaffold.category : familia || scaffold.category,
      subtype: scaffold.subtype ?? (subfamilia || tipo || undefined),
      scaffoldKind: scaffold.kind,
      familia: familia || undefined,
      marca: marca || undefined,
      subfamilia: subfamilia || undefined,
      tipo: tipo || undefined,
      subtipo: subtipo || undefined,
      codBarra: idx.codBarra >= 0 ? (cell(rawRows, i, idx.codBarra) ?? "").toString().trim() || undefined : undefined,
      codCatalogo: idx.codCatalogo >= 0 ? (cell(rawRows, i, idx.codCatalogo) ?? "").toString().trim() || undefined : undefined,
      proveedor: proveedor || undefined,
    })
  }

  return { items, rawCount: items.length }
}
