export interface Sync3CItem {
  codigo: string
  name: string
  normalizedName: string
  stockTotal: number
  unit: string
  deposito: number
  source: "3c"
  stockWarning: boolean
}

export interface Sync3CResult {
  success: boolean
  created: number
  updated: number
  skipped: number
  warnings: string[]
}

export interface Sync3CConfig {
  unit: string
  category: string
  locationType: string
  strictMode: boolean
}
