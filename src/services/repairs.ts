import {
  collection,
  addDoc,
  updateDoc,
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
import type { Repair, RepairFormData, RepairStatus } from "@/types"

const COLLECTION = "repairs"

function docToRepair(doc: { id: string; data: () => Record<string, unknown> }): Repair {
  const data = doc.data()
  return {
    id: doc.id,
    ...data,
    estimatedReturn: (data.estimatedReturn as Timestamp)?.toDate() ?? null,
    createdAt: (data.createdAt as Timestamp)?.toDate() ?? new Date(),
    updatedAt: (data.updatedAt as Timestamp)?.toDate() ?? new Date(),
  } as unknown as Repair
}

export async function createRepair(data: RepairFormData): Promise<string> {
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...data,
    status: "pending",
    estimatedReturn: data.estimatedReturn ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await updateDoc(doc(db, "machines", data.machineId), { status: "maintenance", updatedAt: serverTimestamp() })
  const repair = { id: docRef.id, ...data, status: "pending" }
  await createAuditLog("create", "repair", docRef.id, null, repair as unknown as Record<string, unknown>)
  return docRef.id
}

export async function updateRepairStatus(id: string, status: RepairStatus): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const updates: Record<string, unknown> = { status, updatedAt: serverTimestamp() }
  if (status === "done") {
    updates.completedAt = serverTimestamp()
  }
  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  if (before?.machineId) {
    const machineRef = doc(db, "machines", before.machineId as string)
    if (status === "done") {
      await updateDoc(machineRef, { status: "available", updatedAt: serverTimestamp() })
    } else if (status === "repairing") {
      await updateDoc(machineRef, { status: "maintenance", updatedAt: serverTimestamp() })
    }
  }
  await createAuditLog("update", "repair", id, before ?? null, after)
}

export async function getRepair(id: string): Promise<Repair | null> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return docToRepair(snap)
}

export async function getRepairs(): Promise<Repair[]> {
  const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToRepair)
}

export async function getPendingRepairs(): Promise<Repair[]> {
  const q = query(collection(db, COLLECTION), where("status", "!=", "done"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToRepair)
}
