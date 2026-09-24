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
  machineModel?: string | null
  sparePartId?: string
  code: string
  description: string
  unit: string
  quantityRequested: number
  quantityReceived: number
  quantityUsed: number
  status: SparePartOrderStatus
  supplier?: string
  // Fecha REAL del estado "A la Espera Repuestos" de 3C. Nunca se inventa:
  // si el registro de 3C no tiene fecha válida queda en null (la UI muestra "—").
  requestedAt: Date | null
  // ─── Las 3 fechas del circuito de compra (compra semanal) ────────────────
  // Las carga/edita a mano el operario desde "Pedidos Rep." (lista, hoja de
  // compra, panel de la reparación y detalle). NO alteran cantidades ni stock:
  // la recepción con cantidad y la entrada de stock siguen siendo de markReceived().
  //   1) ownerRequestedAt → día en que el operario le pidió el repuesto al dueño.
  //   2) orderedAt        → día en que el dueño pidió el repuesto en la casa.
  //   3) receivedAt       → día en que el dueño trajo los repuestos.
  ownerRequestedAt?: Date | null
  orderedAt?: Date      // fecha en que se encargó en la casa de repuestos
  expectedAt?: Date     // fecha aproximada para retirar
  receivedAt?: Date
  usedAt?: Date
  notes?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Fechas del circuito de compra que el operario carga a mano.
 *
 * Sólo se escriben las claves PRESENTES en el objeto:
 *   - clave ausente (undefined) → no se toca la fecha guardada.
 *   - `null`                    → se borra la fecha.
 */
export interface SparePartOrderDatesInput {
  /** Día en que el operario le pidió el repuesto al dueño. */
  ownerRequestedAt?: Date | null
  /** Día en que el dueño pidió el repuesto en la casa de repuestos (pasa a ENCARGADO). */
  orderedAt?: Date | null
  /** Día en que el dueño trajo los repuestos. */
  receivedAt?: Date | null
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
  machineModel?: string | null
  sparePartId?: string
  code: string
  description: string
  unit?: string
  quantity: number
  supplier?: string
  // Fecha del estado "A la Espera Repuestos" de 3C (null = sin fecha real).
  requestedAt?: Date | null
  // Día en que el operario le pidió el repuesto al dueño (editable a mano).
  ownerRequestedAt?: Date | null
  notes?: string
}
