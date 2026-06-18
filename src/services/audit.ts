import { collection, addDoc, serverTimestamp, query, orderBy, getDocs, Timestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import type { AuditAction, AuditEntity, AuditLog } from "@/types"

const COLLECTION = "audit_logs"

export async function createAuditLog(
  action: AuditAction,
  entity: AuditEntity,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  try {
    await addDoc(collection(db, COLLECTION), {
      action,
      entity,
      entityId,
      before,
      after,
      timestamp: serverTimestamp(),
    })
  } catch {
    console.error("Error creating audit log")
  }
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const q = query(collection(db, COLLECTION), orderBy("timestamp", "desc"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      action: data.action as AuditAction,
      entity: data.entity as AuditEntity,
      entityId: data.entityId as string,
      before: data.before as Record<string, unknown> | null,
      after: data.after as Record<string, unknown> | null,
      timestamp: (data.timestamp as Timestamp)?.toDate() ?? new Date(),
    } as AuditLog
  })
}
