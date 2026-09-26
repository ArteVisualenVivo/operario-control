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
import { matchesLoose, queryTokens } from "@/lib/fuzzySearch"

export type CompatOrigen = "ficha" | "pedido" | "plano"

export interface CompatibleMachine {
  machineId: string
  machineName: string
  machineModel: string
  /** Nombres de repuesto que matchearon en esta máquina. */
  partNames: string[]
  /** Códigos a mostrar (normalizados con espacios, ej. "1 619 P14 777"). */
  partCodes: string[]
  stockDisponible: number
  pedidosCount: number
  ultimoPedido: string
  origenes: CompatOrigen[]
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

/**
 * Busca un código o nombre de repuesto y devuelve las máquinas que lo usan.
 * - Primero intenta match EXACTO por código (ignora espacios/mayúsculas).
 * - Si no hay match por código, busca por descripción/nombre (tokens).
 * - Agrupa por máquina y cuenta fichas + pedidos.
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

  type Acc = {
    machineId: string
    machineName: string
    machineModel: string
    partNames: Set<string>
    partCodes: Set<string>
    stockDisponible: number
    pedidosCount: number
    ultimoPedidoTime: number
    ultimoPedido: string
    origenes: Set<CompatOrigen>
  }
  const accs = new Map<string, Acc>()

  const ensureAcc = (machineId: string, fbName: string, fbModel: string): Acc => {
    const key = machineId || `nombre:${fbName.toLowerCase()}` || "desconocida"
    let acc = accs.get(key)
    if (!acc) {
      const ref = machineId ? machineById.get(machineId) : undefined
      acc = {
        machineId,
        machineName: ref?.name || fbName || "—",
        machineModel: ref?.model || fbModel || "",
        partNames: new Set(),
        partCodes: new Set(),
        stockDisponible: 0,
        pedidosCount: 0,
        ultimoPedidoTime: 0,
        ultimoPedido: "—",
        origenes: new Set(),
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
      partNames: [...a.partNames].slice(0, 3),
      partCodes: dedupCodes(a.partCodes),
      stockDisponible: a.stockDisponible,
      pedidosCount: a.pedidosCount,
      ultimoPedido: a.ultimoPedido,
      origenes: [...a.origenes],
    }))
    .sort((x, y) => y.pedidosCount - x.pedidosCount || x.machineName.localeCompare(y.machineName, "es"))

  return { modo, clave: matchedByCode ? normalizePartCode(q) : q.trim(), maquinas }
}

