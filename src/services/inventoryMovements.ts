import {
  collection, addDoc, getDocs, query, where, orderBy, limit, Timestamp,
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

let getAllInventoryMovementsCalls = 0
let getInventoryMovementsByMaterialCalls = 0
let getRecentInventoryMovementsCalls = 0

export async function getAllInventoryMovements(): Promise<InventoryMovement[]> {
  const start = Date.now()
  const q = query(collection(db, COLLECTION), orderBy("date", "desc"))
  const snapshot = await getDocs(q)
  getAllInventoryMovementsCalls++
  console.log(`[SYNC] getAllInventoryMovements() Call #${getAllInventoryMovementsCalls} docs=${snapshot.size} time=${(Date.now() - start).toFixed(1)}ms`)
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
  const start = Date.now()
  const q = query(
    collection(db, COLLECTION),
    where("materialId", "==", materialId),
    orderBy("date", "desc"),
  )
  const snapshot = await getDocs(q)
  getInventoryMovementsByMaterialCalls++
  console.log(`[SYNC] getInventoryMovementsByMaterial() Call #${getInventoryMovementsByMaterialCalls} docs=${snapshot.size} time=${(Date.now() - start).toFixed(1)}ms`)
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

export async function getRecentInventoryMovements(
  daysAgo: number,
  maxItems: number,
): Promise<InventoryMovement[]> {
  const start = Date.now()
  const since = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  const q = query(
    collection(db, COLLECTION),
    where("date", ">=", since),
    orderBy("date", "desc"),
    limit(maxItems),
  )
  const snapshot = await getDocs(q)
  getRecentInventoryMovementsCalls++
  console.log(`[SYNC] getRecentInventoryMovements() Call #${getRecentInventoryMovementsCalls} docs=${snapshot.size} time=${(Date.now() - start).toFixed(1)}ms`)
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
