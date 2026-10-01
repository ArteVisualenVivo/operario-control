/**
 * Compatibilidad repuesto → máquinas (lib PURO, sin firebase/fs).
 *
 * Cruza las dos fuentes que ya existen y que el Dashboard hoy no mira:
 *  - fichas `machine_spare_parts` (manual / plano PDF)
 *  - historial `spare_part_orders` (pedidos 3C, con machineId + code)
 *
 * La normalización de códigos se duplica a propósito desde
 * `services/sparePartOrders.ts`: ese servicio importa `firebase/firestore` y
 * NO puede entrar al bundle puro de `lib/search-grouped.ts`. La regla es la
 * misma (mayúsculas, sin espacios para comparar; voltajes/códigos internos
 * no son códigos reales).
 */
import type { Machine, SparePart, SparePartOrder } from "@/types"
import { matchesLoose, normalizeSpaced, queryTokens } from "@/lib/fuzzySearch"

export type CompatOrigen = "ficha" | "pedido" | "plano"

export interface CompatibleMachine {
  /**
   * Id REAL de la máquina del catálogo, o "" si no existe (los pedidos de 3C
   * traen el nº de ORDEN en `machineId`, que no es una máquina: antes eso hacía
   * que cada pedido abriera su propia fila).
   */
  machineId: string
  /** Nombre corto tal como lo manda 3C (ej. "AMOLADORA"). Informativo. */
  machineName: string
  /** Texto de modelo tal cual viene (puede traer el prefijo "REPARACION:"). */
  machineModel: string
  /**
   * MODELO COMPLETO y limpio: es la IDENTIDAD de la máquina en esta búsqueda.
   * "REPARACION: AMOLADORA BOSCH 230 GWS 25-180" → "AMOLADORA BOSCH 230 GWS 25-180".
   * Si no hay modelo, cae al nombre corto.
   *
   * POR QUÉ: el nombre corto NO alcanza. Tres máquinas distintas (MAKITA 115
   * 9557 HP, BOSCH GWS 25-180, BOSCH GWS 2200-230) figuran las tres como
   * "AMOLADORA": agrupando por nombre se diría "es la misma máquina" cuando en
   * realidad son máquinas distintas (y eso hace decidir mal al buscar reemplazo).
   */
  modeloCompleto: string
  /**
   * AVISO (no se fusiona nada): otro modelo de la MISMA búsqueda que comparte
   * marca/números con este → probablemente sea la misma máquina escrita distinto
   * en 3C (ej. "AMOLDADORA BOSCH 230 GWS 25-180" vs "AMOLADORA 230 BOSCH - GWS 28-230").
   * Se muestra como "⚠ se parece a: …" y decide el operario: fusionar mal diría
   * "es la misma máquina" justo cuando se busca un repuesto para otra.
   */
  sePareceA?: string
  /** Nombres de repuesto que matchearon en esta máquina. */
  partNames: string[]
  /** Códigos a mostrar (normalizados con espacios, ej. "1 619 P14 777"). */
  partCodes: string[]
  stockDisponible: number
  pedidosCount: number
  ultimoPedido: string
  origenes: CompatOrigen[]
  /**
   * HISTORIAL: detalle de los pedidos de 3C que respaldan esta fila (nº de orden,
   * repuesto, estado y las fechas del circuito). Vacío si la fila viene sólo de
   * fichas/planos.
   */
  detallePedidos: CompatPedido[]
}

/** Un pedido de 3C dentro del historial de una máquina. */
export interface CompatPedido {
  /** Id del documento del pedido (para abrir su detalle). */
  id: string
  orderNumber: string
  code: string
  description: string
  status: string
  /** Día en que se pidió (fecha de 3C, o el día en que se creó el pedido). */
  pedido: string
  /** Día en que se trajo. */
  traido: string
  /** Día en que se utilizó. */
  utilizado: string
}


export interface CompatibilidadRepuesto {
  /** "codigo" = match exacto por código · "nombre" = match por descripción. */
  modo: "codigo" | "nombre"
  /** Clave/código que se buscó (para mostrar en la UI). */
  clave: string
  maquinas: CompatibleMachine[]
}

export interface CompatibilityData {
  parts: SparePart[]
  orders: SparePartOrder[]
  machines: Machine[]
}

// ─── Normalización (misma regla que sparePartOrders.ts, versión pura) ───────

/** Código tal como se MUESTRA: mayúsculas y espacios simples. */
function normalizePartCode(code: unknown): string {
  return String(code ?? "").toUpperCase().replace(/\s+/g, " ").trim()
}

/** ¿El valor sirve como CÓDIGO? (vacío, "S/C", interno o voltaje → no). */
function isUsablePartCode(code: unknown): boolean {
  const raw = String(code ?? "").trim()
  if (!raw) return false
  const upper = raw.toUpperCase()
  if (upper === "S/C" || upper === "SC") return false
  // Interno de mano de obra: 3-4 dígitos solos ("1012", "1025").
  if (/^\d{3,4}$/.test(raw)) return false
  // Voltaje / medida ("220V", "110 V", "12V", "220").
  if (/^\d{2,4}\s*V$/i.test(raw)) return false
  return true
}

/** Clave canónica para COMPARAR: mayúsculas SIN espacios. "" si no es código. */
function sparePartCodeKey(code: unknown): string {
  if (!isUsablePartCode(code)) return ""
  return String(code ?? "").toUpperCase().replace(/\s+/g, "").trim()
}

function toDateSafe(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    try {
      const converted = (value as { toDate: () => Date }).toDate()
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) return converted
    } catch {
      return null
    }
  }
  return null
}

function formatDay(value: unknown): string {
  const d = toDateSafe(value)
  if (!d) return "—"
  return d.toLocaleDateString("es-AR")
}

/** Cuántos pedidos se guardan por máquina para el historial desplegable. */
const MAX_DETALLE_PEDIDOS = 8

/** Texto de 3C "REPARACION: AMOLADORA BOSCH 230" → "AMOLADORA BOSCH 230". */
function stripReparacionPrefix(value: unknown): string {
  return String(value ?? "")
    .replace(/^\s*reparaci[oó]n\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * IDENTIDAD de la máquina (con qué se agrupa el resultado): el MODELO COMPLETO
 * sin el prefijo "REPARACION:"; si no hay modelo, el nombre corto de 3C.
 *
 * El nombre corto NO sirve como identidad: "AMOLADORA" es el nombre de tres
 * máquinas distintas (MAKITA 115, BOSCH GWS 25-180, BOSCH GWS 2200-230).
 */
function machineIdentity(name: unknown, model: unknown): string {
  const full = stripReparacionPrefix(model)
  return full || String(name ?? "").trim()
}

/**
 * Tokens "de modelo" (los que llevan números: "230", "25", "180", "9557",
 * "gws190"): son los que identifican una máquina y no una categoría. Sirven para
 * el aviso "se parece a" — una categoría suelta ("amoladora", "sierra",
 * "circular") NO alcanza para decir que dos máquinas son la misma.
 */
function modelTokens(identity: string): Set<string> {
  return new Set(
    normalizeSpaced(identity)
      .split(" ")
      .filter((token) => token.length >= 2 && /\d/.test(token)),
  )
}

/** ¿Dos identidades comparten algún token de modelo? → probablemente la misma. */
function sharesModelToken(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) {
    if (b.has(token)) return true
  }
  return false
}


/**
 * Busca un código o nombre de repuesto y devuelve las MÁQUINAS que lo usan: es
 * la pregunta "¿este repuesto sirve para otra máquina?" (cuando no se consigue
 * el original).
 *
 * - Primero intenta match EXACTO por código (ignora espacios/mayúsculas).
 * - Si no hay match por código, busca por descripción/nombre (tokens).
 * - Agrupa por MÁQUINA: la del catálogo (id real) o el MODELO COMPLETO de 3C.
 *   Nunca por el nombre corto ("AMOLADORA" son tres máquinas distintas) ni por
 *   el nº de orden (que es lo que trae `machineId` en los pedidos de 3C).
 * - Cada fila trae `detallePedidos` (nº de orden + fechas) = su historial.
 * Devuelve null cuando no hay coincidencias (la sección no se muestra).
 */
export function findCompatibleMachines(
  query: string,
  data: CompatibilityData,
): CompatibilidadRepuesto | null {
  const q = String(query ?? "").trim()
  if (q.length < 2) return null
  const parts = Array.isArray(data.parts) ? data.parts : []
  const orders = Array.isArray(data.orders) ? data.orders : []
  if (parts.length === 0 && orders.length === 0) return null

  const machineById = new Map<string, Machine>()
  for (const m of data.machines ?? []) {
    if (m?.id) machineById.set(m.id, m)
  }

  const codeKey = sparePartCodeKey(q)

  type DetalleInterno = CompatPedido & { ts: number }
  type Acc = {
    machineId: string
    machineName: string
    machineModel: string
    modeloCompleto: string
    partNames: Set<string>
    partCodes: Set<string>
    stockDisponible: number
    pedidosCount: number
    ultimoPedidoTime: number
    ultimoPedido: string
    origenes: Set<CompatOrigen>
    detallePedidos: DetalleInterno[]
  }
  const accs = new Map<string, Acc>()

  const ensureAcc = (machineId: string, fbName: string, fbModel: string): Acc => {
    // Los pedidos de 3C traen el Nº DE ORDEN en `machineId` ("X 0001-00011174"):
    // eso no es una máquina, así que no sirve ni para agrupar (una fila por
    // pedido = la misma máquina repetida) ni para linkear.
    const idLooksLikeOrder = /^x?\s?\d{3,6}-\d{4,10}$/i.test(machineId.trim())
    const machineDoc = machineId && !idLooksLikeOrder ? machineById.get(machineId) : undefined
    const name = machineDoc?.name || fbName || "—"
    const model = machineDoc?.model || fbModel || ""
    // IDENTIDAD: la máquina del catálogo (id real) o el MODELO COMPLETO.
    const modeloCompleto = machineIdentity(name, model)
    const key = machineDoc?.id
      ? `id:${machineDoc.id}`
      : `modelo:${normalizeSpaced(modeloCompleto) || "desconocida"}`
    let acc = accs.get(key)
    if (!acc) {
      acc = {
        machineId: machineDoc?.id ?? (idLooksLikeOrder ? "" : machineId),
        machineName: name,
        machineModel: model,
        modeloCompleto,
        partNames: new Set(),
        partCodes: new Set(),
        stockDisponible: 0,
        pedidosCount: 0,
        ultimoPedidoTime: 0,
        ultimoPedido: "—",
        origenes: new Set(),
        detallePedidos: [],
      }
      accs.set(key, acc)
    }
    return acc
  }

  const touchOrder = (acc: Acc, o: SparePartOrder): void => {
    if (o.description) acc.partNames.add(String(o.description))
    // "220V" y demás valores no-código nunca se muestran como código.
    if (isUsablePartCode(o.code)) acc.partCodes.add(normalizePartCode(o.code))
    acc.pedidosCount += 1
    const day = toDateSafe(o.requestedAt) ?? toDateSafe(o.createdAt)
    if (day && day.getTime() > acc.ultimoPedidoTime) {
      acc.ultimoPedidoTime = day.getTime()
      acc.ultimoPedido = formatDay(day)
    }
    acc.origenes.add("pedido")
    // HISTORIAL de la máquina para ese repuesto (lo muestra el desplegable de la
    // pantalla "Repuestos"): nº de orden + estado + fechas del circuito.
    acc.detallePedidos.push({
      id: o.id,
      orderNumber: o.orderNumber,
      code: isUsablePartCode(o.code) ? normalizePartCode(o.code) : "",
      description: o.description ?? "",
      status: String(o.status ?? ""),
      pedido: formatDay(day),
      traido: formatDay(o.receivedAt),
      utilizado: formatDay(o.usedAt),
      ts: day ? day.getTime() : 0,
    })
  }

  let modo: "codigo" | "nombre" = "codigo"
  let matchedByCode = false

  // ── 1) Match exacto por CÓDIGO ──────────────────────────────────────────
  // Si la búsqueda NO es un código real (voltaje "220V", "S/C", "1012"…),
  // no se hace match por código: cae al fallback por nombre.
  if (codeKey) {
    for (const p of parts) {
      if (sparePartCodeKey(p.partCode) !== codeKey) continue
      matchedByCode = true
      const acc = ensureAcc(p.machineId ?? "", p.machineName ?? "", p.machineModel ?? "")
      if (p.partName) acc.partNames.add(String(p.partName))
      acc.partCodes.add(normalizePartCode(p.partCode) || codeKey)
      acc.stockDisponible += Number(p.stockAvailable ?? 0) || 0
      acc.origenes.add(p.source === "blueprint" ? "plano" : "ficha")
    }
    for (const o of orders) {
      if (sparePartCodeKey(o.code) !== codeKey) continue
      matchedByCode = true
      touchOrder(ensureAcc(o.machineId ?? "", o.machineName ?? "", o.machineModel ?? ""), o)
    }
  }

  // ── 2) Fallback por NOMBRE/descripción (tolerante a variantes) ─────────────
  if (!matchedByCode) {
    const looseTokens = queryTokens(q)
    if (looseTokens.length === 0) return null
    const haystackMatch = (haystack: unknown): boolean =>
      matchesLoose(String(haystack ?? ""), looseTokens)
    for (const p of parts) {
      if (!haystackMatch(`${p.partName ?? ""} ${p.partCode ?? ""}`)) continue
      const acc = ensureAcc(p.machineId ?? "", p.machineName ?? "", p.machineModel ?? "")
      if (p.partName) acc.partNames.add(String(p.partName))
      if (isUsablePartCode(p.partCode)) acc.partCodes.add(normalizePartCode(p.partCode))
      acc.stockDisponible += Number(p.stockAvailable ?? 0) || 0
      acc.origenes.add(p.source === "blueprint" ? "plano" : "ficha")
    }
    for (const o of orders) {
      if (!haystackMatch(`${o.description ?? ""} ${o.code ?? ""}`)) continue
      touchOrder(ensureAcc(o.machineId ?? "", o.machineName ?? "", o.machineModel ?? ""), o)
    }
    modo = "nombre"
  }

  if (accs.size === 0) return null

  // El mismo código con distinto formato ("1 619 P14 777" vs "1619P14777")
  // se muestra una sola vez: se deduce por clave sin espacios.
  const dedupCodes = (codes: Set<string>): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of codes) {
      const k = sparePartCodeKey(c) || normalizePartCode(c)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(c)
    }
    return out.slice(0, 3)
  }

  const maquinas: CompatibleMachine[] = [...accs.values()]
    .map((a) => ({
      machineId: a.machineId,
      machineName: a.machineName,
      machineModel: a.machineModel,
      modeloCompleto: a.modeloCompleto,
      partNames: [...a.partNames].slice(0, 3),
      partCodes: dedupCodes(a.partCodes),
      stockDisponible: a.stockDisponible,
      pedidosCount: a.pedidosCount,
      ultimoPedido: a.ultimoPedido,
      origenes: [...a.origenes],
      // Historial: los más recientes primero, acotado (ver MAX_DETALLE_PEDIDOS).
      detallePedidos: a.detallePedidos
        .slice()
        .sort((x, y) => y.ts - x.ts)
        .slice(0, MAX_DETALLE_PEDIDOS)
        .map((d) => ({
          id: d.id,
          orderNumber: d.orderNumber,
          code: d.code,
          description: d.description,
          status: d.status,
          pedido: d.pedido,
          traido: d.traido,
          utilizado: d.utilizado,
        })),
    }))
    .sort(
      (x, y) =>
        y.pedidosCount - x.pedidosCount ||
        x.modeloCompleto.localeCompare(y.modeloCompleto, "es"),
    )

  // AVISO "se parece a" (ver `CompatibleMachine.sePareceA`): dos identidades que
  // comparten algún token con números son, casi seguro, la MISMA máquina escrita
  // distinto en 3C. NO se fusionan las filas a propósito: fusionar mal diría "es
  // la misma máquina" justo cuando se busca un repuesto para otra.
  const tokens = maquinas.map((m) => modelTokens(m.modeloCompleto))
  for (let i = 0; i < maquinas.length; i++) {
    if (tokens[i].size === 0) continue
    for (let j = 0; j < maquinas.length; j++) {
      if (i === j) continue
      if (!sharesModelToken(tokens[i], tokens[j])) continue
      maquinas[i].sePareceA = maquinas[j].modeloCompleto
      break
    }
  }

  return { modo, clave: matchedByCode ? normalizePartCode(q) : q.trim(), maquinas }
}

