export type AuditAction = "create" | "update" | "delete"
export type AuditEntity = "machine" | "rental" | "repair"

export interface AuditLog {
  id: string
  action: AuditAction
  entity: AuditEntity
  entityId: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  timestamp: Date
  userId: string
}
