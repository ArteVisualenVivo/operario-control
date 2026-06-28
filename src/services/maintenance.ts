import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createAuditLog } from "./audit"

export interface MaintenanceRecord {
  id: string
  orderNumber: string
  entryDate: Date
  clientName: string
  machineName: string
  brand?: string
  model?: string
  serial?: string
  status: string
  technician?: string
  observations?: string

  repairDate?: Date
  returnDate?: Date
  warranty?: Date
  history?: string
  shopTime?: number

  createdAt: Date
  updatedAt: Date
}

export interface MaintenanceInput {
  orderNumber: string
  entryDate: Date
  clientName: string
  machineName: string
  brand?: string
  model?: string
  serial?: string
  status: string
  technician?: string
  observations?: string

  repairDate?: Date
  returnDate?: Date
  warranty?: Date
  history?: string
  shopTime?: number
}

const COLLECTION = "maintenance"
const AUDIT_ENTITY: "maintenance" = "maintenance"

function toDate(val: unknown): Date {
  if (val instanceof Date) return val
  if (val && typeof val === "object" && "toDate" in val && typeof (val as { toDate?: () => Date }).toDate === "function") {
    const date = (val as { toDate: () => Date }).toDate()
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date
  }
  if (typeof val === "string") return new Date(val)
  return new Date("")
}

export async function getMaintenanceRecords(): Promise<MaintenanceRecord[]> {
  const q = query(collection(db, COLLECTION), orderBy("entryDate", "desc"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      orderNumber: data.orderNumber as string,
      entryDate: toDate(data.entryDate),
      clientName: data.clientName as string,
      machineName: data.machineName as string,
      brand: data.brand as string | undefined,
      model: data.model as string | undefined,
      serial: data.serial as string | undefined,
      status: data.status as string,
      technician: data.technician as string | undefined,
      observations: data.observations as string | undefined,
      repairDate: data.repairDate ? toDate(data.repairDate) : undefined,
      returnDate: data.returnDate ? toDate(data.returnDate) : undefined,
      warranty: data.warranty ? toDate(data.warranty) : undefined,
      history: data.history as string | undefined,
      shopTime: data.shopTime as number | undefined,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
    }
  })
}

export async function createOrUpdateMaintenance(input: MaintenanceInput): Promise<void> {
  const ref = doc(db, COLLECTION, input.orderNumber)
  const before = await getDoc(ref)

  const payload: Record<string, unknown> = {
    orderNumber: input.orderNumber,
    entryDate: input.entryDate,
    clientName: input.clientName,
    machineName: input.machineName,
    brand: input.brand ?? null,
    model: input.model ?? null,
    serial: input.serial ?? null,
    status: input.status,
    technician: input.technician ?? null,
    observations: input.observations ?? null,
    repairDate: input.repairDate ?? null,
    returnDate: input.returnDate ?? null,
    warranty: input.warranty ?? null,
    history: input.history ?? null,
    shopTime: input.shopTime ?? null,
    updatedAt: serverTimestamp(),
  }

  if (!before.exists) {
    await setDoc(ref, {
      ...payload,
      createdAt: serverTimestamp(),
    })
    await createAuditLog("create", AUDIT_ENTITY, ref.id, null, payload)
  } else {
    await setDoc(ref, payload, { merge: true })
    await createAuditLog("update", AUDIT_ENTITY, ref.id, (before.data() as Record<string, unknown>) ?? null, payload)
  }
}
