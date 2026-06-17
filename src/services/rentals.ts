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
import type { Rental, RentalFormData } from "@/types"

const COLLECTION = "rentals"

function docToRental(doc: { id: string; data: () => Record<string, unknown> }): Rental {
  const data = doc.data()
  return {
    id: doc.id,
    ...data,
    startDate: (data.startDate as Timestamp)?.toDate() ?? new Date(),
    returnDate: (data.returnDate as Timestamp)?.toDate() ?? null,
    createdAt: (data.createdAt as Timestamp)?.toDate() ?? new Date(),
    updatedAt: (data.updatedAt as Timestamp)?.toDate() ?? new Date(),
  } as unknown as Rental
}

export async function createRental(data: RentalFormData): Promise<string> {
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...data,
    returnDate: null,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await updateDoc(doc(db, "machines", data.machineId), { status: "rented", updatedAt: serverTimestamp() })
  const rental = { id: docRef.id, ...data, status: "active" }
  await createAuditLog("create", "rental", docRef.id, null, rental as unknown as Record<string, unknown>)
  return docRef.id
}

export async function closeRental(id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  await updateDoc(ref, {
    status: "closed",
    returnDate: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  const after = { ...before, status: "closed" }
  if (before?.machineId) {
    await updateDoc(doc(db, "machines", before.machineId as string), { status: "available", updatedAt: serverTimestamp() })
  }
  await createAuditLog("update", "rental", id, before ?? null, after)
}

export async function getRental(id: string): Promise<Rental | null> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return docToRental(snap)
}

export async function getRentals(): Promise<Rental[]> {
  const q = query(collection(db, COLLECTION), orderBy("startDate", "desc"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToRental)
}

export async function getActiveRentals(): Promise<Rental[]> {
  const q = query(collection(db, COLLECTION), where("status", "==", "active"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToRental)
}
