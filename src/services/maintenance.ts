import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
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

function parseDmyDate(value: string): Date | undefined {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return undefined
  let day = Number(match[1])
  let month = Number(match[2])
  let year = Number(match[3])
  if (year < 100) year += 2000
  const parsed = new Date(year, month - 1, day)
  return isValidDate(parsed) ? parsed : undefined
}

function toDate(val: unknown): Date {
  if (val instanceof Date) return val
  if (val && typeof val === "object" && "toDate" in val && typeof (val as { toDate?: () => Date }).toDate === "function") {
    const date = (val as { toDate: () => Date }).toDate()
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date
  }
  if (typeof val === "string") {
    const parsedDmy = parseDmyDate(val)
    if (parsedDmy) return parsedDmy
    return new Date(val)
  }
  return new Date("")
}

function isValidDate(val: unknown): val is Date {
  return val instanceof Date && !Number.isNaN(val.getTime())
}

function findDateLikeValue(data: Record<string, unknown> | undefined, patterns: string[]): unknown {
  if (!data) return undefined
  for (const [key, value] of Object.entries(data)) {
    const normalized = key.toLowerCase()
    if (patterns.some((pattern) => normalized.includes(pattern))) return value
  }
  return undefined
}

function firstDateCandidate(...values: unknown[]): Date | undefined {
  for (const value of values) {
    const date = toDate(value)
    if (isValidDate(date)) return date
  }
  return undefined
}

export async function getMaintenanceRecords(): Promise<MaintenanceRecord[]> {
  const q = query(collection(db, COLLECTION), orderBy("entryDate", "desc"))
  const snapshot = await getDocs(q)
  return snapshot.docs
    .map((d) => {
      const data = d.data()
      const originalData = (data.originalData as Record<string, unknown> | undefined) ?? undefined
      const originalReturn = findDateLikeValue(originalData, ["entrega", "egreso", "salida", "retiro", "return", "fecha2"])
      const originalRepair = findDateLikeValue(originalData, ["reparacion", "reparación", "taller", "repair"])
      const originalEntry = findDateLikeValue(originalData, ["fecha_ingreso", "ingreso", "entrada", "entry", "fecha"])
      const originalStatus = findDateLikeValue(originalData, ["estado", "situacion", "situación"])

      const entryDateCandidate = firstDateCandidate(data.entryDate, originalEntry, data.createdAt)
      const returnDateCandidate = firstDateCandidate(
        data.returnDate,
        originalReturn,
        originalData?.entrega,
        originalData?.fecha_entrega,
        originalData?.egreso,
        originalData?.salida,
      )
      const repairDateCandidate = firstDateCandidate(
        data.repairDate,
        originalRepair,
        originalData?.fecha_reparacion,
        originalData?.reparacion,
      )
      const fallbackEntry = entryDateCandidate ?? toDate(data.createdAt)

      return {
        id: d.id,
        orderNumber: data.orderNumber as string,
        entryDate: fallbackEntry,
        type: data.type as string | undefined,
        clientName: data.clientName as string,
        clientCode: data.clientCode as string | undefined,
        machineName: data.machineName as string,
        status: (data.status as string) || (typeof originalStatus === "string" ? originalStatus : "Recepción"),
        docId: data.docId as string | undefined,
        itemId: typeof data.itemId === "number" ? data.itemId : null,
        articleId: data.articleId as string | undefined,
        quantity:typeof data.quantity==="number"?data.quantity:null,
        unitPrice:typeof data.unitPrice==="number"?data.unitPrice:null,
        totalPrice:typeof data.totalPrice==="number"?data.totalPrice:null,
        taxed:typeof data.taxed==="number"?data.taxed:null,
        notTaxed:typeof data.notTaxed==="number"?data.notTaxed:null,
        exempt:typeof data.exempt==="number"?data.exempt:null,
        capitalGood:typeof data.capitalGood==="number"?data.capitalGood:null,
        useGood:typeof data.useGood==="number"?data.useGood:null,
        equivalentCoefficient:typeof data.equivalentCoefficient==="number"?data.equivalentCoefficient:null,
        netPrice:typeof data.netPrice==="number"?data.netPrice:null,
        originalData,
        sourceRow:typeof data.sourceRow==="number"?data.sourceRow:undefined,
        repairDate: repairDateCandidate ?? undefined,
        returnDate: returnDateCandidate ?? undefined,
        warranty: data.warranty ? toDate(data.warranty) : undefined,
        history: data.history as string | undefined,
        shopTime: data.shopTime as number | undefined,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
      }
    })
    .filter((record) => ORDER_PATTERN.test(record.orderNumber))
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
    await setDoc(ref, { ...payload, createdAt: serverTimestamp() })
    await createAuditLog("create", AUDIT_ENTITY, ref.id, null, payload)
  } else {
    await setDoc(ref, payload, { merge: true })
    await createAuditLog("update", AUDIT_ENTITY, ref.id, (before.data() as Record<string, unknown>) ?? null, payload)
  }
}
