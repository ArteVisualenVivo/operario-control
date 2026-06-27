export type StockAlertType = "CRITICAL" | "WARNING" | "INFO"
export type StockAlertEntityType = "MATERIAL" | "SPARE_PART" | "MACHINE"

export interface StockAlert {
  id: string
  type: StockAlertType
  entityType: StockAlertEntityType
  entityId: string
  message: string
  detail?: string
  trend?: "up" | "down" | "stable"
  createdAt: Date
}

export interface StockHealthScore {
  overall: number
  materials: number
  spareParts: number
  machines: number
}

export interface ConsumptionTrend {
  weekly: number
  monthly: number
  trend: "up" | "down" | "stable"
}

export interface StockIntelligence {
  alerts: StockAlert[]
  healthScore: StockHealthScore
  topConsumed: {
    materialId: string
    materialName: string
    total: number
  }[]
  criticalItems: StockAlert[]
  trend: "up" | "down" | "stable"
}
