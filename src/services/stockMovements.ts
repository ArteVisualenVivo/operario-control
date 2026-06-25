import {
  collection, addDoc, getDocs, query, where, orderBy, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import type { StockMovement, StockMovementType, StockMovementSource } from "@/types"

const COLLECTION = "stock_movements"

export async function createMovement(
  partId: string,
  type: StockMovementType,
  source: StockMovementSource,
  referenceId: string,
  quantity: number,
): Promise<string> {
  const docRef = await addDoc(collection(db, COLLECTION), {
    partId,
    type,
    source,
    referenceId,
    quantity,
    date: Timestamp.now(),
  })
  return docRef.id
}

export async function getMovementsByPart(partId: string): Promise<StockMovement[]> {
  const q = query(
    collection(db, COLLECTION),
    where("partId", "==", partId),
    orderBy("date", "desc"),
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      partId: data.partId as string,
      date: (data.date as Timestamp)?.toDate() ?? new Date(),
      type: data.type as StockMovementType,
      source: data.source as StockMovementSource,
      referenceId: data.referenceId as string,
      quantity: (data.quantity as number) ?? 0,
    }
  })
}
