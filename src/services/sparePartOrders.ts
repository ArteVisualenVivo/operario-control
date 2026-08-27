import {
  collection, addDoc, getDocs, getDoc, doc, updateDoc, query, where, orderBy, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { LOCAL_MODE } from "@/lib/runtimeMode"
import { createAuditLog } from "./audit"
import { restockPart, usePart as consumePart } from "./spareParts"
import type { SparePartOrder, CreateSparePartOrderInput, SparePartOrderStatus, MarkOrderedInput } from "@/types"

const COLLECTION = "spare_part_orders"

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date()
}

function docToOrder(snap: { id: string; data: () => Record<string, unknown> }): SparePartOrder {
  const d = snap.data()
  return {
    id: snap.id,
    repairId: (d.repairId as string) ?? "",
    orderNumber: (d.orderNumber as string) ?? "",
    machineId: (d.machineId as string) ?? "",
    machineName: (d.machineName as string) ?? "",
    sparePartId: (d.sparePartId as string) || undefined,
    code: (d.code as string) ?? "",
    description: (d.description as string) ?? "",
    unit: (d.unit as string) ?? "unidad",
    quantityRequested: (d.quantityRequested as number) ?? 0,
    quantityReceived: (d.quantityReceived as number) ?? 0,
    quantityUsed: (d.quantityUsed as number) ?? 0,
    status: (d.status as SparePartOrderStatus) ?? "SOLICITADO",
    supplier: (d.supplier as string) || undefined,
    requestedAt: toDate(d.requestedAt),
    orderedAt: d.orderedAt ? toDate(d.orderedAt) : undefined,
    expectedAt: d.expectedAt ? toDate(d.expectedAt) : undefined,
    receivedAt: d.receivedAt ? toDate(d.receivedAt) : undefined,
    usedAt: d.usedAt ? toDate(d.usedAt) : undefined,
    notes: (d.notes as string) || undefined,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

export async function getAllOrders(): Promise<SparePartOrder[]> {
  try {
    const q = query(collection(db, COLLECTION), orderBy("requestedAt", "desc"))
    const snap = await getDocs(q)
    return snap.docs.map(docToOrder)
  } catch (err) {
    if (LOCAL_MODE) return []
    throw err
  }
}

export async function getOrdersByRepair(repairId: string): Promise<SparePartOrder[]> {
  if (!repairId) return []
  try {
    const q = query(
      collection(db, COLLECTION),
      where("repairId", "==", repairId),
      orderBy("requestedAt", "desc"),
    )
    const snap = await getDocs(q)
    return snap.docs.map(docToOrder)
  } catch (err) {
    if (LOCAL_MODE) return []
    throw err
  }
}

export async function getOrderById(id: string): Promise<SparePartOrder | null> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return docToOrder(snap)
}

export async function createOrder(input: CreateSparePartOrderInput): Promise<string> {
  if (!input.repairId) {
    throw new Error("El pedido debe estar asociado a una orden de trabajo")
  }
  if (!input.machineId) {
    throw new Error("El pedido debe estar asociado a una máquina")
  }
  if (!String(input.code ?? "").trim()) {
    throw new Error("El código del repuesto es obligatorio")
  }
  if (!String(input.description ?? "").trim()) {
    throw new Error("La descripción del repuesto es obligatoria")
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("La cantidad debe ser mayor a 0")
  }

  const docData: Record<string, unknown> = {
    repairId: input.repairId,
    orderNumber: input.orderNumber ?? "",
    machineId: input.machineId,
    machineName: input.machineName ?? "",
    sparePartId: input.sparePartId ?? null,
    code: String(input.code).trim(),
    description: String(input.description).trim(),
    unit: input.unit ?? "unidad",
    quantityRequested: input.quantity,
    quantityReceived: 0,
    quantityUsed: 0,
    status: "SOLICITADO",
    supplier: input.supplier ?? null,
    requestedAt: input.requestedAt ?? new Date(),
    receivedAt: null,
    usedAt: null,
    notes: input.notes ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const ref = await addDoc(collection(db, COLLECTION), docData)
  await createAuditLog("create", "spare_part_order", ref.id, null, docData)
  return ref.id
}

async function loadOrder(id: string): Promise<{ ref: Parameters<typeof updateDoc>[0]; before: Record<string, unknown> }> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error("Pedido no encontrado")
  return { ref, before: snap.data() as Record<string, unknown> }
}

export async function markOrdered(
  id: string,
  input: MarkOrderedInput,
): Promise<void> {
  if (!(input.orderedAt instanceof Date) || Number.isNaN(input.orderedAt.getTime())) {
    throw new Error("La fecha de encargo es inválida")
  }
  if (input.expectedAt && Number.isNaN(input.expectedAt.getTime())) {
    throw new Error("La fecha estimada de retiro es inválida")
  }

  const { ref, before } = await loadOrder(id)
  const status = before.status as SparePartOrderStatus

  if (status !== "SOLICITADO" && status !== "PEDIDO") {
    throw new Error(
      `Solo se puede marcar como encargado un pedido SOLICITADO o PEDIDO (estado actual: ${status})`,
    )
  }

  const updates: Record<string, unknown> = {
    status: "ENCARGADO",
    orderedAt: input.orderedAt,
    expectedAt: input.expectedAt ?? null,
    updatedAt: new Date(),
  }
  if (input.notes !== undefined) updates.notes = input.notes

  await updateDoc(ref, updates)
  await createAuditLog("update", "spare_part_order", id, before, { ...before, ...updates })
}

export async function markReceived(
  id: string,
  quantity: number,
  receivedAt?: Date,
  notes?: string,
): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("La cantidad recibida debe ser mayor a 0")
  }

  const { ref, before } = await loadOrder(id)

  const currentReceived = (before.quantityReceived as number) ?? 0
  const requested = (before.quantityRequested as number) ?? 0
  const status = before.status as SparePartOrderStatus

  if (status === "CANCELADO") {
    throw new Error("No se puede recibir un pedido cancelado")
  }
  if (status === "UTILIZADO") {
    throw new Error("El pedido ya fue totalmente utilizado")
  }

  const pending = requested - currentReceived
  if (quantity > pending) {
    throw new Error(
      `Solo quedan ${pending} unidades por recibir (solicitado: ${requested}, recibido: ${currentReceived})`,
    )
  }

  const newReceived = currentReceived + quantity

  const updates: Record<string, unknown> = {
    quantityReceived: newReceived,
    status: "RECIBIDO",
    receivedAt: receivedAt ?? new Date(),
    updatedAt: new Date(),
  }
  if (notes !== undefined) updates.notes = notes

  await updateDoc(ref, updates)
  const after = { ...before, ...updates }

  // Recepción = entrada de stock si el repuesto está catalogado
  if (before.sparePartId) {
    await restockPart(before.sparePartId as string, quantity)
  }
  await createAuditLog("update", "spare_part_order", id, before, after)
}

export async function markUsed(
  id: string,
  quantity: number,
  usedAt?: Date,
  notes?: string,
): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("La cantidad utilizada debe ser mayor a 0")
  }

  const { ref, before } = await loadOrder(id)

  const received = (before.quantityReceived as number) ?? 0
  const used = (before.quantityUsed as number) ?? 0
  const status = before.status as SparePartOrderStatus

  if (status === "CANCELADO") {
    throw new Error("No se puede utilizar un pedido cancelado")
  }
  if (received <= 0) {
    throw new Error("No se puede utilizar el repuesto: todavía no fue recibido")
  }

  const remaining = received - used
  if (quantity > remaining) {
    throw new Error(
      `Solo quedan ${remaining} unidades por utilizar (recibido: ${received}, utilizado: ${used})`,
    )
  }

  const newUsed = used + quantity
  const newStatus: SparePartOrderStatus = newUsed >= received ? "UTILIZADO" : "RECIBIDO"

  const updates: Record<string, unknown> = {
    quantityUsed: newUsed,
    status: newStatus,
    usedAt: usedAt ?? new Date(),
    updatedAt: new Date(),
  }
  if (notes !== undefined) updates.notes = notes

  await updateDoc(ref, updates)
  const after = { ...before, ...updates }

  // Utilización = salida de stock si el repuesto está catalogado
  if (before.sparePartId) {
    await consumePart(before.sparePartId as string, quantity)
  }
  await createAuditLog("update", "spare_part_order", id, before, after)
}

export async function cancelOrder(id: string): Promise<void> {
  const { ref, before } = await loadOrder(id)
  const status = before.status as SparePartOrderStatus

  if (status === "UTILIZADO") {
    throw new Error("No se puede cancelar un pedido ya utilizado")
  }
  if (status === "CANCELADO") {
    throw new Error("El pedido ya está cancelado")
  }

  const updates: Record<string, unknown> = { status: "CANCELADO", updatedAt: new Date() }
  await updateDoc(ref, updates)
  await createAuditLog("update", "spare_part_order", id, before, { ...before, ...updates })
}

export async function updateOrderNotes(id: string, notes: string): Promise<void> {
  const { ref, before } = await loadOrder(id)
  const updates: Record<string, unknown> = { notes: notes || null, updatedAt: new Date() }
  await updateDoc(ref, updates)
  await createAuditLog("update", "spare_part_order", id, before, { ...before, ...updates })
}

