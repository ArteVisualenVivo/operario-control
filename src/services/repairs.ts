import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs,
  query, where, orderBy, serverTimestamp, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createAuditLog } from "./audit"
import { getMaintenanceSettings } from "./maintenanceSettings"
import { usePart } from "./spareParts"
import { createMovement } from "./stockMovements"
import type { MachineRepair, CreateRepairInput, MaintenanceSettings } from "@/types"

const COLLECTION = "repairs"

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date()
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function docToRepair(docSnap: { id: string; data: () => Record<string, unknown> }): MachineRepair {
  const data = docSnap.data()
  const exitDate = data.exitDate ? toDate(data.exitDate) : toDate(data.createdAt)
  const warrantyDays = (data.warrantyDays as number) ?? 90

  return {
    id: docSnap.id,
    machineId: (data.machineId as string) ?? "",
    machineName: (data.machineName as string) ?? "",
    machineModel: data.machineModel as string | undefined,
    internalNumber: data.internalNumber as string | undefined,
    clientId: data.clientId as string | undefined,
    clientName: (data.clientName as string) ?? "",
    clientNumber: data.clientNumber as string | undefined,
    reportedIssue: (data.reportedIssue as string) ?? (data.issue as string) ?? "",
    diagnosis: data.diagnosis as string | undefined,
    repairPerformed: (data.repairPerformed as string) ?? "",
    technician: (data.technician as string) ?? "",
    entryDate: data.entryDate ? toDate(data.entryDate) : toDate(data.createdAt),
    exitDate,
    hoursUsed: data.hoursUsed as number | undefined,
    warrantyDays,
    warrantyUntil: data.warrantyUntil ? toDate(data.warrantyUntil) : addDays(exitDate, warrantyDays),
    oilChangeDueDate: data.oilChangeDueDate ? toDate(data.oilChangeDueDate) : undefined,
    bearingChangeDueDate: data.bearingChangeDueDate ? toDate(data.bearingChangeDueDate) : undefined,
    maintenanceDueDate: data.maintenanceDueDate ? toDate(data.maintenanceDueDate) : undefined,
    notes: data.notes as string | undefined,
    partsUsed: (data.partsUsed as MachineRepair["partsUsed"]) ?? [],
    source: data.source as MachineRepair["source"] | undefined,
    externalId: data.externalId as string | undefined,
    status: (data.status as MachineRepair["status"]) ?? "done",
    issue: (data.issue as string) ?? "",
    estimatedReturn: data.estimatedReturn ? toDate(data.estimatedReturn) : null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function calculateAutoDates(
  exitDate: Date,
  settings: MaintenanceSettings,
  overrides?: { warrantyDays?: number; oilChangeDays?: number; bearingChangeDays?: number; maintenanceDays?: number },
): {
  warrantyDays: number
  warrantyUntil: Date
  oilChangeDueDate?: Date
  bearingChangeDueDate?: Date
  maintenanceDueDate?: Date
} {
  const warrantyDays = overrides?.warrantyDays ?? settings.warrantyDays
  const oilChangeDays = overrides?.oilChangeDays ?? settings.oilChangeDays
  const bearingChangeDays = overrides?.bearingChangeDays ?? settings.bearingChangeDays
  const maintenanceDays = overrides?.maintenanceDays ?? settings.maintenanceDays

  return {
    warrantyDays,
    warrantyUntil: addDays(exitDate, warrantyDays),
    oilChangeDueDate: addDays(exitDate, oilChangeDays),
    bearingChangeDueDate: addDays(exitDate, bearingChangeDays),
    maintenanceDueDate: addDays(exitDate, maintenanceDays),
  }
}

export async function getRepairs(): Promise<MachineRepair[]> {
  const q = query(collection(db, COLLECTION), orderBy("entryDate", "desc"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToRepair)
}

export async function getRepairsByMachine(machineId: string): Promise<MachineRepair[]> {
  const q = query(
    collection(db, COLLECTION),
    where("machineId", "==", machineId),
    orderBy("entryDate", "desc"),
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToRepair)
}

export async function getRepair(id: string): Promise<MachineRepair | null> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return docToRepair(snap)
}

export async function createRepair(input: CreateRepairInput): Promise<string> {
  const settings = await getMaintenanceSettings()
  const auto = calculateAutoDates(input.exitDate, settings, {
    warrantyDays: input.warrantyDays,
    oilChangeDays: input.oilChangeDays,
    bearingChangeDays: input.bearingChangeDays,
    maintenanceDays: input.maintenanceDays,
  })

  const docData: Record<string, unknown> = {
    machineId: input.machineId,
    machineName: input.machineName,
    machineModel: input.machineModel ?? null,
    internalNumber: input.internalNumber ?? null,
    clientId: input.clientId ?? null,
    clientName: input.clientName,
    clientNumber: input.clientNumber ?? null,
    reportedIssue: input.reportedIssue,
    diagnosis: input.diagnosis ?? null,
    repairPerformed: input.repairPerformed,
    technician: input.technician,
    entryDate: input.entryDate,
    exitDate: input.exitDate,
    hoursUsed: input.hoursUsed ?? null,
    notes: input.notes ?? null,
    partsUsed: input.partsUsed ?? [],
    warrantyDays: auto.warrantyDays,
    warrantyUntil: auto.warrantyUntil,
    oilChangeDueDate: auto.oilChangeDueDate ?? null,
    bearingChangeDueDate: auto.bearingChangeDueDate ?? null,
    maintenanceDueDate: auto.maintenanceDueDate ?? null,
    issue: input.reportedIssue,
    status: input.status ?? "EN_TALLER",
    estimatedReturn: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  const docRef = await addDoc(collection(db, COLLECTION), docData)

  for (const part of input.partsUsed ?? []) {
    try {
      await usePart(part.partId, part.quantity)
      await createMovement(part.partId, "EGRESO", "REPARACION", docRef.id, part.quantity)
    } catch (err) {
      console.error(`Error al descontar stock del repuesto ${part.partId}:`, err)
    }
  }

  await createAuditLog("create", "machine_repair", docRef.id, null, docData)
  return docRef.id
}

export async function updateRepair(
  id: string,
  data: Partial<CreateRepairInput>,
): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  if (!before) throw new Error("Reparación no encontrada")

  const updates: Record<string, unknown> = {
    ...data,
    updatedAt: serverTimestamp(),
  }

  if (data.reportedIssue !== undefined) {
    updates.issue = data.reportedIssue
  }

  const exitDate = data.exitDate ?? (before.exitDate ? toDate(before.exitDate) : null)

  if (exitDate) {
    const settings = await getMaintenanceSettings()
    const auto = calculateAutoDates(exitDate, settings, {
      warrantyDays: (data.warrantyDays as number | undefined) ?? (before.warrantyDays as number | undefined),
      oilChangeDays: (data.oilChangeDays as number | undefined) ?? (before.oilChangeDays as number | undefined),
      bearingChangeDays: (data.bearingChangeDays as number | undefined) ?? (before.bearingChangeDays as number | undefined),
      maintenanceDays: (data.maintenanceDays as number | undefined) ?? (before.maintenanceDays as number | undefined),
    })
    updates.warrantyDays = auto.warrantyDays
    updates.warrantyUntil = auto.warrantyUntil
    updates.oilChangeDueDate = auto.oilChangeDueDate ?? null
    updates.bearingChangeDueDate = auto.bearingChangeDueDate ?? null
    updates.maintenanceDueDate = auto.maintenanceDueDate ?? null
  }

  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  await createAuditLog("update", "machine_repair", id, before ?? null, after)
}

export async function deleteRepair(id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  if (!before) throw new Error("Reparación no encontrada")
  await deleteDoc(ref)
  await createAuditLog("delete", "machine_repair", id, before ?? null, null)
}

export async function getUpcomingWarranty(): Promise<{ expired: MachineRepair[]; upcoming7: MachineRepair[] }> {
  const all = await getRepairs()
  const now = new Date()
  const in7Days = addDays(now, 7)

  const expired: MachineRepair[] = []
  const upcoming7: MachineRepair[] = []

  for (const r of all) {
    if (r.warrantyUntil <= now) {
      expired.push(r)
    } else if (r.warrantyUntil <= in7Days) {
      upcoming7.push(r)
    }
  }

  return { expired, upcoming7 }
}

export async function getUpcomingOilChanges(): Promise<MachineRepair[]> {
  const all = await getRepairs()
  const now = new Date()
  const in7Days = addDays(now, 7)
  return all.filter((r) => r.oilChangeDueDate && r.oilChangeDueDate >= now && r.oilChangeDueDate <= in7Days)
}

export async function getUpcomingBearingChanges(): Promise<MachineRepair[]> {
  const all = await getRepairs()
  const now = new Date()
  const in7Days = addDays(now, 7)
  return all.filter((r) => r.bearingChangeDueDate && r.bearingChangeDueDate >= now && r.bearingChangeDueDate <= in7Days)
}

export async function getOverdueMaintenances(): Promise<MachineRepair[]> {
  const all = await getRepairs()
  const now = new Date()
  return all.filter((r) => r.maintenanceDueDate && r.maintenanceDueDate < now)
}

export async function getRecentRepairs(days = 30): Promise<MachineRepair[]> {
  const all = await getRepairs()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return all.filter((r) => r.entryDate >= cutoff)
}

export async function getWorkshopStats(): Promise<{
  inTaller: number
  finishedToday: number
  overdue: number
  upcoming: number
}> {
  const all = await getRepairs()
  const now = new Date()
  const in7Days = addDays(now, 7)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const inTaller = all.filter((r) => r.status === "EN_TALLER").length

  const finishedToday = all.filter(
    (r) => r.status === "FINALIZADO" && r.exitDate >= todayStart,
  ).length

  const hasOverdue = (r: MachineRepair) =>
    (r.oilChangeDueDate && r.oilChangeDueDate < now) ||
    (r.bearingChangeDueDate && r.bearingChangeDueDate < now) ||
    (r.maintenanceDueDate && r.maintenanceDueDate < now)

  const hasUpcoming = (r: MachineRepair) =>
    (r.oilChangeDueDate && r.oilChangeDueDate >= now && r.oilChangeDueDate <= in7Days) ||
    (r.bearingChangeDueDate && r.bearingChangeDueDate >= now && r.bearingChangeDueDate <= in7Days) ||
    (r.maintenanceDueDate && r.maintenanceDueDate >= now && r.maintenanceDueDate <= in7Days)

  return {
    inTaller,
    finishedToday,
    overdue: all.filter(hasOverdue).length,
    upcoming: all.filter(hasUpcoming).length,
  }
}
