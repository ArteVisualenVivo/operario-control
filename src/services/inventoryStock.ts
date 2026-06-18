/**
 * REGLA DE DOMINIO:
 * - machines → alquiler unitario (1 doc = 1 unidad física)
 * - inventory_stock → inventario agregado (1 doc = stock total de un material)
 * - inventory_stock NO se alquila como unidad individual
 * - Solo se controla por cantidad (rentStockItem / returnStockItem)
 */

import {
  collection, addDoc, updateDoc, doc, getDoc, getDocs,
  query, orderBy, serverTimestamp, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createAuditLog } from "./audit"
import type { InventoryStock, CreateStockInput } from "@/types"

const COLLECTION = "inventory_stock"

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date()
}

function docToStock(docSnap: { id: string; data: () => Record<string, unknown> }): InventoryStock {
  const data = docSnap.data()
  return {
    id: docSnap.id,
    name: (data.name as string) ?? "",
    category: data.category as InventoryStock["category"],
    unit: (data.unit as InventoryStock["unit"]) ?? "unidad",
    stockTotal: (data.stockTotal as number) ?? 0,
    stockAvailable: (data.stockAvailable as number) ?? 0,
    stockRented: (data.stockRented as number) ?? 0,
    locationType: "deposito",
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

export async function getStockItems(): Promise<InventoryStock[]> {
  const q = query(collection(db, COLLECTION), orderBy("name"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToStock)
}

export async function getStockItem(id: string): Promise<InventoryStock | null> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return docToStock(snap)
}

export async function createStockItem(input: CreateStockInput): Promise<string> {
  const docData: Record<string, unknown> = {
    name: input.name,
    category: input.category,
    unit: input.unit,
    stockTotal: input.stockTotal,
    stockAvailable: input.stockTotal,
    stockRented: 0,
    locationType: "deposito",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const docRef = await addDoc(collection(db, COLLECTION), docData)
  await createAuditLog("create", "inventory_stock", docRef.id, null, docData)
  return docRef.id
}

export async function updateStockItem(
  id: string,
  data: Partial<Pick<InventoryStock, "name" | "category" | "unit" | "stockTotal">>,
): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined

  const updates: Record<string, unknown> = {
    ...data,
    updatedAt: serverTimestamp(),
  }

  if (data.stockTotal !== undefined) {
    const beforeData = before ?? {}
    const currentAvailable = (beforeData.stockAvailable as number) ?? 0
    const currentRented = (beforeData.stockRented as number) ?? 0
    const diff = data.stockTotal - ((beforeData.stockTotal as number) ?? 0)
    updates.stockAvailable = Math.max(0, currentAvailable + diff)
    updates.stockRented = currentRented
  }

  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  await createAuditLog("update", "inventory_stock", id, before ?? null, after)
}

export async function rentStockItem(id: string, quantity: number): Promise<void> {
  if (quantity <= 0) throw new Error("La cantidad debe ser mayor a 0")

  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined

  if (!before) throw new Error("Material no encontrado")

  const currentAvailable = (before.stockAvailable as number) ?? 0
  const currentRented = (before.stockRented as number) ?? 0

  if (currentAvailable < quantity) {
    throw new Error(`Stock insuficiente: disponible ${currentAvailable}, solicitado ${quantity}`)
  }

  const updates: Record<string, unknown> = {
    stockAvailable: currentAvailable - quantity,
    stockRented: currentRented + quantity,
    updatedAt: serverTimestamp(),
  }

  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  await createAuditLog("update", "inventory_stock", id, before ?? null, after)
}

export async function returnStockItem(id: string, quantity: number): Promise<void> {
  if (quantity <= 0) throw new Error("La cantidad debe ser mayor a 0")

  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined

  if (!before) throw new Error("Material no encontrado")

  const currentAvailable = (before.stockAvailable as number) ?? 0
  const currentRented = (before.stockRented as number) ?? 0

  if (currentRented < quantity) {
    throw new Error(`No hay suficientes unidades alquiladas para devolver: alquiladas ${currentRented}, devolución ${quantity}`)
  }

  const updates: Record<string, unknown> = {
    stockAvailable: currentAvailable + quantity,
    stockRented: currentRented - quantity,
    updatedAt: serverTimestamp(),
  }

  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  await createAuditLog("update", "inventory_stock", id, before ?? null, after)
}
