import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs,
  query, where, serverTimestamp, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createAuditLog } from "./audit"
import type { SparePart, CreateSparePartInput, SparePartCategory, SparePartSource } from "@/types"

const COLLECTION = "machine_spare_parts"

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date()
}

function docToSparePart(docSnap: { id: string; data: () => Record<string, unknown> }): SparePart {
  const data = docSnap.data()
  return {
    id: docSnap.id,
    machineId: (data.machineId as string) ?? "",
    machineName: (data.machineName as string) ?? "",
    machineModel: (data.machineModel as string) ?? "",
    partName: (data.partName as string) ?? "",
    partCode: (data.partCode as string) ?? "",
    category: (data.category as SparePartCategory) ?? "otro",
    unit: (data.unit as string) ?? "unidad",
    stockTotal: (data.stockTotal as number) ?? 0,
    stockAvailable: (data.stockAvailable as number) ?? 0,
    stockUsed: (data.stockUsed as number) ?? 0,
    source: (data.source as SparePartSource) ?? "manual",
    blueprintId: (data.blueprintId as string) ?? undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

export async function getSparePartsByMachine(machineId: string): Promise<SparePart[]> {
  const q = query(
    collection(db, COLLECTION),
    where("machineId", "==", machineId),
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToSparePart)
}

export async function getSparePartById(id: string): Promise<SparePart | null> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return docToSparePart(snap)
}

export async function createSparePart(input: CreateSparePartInput): Promise<string> {
  const existing = await getDocs(
    query(
      collection(db, COLLECTION),
      where("machineId", "==", input.machineId),
      where("partCode", "==", input.partCode),
    )
  )
  if (!existing.empty) {
    throw new Error(
      `Ya existe un repuesto con código "${input.partCode}" para esta máquina. Usá "Reponer" para agregar stock.`
    )
  }

  const docData: Record<string, unknown> = {
    machineId: input.machineId,
    machineName: input.machineName,
    machineModel: input.machineModel,
    partName: input.partName,
    partCode: input.partCode,
    category: input.category,
    unit: input.unit,
    stockTotal: input.stockTotal,
    stockAvailable: input.stockTotal,
    stockUsed: 0,
    source: input.source ?? "manual",
    blueprintId: input.blueprintId ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const docRef = await addDoc(collection(db, COLLECTION), docData)
  await createAuditLog("create", "machine_spare_part", docRef.id, null, docData)
  return docRef.id
}

export async function updateSparePart(
  id: string,
  data: Partial<Pick<SparePart, "partName" | "category" | "unit">>,
): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const updates: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() }
  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  await createAuditLog("update", "machine_spare_part", id, before ?? null, after)
}

export async function deleteSparePart(id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  await deleteDoc(ref)
  await createAuditLog("delete", "machine_spare_part", id, before ?? null, null)
}

export async function usePart(id: string, quantity: number): Promise<void> {
  if (quantity <= 0) throw new Error("La cantidad debe ser mayor a 0")

  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  if (!before) throw new Error("Repuesto no encontrado")

  const currentTotal = (before.stockTotal as number) ?? 0
  const currentAvailable = (before.stockAvailable as number) ?? 0
  const currentUsed = (before.stockUsed as number) ?? 0

  if (currentAvailable < quantity) {
    throw new Error(
      `Stock insuficiente: disponible ${currentAvailable}, solicitado ${quantity}`
    )
  }

  const updates: Record<string, unknown> = {
    stockTotal: currentTotal - quantity,
    stockAvailable: currentAvailable - quantity,
    stockUsed: currentUsed + quantity,
    updatedAt: serverTimestamp(),
  }
  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  await createAuditLog("update", "machine_spare_part", id, before ?? null, after)
}

export async function restockPart(id: string, quantity: number): Promise<void> {
  if (quantity <= 0) throw new Error("La cantidad debe ser mayor a 0")

  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  if (!before) throw new Error("Repuesto no encontrado")

  const currentTotal = (before.stockTotal as number) ?? 0
  const currentAvailable = (before.stockAvailable as number) ?? 0

  const updates: Record<string, unknown> = {
    stockTotal: currentTotal + quantity,
    stockAvailable: currentAvailable + quantity,
    updatedAt: serverTimestamp(),
  }
  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  await createAuditLog("update", "machine_spare_part", id, before ?? null, after)
}
