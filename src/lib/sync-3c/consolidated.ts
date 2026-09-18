import type { MaintenanceRecord } from "@/services/maintenance"

// ============================================================================
// consolidated.ts — Registro CONSOLIDADO de órdenes de reparación.
// Ningún Excel de 3C contiene todo: los informes aportan partes distintas y
// se unen cruzando por número de orden, sin perder información.
// ============================================================================

export interface ConsolidatedState {
  status: string
  statusDate?: string
  statusDescription?: string
  statusUser?: string
  /**
   * MOTIVO_ESTADO_REP de esa fila del informe de 3C: los repuestos pedidos
   * cuando el estado es "A la Espera Repuestos". Única fuente de Pedidos Rep.
   */
  motivoEstadoRep?: string
  sourceFile?: string
}

export interface OrderConsolidated {
  orderNumber: string
  clientName?: string
  clientCode?: string
  machineName?: string
  observations?: string
  entryDate?: string
  returnDate?: string
  repairDate?: string
  states: ConsolidatedState[]
  workItems: string[]
  sourceFiles: string[]
}

function normHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
}

function clean(value: unknown): string {
  return String(value ?? "").trim()
}

/**
 * 3C parte la identificación larga de la máquina en DOS celdas contiguas: corta
 * el texto a 30 caracteres y escribe el resto en la celda inmediatamente a la
 * derecha. Ej. (O.R. X 0001-00011233):
 *   celda "descripcion"  = "Amoladora bosch 230 GWS- 25-23"
 *   celda siguiente      = "0 Bare | 3 601 HF4 0H0"
 *   identificación real  = "Amoladora bosch 230 GWS- 25-230 Bare | 3 601 HF4 0H0"
 *
 * REGLA GENERAL (no depende de ninguna orden): se une la celda vecina sólo
 * cuando el texto se cortó en el ancho de 3C, es decir cuando la celda mide 29
 * o 30 caracteres. Verificado sobre los informes reales: 1935 de 1935 filas con
 * celda vecina tienen la celda de máquina en 29/30 caracteres, por lo que la
 * vecina es SIEMPRE la continuación de este mismo texto y nunca otro campo.
 *
 * Devuelve la identificación COMPLETA, sin cortar ni perder nada.
 */
function joinWrappedIdentification(row: unknown[], colIndex: number): string {
  if (colIndex < 0) return ""
  const first = clean(row[colIndex])
  if (!first) return ""
  const next = clean(row[colIndex + 1])
  if (!next || first.length < 29) return first
  // A los 30 el corte es exacto; a los 29, 3C recortó el espacio final, así que
  // se repone para no pegar dos palabras (ej. "N1" + "- BOCSH 10KG").
  const full = first.length >= 30 ? `${first}${next}` : `${first} ${next}`
  return full.replace(/\s+/g, " ").trim()
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  const t = clean(value)
  if (!t) return undefined
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    let y = Number(m[3])
    if (y < 100) y += 2000
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]))
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  const isoDate = new Date(t)
  return Number.isNaN(isoDate.getTime()) ? undefined : isoDate
}

function iso(d?: Date): string | undefined {
  return d ? d.toISOString() : undefined
}

/** Normaliza el número de orden para cruzar entre Excel. */
export function normOrder(value: unknown): string {
  return clean(value)
    .toUpperCase()
    .replace(/^X\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

type ExportKind = "items" | "statuses" | null

/** Clasifica un Excel por su CONTENIDO (encabezados reales). */
export function classifyRepairExport(rows: unknown[][]): ExportKind {
  const first = clean(rows[0]?.[0]).replace(/"/g, "").toLowerCase()
  const headerRow = rows[2] ?? rows[1] ?? []
  const cols = new Set(headerRow.map((c) => normHeader(c)))
  const hasStateCols =
    (cols.has("estado_repara_txt") || cols.has("estado_repara")) && cols.has("numero") && cols.has("fecha")
  if (hasStateCols) return "statuses"
  if (cols.has("numero") && cols.has("razon_social") && cols.has("articu_id")) return "items"
  if (first.includes("ordenes de reparacion con items")) return "items"
  if (first.includes("reparaciones del") && hasStateCols) return "statuses"
  return null
}

type FactMap = Map<string, OrderConsolidated>

function touch(map: FactMap, order: string): OrderConsolidated {
  let rec = map.get(order)
  if (!rec) {
    rec = { orderNumber: order, states: [], workItems: [], sourceFiles: [] }
    map.set(order, rec)
  }
  return rec
}

/** Fusiona sin perder datos: solo completa lo que falta, nunca pisa real con vacío. */
function mergeFacts(target: OrderConsolidated, src: Partial<OrderConsolidated>): void {
  if (src.clientName && !target.clientName) target.clientName = src.clientName
  if (src.clientCode && !target.clientCode) target.clientCode = src.clientCode
  if (src.machineName && !target.machineName) target.machineName = src.machineName
  if (src.observations && !target.observations) target.observations = src.observations
  if (src.entryDate && !target.entryDate) target.entryDate = src.entryDate
  if (src.returnDate && !target.returnDate) target.returnDate = src.returnDate
  if (src.repairDate && !target.repairDate) target.repairDate = src.repairDate
  if (src.states?.length) target.states.push(...src.states)
  if (src.workItems?.length) {
    for (const w of src.workItems) {
      if (!target.workItems.some((x) => x.toLowerCase() === w.toLowerCase())) target.workItems.push(w)
    }
  }
  if (src.sourceFiles?.length) {
    for (const f of src.sourceFiles) {
      if (!target.sourceFiles.includes(f)) target.sourceFiles.push(f)
    }
  }
}
/**
 * Extrae órdenes del informe de ESTADOS ("Reparaciones del ...").
 * Columnas REALES: [1]FECHA [2]NUMERO [5]ESTADO_REPARA_TXT [7]PERSONAS_TEX
 * [8]OBSERVACIONES [11]ORDEN_COMPRA [13]ENTREGA [14]USUARIO.
 * Sin lista cerrada de estados: se acepta cualquier ESTADO_REPARA_TXT real.
 */
export function extractStatusesExcel(rows: unknown[][], fileName: string): FactMap {
  const map: FactMap = new Map()
  const headerIdx = rows.findIndex((r, i) => i < 10 && Array.isArray(r) && r.map(normHeader).includes("numero") && r.map(normHeader).includes("fecha"))
  if (headerIdx < 0) return map
  const header = rows[headerIdx].map(normHeader)
  const col = (names: string[], fallback: number): number => {
    for (const n of names) {
      const i = header.indexOf(n)
      if (i >= 0) return i
    }
    return fallback
  }
  const cNumero = col(["numero"], 2)
  const cFecha = col(["fecha"], 1)
  const cEstadoTxt = col(["estado_repara_txt"], 5)
  const cEstado = col(["estado_repara"], 4)
  const cCliente = col(["personas_tex", "cliente", "razon_social"], -1)
  const cObs = col(["observaciones"], 8)
  const cMaquina = col(["orden_compra", "descripcion"], -1)
  const cEntrega = col(["entrega"], 13)
  const cUsuario = col(["usuario"], 14)
  // MOTIVO_ESTADO_REP: repuestos pedidos en ese estado (informe DETALLE de 3C).
  const cMotivo = col(["motivo_estado_rep", "motivo_estado"], -1)

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    const orderRaw = clean(row[cNumero])
    if (!/^x?\s*\d{3,6}-\d{4,10}$/i.test(orderRaw)) continue
    const order = normOrder(orderRaw)
    const statusTxt = clean(row[cEstadoTxt]) || clean(row[cEstado])
    if (!statusTxt) continue
    const rec = touch(map, order)
    const fechaOrden = toDate(row[cFecha])
    const entrega = toDate(row[cEntrega])
    // Cada fila del informe es un CAMBIO de estado con su propia fecha:
    //  - fila "Reparada"        → FECHA = fecha de reparación (excluye "No Reparada")
    //  - fila "Entreg./Factur." o "Retirada" → FECHA = fecha de entrega real
    //    (si la columna ENTREGA está poblada se prefiere esa)
    const isRepaired = /reparada/i.test(statusTxt) && !/^no\s+reparada$/i.test(statusTxt)
    const isDelivered = /entreg|retirad/i.test(statusTxt)
    mergeFacts(rec, {
      clientName: clean(row[cCliente]) || undefined,
      machineName: joinWrappedIdentification(row, cMaquina) || undefined,
      observations: clean(row[cObs]) || undefined,
      entryDate: iso(fechaOrden),
      returnDate: iso(isDelivered ? (entrega ?? fechaOrden) : entrega),
      repairDate: isRepaired ? iso(fechaOrden) : undefined,
      states: [{
        status: statusTxt,
        statusDate: iso(fechaOrden),
        statusDescription: clean(row[cObs]) || undefined,
        statusUser: clean(row[cUsuario]) || undefined,
        sourceFile: fileName,
        // Repuestos del motivo de ese estado (solo "A la Espera Repuestos"
        // genera Pedidos Rep.). Se conserva por estado, sin pisar otros estados.
        motivoEstadoRep: cMotivo >= 0 ? (clean(row[cMotivo]) || undefined) : undefined,
      }],
      sourceFiles: [fileName],
    })
  }
  return map
}

/**
 * Extrae órdenes del informe de ÍTEMS ("Detalle de Ordenes de Reparación con
 * Items"). Columnas REALES: [1]NUMERO [2]FECHA [4]RAZON_SOCIAL [7]ARTICU_ID
 * [8]TEXTO. La línea "REPARACION: ..." define la máquina; los demás ítems son
 * trabajos/repuestos.
 */
export function extractItemsExcel(rows: unknown[][], fileName: string): FactMap {
  const map: FactMap = new Map()
  const headerIdx = rows.findIndex((r, i) => i < 10 && Array.isArray(r) && r.map(normHeader).includes("numero") && r.map(normHeader).includes("razon_social"))
  if (headerIdx < 0) return map
  const header = rows[headerIdx].map(normHeader)
  const col = (names: string[], fallback: number): number => {
    for (const n of names) {
      const i = header.indexOf(n)
      if (i >= 0) return i
    }
    return fallback
  }
  const cNumero = col(["numero"], 1)
  const cFecha = col(["fecha"], 2)
  const cCliente = col(["razon_social"], 4)
  const cClienteId = col(["cliente"], 3)
  const cArticulo = col(["articu_id"], 7)
  const cTexto = col(["texto"], 8)

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    const orderRaw = clean(row[cNumero])
    if (!/^x?\s*\d{3,6}-\d{4,10}$/i.test(orderRaw)) continue
    const order = normOrder(orderRaw)
    const rec = touch(map, order)
    const texto = clean(row[cTexto])
    const articulo = clean(row[cArticulo])
    const isRepairLine = /^reparaci[oó]n:/i.test(texto)
    mergeFacts(rec, {
      clientName: clean(row[cCliente]) || undefined,
      clientCode: clean(row[cClienteId]) || undefined,
      machineName: isRepairLine ? texto.replace(/^reparaci[oó]n:\s*/i, "").trim() : undefined,
      entryDate: iso(toDate(row[cFecha])),
      workItems: texto && !isRepairLine
        ? [articulo && articulo.toLowerCase() !== "reparacion" ? `${articulo} — ${texto}` : texto]
        : [],
      sourceFiles: [fileName],
    })
  }
  return map
}
/**
 * Escanea TODOS los Excel del directorio de exports, clasifica cada uno por
 * contenido y consolida por número de orden. Ignora archivos que no aportan
 * datos de órdenes (Existencias, Artículos, Alquileres, HTML de impresión).
 */
export async function buildConsolidatedOrders(exportsDir: string): Promise<Map<string, OrderConsolidated>> {
  const fs = await import("fs").then((m) => m.default || m)
  const path = await import("path").then((m) => m.default || m)
  const XLSX = await import("xlsx").then((m) => m.default || m)

  const all: FactMap = new Map()
  if (!fs.existsSync(exportsDir)) return all

  for (const f of fs.readdirSync(exportsDir)) {
    if (!/\.(xls|xlsx)$/i.test(f) || f.startsWith("~$")) continue
    const full = path.join(exportsDir, f)
    let rows: unknown[][]
    try {
      const wb = XLSX.readFile(full)
      const sheet = wb.Sheets[wb.SheetNames[0]]
      if (!sheet) continue
      rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
    } catch {
      continue // HTML de impresión, archivo corrupto, etc.
    }
    const kind = classifyRepairExport(rows)
    const facts = kind === "statuses"
      ? extractStatusesExcel(rows, f)
      : kind === "items"
        ? extractItemsExcel(rows, f)
        : null
    if (!facts) continue
    for (const [order, rec] of facts) {
      mergeFacts(touch(all, order), rec)
    }
  }
  return all
}

/**
 * Estado ACTUAL de una orden: el ÚLTIMO estado real disponible.
 * Mayor fecha de estado; empate → el último registrado (orden de aparición).
 * Sin lista cerrada de estados.
 */
export function currentState(consolidated: OrderConsolidated): ConsolidatedState | undefined {
  if (consolidated.states.length === 0) return undefined
  const best = [...consolidated.states]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ta = a.s.statusDate ? Date.parse(a.s.statusDate) : Number.NEGATIVE_INFINITY
      const tb = b.s.statusDate ? Date.parse(b.s.statusDate) : Number.NEGATIVE_INFINITY
      if (tb !== ta) return tb - ta
      return b.i - a.i
    })[0]
  return best.s
}

/**
 * Convierte los registros consolidados en MaintenanceRecord[] para la fuente
 * primaria (Redis) y la web. Conserva TODO: último estado + línea de tiempo
 * completa (states), trabajos/repuestos (workItems) y origen (sourceFiles).
 * Las órdenes previas que no aparecen en los Excel de esta corrida se conservan.
 */
/**
 * Recopila MOTIVO_ESTADO_REP por estado: los que vienen de esta corrida (fila
 * del informe DETALLE/ESTADOS con su motivo) y los que ya estaban guardados.
 * Este dato es la ÚNICA fuente de repuestos para Pedidos Rep.: solo el estado
 * "A la Espera Repuestos" genera pedidos (ver services/sparePartOrders.ts).
 */
function collectMotivosByStatus(
  rec: OrderConsolidated,
  prev?: MaintenanceRecord,
): { status: string; motivo: string }[] {
  const out: { status: string; motivo: string }[] = []
  const add = (status: unknown, motivo: unknown): void => {
    const m = clean(motivo)
    if (!m) return
    const s = clean(status)
    if (out.some((e) => e.status === s && e.motivo.toLowerCase() === m.toLowerCase())) return
    out.push({ status: s, motivo: m })
  }
  for (const st of rec.states) add(st.status, st.motivoEstadoRep)
  for (const e of prev?.motivoByStatus ?? []) add(e.status, e.motivo)
  return out
}

export function consolidatedToMaintenanceRecords(
  consolidated: Map<string, OrderConsolidated>,
  existing?: MaintenanceRecord[],
): MaintenanceRecord[] {
  const result: MaintenanceRecord[] = []
  const existingByOrder = new Map<string, MaintenanceRecord>()
  for (const r of existing ?? []) {
    existingByOrder.set(normOrder(r.orderNumber), r)
  }

  for (const [orderKey, rec] of consolidated.entries()) {
    const cur = currentState(rec)
    const prev = existingByOrder.get(orderKey)
    const motivosByStatus = collectMotivosByStatus(rec, prev)
    // Texto plano de todos los motivos (compatibilidad con datos previos).
    const motivoEstadoRepText = motivosByStatus.length > 0
      ? [...new Set(motivosByStatus.map((e) => e.motivo))].join("\n")
      : prev?.motivoEstadoRep
    const merged = {
      ...(prev ?? {}),
      id: prev?.id ?? rec.orderNumber,
      orderNumber: prev?.orderNumber ?? rec.orderNumber,
      entryDate: prev?.entryDate ?? (rec.entryDate ? new Date(rec.entryDate) : new Date()),
      returnDate: rec.returnDate ? new Date(rec.returnDate) : prev?.returnDate,
      repairDate: rec.repairDate ? new Date(rec.repairDate) : prev?.repairDate,
      clientName: rec.clientName || prev?.clientName || "",
      clientCode: rec.clientCode || prev?.clientCode,
      machineName: rec.machineName || prev?.machineName || "",
      status: cur?.status || prev?.status || "",
      statusDate: cur?.statusDate ? new Date(cur.statusDate) : prev?.statusDate,
      statusDescription: cur?.statusDescription || prev?.statusDescription,
      statusUser: cur?.statusUser || prev?.statusUser,
      observations: rec.observations || prev?.observations,
      createdAt: prev?.createdAt ?? (rec.entryDate ? new Date(rec.entryDate) : new Date()),
      updatedAt: new Date(),
      states: rec.states,
      workItems: rec.workItems,
      sourceFiles: rec.sourceFiles,
      // Preservar motivo + estado de 3C del parse del Excel de Detalle
      // (necesario para la regla "A la Espera Repuestos" → Pedidos Rep.)
      // Motivo + estado de 3C del parse del Excel de Detalle/Estados
      // (necesario para la regla "A la Espera Repuestos" → Pedidos Rep.)
      motivoEstadoRep: motivoEstadoRepText ?? prev?.motivoEstadoRep,
      motivoByStatus: motivosByStatus.length > 0 ? motivosByStatus : prev?.motivoByStatus,
    } as MaintenanceRecord
    result.push(merged)
    existingByOrder.delete(orderKey)
  }

  for (const r of existingByOrder.values()) result.push(r)

  const toTime = (d: Date | string | number | undefined | null): number => {
    if (d === undefined || d === null) return 0
    const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  return result.sort((a, b) => toTime(b.entryDate) - toTime(a.entryDate))
}