// local-sync.ts — LECTURAS ISOMORFAS.
//
// REGLA DE ARQUITECTURA (frontera cliente/servidor):
// fs/path/xlsx/firebase-admin viven en local-sync.server.ts y NO se importan
// desde acá. Este módulo lo importan páginas cliente (dashboard, mantenimiento)
// y sparePartOrders.ts (que también corre en el navegador), así que ni siquiera
// un `await import("./local-sync.server")` es seguro: Turbopack resuelve los
// especificadores literales de forma ESTÁTICA y metería xlsx (CommonJS) y
// firebase-admin en el bundle del navegador → "module is not defined".
//
// En su lugar el backend servidor se INYECTA desde Node con
// `registerLocalSyncServerStore()` (lo llama el agente al arrancar; ver
// installLocalSyncServerStore() en local-sync.server.ts). Es el mismo patrón que
// usa Pedidos Rep. con sparePartOrderStore.server.ts.
//
// - NAVEGADOR: fetch a /api/* (Redis) o Firestore client SDK.
// - NODE (agente): backend servidor inyectado (Excel local / Admin SDK).
import type { MachineRepair } from "@/types"
import type { MaintenanceRecord } from "@/services/maintenance"

/**
 * Backend SERVIDOR (Node) de las lecturas: Excel local de 3C (fs/xlsx) y
 * Admin SDK de Firestore. Lo provee `local-sync.server.ts` por INYECCIÓN.
 *
 * REGLA: este archivo es ISOMORFO. No puede importar fs/path/xlsx/firebase-admin
 * ni con `import()` dinámico: el bundler incluye los especificadores literales
 * igual, aunque el guard de `typeof window` impida ejecutarlos.
 */
export interface LocalSyncServerStore {
  loadFromExcelServer: () => Promise<MaintenanceRecord[]>
  loadMaintenanceAdminServer: () => Promise<MaintenanceRecord[] | null>
}

let localSyncServerStore: LocalSyncServerStore | null = null

/**
 * Instala el backend servidor (Excel local + Admin SDK). La llama el agente local
 * al arrancar, que SÍ corre en Node. En el navegador nunca se llama → las
 * lecturas usan la API (Redis) o el client SDK de Firestore.
 */
export function registerLocalSyncServerStore(store: LocalSyncServerStore): void {
  localSyncServerStore = store
}
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
  // En el cliente no hay fs; en Node, sin backend inyectado tampoco hay lectura local.
  if (typeof window !== "undefined") return []
  return (await localSyncServerStore?.loadFromExcelServer()) ?? []
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
    // El backend inyectado hace el trabajo completo (service account → colección
    // "maintenance" → MaintenanceRecord[]); null si el Admin SDK no está
    // disponible o si nadie instaló el backend.
    const records = (await localSyncServerStore?.loadMaintenanceAdminServer()) ?? null
    // Sin Admin disponible y sin fuente primaria: [] en lugar de excepción, para
    // no abortar el ciclo del agente (antes esto frenaba toda la importación de
    // repuestos con "Missing or insufficient permissions").
    return records ?? []
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