import type { MaintenanceRecord } from "@/services/maintenance"

// Este archivo SOLO se usa en el servidor (Node.js)
// No debe importarse desde el cliente

async function loadFromExcel(): Promise<MaintenanceRecord[]> {
  const fs = await import("fs").then(
    (m) => m.default || m
  )
  const path = await import("path").then(
    (m) => m.default || m
  )
  const XLSX = await import("xlsx")

  const EXPORTS_DIR = path.resolve(
    process.cwd(),
    "automation-watcher/3c_exports"
  )
  const CACHE_DIR = path.resolve(
    process.cwd(),
    "automation-watcher/cache"
  )
  const MAINTENANCE_CACHE_FILE = path.join(
    CACHE_DIR,
    "maintenance-cache.json"
  )

  function latestExportFile(): string | null {
    if (!fs.existsSync(EXPORTS_DIR)) return null
    const files = fs.readdirSync(EXPORTS_DIR)
      .filter((f) => /\.(xls|xlsx)$/i.test(f) && !f.startsWith("~$"))
      .map((f) => {
        const full = path.join(EXPORTS_DIR, f)
        return { full, stat: fs.statSync(full) }
      })
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    return files[0]?.full ?? null
  }

  function readCachedRecords(): MaintenanceRecord[] | null {
    if (!fs.existsSync(MAINTENANCE_CACHE_FILE)) return null
    try {
      const raw = fs.readFileSync(MAINTENANCE_CACHE_FILE, "utf-8")
      const data = JSON.parse(raw)
      if (!Array.isArray(data)) return null
      return data.map((item: Record<string, unknown>) => ({
        ...item,
        entryDate: new Date(item.entryDate as string),
        returnDate: item.returnDate ? new Date(item.returnDate as string) : undefined,
        repairDate: item.repairDate ? new Date(item.repairDate as string) : undefined,
        createdAt: new Date(item.createdAt as string),
        updatedAt: new Date(item.updatedAt as string),
      })) as MaintenanceRecord[]
    } catch {
      return null
    }
  }

  function getRows(): { rows: unknown[][]; sourceFile: string } | null {
    const file = latestExportFile()
    if (!file) return null
    const buf = fs.readFileSync(file)
    const workbook = XLSX.read(buf, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]
    return { rows, sourceFile: file }
  }

  const cached = readCachedRecords()
  const source = getRows()
  if (!source) return cached ?? []

  return parseMaintenanceRows(source.rows)
}

// ---------------------------------------------------------------------------
// PARSER DE MANTENIMIENTO REUTILIZABLE (fuente primaria / outbox)
// Convierte un Excel de órdenes de reparación en MaintenanceRecord[].
// Se usa en el agente para alimentar sync-3c:data:maintenance y el outbox.
// ---------------------------------------------------------------------------

type MRecord = MaintenanceRecord

function normNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const t = String(value ?? "").trim()
  if (!t) return null
  const n = Number(t.replace(/\./g, "").replace(",", "."))
  return Number.isFinite(n) ? n : null
}

export function parseMaintenanceRows(rows: unknown[][]): MaintenanceRecord[] {
  function toDate(value: unknown): Date | undefined {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value
    if (typeof value === "string") {
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value.trim())) {
        const parts = value.trim().split("/")
        const d = Number(parts[0])
        const m = Number(parts[1])
        let y = Number(parts[2])
        if (y < 100) y += 2000
        const parsed = new Date(y, m - 1, d)
        if (!Number.isNaN(parsed.getTime())) return parsed
      }
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
    return undefined
  }

  function normHeader(value: unknown): string {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_")
  }

  // Detectar la fila de encabezados (TIPO|NUMERO|FECHA|CLIENTE|RAZON_SOCIAL|...)
  // y mapear columnas dinámicamente, igual que syncRepairsToMaintenance().
  let headerIndex = -1
  const cols = new Map<string, number>()
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    cols.clear()
    row.forEach((c, idx) => {
      const n = normHeader(c)
      if (n && !cols.has(n)) cols.set(n, idx)
    })
    if (cols.has("numero") && cols.has("fecha")) {
      headerIndex = i
      break
    }
  }

  // Mapeo con fallback posicional (formato real de 3C):
  // 0=TIPO 1=NUMERO 2=FECHA 3=CLIENTE(id) 4=RAZON_SOCIAL 5=DOC_ID 6=ITEM_ID
  // 7=ARTICU_ID 8=TEXTO 9=CANTIDAD 10=PRECIO_UNITARIO 11=PRECIO_TOTAL
  const c = (names: string[], fallback: number): number => {
    for (const n of names) {
      const found = cols.get(n)
      if (typeof found === "number") return found
    }
    return fallback
  }
  const COL = {
    tipo: c(["tipo", "tipdoc"], 0),
    numero: c(["numero", "nro", "nro_orden"], 1),
    fecha: c(["fecha", "fecha_ingreso"], 2),
    cliente: c(["cliente", "cod_cliente", "cliente_id"], 3),
    razonSocial: c(["razon_social", "cliente_nombre", "nombre_cliente"], 4),
    docId: c(["doc_id", "docid"], 5),
    itemId: c(["item_id", "itemid"], 6),
    articuId: c(["articu_id", "articulo_id"], 7),
    texto: c(["texto", "maquina", "equipo", "descripcion"], 8),
    cantidad: c(["cantidad", "qty"], 9),
    precioUnitario: c(["precio_unitario", "precio"], 10),
    precioTotal: c(["precio_total", "total"], 11),
    gravado: c(["gravado"], 12),
    noGravado: c(["no_gravado"], 13),
    exento: c(["exento"], 14),
    // Estado y fecha de entrega: solo presentes si el export de 3C
    // incluye las columnas ESTADO / ENTREGA en la grilla.
    estado: c(["estado", "estado_repara_txt", "situacion"], -1),
    entrega: c(["entrega", "fecha_entrega", "fecha_retiro"], -1),
  }
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v
    const s = String(v ?? "").trim()
    if (!s) return null
    const n = Number(s.replace(/\./g, "").replace(",", "."))
    return Number.isFinite(n) ? n : null
  }

  // Agrupar por NUMERO de orden: cada fila es un ítem de la orden.
  const byOrder = new Map<string, MRecord>()
  // Órdenes que ya tienen su línea REPARACION identificada
  const conReparacion = new Set<string>()
  const today = new Date()

  for (let i = headerIndex >= 0 ? headerIndex + 1 : 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !Array.isArray(row)) continue

    const orderNumber = String(row[COL.numero] ?? "").trim()
    if (!/^X\s?\d{4}-\d{6,8}$/i.test(orderNumber)) continue
    const key = orderNumber.toUpperCase().replace(/\s+/g, " ")

    const entryDate = toDate(row[COL.fecha]) ?? today
    const texto = String(row[COL.texto] ?? "").trim()
    const cantidad = num(row[COL.cantidad]) ?? 0
    const unitPrice = num(row[COL.precioUnitario]) ?? 0
    const totalPrice = num(row[COL.precioTotal]) ?? 0

    const existing = byOrder.get(key)
    if (existing) {
      // Ítem adicional de la misma orden.
      const esLineaReparacion = /^reparaci[oó]n:/i.test(texto)
      if (esLineaReparacion) {
        // La línea "REPARACION: <máquina>" define la máquina/trabajo real
        if (!conReparacion.has(key)) {
          existing.machineName = texto.replace(/^reparaci[oó]n:\s*/i, "").trim()
          conReparacion.add(key)
        }
      } else if (texto) {
        // Las demás líneas son notas del taller (RETIRADA, CLIENTE NO RETIRA, etc.)
        existing.observations = existing.observations ? `${existing.observations} | ${texto}` : texto
      }
      existing.quantity = (existing.quantity ?? 0) + cantidad
      existing.unitPrice = Math.max(existing.unitPrice ?? 0, unitPrice)
      existing.totalPrice = (existing.totalPrice ?? 0) + totalPrice
      existing.taxed = (existing.taxed ?? 0) + (num(row[COL.gravado]) ?? 0)
      existing.notTaxed = (existing.notTaxed ?? 0) + (num(row[COL.noGravado]) ?? 0)
      existing.exempt = (existing.exempt ?? 0) + (num(row[COL.exento]) ?? 0)
      const d = toDate(row[COL.fecha])
      if (d && d.getTime() < existing.entryDate.getTime()) existing.entryDate = d
      continue
    }

    const esLineaReparacion = /^reparaci[oó]n:/i.test(texto)
    if (esLineaReparacion) conReparacion.add(key)
    byOrder.set(key, {
      id: orderNumber,
      orderNumber,
      type: String(row[COL.tipo] ?? "").trim() || undefined,
      entryDate,
      clientName: String(row[COL.razonSocial] ?? "").trim(),
      clientCode: String(row[COL.cliente] ?? "").trim() || undefined,
      // Máquina real: la línea "REPARACION: <máquina>" sin el prefijo
      machineName: esLineaReparacion ? texto.replace(/^reparaci[oó]n:\s*/i, "").trim() : texto,
      // Estado de 3C (Entreg./Factur., En taller, etc.) si el export lo incluye
      // Estado real de 3C si el export lo incluye; si no existe columna,
      // NO se inventa ni se usa "Recepción" como sustituto → queda sin estado.
      status: COL.estado >= 0 ? String(row[COL.estado] ?? "").trim() : "",
      // Fecha de entrega (Entreg.) si el export la incluye
      returnDate: COL.entrega >= 0 ? toDate(row[COL.entrega]) : undefined,
      docId: String(row[COL.docId] ?? "").trim() || undefined,
      itemId: Number(row[COL.itemId]) || null,
      articleId: String(row[COL.articuId] ?? "").trim() || undefined,
      quantity: cantidad,
      unitPrice,
      totalPrice,
      taxed: num(row[COL.gravado]),
      notTaxed: num(row[COL.noGravado]),
      exempt: num(row[COL.exento]),
      originalData: { row: row.slice(0, 19) },
      createdAt: entryDate,
      updatedAt: today,
      technician: undefined,
    } as MRecord)
  }

  return [...byOrder.values()].sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())
}

/** Parsea un buffer de Excel de mantenimiento a MaintenanceRecord[]. */
export async function parseMaintenanceBuffer(buffer: ArrayBuffer | Buffer): Promise<MaintenanceRecord[]> {
  const XLSX = await import("xlsx")
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]
  return parseMaintenanceRows(rows)
}

// Se exporta para compatibilidad con local-sync.ts (import dinámico).
export { loadFromExcel }


