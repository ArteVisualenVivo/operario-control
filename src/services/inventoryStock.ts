/**
 * REGLA DE DOMINIO:
 * - machines → alquiler unitario (1 doc = 1 unidad física)
 * - inventory_stock → inventario agregado (1 doc = stock total de un material)
 * - inventory_stock NO se alquila como unidad individual
 * - Solo se controla por cantidad (rentStockItem / returnStockItem)
 */

import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs,
  query, orderBy, serverTimestamp, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { LOCAL_MODE } from "@/lib/runtimeMode"
import { LOCAL_STOCK_SEED } from "@/lib/local-seeds"
import { createAuditLog } from "./audit"
import { createInventoryMovement } from "./inventoryMovements"
import type { InventoryStock, CreateStockInput, StockSubtype, StockSize } from "@/types"
import type { InventoryMovementType } from "@/types/inventoryMovement"

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
    subtype: (data.subtype as StockSubtype) ?? null,
    size: (data.size as StockSize | string) ?? null,
    locationType: "deposito",
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

export async function getStockItems(): Promise<InventoryStock[]> {
  try {
    const q = query(collection(db, COLLECTION), orderBy("name"))
    const snapshot = await getDocs(q)
    const data = snapshot.docs.map(docToStock)
    if (LOCAL_MODE && data.length === 0) {
      return LOCAL_STOCK_SEED
    }
    return data
  } catch {
    if (LOCAL_MODE) {
      return LOCAL_STOCK_SEED
    }
    throw new Error("No se pudieron cargar los materiales")
  }
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
    subtype: input.subtype ?? null,
    size: input.size ?? null,
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
  data: Partial<Pick<InventoryStock, "name" | "category" | "unit" | "stockTotal" | "subtype" | "size">>,
): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined

  const updates: Record<string, unknown> = {
    ...data,
    updatedAt: serverTimestamp(),
  }

  if (data.stockTotal !== undefined) {
    const beforeData = before ?? {}
    const currentRented = (beforeData.stockRented as number) ?? 0

    if (data.stockTotal < currentRented) {
      throw new Error(
        `No puedes reducir el stock total por debajo del stock actualmente alquilado (${currentRented}). Devuelve unidades primero.`
      )
    }

    updates.stockAvailable = data.stockTotal - currentRented
    updates.stockRented = currentRented
  }

  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  await createAuditLog("update", "inventory_stock", id, before ?? null, after)
}

export async function rentStockItem(
  id: string,
  quantity: number,
  options?: { clientName?: string; projectName?: string; reference?: string },
): Promise<void> {
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
  await createInventoryMovement({
    materialId: id,
    type: "ALQUILER" as InventoryMovementType,
    quantity,
    clientName: options?.clientName,
    projectName: options?.projectName,
    reference: options?.reference,
  })
}

export async function deleteStockItem(id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  if (!before) throw new Error("Material no encontrado")
  await deleteDoc(ref)
  await createAuditLog("delete", "inventory_stock", id, before ?? null, null)
}

export async function returnStockItem(
  id: string,
  quantity: number,
  options?: { clientName?: string; projectName?: string; reference?: string },
): Promise<void> {
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
  await createInventoryMovement({
    materialId: id,
    type: "DEVOLUCION" as InventoryMovementType,
    quantity,
    clientName: options?.clientName,
    projectName: options?.projectName,
    reference: options?.reference,
  })
}
