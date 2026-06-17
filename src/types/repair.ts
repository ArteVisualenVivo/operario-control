export type RepairStatus = "pending" | "repairing" | "done"

export interface Repair {
  id: string
  machineId: string
  issue: string
  status: RepairStatus
  estimatedReturn: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface RepairFormData {
  machineId: string
  issue: string
  estimatedReturn?: Date | null
}
