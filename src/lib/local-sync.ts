import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"
import type { MachineRepair } from "@/types"
import type { MaintenanceRecord } from "@/services/maintenance"

const EXPORTS_DIR = path.resolve(process.cwd(), "automation-watcher/3c_exports")
const CACHE_DIR = path.resolve(process.cwd(), "automation-watcher/cache")
const MAINTENANCE_CACHE_FILE = path.join(CACHE_DIR, "maintenance-cache.json")

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function normalizeRepairState(value: unknown): "EN_TALLER" | "FINALIZADO" {
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
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return undefined
  let day = Number(match[1])
  let month = Number(match[2])
  let year = Number(match[3])
  if (year < 100) year += 2000
  const parsed = new Date(year, month - 1, day)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === "number" && XLSX.SSF && typeof XLSX.SSF.parse_date_code === "function") {
    const d = XLSX.SSF.parse_date_code(value)
    if (d?.y) {
      const parsed = new Date(d.y, (d.m ?? 1) - 1, d.d ?? 1)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
  }
  if (typeof value === "string") {
    const parsedDmy = parseDmyDate(value)
    if (parsedDmy) return parsedDmy
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return undefined
}

function latestExportFile(): string | null {
  if (!fs.existsSync(EXPORTS_DIR)) return null
  const files = fs.readdirSync(EXPORTS_DIR)
    .filter((file) => /\.(xls|xlsx)$/i.test(file) && !file.startsWith("~$"))
    .map((file) => {
      const full = path.join(EXPORTS_DIR, file)
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

function readCachedMaintenanceRecords(): MaintenanceRecord[] | null {
  if (!fs.existsSync(MAINTENANCE_CACHE_FILE)) return null
  try {
    const raw = fs.readFileSync(MAINTENANCE_CACHE_FILE, "utf-8")
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return null
    return data.map((item) => ({
      ...item,
      entryDate: new Date(item.entryDate),
      returnDate: item.returnDate ? new Date(item.returnDate) : undefined,
      repairDate: item.repairDate ? new Date(item.repairDate) : undefined,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    })) as MaintenanceRecord[]
  } catch {
    return null
  }
}

function writeCachedMaintenanceRecords(records: MaintenanceRecord[]): void {
  try {
    ensureCacheDir()
    fs.writeFileSync(MAINTENANCE_CACHE_FILE, JSON.stringify(records, null, 2))
  } catch {
    // cache is best-effort
  }
}

function deleteProcessedFile(file: string): void {
  try {
    fs.unlinkSync(file)
  } catch {
    // best effort
  }
}

function getRows() {
  const file = latestExportFile()
  if (!file) return null
  const workbook = XLSX.read(fs.readFileSync(file), { type: "buffer" })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]
  return { rows, sourceFile: file }
}

export function loadLocalMaintenanceRecords(): MaintenanceRecord[] {
  const cached = readCachedMaintenanceRecords()
  const source = getRows()
  if (!source) return cached ?? []

  const records: MaintenanceRecord[] = []
  for (let i = 0; i < source.rows.length; i++) {
    const row = source.rows[i]
    if (!Array.isArray(row)) continue

    const orderNumber = String(row[2] ?? "").trim()
    if (!/^X\s?\d{4}-\d{6,8}$/i.test(orderNumber)) continue

    const status = String(row[3] ?? "Recepcion").trim()
    const entryDate = toDate(row[1])
    const returnDate = toDate(row[8])
    const repairDate = toDate(row[6])
    const clientName = String(row[4] ?? "").trim()
    const machineName = String(row[6] ?? row[5] ?? "").trim()
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
      type: String(row[0] ?? "").trim() || undefined,
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

  const sorted = records.sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())
  if (sorted.length > 0) {
    writeCachedMaintenanceRecords(sorted)
    deleteProcessedFile(source.sourceFile)
    return sorted
  }

  return cached ?? []
}

export function loadLocalRepairs(): MachineRepair[] {
  const maintenance = loadLocalMaintenanceRecords()
  return maintenance.map((record) => {
    const hasExitDate = Boolean(record.returnDate || record.repairDate || normalizeRepairState(record.status) === "FINALIZADO")
    const exitDate = record.returnDate ?? record.repairDate ?? record.entryDate
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
      warrantyUntil: new Date(exitDate.getTime() + 90 * 24 * 60 * 60 * 1000),
      oilChangeDueDate: undefined,
      bearingChangeDueDate: undefined,
      maintenanceDueDate: undefined,
      notes: record.type,
      partsUsed: [],
      source: "manual",
      externalId: record.orderNumber,
      status: hasExitDate ? "FINALIZADO" : "EN_TALLER",
      issue: record.machineName,
      estimatedReturn: record.returnDate ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  })
}
