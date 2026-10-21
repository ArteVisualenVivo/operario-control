export interface LaborRecord {
  id: string
  orderNumber: string        // N° de orden de 3C (ej. "X 0001-00011174")
  operator: string           // Operario deducido de "MO ..." (ej. "CES")
  code: string               // Código interno de MO (ej. "1012")
  description: string        // Descripción (ej. "MO CES")
  quantity: number           // Cantidad / horas (ej. 2.00)
  unitPrice: number          // Precio unitario / hora (ej. 12100.00)
  totalPrice: number         // Monto total de la fila (ej. 24200.00)
  date: Date                 // Fecha de la orden (ej. 20/10/2026)
  payPeriod: string          // Quincena (ej. "2026-10-01 al 2026-10-15")
  createdAt: Date
  updatedAt: Date
}

export interface LaborRecordInput {
  orderNumber: string
  operator: string
  code: string
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
  date: Date
}

export interface OrderBreakdown {
  orderNumber: string
  totalFacturado: number
  items: LaborItem[]
}

export interface LaborItem {
  type: "repuesto" | "mano_obra"
  code: string | null
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
}