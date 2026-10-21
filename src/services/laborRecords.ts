import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  writeBatch,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import type { LaborRecord, LaborRecordInput, OrderBreakdown, LaborItem } from "@/types/laborRecord"

const COLLECTION = "labor_records"

function toDate(val: unknown): Date | null {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val
  if (val && typeof val === "object" && typeof (val as { toDate?: unknown }).toDate === "function") {
    const converted = (val as { toDate: () => Date }).toDate()
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null
  }
  if (typeof val === "string" || typeof val === "number") {
    const parsed = new Date(val)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

/**
 * Calcula la quincena a la que pertenece una fecha.
 * Quincena 1: del 1 al 15 del mes
 * Quincena 2: del 16 al fin del mes
 */
function payPeriodFor(date: Date): string {
  const d = new Date(date)
  const day = d.getDate()
  const month = d.getMonth() + 1
  const year = d.getFullYear()
  const startDay = day <= 15 ? 1 : 16
  const endDay = day <= 15 ? 15 : new Date(year, month, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(startDay)} al ${year}-${pad(month)}-${pad(endDay)}`
}

/**
 * Guarda un registro de mano de obra en la colección `labor_records`.
 * Es una colección SEPARADA y NO se mezcla con spare_part_orders ni con ninguna otra tabla existente.
 */
export async function createLaborRecord(input: LaborRecordInput): Promise<string> {
  const now = new Date()
  const payPeriod = payPeriodFor(input.date)
  const docRef = await addDoc(collection(db, COLLECTION), {
    orderNumber: input.orderNumber,
    operator: input.operator,
    code: input.code,
    description: input.description,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    totalPrice: input.totalPrice,
    date: Timestamp.fromDate(input.date),
    payPeriod,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  })
  return docRef.id
}

/**
 * Guarda múltiples registros de mano de obra en batch.
 */
export async function createLaborRecords(inputs: LaborRecordInput[]): Promise<void> {
  if (inputs.length === 0) return
  const batch = writeBatch(db)
  const now = new Date()
  for (const input of inputs) {
    const ref = doc(collection(db, COLLECTION))
    batch.set(ref, {
      orderNumber: input.orderNumber,
      operator: input.operator,
      code: input.code,
      description: input.description,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      totalPrice: input.totalPrice,
      date: Timestamp.fromDate(input.date),
      payPeriod: payPeriodFor(input.date),
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    })
  }
  await batch.commit()
}

/**
 * Lee todos los registros de mano de obra, opcionalmente filtrados por quincena.
 */
export async function getLaborRecords(payPeriod?: string): Promise<LaborRecord[]> {
  let q = query(collection(db, COLLECTION), orderBy("date", "desc"))
  if (payPeriod) {
    q = query(collection(db, COLLECTION), where("payPeriod", "==", payPeriod), orderBy("date", "desc"))
  }
  const snapshot = await getDocs(q)
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data()
    return {
      id: docSnap.id,
      orderNumber: data.orderNumber as string,
      operator: data.operator as string,
      code: data.code as string,
      description: data.description as string,
      quantity: typeof data.quantity === "number" ? data.quantity : 0,
      unitPrice: typeof data.unitPrice === "number" ? data.unitPrice : 0,
      totalPrice: typeof data.totalPrice === "number" ? data.totalPrice : 0,
      date: toDate(data.date) ?? new Date(),
      payPeriod: data.payPeriod as string,
      createdAt: toDate(data.createdAt) ?? new Date(),
      updatedAt: toDate(data.updatedAt) ?? new Date(),
    }
  })
}

/**
 * Obtiene los registros de mano de obra agrupados por orden de trabajo,
 * con el total facturado de cada orden y el total general.
 * Esto es lo que se muestra en el desglose del botón CESAR.
 */
export async function getLaborBreakdownByOrder(payPeriod?: string): Promise<{
  orders: OrderBreakdown[]
  totalGeneral: number
}> {
  const records = await getLaborRecords(payPeriod)

  // Agrupar por orden de trabajo
  const byOrder = new Map<string, LaborRecord[]>()
  for (const record of records) {
    const existing = byOrder.get(record.orderNumber) ?? []
    existing.push(record)
    byOrder.set(record.orderNumber, existing)
  }

  const orders: OrderBreakdown[] = []
  let totalGeneral = 0

  for (const [orderNumber, items] of byOrder.entries()) {
    const orderItems: LaborItem[] = items.map((r) => ({
      type: "mano_obra",
      code: r.code,
      description: r.description,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      totalPrice: r.totalPrice,
    }))
    const totalFacturado = items.reduce((sum, r) => sum + r.totalPrice, 0)
    totalGeneral += totalFacturado
    orders.push({
      orderNumber,
      totalFacturado,
      items: orderItems,
    })
  }

  // Ordenar por número de orden descendente
  orders.sort((a, b) => b.orderNumber.localeCompare(a.orderNumber))

  return { orders, totalGeneral }
}

/**
 * Elimina un registro de mano de obra por ID.
 */
export async function deleteLaborRecord(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id))
}