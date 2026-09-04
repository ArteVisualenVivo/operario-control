import type { MaintenanceRecord } from "@/services/maintenance"

// ============================================================================
// repairStatus.ts — Parser del 2º Excel de Reparaciones: "REPARACIONES
// FACTURADAS". Este informe aporta el ESTADO REAL de cada orden de reparación
// (Recepción, Reparada, Retirada, Facturada, etc.) con su fecha y comentario.
//
// Se cruza con el Excel de Reparaciones por número de orden, y para cada orden
// se selecciona SIEMPRE el estado con FECHA más reciente (el último estado).
// No se toma el primer estado ni un registro arbitrario.
//
// El parser es TOLERANTE al formato real de 3C: detecta la fila de encabezados
// por nombre de columna y, si no la encuentra, cae a un mapeo posicional con
// los nombres más probables del informe "facturadas". No inventa columnas.
// ============================================================================

export interface RepairStatusEntry {
  orderNumber: string
  /** Fecha del estado (parseada). undefined si el Excel no trae fecha. */
  statusDate?: Date
  /** Texto del estado (p. ej. "Retirada", "Taller", "Facturado"). */
  status: string
  /** Comentario / descripción asociado a ese estado. */
  statusDescription?: string
  /** Usuario que registró ese estado. */
  statusUser?: string
}

interface StatusGroup {
  orderNumber: string
  entries: RepairStatusEntry[]
}

function normHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === "string") {
    const t = value.trim()
    if (!t) return undefined
    // dd/mm/yyyy o dd/mm/yy
    const match = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
    if (match) {
      let year = Number(match[3])
      if (year < 100) year += 2000
      const day = Number(match[1])
      const month = Number(match[2])
      const d = new Date(year, month - 1, day)
      if (!Number.isNaN(d.getTime())) return d
    }
    // ISO u otro
    const parsed = new Date(t)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  // Excel serial
  if (typeof value === "number" && Number.isFinite(value) && value > 20000) {
    const epoch = new Date(1899, 11, 30)
    return new Date(epoch.getTime() + value * 86400000)
  }
  return undefined
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim()
}
/**
 * Detecta la fila de encabezados y devuelve el mapa nombre-normalizado → índice.
 * Busca la fila que contenga "numero"/"orden" y "fecha"/"estado".
 */
function findHeaderRow(rows: unknown[][]): { headerIndex: number; cols: Map<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    const cols = new Map<string, number>()
    row.forEach((cell, index) => {
      const n = normHeader(cell)
      if (n && !cols.has(n)) cols.set(n, index)
    })
    const hasOrder = cols.has("numero") || cols.has("orden") || cols.has("nro")
      || cols.has("orden_reparacion") || cols.has("nro_orden") || cols.has("numero_doc")
    const hasFecha = cols.has("fecha") || cols.has("fecha_estado") || cols.has("fecha_estado1")
    if (hasOrder && hasFecha) {
      return { headerIndex: i, cols }
    }
  }
  return null
}

/** Normaliza un número de orden para compararlo entre las dos fuentes. */
export function normalizeOrderNumber(value: string): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/^X\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Columnas posicionales usadas como fallback si no se detectan encabezados.
// Basado en el informe "facturadas" típico de 3C (0=NUMERO 1=FECHA 2=ESTADO
// 3=DESCRIPCION 4=USUARIO). El mapeo por nombre tiene prioridad.
const COL_FALLBACK = {
  order: 0,
  date: 1,
  status: 2,
  description: 3,
  user: 4,
}

/**
 * Lee un array de filas y devuelve TODAS las entradas de estado (sin agrupar).
 * Cada fila válida de 3C es un estado registrado de una orden.
 */
export function parseRepairStatusRows(rows: unknown[][]): RepairStatusEntry[] {
  const detected = findHeaderRow(rows)
  const useHeader = detected !== null
  const cols = useHeader ? detected!.cols : new Map<string, number>()

  const c = (names: string[], fallback: number): number => {
    if (useHeader) {
      for (const n of names) {
        const found = cols.get(n)
        if (typeof found === "number") return found
      }
      return -1
    }
    return fallback
  }

  const colOrder = c(["numero_num", "numero", "nro", "nro_orden", "orden_num", "orden", "orden_reparacion", "numero_doc"], COL_FALLBACK.order)
  const colDate = c(["fecha", "fecha_estado", "fecha_estado1", "fecha_estado_", "fecha_del_estado", "fecha1"], COL_FALLBACK.date)
  const colStatus = c(["estado", "estado1", "estado_", "estado_actual", "estado_desc", "descripcion_estado", "estado_facturado"], COL_FALLBACK.status)
  const colDesc = c(["descripcion", "comentario", "observaciones", "texto", "detalle", "comentario_estado"], COL_FALLBACK.description)
  const colUser = c(["usuario", "usuario_estado", "user", "tecnico", "responsable"], COL_FALLBACK.user)

  const startRow = useHeader ? detected!.headerIndex + 1 : 0
  const entries: RepairStatusEntry[] = []

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !Array.isArray(row)) continue
    const orderNumber = cleanText(colOrder >= 0 ? row[colOrder] : undefined)
    if (!orderNumber) continue
    const status = cleanText(colStatus >= 0 ? row[colStatus] : undefined)
    if (!status) continue
    entries.push({
      orderNumber,
      statusDate: colDate >= 0 ? toDate(row[colDate]) : undefined,
      status,
      statusDescription: colDesc >= 0 ? cleanText(row[colDesc]) : undefined,
      statusUser: colUser >= 0 ? cleanText(row[colUser]) : undefined,
    })
  }

  return entries
}
/**
 * Agrupa todas las entradas de estado por número de orden y devuelve, para
 * CADA orden, EL ÚLTIMO estado real (el de fecha más reciente).
 *
 * Reglas:
 * - Ignora filas de estado vacías.
 * - Ordena cronológicamente por la fecha de cada estado.
 * - Si hay dos estados con la misma fecha, usa su orden de aparición en el
 *   Excel (el último registrado gana).
 * - Nunca toma el primer estado ni uno arbitrario.
 */
export function getLatestStatusByOrder(entries: RepairStatusEntry[]): Map<string, RepairStatusEntry> {
  const groups = new Map<string, StatusGroup>()
  for (const entry of entries) {
    const key = normalizeOrderNumber(entry.orderNumber)
    if (!key) continue
    const existing = groups.get(key)
    if (existing) existing.entries.push(entry)
    else groups.set(key, { orderNumber: key, entries: [entry] })
  }

  const result = new Map<string, RepairStatusEntry>()
  for (const group of groups.values()) {
    if (group.entries.length === 0) continue
    const best = [...group.entries]
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        const ta = a.e.statusDate ? a.e.statusDate.getTime() : Number.NEGATIVE_INFINITY
        const tb = b.e.statusDate ? b.e.statusDate.getTime() : Number.NEGATIVE_INFINITY
        if (tb !== ta) return tb - ta
        return b.i - a.i
      })[0]
    result.set(group.orderNumber, best.e)
  }
  return result
}

/**
 * Cruza las entradas de estado con los registros de mantenimiento existentes,
 * agregando el último estado (status, statusDate, statusDescription,
 * statusUser). NO elimina datos de mantenimiento: solo enriquece.
 */
export function mergeStatusIntoMaintenance(
  records: MaintenanceRecord[],
  latestByOrder: Map<string, RepairStatusEntry>,
): MaintenanceRecord[] {
  return records.map((record) => {
    const key = normalizeOrderNumber(record.orderNumber)
    const st = key ? latestByOrder.get(key) : undefined
    if (!st) return record
    return {
      ...record,
      status: st.status || record.status,
      statusDate: st.statusDate || undefined,
      statusDescription: st.statusDescription || undefined,
      statusUser: st.statusUser || undefined,
    }
  })
}

/** Parsea un buffer de Excel de estados de reparaciones. */
export async function parseRepairStatusBuffer(
  buffer: ArrayBuffer | Buffer,
): Promise<RepairStatusEntry[]> {
  const XLSX = await import("xlsx")
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]
  return parseRepairStatusRows(rows)
}

/** Aplica el último estado a un array de MaintenanceRecord (para outbox/replay). */
export function applyLatestStatusToMaintenance(
  records: MaintenanceRecord[],
  latestByOrder: Map<string, RepairStatusEntry>,
): MaintenanceRecord[] {
  return mergeStatusIntoMaintenance(records, latestByOrder)
}