import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createAuditLog } from "./audit"
import type { Machine, MachineCategory, RentalInfo, MaintenanceInfo, CreateMachineInput, UpdateMachineInput } from "@/types"
import { mapOldCategory } from "@/lib/categories"

const COLLECTION = "machines"

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date()
}

function parseRental(raw: unknown): RentalInfo | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  return {
    client: (r.client as string) ?? "",
    startDate: toDate(r.startDate),
    returnDate: r.returnDate ? toDate(r.returnDate) : null,
  }
}

function parseMaintenance(raw: unknown): MaintenanceInfo | null {
  if (!raw || typeof raw !== "object") return null
  const m = raw as Record<string, unknown>
  return {
    reason: (m.reason as string) ?? "",
    startDate: toDate(m.startDate),
    estimatedEnd: m.estimatedEnd ? toDate(m.estimatedEnd) : null,
  }
}

function docToMachine(docSnap: { id: string; data: () => Record<string, unknown> }): Machine {
  const data = docSnap.data()
  const rawCategory = data.category as string | undefined
  const category = rawCategory ? (mapOldCategory(rawCategory) ?? rawCategory as MachineCategory) : null
  const rawMetadata = data.metadata as Record<string, unknown> | undefined
  return {
    id: docSnap.id,
    name: (data.name as string) ?? "",
    model: (data.model as string) ?? "",
    category,
    subcategory: (data.subcategory as string) ?? null,
    metadata: rawMetadata ? { priceAction: (rawMetadata.priceAction as boolean) ?? null } : null,
    status: data.status as Machine["status"],
    location: data.location as Machine["location"],
    rental: parseRental(data.rental),
    maintenance: parseMaintenance(data.maintenance),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  } as Machine
}

export async function createMachine(input: CreateMachineInput): Promise<string> {
  const docData: Record<string, unknown> = {
    name: input.name,
    model: input.model,
    category: input.category ?? null,
    subcategory: input.subcategory ?? null,
    metadata: input.metadata ?? null,
    status: input.status,
    location: input.location,
    rental: input.rental,
    maintenance: input.maintenance,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const docRef = await addDoc(collection(db, COLLECTION), docData)
  await createAuditLog("create", "machine", docRef.id, null, docData as unknown as Record<string, unknown>)
  return docRef.id
}

export async function rentMachine(id: string, rental: RentalInfo): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const rentalData = {
    client: rental.client,
    startDate: rental.startDate,
    returnDate: rental.returnDate ?? null,
  }
  await updateDoc(ref, {
    status: "rented",
    rental: rentalData,
    maintenance: null,
    updatedAt: serverTimestamp(),
  })
  const after = { ...before, status: "rented", rental: rentalData, maintenance: null }
  await createAuditLog("update", "machine", id, before ?? null, after)
}

export async function returnMachine(id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  await updateDoc(ref, {
    status: "available",
    rental: null,
    updatedAt: serverTimestamp(),
  })
  const after = { ...before, status: "available", rental: null }
  await createAuditLog("update", "machine", id, before ?? null, after)
}

export async function startMaintenance(id: string, maintenance: MaintenanceInfo): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const maintenanceData = {
    reason: maintenance.reason,
    startDate: maintenance.startDate,
    estimatedEnd: maintenance.estimatedEnd ?? null,
  }
  await updateDoc(ref, {
    status: "maintenance",
    maintenance: maintenanceData,
    rental: null,
    updatedAt: serverTimestamp(),
  })
  const after = { ...before, status: "maintenance", maintenance: maintenanceData, rental: null }
  await createAuditLog("update", "machine", id, before ?? null, after)
}

export async function completeMaintenance(id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  await updateDoc(ref, {
    status: "available",
    maintenance: null,
    updatedAt: serverTimestamp(),
  })
  const after = { ...before, status: "available", maintenance: null }
  await createAuditLog("update", "machine", id, before ?? null, after)
}

export async function updateMachine(id: string, data: UpdateMachineInput): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const updates = { ...data, updatedAt: serverTimestamp() }
  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  await createAuditLog("update", "machine", id, before ?? null, after)
}

export async function deleteMachine(id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  await deleteDoc(ref)
  await createAuditLog("delete", "machine", id, before ?? null, null)
}

export async function getMachine(id: string): Promise<Machine | null> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return docToMachine(snap)
}

export async function getMachines(): Promise<Machine[]> {
  const q = query(collection(db, COLLECTION), orderBy("name"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToMachine)
}
