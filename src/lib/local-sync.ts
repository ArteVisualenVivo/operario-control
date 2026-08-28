import type { MachineRepair } from "@/types"
import type { MaintenanceRecord } from "@/services/maintenance"

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

// ----------------------------------------------
// LOCAL MODE: Read from Excel (fs/path/xlsx)
// Solo se ejecuta en el servidor (verificado con typeof window)
// ----------------------------------------------
async function loadFromExcel(): Promise<MaintenanceRecord[]> {
  // En el cliente, no hay fs
  if (typeof window !== "undefined") {
    return []
  }
  const { loadFromExcel: loadFromExcelImpl } = await import("./local-sync-excel")
  return loadFromExcelImpl()
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

// 1) FUENTE PRIMARIA (Redis): lee los datos recién procesados por el agente
//    (funciona aunque Firestore esté sin cuota).
async function loadFromPrimary()
  : Promise<MaintenanceRecord[] | null> {
  try {
    const res = await fetch(`/api/sync-3c/data/maintenance`, { cache: "no-store" })
    if (!res.ok) return null
    const body = await res.json()
    if (!body?.available || !Array.isArray(body?.data) || body.recordCount === 0) return null
    return (body.data as Record<string, unknown>[]).map((item) => ({
      ...item,
      entryDate: new Date((item.entryDate as string) ?? new Date()),
      returnDate: item.returnDate ? new Date(item.returnDate as string) : undefined,
      repairDate: item.repairDate ? new Date(item.repairDate as string) : undefined,
      createdAt: new Date((item.createdAt as string) ?? new Date()),
      updatedAt: new Date((item.updatedAt as string) ?? new Date()),
    })) as MaintenanceRecord[]
  } catch {
    return null
  }
}

// ----------------------------------------------
// PUBLIC API
// ----------------------------------------------

export async function loadMaintenanceRecords()
  : Promise<MaintenanceRecord[]> {
  // 1) FUENTE PRIMARIA (Redis): datos recién procesados por el agente.
  const primary = await loadFromPrimary()
  if (primary && primary.length > 0) return primary

  // 2) En el cliente, siempre usar Firestore
  if (typeof window !== "undefined") {
    return loadFromFirestore()
  }
  // 3) En el servidor, verificar LOCAL_MODE
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "1") {
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