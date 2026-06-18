import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDocs, query, where, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createSparePart } from "./spareParts"
import type { SparePartCategory } from "@/types"

export interface BlueprintDraft {
  id: string
  machineId: string
  blueprintId: string
  partName: string
  partCode: string
  category: SparePartCategory
  unit: string
  stockTotal: number
  status: "draft" | "confirmed"
  createdAt: Date
}

export interface CreateDraftInput {
  machineId: string
  blueprintId: string
  partName: string
  partCode: string
  category: SparePartCategory
  unit: string
  stockTotal: number
}

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date()
}

const COLLECTION = "blueprint_drafts"

export async function createDraft(input: CreateDraftInput): Promise<string> {
  const existing = await getDocs(
    query(
      collection(db, COLLECTION),
      where("machineId", "==", input.machineId),
      where("partCode", "==", input.partCode),
      where("status", "==", "draft"),
    )
  )
  if (!existing.empty) {
    throw new Error(`Ya existe un draft con código "${input.partCode}" para este despiece`)
  }

  const docRef = await addDoc(collection(db, COLLECTION), {
    machineId: input.machineId,
    blueprintId: input.blueprintId,
    partName: input.partName,
    partCode: input.partCode,
    category: input.category,
    unit: input.unit,
    stockTotal: input.stockTotal,
    status: "draft",
    createdAt: Timestamp.now(),
  })
  return docRef.id
}

export async function getDrafts(
  machineId: string,
  blueprintId?: string,
): Promise<BlueprintDraft[]> {
  const constraints = [where("machineId", "==", machineId)]
  if (blueprintId) constraints.push(where("blueprintId", "==", blueprintId))

  const q = query(collection(db, COLLECTION), ...constraints)
  const snapshot = await getDocs(q)
  return snapshot.docs.map((d) => {
    const data = d.data() as Omit<CreateDraftInput & { status: string; createdAt: unknown }, "">
    return {
      id: d.id,
      machineId: data.machineId as string,
      blueprintId: data.blueprintId as string,
      partName: data.partName as string,
      partCode: data.partCode as string,
      category: data.category as SparePartCategory,
      unit: data.unit as string,
      stockTotal: data.stockTotal as number,
      status: data.status as "draft" | "confirmed",
      createdAt: toDate(data.createdAt),
    }
  })
}

export async function updateDraft(
  id: string,
  data: Partial<Pick<BlueprintDraft, "partName" | "partCode" | "category" | "stockTotal">>,
): Promise<void> {
  const ref_ = doc(db, COLLECTION, id)
  await updateDoc(ref_, data)
}

export async function deleteDraft(id: string): Promise<void> {
  const ref_ = doc(db, COLLECTION, id)
  await deleteDoc(ref_)
}

export async function confirmDrafts(
  machineId: string,
  blueprintId: string,
  machineName: string,
  machineModel: string,
): Promise<number> {
  const drafts = await getDrafts(machineId, blueprintId)
  const pending = drafts.filter((d) => d.status === "draft")

  if (pending.length === 0) throw new Error("No hay drafts pendientes para confirmar")

  let confirmed = 0
  for (const draft of pending) {
    await createSparePart({
      machineId,
      machineName,
      machineModel,
      partName: draft.partName,
      partCode: draft.partCode,
      category: draft.category,
      unit: draft.unit,
      stockTotal: draft.stockTotal,
      source: "blueprint",
      blueprintId,
    })
    const ref_ = doc(db, COLLECTION, draft.id)
    await updateDoc(ref_, { status: "confirmed" })
    confirmed++
  }
  return confirmed
}
