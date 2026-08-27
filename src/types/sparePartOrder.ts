export type SparePartOrderStatus =
  | "SOLICITADO"
  | "PEDIDO"
  | "ENCARGADO"
  | "RECIBIDO"
  | "UTILIZADO"
  | "CANCELADO"

export interface SparePartOrder {
  id: string
  repairId: string
  orderNumber: string
  machineId: string
  machineName: string
  sparePartId?: string
  code: string
  description: string
  unit: string
  quantityRequested: number
  quantityReceived: number
  quantityUsed: number
  status: SparePartOrderStatus
  supplier?: string
  requestedAt: Date
  // Datos del encargo del dueño (compra semanal)
  orderedAt?: Date      // fecha en que se encargó en la casa de repuestos
  expectedAt?: Date     // fecha aproximada para retirar
  receivedAt?: Date
  usedAt?: Date
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface MarkOrderedInput {
  orderedAt: Date
  expectedAt?: Date | null
  notes?: string
}

export interface CreateSparePartOrderInput {
  repairId: string
  orderNumber?: string
  machineId: string
  machineName?: string
  sparePartId?: string
  code: string
  description: string
  unit?: string
  quantity: number
  supplier?: string
  requestedAt?: Date
  notes?: string
}
