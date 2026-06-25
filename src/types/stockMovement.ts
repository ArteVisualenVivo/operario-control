export type StockMovementType = "INGRESO" | "EGRESO"
export type StockMovementSource = "REPARACION"

export interface StockMovement {
  id: string
  partId: string
  date: Date
  type: StockMovementType
  source: StockMovementSource
  referenceId: string
  quantity: number
}
