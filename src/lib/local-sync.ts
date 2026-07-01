import type { MachineRepair } from "@/types"
import type { MaintenanceRecord } from "@/services/maintenance"
import { LOCAL_MODE } from "@/lib/runtimeMode"

// ----------------------------------------------
// PURE UTILITY FUNCTIONS (no fs/path/xlsx)
// ----------------------------------------------

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function normalizeRepairState(
  value: unknown
): "EN_TALLER" | "FINALIZADO" {
  const text = normalize(value)
  if (
    text.includes("entreg") ||
    text.includes("retir") ||
    text.includes("reparad") ||
    text.includes("no reparad") ||
    text.includes("finaliz")
  ) {
    return "FINALIZADO"
  }
  return "EN_TALLER"
}

function parseDmyDate(value: string): Date | undefined {
  const trimmed = value.trim()
  const match = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/
  )
  if (!match) return undefined
  let day = Number(match[1])
  let month = Number(match[2])
  let year = Number(match[3])
  if (year < 100) year += 2000
  const parsed = new Date(year, month - 1, day)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/** Convert Excel serial date without XLSX.SSF */
function excelSerialToDate(
  value: number
): Date | undefined {
  const UNIX_EPOCH_OFFSET = 25569
  const adjusted = value - UNIX_EPOCH_OFFSET
  const final = value >= 60 ? adjusted - 1 : adjusted
  const ms = final * 86_400_000
  if (!Number.isFinite(ms) || ms < 0) return undefined
  const parsed = new Date(ms)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function toDate(value: unknown): Date | undefined {
  if (
    value instanceof Date &&
    !Number.isNaN(value.getTime())
  ) return value
  if (typeof value === "number") {
    const excelDate = excelSerialToDate(value)
    if (excelDate) return excelDate
  }
  if (typeof value === "string") {
    const parsedDmy = parseDmyDate(value)
    if (parsedDmy) return parsedDmy
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return undefined
}

// ----------------------------------------------
// LOCAL MODE: Read from Excel (fs/path/xlsx)
// ----------------------------------------------
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
      .filter(
        (f) => /\.(xls|xlsx)$/i.test(f) &&
          !f.startsWith("~$")
      )
      .map((f) => {
        const full = path.join(EXPORTS_DIR, f)
        return { full, stat: fs.statSync(full) }
      })
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    return files[0]?.full ?? null
  }

  function ensureCacheDir(): void {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true })
    }
  }

  function readCachedRecords()
    : MaintenanceRecord[] | null {
    if (!fs.existsSync(MAINTENANCE_CACHE_FILE))
      return null
    try {
      const raw = fs.readFileSync(
        MAINTENANCE_CACHE_FILE, "utf-8"
      )
      const data = JSON.parse(raw)
      if (!Array.isArray(data)) return null
      return data.map(
        (item: Record<string, unknown>) => ({
          ...item,
          entryDate: new Date(
            item.entryDate as string
          ),
          returnDate: item.returnDate
            ? new Date(item.returnDate as string)
            : undefined,
          repairDate: item.repairDate
            ? new Date(item.repairDate as string)
            : undefined,
          createdAt: new Date(
            item.createdAt as string
          ),
          updatedAt: new Date(
            item.updatedAt as string
          ),
        })
      ) as MaintenanceRecord[]
    } catch {
      return null
    }
  }

  function writeCachedRecords(
    records: MaintenanceRecord[]
  ): void {
    try {
      ensureCacheDir()
      fs.writeFileSync(
        MAINTENANCE_CACHE_FILE,
        JSON.stringify(records, null, 2)
      )
    } catch {
      // best effort
    }
  }

  function deleteProcessedFile(
    filePath: string
  ): void {
    try {
      fs.unlinkSync(filePath)
    } catch {
      // best effort
    }
  }

  function getRows()
    : { rows: unknown[][]; sourceFile: string } | null {
    const file = latestExportFile()
    if (!file) return null
    const buf = fs.readFileSync(file)
    const workbook = XLSX.read(buf, {
      type: "buffer",
    })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
    }) as unknown[][]
    return { rows, sourceFile: file }
  }

  // -- main local logic --
  const cached = readCachedRecords()
  const source = getRows()
  if (!source) return cached ?? []

  const records: MaintenanceRecord[] = []
  for (let i = 0; i < source.rows.length; i++) {
    const row = source.rows[i]
    if (!Array.isArray(row)) continue

    const orderNumber = String(row[2] ?? "").trim()
    if (
      !/^X\s?\d{4}-\d{6,8}$/i.test(orderNumber)
    ) continue

    const status = String(
      row[3] ?? "Recepcion"
    ).trim()
    const entryDate = toDate(row[1])
    const returnDate = toDate(row[8])
    const repairDate = toDate(row[6])
    const clientName = String(
      row[4] ?? ""
    ).trim()
    const machineName = String(
      row[6] ?? row[5] ?? ""
    ).trim()

    const originalData: Record<string, unknown> = {
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
    }

    records.push({
      id: orderNumber,
      orderNumber,
      type:
        String(row[0] ?? "").trim() || undefined,
      entryDate: entryDate ?? new Date(),
      returnDate,
      repairDate,
      clientName,
      machineName,
      status,
      originalData,
      createdAt: entryDate ?? new Date(),
      updatedAt: entryDate ?? new Date(),
      technician: undefined,
    } as MaintenanceRecord)
  }

  const sorted = records.sort(
    (a, b) =>
      b.entryDate.getTime() - a.entryDate.getTime()
  )
  if (sorted.length > 0) {
    writeCachedRecords(sorted)
    deleteProcessedFile(source.sourceFile)
    return sorted
  }

  return cached ?? []
}

// ----------------------------------------------
// PRODUCTION: Read from Firestore
// ----------------------------------------------

async function loadFromFirestore()
  : Promise<MaintenanceRecord[]> {
  const { getMaintenanceRecords } = await import(
    "@/services/maintenance"
  )
  return getMaintenanceRecords()
}

// ----------------------------------------------
// PUBLIC API
// ----------------------------------------------

export async function loadMaintenanceRecords()
  : Promise<MaintenanceRecord[]> {
  if (LOCAL_MODE) {
    return loadFromExcel()
  }
  return loadFromFirestore()
}

export async function loadLocalRepairs()
  : Promise<MachineRepair[]> {
  const maintenance = await loadMaintenanceRecords()
  return maintenance.map((record) => {
    const hasExitDate = Boolean(
      record.returnDate ||
      record.repairDate ||
      normalizeRepairState(record.status) ===
        "FINALIZADO"
    )
    const exitDate =
      record.returnDate ??
      record.repairDate ??
      record.entryDate
    return {
      id: `local:${record.id}`,
      machineId: record.orderNumber,
      machineName: record.machineName,
      machineModel: record.type,
      internalNumber: undefined,
      clientId: record.clientCode,
      clientName: record.clientName,
      clientNumber: record.clientCode,
      reportedIssue: record.machineName,
      diagnosis: undefined,
      repairPerformed: record.status,
      technician: "",
      entryDate: record.entryDate,
      exitDate,
      hoursUsed: undefined,
      warrantyDays: 90,
      warrantyUntil: new Date(
        exitDate.getTime() + 90 * 24 * 60 * 60 * 1000
      ),
      oilChangeDueDate: undefined,
      bearingChangeDueDate: undefined,
      maintenanceDueDate: undefined,
      notes: record.type,
      partsUsed: [],
      source: "manual" as const,
      externalId: record.orderNumber,
      status: hasExitDate
        ? "FINALIZADO"
        : "EN_TALLER",
      issue: record.machineName,
      estimatedReturn: record.returnDate ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  })
}

