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

let getStockItemsCalls = 0
let stockItemsCache: InventoryStock[] | null = null
let stockItemsPromise: Promise<InventoryStock[]> | null = null

function clearStockItemsCache() {
  stockItemsCache = null
  stockItemsPromise = null
}

// Invalida la fuente primaria de stock en Redis tras una mutación manual,
// para que la web no siga mostrando datos obsoletos del último sync. REGLA 22.
async function invalidatePrimaryStock() {
  clearStockItemsCache()
  try {
    await fetch(`/api/sync-3c/data/stock`, { method: "DELETE", cache: "no-store" })
  } catch {
    // si falla la invalidación remota, al menos se limpió el cache local
  }
}

function mapPrimaryToStock(raw: Record<string, unknown>): InventoryStock {
  const now = new Date()
  return {
    id: String(raw.codigo ?? raw.name ?? `local-${Math.random().toString(36).slice(2)}`),
    name: (raw.name as string) ?? "",
    category: (raw.category as InventoryStock["category"]) ?? "consumibles",
    unit: (raw.unit as InventoryStock["unit"]) ?? "unidad",
    stockTotal: (raw.stockTotal as number) ?? 0,
    stockAvailable: (raw.stockTotal as number) ?? 0,
    stockRented: (raw.stockRented as number) ?? 0,
    subtype: (raw.subtype as StockSubtype) ?? null,
    size: (raw.size as StockSize | string) ?? null,
    locationType: "deposito",
    createdAt: now,
    updatedAt: now,
  }
}

/** Lee la fuente primaria (Redis) vía API. Devuelve null si aún no hay datos. */
async function loadPrimaryStock(): Promise<InventoryStock[] | null> {
  try {
    const res = await fetch(`/api/sync-3c/data/stock`, { cache: "no-store" })
    if (!res.ok) return null
    const body = await res.json()
    if (!body?.available || !Array.isArray(body?.data) || body.recordCount === 0) return null
    return (body.data as Record<string, unknown>[]).map(mapPrimaryToStock)
  } catch {
    return null
  }
}

export async function getStockItems(): Promise<InventoryStock[]> {
  if (stockItemsCache) return stockItemsCache
  if (stockItemsPromise) return stockItemsPromise

  stockItemsPromise = (async () => {
    try {
      // 1) FUENTE PRIMARIA: datos recién descargados/procesados por el agente
      //    (funciona aunque Firestore esté sin cuota).
      const primary = await loadPrimaryStock()
      if (primary && primary.length > 0) {
        stockItemsCache = primary
        return primary
      }

      // 2) FALLBACK: Firestore
      const q = query(collection(db, COLLECTION), orderBy("name"))
      const start = Date.now()
      const snapshot = await getDocs(q)
      getStockItemsCalls++
      console.log(`[SYNC] getStockItems() Call #${getStockItemsCalls} docs=${snapshot.size} time=${(Date.now() - start).toFixed(1)}ms`)
      const data = snapshot.docs.map(docToStock)
      if (LOCAL_MODE && data.length === 0) {
        return LOCAL_STOCK_SEED
      }
      stockItemsCache = data
      return data
    } catch (err) {
      // 3) SI TODO FALLA: seed local (solo desarrollo) o propagar
      const primaryFallback = await loadPrimaryStock().catch(() => null)
      if (primaryFallback && primaryFallback.length > 0) {
        stockItemsCache = primaryFallback
        return primaryFallback
      }
      if (LOCAL_MODE) {
        return LOCAL_STOCK_SEED
      }
      const message = err instanceof Error ? err.message : "Error desconocido"
      throw new Error(`Error al cargar materiales: ${message}`)
    } finally {
      stockItemsPromise = null
    }
  })()

  return stockItemsPromise
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
  await invalidatePrimaryStock()
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
  await invalidatePrimaryStock()
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
  await invalidatePrimaryStock()
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
  await invalidatePrimaryStock()
}
