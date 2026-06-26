export type InventoryMovementType = "ALQUILER" | "DEVOLUCION" | "AJUSTE"

export interface InventoryMovement {
  id: string
  materialId: string
  date: Date
  type: InventoryMovementType
  quantity: number
  clientName?: string
  projectName?: string
  reference?: string
  rentalId?: string
}

export interface CreateInventoryMovementInput {
  materialId: string
  type: InventoryMovementType
  quantity: number
  clientName?: string
  projectName?: string
  reference?: string
  rentalId?: string
}
