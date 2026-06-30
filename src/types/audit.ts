export type AuditAction = "create" | "update" | "delete"
export type AuditEntity = "machine" | "inventory_stock" | "machine_spare_part" | "blueprint" | "machine_repair" | "maintenance_settings" | "maintenance"

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
