import type { SparePartOrder } from "@/types"

/**
 * Helpers de PRESENTACIÓN para agrupar los pedidos de repuestos por número de orden.
 *
 * IMPORTANTE: este módulo es puramente de lectura/agrupamiento en memoria.
 * No altera, recalcula ni mutea los registros originales: cada repuesto conserva
 * su propio código, descripción, cantidades, estado y fecha.
 */

/** Marca de "parcial" (misma regla que usa la tabla actualmente). */
export function isSparePartOrderPartial(
  o: Pick<SparePartOrder, "status" | "quantityRequested" | "quantityReceived" | "quantityUsed">,
): boolean {
  return (
    (o.status === "SOLICITADO" || o.status === "PEDIDO" || o.status === "RECIBIDO") &&
    (o.quantityReceived < o.quantityRequested || (o.quantityUsed > 0 && o.quantityUsed < o.quantityReceived))
  )
}

/**
 * Normaliza el número de orden para agrupar: trim, espacios colapsados y mayúsculas.
 * Ej: "x 0001-00011271 " -> "X 0001-00011271".
 */
export function normSpareOrderGroupKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase()
}

export interface SparePartOrderGroupPart {
  /** Registro original, tal cual viene de la fuente (sin copiar ni prestar códigos). */
  order: SparePartOrder
  /** Descripción del repuesto (== order.description). */
  description: string
  /** Código propio de ESE repuesto (== order.code). */
  code: string
  /** Si el repuesto está parcialmente recibido/usado. */
  partial: boolean
}

export interface SparePartOrderGroup {
  /** Clave de agrupamiento (número de orden normalizado). */
  key: string
  /** Número de orden tal cual lo reporta la fuente (para mostrar). */
  orderNumber: string
  /** Máquina tal cual la reporta la fuente. */
  machineName: string
  /** Repuestos de la orden, en el mismo orden en que llegaron. */
  parts: SparePartOrderGroupPart[]
  /** ids de los registros agrupados (para selección/eliminación). */
  ids: string[]
  /** Cantidad de repuestos del grupo. */
  totalParts: number
}

/**
 * Agrupa los pedidos por número de orden conservando el orden de entrada.
 *
 * - Cada grupo es UNA sola entrada visual.
 * - `parts` mantiene la referencia al registro original de cada repuesto.
 * - Si un registro no tiene número de orden, queda en su propio grupo (no se mezcla).
 */
export function buildSparePartOrderGroups(orders: SparePartOrder[]): SparePartOrderGroup[] {
  const groups: SparePartOrderGroup[] = []
  const positions = new Map<string, number>()

  orders.forEach((order, index) => {
    const normalized = normSpareOrderGroupKey(order.orderNumber)
    // Sin número de orden no se agrupa: clave única por registro.
    const key = normalized || `__sin-orden__:${order.id}:${index}`

    let position = positions.get(key)
    if (position === undefined) {
      position = groups.length
      positions.set(key, position)
      groups.push({
        key,
        orderNumber: order.orderNumber,
        machineName: order.machineName,
        parts: [],
        ids: [],
        totalParts: 0,
      })
    }

    const group = groups[position]
    group.parts.push({
      order,
      description: order.description,
      code: order.code,
      partial: isSparePartOrderPartial(order),
    })
    group.ids.push(order.id)
    group.totalParts = group.parts.length
  })

  return groups
}