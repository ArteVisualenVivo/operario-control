export interface Sync3CItem {
  name: string
  normalizedName: string
  codigo?: string
  stockTotal: number
  stockWarning?: boolean
  unit?: string
  deposito?: number
  source?: string
}

export interface Sync3CConfig {
  unit: string
  category: string
  locationType: string
  strictMode: boolean
}

export interface Sync3CResult {
  success: boolean
  created: number
  updated: number
  skipped: number
  warnings: string[]
  maintenanceCreated?: number
  maintenanceUpdated?: number
  maintenanceSkipped?: number
  maintenanceWarnings?: string[]
  maintenanceError?: string
}
