import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs,
  query, orderBy, serverTimestamp, Timestamp, writeBatch,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createAuditLog } from "./audit"
import type { Machine, MachineRental, LocationInfo, CreateMachineInput, UpdateMachineInput } from "@/types"

const COLLECTION = "machines"

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date()
}

function parseLocation(raw: unknown): LocationInfo | null {
  if (!raw || typeof raw !== "object") return null
  const l = raw as Record<string, unknown>
  const client = l.client as Record<string, unknown> | undefined
  const project = l.project as Record<string, unknown> | undefined
  if (!client || !project) return null
  return {
    client: { name: (client.name as string) ?? "", address: (client.address as string) ?? "" },
    project: { name: (project.name as string) ?? "", address: (project.address as string) ?? "" },
  }
}

function parseRental(raw: unknown): MachineRental | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  return {
    clientName: (r.clientName as string) ?? "",
    clientAddress: (r.clientAddress as string) ?? "",
    projectName: (r.projectName as string) ?? "",
    projectAddress: (r.projectAddress as string) ?? "",
    startDate: toDate(r.startDate),
    expectedEndDate: r.expectedEndDate ? toDate(r.expectedEndDate) : null,
    isOpenEnded: (r.isOpenEnded as boolean) ?? false,
  }
}

function docToMachine(docSnap: { id: string; data: () => Record<string, unknown> }): Machine {
  const data = docSnap.data()
  return {
    id: docSnap.id,
    name: (data.name as string) ?? "",
    model: (data.model as string) ?? "",
    category: data.category as Machine["category"],
    status: data.status as Machine["status"],
    locationType: (data.locationType as Machine["locationType"]) ?? "deposito",
    location: parseLocation(data.location),
    rental: parseRental(data.rental),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  } as Machine
}

function marshalLocation(l: LocationInfo): Record<string, unknown> {
  return {
    client: { name: l.client.name, address: l.client.address },
    project: { name: l.project.name, address: l.project.address },
  }
}

function marshalRental(r: MachineRental): Record<string, unknown> {
  return {
    clientName: r.clientName,
    clientAddress: r.clientAddress,
    projectName: r.projectName,
    projectAddress: r.projectAddress,
    startDate: r.startDate,
    expectedEndDate: r.expectedEndDate ?? null,
    isOpenEnded: r.isOpenEnded,
  }
}

export async function createMachine(input: CreateMachineInput): Promise<string> {
  const docData: Record<string, unknown> = {
    name: input.name,
    model: input.model,
    category: input.category ?? null,
    status: input.status,
    locationType: input.locationType,
    location: input.location ? marshalLocation(input.location) : null,
    rental: input.rental ? marshalRental(input.rental) : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const docRef = await addDoc(collection(db, COLLECTION), docData)
  await createAuditLog("create", "machine", docRef.id, null, docData)
  return docRef.id
}

export async function rentMachine(id: string, rental: MachineRental): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const rentalData = marshalRental(rental)
  await updateDoc(ref, {
    status: "rented",
    rental: rentalData,
    location: {
      client: { name: rental.clientName, address: rental.clientAddress },
      project: { name: rental.projectName, address: rental.projectAddress },
    },
    updatedAt: serverTimestamp(),
  })
  const after = { ...before, status: "rented", rental: rentalData }
  await createAuditLog("update", "machine", id, before ?? null, after)
}

export async function returnMachine(id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const currentRental = before?.rental as Record<string, unknown> | undefined
  const rentalData = currentRental ? { ...currentRental, actualReturnDate: new Date() } : null
  await updateDoc(ref, {
    status: "available",
    rental: rentalData,
    updatedAt: serverTimestamp(),
  })
  const after = { ...before, status: "available", rental: rentalData }
  await createAuditLog("update", "machine", id, before ?? null, after)
}

export async function updateMachine(id: string, data: UpdateMachineInput): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const updates: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() }
  if (data.location) {
    updates.location = marshalLocation(data.location)
  }
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

export async function deleteAllMachines(): Promise<number> {
  const snapshot = await getDocs(collection(db, COLLECTION))
  const docs = snapshot.docs
  const total = docs.length

  for (let i = 0; i < docs.length; i += 500) {
    const batch = writeBatch(db)
    const chunk = docs.slice(i, i + 500)

    for (const docSnap of chunk) {
      batch.delete(docSnap.ref)
    }
    await batch.commit()

    for (const docSnap of chunk) {
      await createAuditLog("delete", "machine", docSnap.id, docSnap.data() as Record<string, unknown> ?? null, null)
    }
  }

  return total
}

export async function getMachines(): Promise<Machine[]> {
  const q = query(collection(db, COLLECTION), orderBy("name"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToMachine)
}
