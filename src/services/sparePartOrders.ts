import {
  collection, addDoc, getDocs, getDoc, doc, updateDoc, deleteDoc, query, where, orderBy, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { LOCAL_MODE } from "@/lib/runtimeMode"
import { loadMaintenanceRecords } from "@/lib/local-sync"
import { createAuditLog } from "./audit"
import { restockPart, usePart as consumePart } from "./spareParts"
import type { SparePartOrder, CreateSparePartOrderInput, SparePartOrderStatus, MarkOrderedInput } from "@/types"

const COLLECTION = "spare_part_orders"

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date()
}

function docToOrder(snap: { id: string; data: () => Record<string, unknown> }): SparePartOrder {
  const d = snap.data()
  return {
    id: snap.id,
    repairId: (d.repairId as string) ?? "",
    orderNumber: (d.orderNumber as string) ?? "",
    machineId: (d.machineId as string) ?? "",
    machineName: (d.machineName as string) ?? "",
    sparePartId: (d.sparePartId as string) || undefined,
    code: (d.code as string) ?? "",
    description: (d.description as string) ?? "",
    unit: (d.unit as string) ?? "unidad",
    quantityRequested: (d.quantityRequested as number) ?? 0,
    quantityReceived: (d.quantityReceived as number) ?? 0,
    quantityUsed: (d.quantityUsed as number) ?? 0,
    status: (d.status as SparePartOrderStatus) ?? "SOLICITADO",
    supplier: (d.supplier as string) || undefined,
    requestedAt: toDate(d.requestedAt),
    orderedAt: d.orderedAt ? toDate(d.orderedAt) : undefined,
    expectedAt: d.expectedAt ? toDate(d.expectedAt) : undefined,
    receivedAt: d.receivedAt ? toDate(d.receivedAt) : undefined,
    usedAt: d.usedAt ? toDate(d.usedAt) : undefined,
    notes: (d.notes as string) || undefined,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

export async function getAllOrders(): Promise<SparePartOrder[]> {
  try {
    const q = query(collection(db, COLLECTION), orderBy("requestedAt", "desc"))
    const snap = await getDocs(q)
    return snap.docs.map(docToOrder)
  } catch (err) {
    if (LOCAL_MODE) return []
    throw err
  }
}

export async function getOrdersByRepair(repairId: string): Promise<SparePartOrder[]> {
  if (!repairId) return []
  try {
    const q = query(
      collection(db, COLLECTION),
      where("repairId", "==", repairId),
      orderBy("requestedAt", "desc"),
    )
    const snap = await getDocs(q)
    return snap.docs.map(docToOrder)
  } catch (err) {
    if (LOCAL_MODE) return []
    throw err
  }
}

export async function getOrderById(id: string): Promise<SparePartOrder | null> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return docToOrder(snap)
}

export async function createOrder(input: CreateSparePartOrderInput): Promise<string> {
  if (!input.repairId) {
    throw new Error("El pedido debe estar asociado a una orden de trabajo")
  }
  if (!input.machineId) {
    throw new Error("El pedido debe estar asociado a una máquina")
  }
  if (!String(input.code ?? "").trim()) {
    throw new Error("El código del repuesto es obligatorio")
  }
  if (!String(input.description ?? "").trim()) {
    throw new Error("La descripción del repuesto es obligatoria")
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("La cantidad debe ser mayor a 0")
  }

  const docData: Record<string, unknown> = {
    repairId: input.repairId,
    orderNumber: input.orderNumber ?? "",
    machineId: input.machineId,
    machineName: input.machineName ?? "",
    sparePartId: input.sparePartId ?? null,
    code: String(input.code).trim(),
    description: String(input.description).trim(),
    unit: input.unit ?? "unidad",
    quantityRequested: input.quantity,
    quantityReceived: 0,
    quantityUsed: 0,
    status: "SOLICITADO",
    supplier: input.supplier ?? null,
    requestedAt: input.requestedAt ?? new Date(),
    receivedAt: null,
    usedAt: null,
    notes: input.notes ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const ref = await addDoc(collection(db, COLLECTION), docData)
  await createAuditLog("create", "spare_part_order", ref.id, null, docData)
  return ref.id
}

async function loadOrder(id: string): Promise<{ ref: Parameters<typeof updateDoc>[0]; before: Record<string, unknown> }> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error("Pedido no encontrado")
  return { ref, before: snap.data() as Record<string, unknown> }
}

export async function markOrdered(
  id: string,
  input: MarkOrderedInput,
): Promise<void> {
  if (!(input.orderedAt instanceof Date) || Number.isNaN(input.orderedAt.getTime())) {
    throw new Error("La fecha de encargo es inválida")
  }
  if (input.expectedAt && Number.isNaN(input.expectedAt.getTime())) {
    throw new Error("La fecha estimada de retiro es inválida")
  }

  const { ref, before } = await loadOrder(id)
  const status = before.status as SparePartOrderStatus

  if (status !== "SOLICITADO" && status !== "PEDIDO") {
    throw new Error(
      `Solo se puede marcar como encargado un pedido SOLICITADO o PEDIDO (estado actual: ${status})`,
    )
  }

  const updates: Record<string, unknown> = {
    status: "ENCARGADO",
    orderedAt: input.orderedAt,
    expectedAt: input.expectedAt ?? null,
    updatedAt: new Date(),
  }
  if (input.notes !== undefined) updates.notes = input.notes

  await updateDoc(ref, updates)
  await createAuditLog("update", "spare_part_order", id, before, { ...before, ...updates })
}

export async function markReceived(
  id: string,
  quantity: number,
  receivedAt?: Date,
  notes?: string,
): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("La cantidad recibida debe ser mayor a 0")
  }

  const { ref, before } = await loadOrder(id)

  const currentReceived = (before.quantityReceived as number) ?? 0
  const requested = (before.quantityRequested as number) ?? 0
  const status = before.status as SparePartOrderStatus

  if (status === "CANCELADO") {
    throw new Error("No se puede recibir un pedido cancelado")
  }
  if (status === "UTILIZADO") {
    throw new Error("El pedido ya fue totalmente utilizado")
  }

  const pending = requested - currentReceived
  if (quantity > pending) {
    throw new Error(
      `Solo quedan ${pending} unidades por recibir (solicitado: ${requested}, recibido: ${currentReceived})`,
    )
  }

  const newReceived = currentReceived + quantity

  const updates: Record<string, unknown> = {
    quantityReceived: newReceived,
    status: "RECIBIDO",
    receivedAt: receivedAt ?? new Date(),
    updatedAt: new Date(),
  }
  if (notes !== undefined) updates.notes = notes

  await updateDoc(ref, updates)
  const after = { ...before, ...updates }

  // Recepción = entrada de stock si el repuesto está catalogado
  if (before.sparePartId) {
    await restockPart(before.sparePartId as string, quantity)
  }
  await createAuditLog("update", "spare_part_order", id, before, after)
}

export async function markUsed(
  id: string,
  quantity: number,
  usedAt?: Date,
  notes?: string,
): Promise<void> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("La cantidad utilizada debe ser mayor a 0")
  }

  const { ref, before } = await loadOrder(id)

  const received = (before.quantityReceived as number) ?? 0
  const used = (before.quantityUsed as number) ?? 0
  const status = before.status as SparePartOrderStatus

  if (status === "CANCELADO") {
    throw new Error("No se puede utilizar un pedido cancelado")
  }
  if (received <= 0) {
    throw new Error("No se puede utilizar el repuesto: todavía no fue recibido")
  }

  const remaining = received - used
  if (quantity > remaining) {
    throw new Error(
      `Solo quedan ${remaining} unidades por utilizar (recibido: ${received}, utilizado: ${used})`,
    )
  }

  const newUsed = used + quantity
  const newStatus: SparePartOrderStatus = newUsed >= received ? "UTILIZADO" : "RECIBIDO"

  const updates: Record<string, unknown> = {
    quantityUsed: newUsed,
    status: newStatus,
    usedAt: usedAt ?? new Date(),
    updatedAt: new Date(),
  }
  if (notes !== undefined) updates.notes = notes

  await updateDoc(ref, updates)
  const after = { ...before, ...updates }

  // Utilización = salida de stock si el repuesto está catalogado
  if (before.sparePartId) {
    await consumePart(before.sparePartId as string, quantity)
  }
  await createAuditLog("update", "spare_part_order", id, before, after)
}

export async function cancelOrder(id: string): Promise<void> {
  const { ref, before } = await loadOrder(id)
  const status = before.status as SparePartOrderStatus

  if (status === "UTILIZADO") {
    throw new Error("No se puede cancelar un pedido ya utilizado")
  }
  if (status === "CANCELADO") {
    throw new Error("El pedido ya está cancelado")
  }

  const updates: Record<string, unknown> = { status: "CANCELADO", updatedAt: new Date() }
  await updateDoc(ref, updates)
  await createAuditLog("update", "spare_part_order", id, before, { ...before, ...updates })
}

export async function deleteOrders(ids: string[]): Promise<void> {
  const unique = Array.from(new Set(ids)).filter(Boolean)
  if (unique.length === 0) return
  await Promise.all(
    unique.map(async (id) => {
      const ref = doc(db, COLLECTION, id)
      let before: Record<string, unknown> | null = null
      try {
        const snap = await getDoc(ref)
        if (snap.exists()) before = snap.data()
      } catch {
        before = null
      }
      await deleteDoc(ref)
      await createAuditLog("delete", "spare_part_order", id, before ?? {}, {})
    }),
  )
}

export async function updateOrderNotes(id: string, notes: string): Promise<void> {
  const { ref, before } = await loadOrder(id)
  const updates: Record<string, unknown> = { notes: notes || null, updatedAt: new Date() }
  await updateDoc(ref, updates)
  await createAuditLog("update", "spare_part_order", id, before, { ...before, ...updates })
}
// Normaliza el número de orden para comparar sin "X" ni espacios.
function normOrderKey(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/^X\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Extrae un posible CÓDIGO de repuesto desde un comentario/descripción de 3C.
 * - Si hay un patrón tipo "CÓDIGO — NOMBRE" o "CÓDIGO.nombre" lo toma.
 * - Si no, busca una secuencia alfanumérica con guiones/puntos que parezca código.
 * Devuelve `null` si no encuentra nada (se usará "S/C").
 */
export function extractPartCodeFromText(text: unknown): string | null {
  const raw = String(text ?? "").trim()
  if (!raw) return null
  // Formato "XXXXX — NOMBRE" (código antes del guión largo/emdash/trazo)
  const em = raw.match(/^\s*([A-Z0-9][A-Z0-9.\-/]{2,})\s*[—–-]\s/i)
  if (em) return em[1].toUpperCase()
  // Buscar token alfanumérico con guiones que parezca código (>=4 chars, con dígito o letra+número)
  const tm = raw.match(/\b([A-Z0-9]{1,4}[−–-]?[0-9]{2,}[A-Z0-9\-.]*|\d{2,}[A-Z0-9][A-Z0-9\-.]*)\b/i)
  if (tm) {
    const tok = tm[1].toUpperCase()
    // Evitar falsos positivos: si es solo números tipo años/horas, ignorar
    if (/^\d{4}$/.test(tok)) return null
    return tok
  }
  return null
}

/**
 * Importa a "Pedidos de Repuestos" los repuestos que están en espera según las
 * Órdenes de Reparación de 3C (estado "A la Espera Repuestos" en Mantenimiento).
 *
 * Toma de cada orden en espera su statusDescription (la descripción del repuesto
 * que se está esperando) y crea un pedido (estado SOLICITADO) asociado a esa
 * orden/máquina. Es idempotente: NO borra nada existente y NO duplica pedidos que
 * ya existen para la misma (orden + descripción repuesto).
 */
export async function importPendingPartsFromMaintenance(): Promise<{
  created: number
  skippedExisting: number
  createdOrders: { orderNumber: string; description: string }[]
}> {
  const existing = await getAllOrders()
  const seen = new Set(
    existing.map((o) => `${normOrderKey(o.orderNumber)}||${o.description.trim().toLowerCase()}`),
  )

  // Cargar órdenes consolidadas de 3C (fuente primaria Redis / Firestore)
  const maintenance = await loadMaintenanceRecords()

  const pendingKinds = /espera.*repuesto|repuesto.*espera|esperando.*repuesto/i
  const awaiting = maintenance.filter((m) => pendingKinds.test(m.status ?? "") || pendingKinds.test(m.statusDescription ?? ""))

  const createdOrders: { orderNumber: string; description: string }[] = []
  let skippedExisting = 0

  // Separa un ítem de trabajo/repuesto de 3C en { code, name }.
  // formato esperado: "1262 — rodamiento 6203" | "KD44221 — FICHA BIPOLAR AZUL"
  const splitItem = (item: string): { code: string; name: string } => {
    const m = String(item ?? "").match(/^\s*([^—–]+?)\s*[—–]\s*(.+)$/)
    if (m) {
      const code = m[1].trim()
      const name = m[2].trim()
      if (code && name) return { code, name }
    }
    return { code: "S/C", name: String(item ?? "").trim() }
  }

  for (const rec of awaiting) {
    const partDesc = (rec.statusDescription ?? rec.status ?? "").trim()
    // Ítems reales de la orden (código + nombre). Si no hay, usar el comentario.
    const items = (rec.workItems ?? []).filter(Boolean)
    const sources = items.length > 0 ? items : partDesc ? [partDesc] : []

    for (const rawItem of sources) {
      const { code, name } = splitItem(rawItem)
      if (!name) continue

      const key = `${normOrderKey(rec.orderNumber)}||${name.toLowerCase()}`
      if (seen.has(key)) {
        skippedExisting++
        continue
      }

      await createOrder({
        repairId: rec.id ?? rec.orderNumber,
        orderNumber: rec.orderNumber,
        machineId: rec.orderNumber,
        machineName: rec.machineName ?? "",
        code,
        description: name,
        unit: "unidad",
        quantity: 1,
        requestedAt: rec.entryDate ?? new Date(),
        notes: "Importado desde Órdenes de Reparación (3C): repuesto en espera",
      })
      seen.add(key)
      createdOrders.push({ orderNumber: rec.orderNumber, description: name })
    }
  }

  return { created: createdOrders.length, skippedExisting, createdOrders }
}

// ============================================================================
// PARSING DE REPUESTOS DESDE MOTIVO_ESTADO_REP
// ============================================================================

/**
 * Patrones que indican texto administrativo/comunicaciones que NO son repuestos.
 * Si el texto completo coincide con alguno de estos patrones, se descarta.
 */
const ADMIN_PATTERNS = [
  /^FVta\s*:/i,
  /^FAIV\s*:/i,
  /^retira\s/i,
  /^retirad[oa]/i,
  /^retiro\s/i,
  /^retirad[oa]\s+por\b/i,
  /^NO\s+SE\s+REPARA?\s*POR?\s*FALTA\s+DE\s+REPUESTOS?\b/i,
  /^NO\s+SE\s+PUEDE\s+REPARAR\s*POR?\s*FALTA\s+DE\s+REPUESTOS?\b/i,
  /^FALTA\s+DE\s+REPUESTOS?\b/i,
  /^REPUESTO\s+NO\s+DISPONIBLE\b/i,
  /^NO\s+SE\s+CONSIGUE\s+(EL\s+)?REPUESTO\b/i,
  /^NO\s+ACEPTO\s+PRESUPUESTO\b/i,
  /^FUERA\s+DE\s+PRESUPUESTO\b/i,
  /^PENDIENTE\s+PARA\s+REVISAR\b/i,
  /^SE\s+LLAM[OÓ]\s+AL\s+CLIENTE\b/i,
  /^DONADA?\s*POR\b/i,
  /^NO\s+SE\s+REPARA\b/i,
  /^REPARACION\s+DE\b/i,
  /^NO\s+SE\s+CAMBIO\s+(NINGUN|NINGUNO|NADA)\b/i,
  /NO\s+SE\s+CAMBIO\s+(NINGUN|NINGUNO|NADA)\b/i,
  /^LIMPIEZA\s+Y\s+LUBRICACION\b/i,
  /^REPARADA\s+LIMPIEZA\b/i,
]

/** Verifica si un texto es puramente administrativo (no contiene repuestos). */
function isAdminText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  return ADMIN_PATTERNS.some((p) => p.test(trimmed))
}

/** Limpia y normaliza una línea de texto. */
function cleanLine(text: string): string[] {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/[\r\n]+/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * Detecta si una línea parece un código de repuesto (no una descripción).
 * Códigos típicos: "1619P15184", "600 A01 L7D", "619 P06 232", "604 611 024"
 */
function looksLikeCode(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  // Empieza con letra seguida de varios dígitos: "R9939675", "A1234"
  if (/^[A-Z]\d{4,}/i.test(t)) return true
  // Formato con espacios: "600 A01 L7D", "619 P06 232", "1 600 A01 L7D"
  if (/^\d{1,4}\s+[A-Z0-9]{2,4}(\s+[A-Z0-9]{2,})+$/i.test(t)) return true
  // Alfanumérico con guiones/puntos: "1619P15184", "1619-P15-184"
  if (/^\d{3,4}[-.]?[A-Z0-9]{2,}[-.]?[A-Z0-9]*$/i.test(t)) return true
  // Mayormente dígitos con separadores
  if (/^[\d\s.]{5,}$/.test(t) && /\d{4,}/.test(t)) return true
  return false
}

/** Limpia la descripción de prefijos verbales comunes. */
function cleanDescription(desc: string): string {
  if (!desc) return desc
  return desc
    .replace(/^(se\s+)?(cambia(r)?|coloca(r)?|pone(r)?|repara(r)?|necesita|requiere|comprar)\s+(el|la|los|las|un|una)\s+/i, "")
    .replace(/^(se\s+cambio)\b/i, "")
    .trim()
    .replace(/^(se\s+)?(cambia(r)?|coloca(r)?|pone(r)?|repara(r)?|necesita|requiere|comprar|cambie)\s+/i, "")
    .replace(/^de\s+/i, "")
    .replace(/^[\d]+[.,]?\d*\s*(mts?|metros?|kg|g|cm|mm|unid|lts?|litros?)\s*(de\s+)?/i, "")
    .replace(/^[""]/, "")
    .replace(/(\d)x(\d)/gi, "$1X$2")
    .trim()
}

/** Extrae código de una línea, eliminando cantidad inicial si existe. */
function extractCode(line: string): string {
  const t = line.trim()
  // Quitar cantidad inicial: "1 600 A01 L7D" → "600 A01 L7D"
  const cleaned = t.replace(/^\d{1,3}\s+(?=\d)/, "")
  return cleaned.toUpperCase()
}

/**
 * Parsea MOTIVO_ESTADO_REP y extrae repuestos/materiales concretos.
 * Soporta código en línea separada, código en misma línea, múltiples repuestos,
 * y repuestos sin código.
 */
export function parseSparePartsFromMotivo(motivo: string): { code: string | null; description: string }[] {
  if (!motivo || isAdminText(motivo)) return []

  const lines = cleanLine(motivo)
  if (lines.length === 0) return []

  const parts: { code: string | null; description: string }[] = []
  let currentDesc: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || isAdminText(line)) continue

    // Detectar patrón "CÓDIGO [modelo] descripción" (código al inicio)
    // Ej: "R9939675 92 JGO DE CARBONES 92 p/9993896"
    const codeFirst = line.match(/^([A-Z]\d{4,})(?:\s+\d{1,3})?\s{1,3}(.+)$/i)
    if (codeFirst && codeFirst[2] && codeFirst[2].length > 3) {
      const potentialCode = codeFirst[1].trim()
      if (looksLikeCode(potentialCode)) {
        parts.push({ code: potentialCode.toUpperCase(), description: codeFirst[2].trim() })
        continue
      }
    }

    // Detectar patrón "descripción CÓDIGO" (código al final con paréntesis opcional)
    const inlineCode = line.match(/^(.+?)\s+([A-Z]?\d{3,}[A-Z0-9]*)(?:\s*\(([^)]+)\))?$/i)
    if (inlineCode && inlineCode[2] && inlineCode[2].length >= 4) {
      const potentialCode = inlineCode[2]
      if (inlineCode[1].trim().length > 0 && looksLikeCode(potentialCode)) {
        parts.push({ code: potentialCode.toUpperCase(), description: inlineCode[3] ? `${inlineCode[1].trim()} (${inlineCode[3]})` : inlineCode[1].trim() })
        continue
      }
    }

    // Si la línea parece código
    if (looksLikeCode(line)) {
      const code = extractCode(line)
      if (currentDesc) { parts.push({ code: code, description: currentDesc }); currentDesc = null }
      else parts.push({ code: code, description: `Repuesto ${line}` })
    } else {
      // Es una descripción (no código)
      if (currentDesc && !isAdminText(currentDesc)) {
        parts.push({ code: null, description: currentDesc })
      }
      currentDesc = line
    }
  }

  // Guardar última descripción pendiente
  if (currentDesc && !isAdminText(currentDesc)) {
    parts.push({ code: null, description: currentDesc })
  }

  // Si no se generó nada pero el texto no es admin, usarlo tal cual
  if (parts.length === 0 && !isAdminText(motivo.trim())) {
    parts.push({ code: null, description: motivo.trim() })
  }

  return parts
    .map((p) => ({
      code: p.code,
      description: cleanDescription(p.description),
    }))
    .filter((p) => p.description && !isAdminText(p.description))
}

/**
 * Importa repuestos/materiales detectados en MOTIVO_ESTADO_REP hacia Pedidos Rep.
 *
 * Lógica:
 * - Lee todos los MaintenanceRecords (fuente primaria Redis / Firestore)
 * - Filtra los que tienen motivoEstadoRep no vacío
 * - Parsea cada motivo para identificar repuestos concretos
 * - Crea/actualiza spare_part_orders por cada repuesto detectado
 * - Es idempotente: no duplica si ya existe (orden + código/descripción)
 */
export async function importSparePartsFromRepairMotivo(): Promise<{
  created: number
  updated: number
  skippedAdmin: number
  createdOrders: { orderNumber: string; code: string | null; description: string }[]
}> {
  const { loadMaintenanceRecords } = await import("@/lib/local-sync")
  const maintenance = await loadMaintenanceRecords()

  const existing = await getAllOrders()
  const seen = new Map<string, SparePartOrder>()
  for (const o of existing) {
    const key = `${normOrderKey(o.orderNumber)}||${(o.code || o.description).trim().toLowerCase()}`
    seen.set(key, o)
  }

  const createdOrders: { orderNumber: string; code: string | null; description: string }[] = []
  let updated = 0
  let skippedAdmin = 0

  for (const record of maintenance) {
    const motivo = record.motivoEstadoRep?.trim()
    if (!motivo) continue

    // Saltar si todo el texto es administrativo
    if (isAdminText(motivo)) {
      skippedAdmin++
      continue
    }

    const spareParts = parseSparePartsFromMotivo(motivo)
    if (spareParts.length === 0) {
      skippedAdmin++
      continue
    }

    for (const part of spareParts) {
      const codeNorm = part.code ? part.code.toUpperCase().replace(/\s+/g, " ") : ""
      const descNorm = part.description.trim().toLowerCase()

      // Clave de deduplicación: orden + código (si hay) o descripción normalizada
      const dedupKey = codeNorm
        ? `${normOrderKey(record.orderNumber)}||${codeNorm}`
        : `${normOrderKey(record.orderNumber)}||${descNorm}`

      const existingOrder = seen.get(dedupKey)
      if (existingOrder) {
        // Actualizar existente si cambió algo relevante
        const updates: Record<string, unknown> = {}
        if (!existingOrder.notes || !existingOrder.notes.includes(motivo)) {
          updates.notes = existingOrder.notes
            ? `${existingOrder.notes}\n---\nMOTIVO_ESTADO_REP: ${motivo}`
            : `MOTIVO_ESTADO_REP: ${motivo}`
        }
        if (Object.keys(updates).length > 0) {
          const ref = doc(db, COLLECTION, existingOrder.id)
          await updateDoc(ref, { ...updates, updatedAt: new Date() })
          updated++
        }
        continue
      }

      // Crear nuevo pedido
      await createOrder({
        repairId: record.id ?? record.orderNumber,
        orderNumber: record.orderNumber,
        machineId: record.orderNumber,
        machineName: record.machineName ?? "",
        code: part.code ?? "",
        description: part.description,
        unit: "unidad",
        quantity: 1,
        requestedAt: record.entryDate ?? new Date(),
        notes: `Importado desde MOTIVO_ESTADO_REP (3C)\nOrden: ${record.orderNumber}\nCliente: ${record.clientName}\nEstado: ${record.status}\n---\nMOTIVO original: ${motivo}`,
      })

      seen.set(dedupKey, {
        id: "pending",
        repairId: record.id ?? record.orderNumber,
        orderNumber: record.orderNumber,
        machineId: record.orderNumber,
        machineName: record.machineName ?? "",
        code: part.code ?? "",
        description: part.description,
        unit: "unidad",
        quantityRequested: 1,
        quantityReceived: 0,
        quantityUsed: 0,
        status: "SOLICITADO",
        requestedAt: record.entryDate ?? new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      createdOrders.push({
        orderNumber: record.orderNumber,
        code: part.code,
        description: part.description,
      })
    }
  }

  return { created: createdOrders.length, updated, skippedAdmin, createdOrders }
}
