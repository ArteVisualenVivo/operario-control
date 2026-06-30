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
