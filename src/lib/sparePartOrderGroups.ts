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
  /**
   * MODELO de 3C para esa máquina (columna DENOMINACION del informe de
   * Reparaciones), tal como lo guarda el pedido auto-importado. Suele ser la
   * identificación COMPLETA (con el prefijo "REPARACION:") y por eso es la
   * fuente para mostrar el nombre entero: ver fullMachineIdentification().
   * `null`/vacío = 3C no informó ese dato para esa orden.
   */
  machineModel: string | null
  /** Repuestos de la orden, en el mismo orden en que llegaron. */
  parts: SparePartOrderGroupPart[]
  /** ids de los registros agrupados (para selección/eliminación). */
  ids: string[]
  /** Cantidad de repuestos del grupo. */
  totalParts: number
}

/**
 * Número de orden "real": el ÚLTIMO grupo de dígitos del texto.
 *
 * El formato de 3C es "X 0001-NNNNNNNN": los dígitos que identifican la orden son
 * los de después del guion, NO el prefijo "0001". Devuelve "0" si no hay dígitos.
 */
export function extractRealOrderNumber(orderNumber: string | null | undefined): number {
  const matches = (orderNumber ?? "").match(/\d+/g)
  if (matches && matches.length > 0) return parseInt(matches[matches.length - 1], 10)
  return 0
}

/**
 * Agrupa por N° DE ORDEN REAL y cuenta cada orden UNA sola vez.
 *
 * La misma orden puede venir escrita de dos formas en la fuente ("X 0001-00010867"
 * y "0001-00010867"): sin esta fusión se mostraba como DOS órdenes y quedaba
 * inflada la cantidad de máquinas (Pedidos Rep.) y las filas de la hoja de
 * imprimir. Lo usan las dos pantallas para que cuenten igual.
 *
 * - La clave del grupo pasa a ser `#<número>` (identidad real de la orden).
 * - Cada repuesto sigue siendo su propio registro: no se copia ni se inventa nada.
 * - Sin número reconocible se respeta la clave original (no se fusiona).
 */
export function groupOrdersByRealNumber(orders: SparePartOrder[]): SparePartOrderGroup[] {
  const groups = buildSparePartOrderGroups(orders)
  const keyOf = (g: SparePartOrderGroup): string => {
    const num = extractRealOrderNumber(g.orderNumber)
    return num > 0 ? `#${num}` : g.key
  }
  // Claves en orden de primera aparición: el grupo queda en el lugar del primer
  // registro de esa orden (mismo orden que la fuente).
  const keys = groups.map(keyOf)
  const uniqueKeys = [...new Set(keys)]

  // Se reconstruye cada grupo desde cero (sin mutar objetos ya creados): cada
  // repuesto sigue siendo su propio registro y `parts` conserva el orden.
  return uniqueKeys.map((key) => {
    const members = groups.filter((_, i) => keys[i] === key)
    const parts = members.flatMap((g) => g.parts)
    return {
      ...members[0],
      key,
      parts,
      ids: members.flatMap((g) => g.ids),
      totalParts: parts.length,
    }
  })
}

/** Normaliza para comparar textos: sin espacios ni mayúsculas. */
function compactIdentification(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase()
}

/** Prefijo con el que 3C encabeza la columna DENOMINACION (marca de la fuente). */
const REPARACION_PREFIX = /^reparaci[oó]n:\s*/i

/**
 * TEXTO de la máquina para MOSTRAR: la identificación COMPLETA de 3C
 * (nombre + modelo), no sólo el nombre suelto.
 *
 * POR QUÉ: 3C corta la identificación a 30 caracteres y sigue en la celda de al
 * lado; al importar, el pedido la parte en dos campos —
 *   machineName  = "Martillo demoledor"
 *   machineModel = "Martillo demoledor TE-DH 12 11029"   (DENOMINACION de 3C)
 * — y la lista mostraba sólo `machineName`: el modelo quedaba invisible en la
 * pantalla (aunque sí se imprimía en la hoja de compra y se ve en Reparaciones).
 * Con esto la celda muestra el nombre entero, igual que las órdenes donde 3C no
 * pudo partirse el texto (ahí la identificación entera quedó en `machineName`).
 *
 * Reglas (nunca inventa ni degrada el dato):
 *  - Sin modelo de 3C            → lo guardado como nombre.
 *  - El modelo ES el mismo dato  → lo guardado como nombre (3C lo escribe
 *    distinto al exportarlo: "…1300WGKS130" vs "…1300W GKS130").
 *  - El modelo CONTINÚA el nombre (mismo prefijo: es el nombre + el resto que
 *    3C había cortado) → el modelo completo, sin el prefijo "REPARACION:".
 *  - Textos distintos (otra fuente/otra máquina) → lo guardado como nombre.
 */
export function fullMachineIdentification(
  machineName: string | null | undefined,
  machineModel: string | null | undefined,
): string {
  const name = String(machineName ?? "").trim()
  const model = String(machineModel ?? "").replace(REPARACION_PREFIX, "").trim()
  if (!model) return name
  if (!name) return model
  const a = compactIdentification(name)
  const b = compactIdentification(model)
  if (a === b) return name
  if (b.startsWith(a)) return model
  return name
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
        machineModel: order.machineModel ?? null,
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