import { collection, addDoc, serverTimestamp, query, orderBy, getDocs, Timestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { auth } from "@/lib/firebase"
import type { AuditAction, AuditEntity, AuditLog } from "@/types"

const COLLECTION = "audit_logs"

export async function createAuditLog(
  action: AuditAction,
  entity: AuditEntity,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Promise<void> {
  try {
    const userId = auth.currentUser?.uid ?? "unknown"
    await addDoc(collection(db, COLLECTION), {
      action,
      entity,
      entityId,
      before,
      after,
      timestamp: serverTimestamp(),
      userId,
    })
  } catch (error) {
    console.error("[Audit] Failed to create log:", error)
  }
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const q = query(collection(db, COLLECTION), orderBy("timestamp", "desc"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      ...data,
      timestamp: (data.timestamp as Timestamp)?.toDate() ?? new Date(),
    } as AuditLog
  })
}
