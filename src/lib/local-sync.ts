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

/**
 * Mapea los registros crudos (JSON con fechas ISO) que vienen de la fuente
 * primaria o de la API a MaintenanceRecord con Date reales.
 */
function mapRawRecords(data: unknown[]): MaintenanceRecord[] {
  return (data as Record<string, unknown>[]).map((item) => ({
    ...item,
    entryDate: new Date((item.entryDate as string) ?? new Date()),
    returnDate: item.returnDate ? new Date(item.returnDate as string) : undefined,
    repairDate: item.repairDate ? new Date(item.repairDate as string) : undefined,
    statusDate: item.statusDate ? new Date(item.statusDate as string) : undefined,
    createdAt: new Date((item.createdAt as string) ?? new Date()),
    updatedAt: new Date((item.updatedAt as string) ?? new Date()),
  })) as MaintenanceRecord[]
}

async function loadFromFirestore()
  : Promise<MaintenanceRecord[]> {
  // En NODE (agente, API routes) NO hay sesión de usuario: el client SDK
  // responde "Missing or insufficient permissions". Se usa el Admin SDK con la
  // service account (mismo mecanismo que engine.ts / firestoreSync.ts).
  if (typeof window === "undefined") {
    const { getAdminFirestore } = await import("./sync-3c/adminDb")
    const admin = await getAdminFirestore()
    if (admin) {
      try {
        const snap = await admin.collection("maintenance").get()
        return snap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            ...data,
            entryDate: data.entryDate ? new Date(data.entryDate as string) : new Date(),
            returnDate: data.returnDate ? new Date(data.returnDate as string) : undefined,
            repairDate: data.repairDate ? new Date(data.repairDate as string) : undefined,
            statusDate: data.statusDate ? new Date(data.statusDate as string) : undefined,
            createdAt: data.createdAt ? new Date(data.createdAt as string) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt as string) : new Date(),
          } as MaintenanceRecord
        })
      } catch (err) {
        console.error(
          "[local-sync] Admin loadFromFirestore falló:",
          err instanceof Error ? err.message : err,
        )
      }
    }
    // Sin Admin disponible y sin fuente primaria: [] en lugar de excepción, para
    // no abortar el ciclo del agente (antes esto frenaba toda la importación de
    // repuestos con "Missing or insufficient permissions").
    return []
  }

  const { getMaintenanceRecords } = await import(
    "@/services/maintenance"
  )
  return getMaintenanceRecords()
}

// 1) FUENTE PRIMARIA (Redis): datos recién procesados por el agente.
//    - NAVEGADOR: se consulta por la API interna (misma máquina que sirve la web).
//    - NODE (agente): se lee Redis directo con las credenciales Upstash del
//      entorno; el fetch relativo no es válido fuera del navegador.
async function loadFromPrimary()
  : Promise<MaintenanceRecord[] | null> {
  if (typeof window === "undefined") {
    try {
      const { getRedis, readModuleData } = await import("./sync-3c/redisPrimary")
      const envelope = await readModuleData("maintenance", getRedis())
      if (!envelope || !Array.isArray(envelope.data) || envelope.recordCount === 0) return null
      return mapRawRecords(envelope.data as unknown[])
    } catch {
      return null
    }
  }
  try {
    const res = await fetch(`/api/sync-3c/data/maintenance`, { cache: "no-store" })
    if (!res.ok) return null
    const body = await res.json()
    if (!body?.available || !Array.isArray(body?.data) || body.recordCount === 0) return null
    return mapRawRecords(body.data as unknown[])
  } catch {
    return null
  }
}

/**
 * FUENTE PRIMARIA (Redis) de PEDIDOS DE REPUESTO, para MOSTRAR en la web.
 *
 * REGLA: la web lee primero de Redis (lo último que dejó el agente) y si no hay
 * snapshot cae a Firestore. Así la pantalla NO depende de la cuota de Firestore.
 *
 * Se usa SOLO en el navegador: en Node (agente) la fuente de verdad para
 * escribir/actualizar sigue siendo Firestore (evita duplicados por leer un
 * snapshot viejo).
 */
export async function loadSparePartOrdersPrimary(): Promise<Record<string, unknown>[] | null> {
  if (typeof window === "undefined") return null
  try {
    const res = await fetch(`/api/sync-3c/data/spare_part_orders`, { cache: "no-store" })
    if (!res.ok) return null
    const body = await res.json()
    if (!body?.available || !Array.isArray(body?.data) || body.recordCount === 0) return null
    return body.data as Record<string, unknown>[]
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