export type SparePartOrderStatus =
  | "SOLICITADO"
  | "PEDIDO"
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
  receivedAt?: Date
  usedAt?: Date
  notes?: string
  createdAt: Date
  updatedAt: Date
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
