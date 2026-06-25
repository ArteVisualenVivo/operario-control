export type RepairOrderStatus = "EN_TALLER" | "FINALIZADO"
export type RepairStatus = RepairOrderStatus | "pending" | "repairing" | "done"
export type RepairSource = "manual" | "3c"

export interface PartUsage {
  partId: string
  code: string
  description: string
  quantity: number
}

export interface MachineRepair {
  id: string
  machineId: string
  machineName: string
  machineModel?: string
  internalNumber?: string

  clientId?: string
  clientName: string
  clientNumber?: string

  reportedIssue: string
  diagnosis?: string
  repairPerformed: string

  technician: string

  entryDate: Date
  exitDate: Date

  hoursUsed?: number

  warrantyDays: number
  warrantyUntil: Date

  oilChangeDueDate?: Date
  bearingChangeDueDate?: Date
  maintenanceDueDate?: Date

  notes?: string
  partsUsed: PartUsage[]

  source?: RepairSource
  externalId?: string

  status: RepairStatus
  issue: string
  estimatedReturn: Date | null

  createdAt: Date
  updatedAt: Date
}

export interface CreateRepairInput {
  machineId: string
  machineName: string
  machineModel?: string
  internalNumber?: string
  clientId?: string
  clientName: string
  clientNumber?: string
  reportedIssue: string
  diagnosis?: string
  repairPerformed: string
  technician: string
  entryDate: Date
  exitDate: Date
  hoursUsed?: number
  notes?: string
  partsUsed?: PartUsage[]
  status?: RepairOrderStatus
  warrantyDays?: number
  oilChangeDays?: number
  bearingChangeDays?: number
  maintenanceDays?: number
}

export interface MaintenanceSettings {
  oilChangeDays: number
  bearingChangeDays: number
  maintenanceDays: number
  warrantyDays: number
}

export interface RepairImportData {
  externalId?: string
  source: RepairSource
  originalData?: Record<string, unknown>
}
