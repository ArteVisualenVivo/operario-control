import {
  collection, addDoc, getDocs, query, where, orderBy, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import type { InventoryMovement, InventoryMovementType, CreateInventoryMovementInput } from "@/types"

const COLLECTION = "inventory_movements"

export async function createInventoryMovement(input: CreateInventoryMovementInput): Promise<string> {
  const docRef = await addDoc(collection(db, COLLECTION), {
    materialId: input.materialId,
    type: input.type,
    quantity: input.quantity,
    clientName: input.clientName ?? null,
    projectName: input.projectName ?? null,
    reference: input.reference ?? null,
    rentalId: input.rentalId ?? null,
    date: Timestamp.now(),
  })
  return docRef.id
}

export async function getAllInventoryMovements(): Promise<InventoryMovement[]> {
  const q = query(collection(db, COLLECTION), orderBy("date", "desc"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      materialId: data.materialId as string,
      date: (data.date as Timestamp)?.toDate() ?? new Date(),
      type: data.type as InventoryMovementType,
      quantity: (data.quantity as number) ?? 0,
      clientName: data.clientName as string | undefined,
      projectName: data.projectName as string | undefined,
      reference: data.reference as string | undefined,
      rentalId: data.rentalId as string | undefined,
    }
  })
}

export async function getInventoryMovementsByMaterial(materialId: string): Promise<InventoryMovement[]> {
  const q = query(
    collection(db, COLLECTION),
    where("materialId", "==", materialId),
    orderBy("date", "desc"),
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      materialId: data.materialId as string,
      date: (data.date as Timestamp)?.toDate() ?? new Date(),
      type: data.type as InventoryMovementType,
      quantity: (data.quantity as number) ?? 0,
      clientName: data.clientName as string | undefined,
      projectName: data.projectName as string | undefined,
      reference: data.reference as string | undefined,
      rentalId: data.rentalId as string | undefined,
    }
  })
}
