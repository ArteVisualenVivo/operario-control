export interface LegacyRepair {
  id: string
  machineId: string
  issue: string
  status: "pending" | "repairing" | "done"
  estimatedReturn: Date | null
  createdAt: Date
  updatedAt: Date
}
