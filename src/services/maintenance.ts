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
  type?: string
  entryDate: Date
  returnDate?: Date
  repairDate?: Date
  clientName: string
  clientCode?: string
  machineName: string
  status: string
  brand?: string
  model?: string
  serial?: string
  technician?: string
  observations?: string

  docId?: string
  itemId?: number | null
  articleId?: string
  quantity?: number | null
  unitPrice?: number | null
  totalPrice?: number | null
  taxed?: number | null
  notTaxed?: number | null
  exempt?: number | null
  capitalGood?: number | null
  useGood?: number | null
  equivalentCoefficient?: number | null
  netPrice?: number | null

  originalData?: Record<string, unknown>
  sourceRow?: number

  warranty?: Date
  history?: string
  shopTime?: number

  createdAt: Date
  updatedAt: Date
}

export interface MaintenanceInput {
  orderNumber: string
  entryDate: Date
  returnDate?: Date | null
  repairDate?: Date | null
  clientName: string
  clientCode?: string
  machineName: string
  status: string
  brand?: string
  model?: string
  serial?: string
  technician?: string
  observations?: string

  docId?: string
  itemId?: number | null
  articleId?: string
  quantity?: number | null
  unitPrice?: number | null
  totalPrice?: number | null
  taxed?: number | null
  notTaxed?: number | null
  exempt?: number | null
  capitalGood?: number | null
  useGood?: number | null
  equivalentCoefficient?: number | null
  netPrice?: number | null
  originalData?: Record<string, unknown>
  sourceRow?: number

  warranty?: Date
  history?: string
  shopTime?: number
}

const COLLECTION = "maintenance"
const AUDIT_ENTITY: "maintenance" = "maintenance"
const ORDER_PATTERN = /^X\s?\d{4}-\d{8}$/i

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
      type: data.type as string | undefined,
      clientName: data.clientName as string,
      clientCode: data.clientCode as string | undefined,
      machineName: data.machineName as string,
      status: data.status as string,
      docId: data.docId as string | undefined,
      itemId: typeof data.itemId === "number" ? data.itemId : null,
      articleId: data.articleId as string | undefined,
      quantity: typeof data.quantity === "number" ? data.quantity : null,
      unitPrice: typeof data.unitPrice === "number" ? data.unitPrice : null,
      totalPrice: typeof data.totalPrice === "number" ? data.totalPrice : null,
      taxed: typeof data.taxed === "number" ? data.taxed : null,
      notTaxed: typeof data.notTaxed === "number" ? data.notTaxed : null,
      exempt: typeof data.exempt === "number" ? data.exempt : null,
      capitalGood: typeof data.capitalGood === "number" ? data.capitalGood : null,
      useGood: typeof data.useGood === "number" ? data.useGood : null,
      equivalentCoefficient: typeof data.equivalentCoefficient === "number" ? data.equivalentCoefficient : null,
      netPrice: typeof data.netPrice === "number" ? data.netPrice : null,
      originalData: (data.originalData as Record<string, unknown> | undefined) ?? undefined,
      sourceRow: typeof data.sourceRow === "number" ? data.sourceRow : undefined,
      repairDate: data.repairDate ? toDate(data.repairDate) : undefined,
      returnDate: data.returnDate ? toDate(data.returnDate) : undefined,
      warranty: data.warranty ? toDate(data.warranty) : undefined,
      history: data.history as string | undefined,
      shopTime: data.shopTime as number | undefined,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
    }
  }).filter((record) => ORDER_PATTERN.test(record.orderNumber))
}

export async function createOrUpdateMaintenance(input: MaintenanceInput): Promise<void> {
  const ref = doc(db, COLLECTION, input.orderNumber)
  const before = await getDoc(ref)

  const payload: Record<string, unknown> = {
    orderNumber: input.orderNumber,
    entryDate: input.entryDate,
    returnDate: input.returnDate ?? null,
    repairDate: input.repairDate ?? null,
    clientName: input.clientName,
    clientCode: input.clientCode ?? null,
    machineName: input.machineName,
    status: input.status,
    docId: input.docId ?? null,
    itemId: input.itemId ?? null,
    articleId: input.articleId ?? null,
    quantity: input.quantity ?? null,
    unitPrice: input.unitPrice ?? null,
    totalPrice: input.totalPrice ?? null,
    taxed: input.taxed ?? null,
    notTaxed: input.notTaxed ?? null,
    exempt: input.exempt ?? null,
    capitalGood: input.capitalGood ?? null,
    useGood: input.useGood ?? null,
    equivalentCoefficient: input.equivalentCoefficient ?? null,
    netPrice: input.netPrice ?? null,
    originalData: input.originalData ?? null,
    sourceRow: input.sourceRow ?? null,
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
