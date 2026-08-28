export interface Sync3CItem {
  name: string
  normalizedName: string
  codigo?: string
  stockTotal: number
  stockWarning?: boolean
  unit?: string
  deposito?: number
  source?: string
  category?: string
  subtype?: string | null
  scaffoldKind?: "structure" | "piece" | "accessory" | null
  // Datos reales del Excel de 3C (catálogo de artículos / stock por depósito)
  familia?: string
  subfamilia?: string
  marca?: string
  tipo?: string
  subtipo?: string
  precioUnitario?: number
  stockMinimo?: number
  ubicacion?: string
  codBarra?: string
  codCatalogo?: string
  proveedor?: string
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
  degraded?: boolean
  maintenanceCreated?: number
  maintenanceUpdated?: number
  maintenanceSkipped?: number
  maintenanceWarnings?: string[]
  maintenanceError?: string
  scaffoldCuerposAlquilados?: number
  scaffoldDetalleCount?: number
}
