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

  function toDate(value: unknown): Date | undefined {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value
    if (typeof value === "string") {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
    return undefined
  }

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

  const records: MaintenanceRecord[] = []
  for (let i = 0; i < source.rows.length; i++) {
    const row = source.rows[i]
    if (!Array.isArray(row)) continue

    const orderNumber = String(row[2] ?? "").trim()
    if (!/^X\s?\d{4}-\d{6,8}$/i.test(orderNumber)) continue

    const entryDate = toDate(row[1])
    const returnDate = toDate(row[8])
    const repairDate = toDate(row[6])

    records.push({
      id: orderNumber,
      orderNumber,
      type: String(row[0] ?? "").trim() || undefined,
      entryDate: entryDate ?? new Date(),
      returnDate,
      repairDate,
      clientName: String(row[4] ?? "").trim(),
      machineName: String(row[6] ?? row[5] ?? "").trim(),
      status: String(row[3] ?? "Recepcion").trim(),
      originalData: {
        tipdoc: row[0] ?? null,
        fecha: row[1] ?? null,
        numero: row[2] ?? null,
        estado: row[3] ?? null,
        cliente: row[4] ?? null,
        observ: row[5] ?? null,
        descrip: row[6] ?? null,
        expediente: row[7] ?? null,
        entrega: row[8] ?? null,
        garant: row[9] ?? null,
        presup: row[10] ?? null,
        vendedor: row[11] ?? null,
        costo: row[12] ?? null,
      },
      createdAt: entryDate ?? new Date(),
      updatedAt: entryDate ?? new Date(),
      technician: undefined,
    } as MaintenanceRecord)
  }

  return records.sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())
}

export { loadFromExcel }