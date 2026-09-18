import {
  collection, addDoc, getDocs, getDoc, doc, updateDoc, deleteDoc, query, where, orderBy, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { LOCAL_MODE } from "@/lib/runtimeMode"
import { loadMaintenanceRecords } from "@/lib/local-sync"
import { createAuditLog } from "./audit"
import { restockPart, usePart as consumePart } from "./spareParts"
import type { SparePartOrder, CreateSparePartOrderInput, SparePartOrderStatus, MarkOrderedInput } from "@/types"
import type { MaintenanceRecord } from "./maintenance"

const COLLECTION = "spare_part_orders"

function toDate(val: unknown): Date | null {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val
  // Admin SDK (Node) devuelve su propio Timestamp: se resuelve por duck typing.
  if (val && typeof val === "object" && typeof (val as { toDate?: unknown }).toDate === "function") {
    const converted = (val as { toDate: () => Date }).toDate()
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null
  }
  if (typeof val === "string" || typeof val === "number") {
    const parsed = new Date(val)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  // REGLA: una fecha faltante/inválida NO se transforma en "ahora".
  return null
}

/**
 * Canoniza una fecha de 3C al MEDIODÍA UTC de su mismo día calendario (UTC).
 * 3C sólo informa el día (sin hora) y los valores llegan con horas artificiales
 * (p. ej. 03:00Z / 15:00Z): el mediodía UTC evita que el día mostrado dependa de
 * la zona horaria del navegador. NO cambia la fecha, sólo su hora.
 */
function toCanonicalDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0))
}

/**
 * Fecha REAL del registro de 3C cuyo estado es "A la Espera Repuestos".
 *
 * Fuentes, en orden: la fecha del propio estado de espera en `states[]`; si no,
 * `statusDate`/`entryDate` del registro cuando su estado es el de espera.
 * Si no hay fecha válida devuelve null (NUNCA `new Date()`).
 */
export function resolveWaitingStatusDate(rec: {
  status?: string | null
  statusDate?: Date | string | null
  entryDate?: Date | string | null
  states?: { status?: string | null; statusDate?: string | null }[] | null
}): Date | null {
  const candidates: unknown[] = []

  if (Array.isArray(rec.states)) {
    for (const state of rec.states) {
      if (isSpareWaitingStatus(state?.status)) candidates.push(state?.statusDate)
    }
  }
  if (isSpareWaitingStatus(rec.status)) {
    candidates.push(rec.statusDate, rec.entryDate)
  }

  for (const candidate of candidates) {
    const parsed = toDate(candidate)
    if (parsed) return toCanonicalDay(parsed)
  }
  return null
}

function docToOrder(snap: { id: string; data: () => Record<string, unknown> }): SparePartOrder {
  const d = snap.data()
  return {
    id: snap.id,
    repairId: (d.repairId as string) ?? "",
    orderNumber: (d.orderNumber as string) ?? "",
    machineId: (d.machineId as string) ?? "",
    machineName: (d.machineName as string) ?? "",
    machineModel: (d.machineModel as string | null | undefined) ?? null,
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
    orderedAt: toDate(d.orderedAt) ?? undefined,
    expectedAt: toDate(d.expectedAt) ?? undefined,
    receivedAt: toDate(d.receivedAt) ?? undefined,
    usedAt: toDate(d.usedAt) ?? undefined,
    notes: (d.notes as string) || undefined,
    // Metadatos del documento (no son fechas de 3C): si faltan se usa "ahora".
    // La fecha de 3C es `requestedAt` y NUNCA se rellena con "ahora".
    createdAt: toDate(d.createdAt) ?? new Date(),
    updatedAt: toDate(d.updatedAt) ?? new Date(),
  }
}

// ============================================================================
// BACKEND DE FIRESTORE SEGÚN EL ENTORNO
// - NAVEGADOR: client SDK con la sesión del usuario (comportamiento actual).
// - NODE (agente local, sin sesión): el client SDK responde "Missing or
//   insufficient permissions", así que se usa el Admin SDK — el MISMO mecanismo
//   que ya usan src/lib/sync-3c/engine.ts y firestoreSync.ts con la service
//   account de sync-agent/service-account.json. No es un backend nuevo: es el
//   camino server-side que ya existe en el proyecto.
// ============================================================================

interface AdminFirestoreLike {
  collection: (name: string) => {
    get: () => Promise<{ docs: { id: string; data: () => Record<string, unknown> }[] }>
    add: (data: Record<string, unknown>) => Promise<{ id: string }>
    doc: (id: string) => { update: (data: Record<string, unknown>) => Promise<unknown> }
  }
}

let adminDb: AdminFirestoreLike | null = null
let adminDbResolved = false

/** Admin SDK de Firestore cuando corremos en Node; null en el navegador. */
async function getAdminDb(): Promise<AdminFirestoreLike | null> {
  if (typeof window !== "undefined") return null
  if (adminDbResolved) return adminDb
  adminDbResolved = true
  try {
    // API modular + service account: MISMA credencial que ya usa el agente
    // (src/lib/sync-3c/engine.ts y scripts/*.mjs).
    const fs = await import("fs")
    const path = await import("path")
    const { initializeApp, cert, getApps } = await import("firebase-admin/app")
    const { getFirestore } = await import("firebase-admin/firestore")
    const candidates = [
      path.resolve(process.cwd(), "sync-agent", "service-account.json"),
      path.resolve(process.cwd(), "..", "sync-agent", "service-account.json"),
    ]
    const saPath = candidates.find((candidate) => fs.existsSync(candidate))
    if (!saPath) throw new Error(`No se encontró service-account.json en: ${candidates.join(", ")}`)
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"))
    const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) })
    adminDb = getFirestore(app) as unknown as AdminFirestoreLike
    return adminDb
  } catch (err) {
    console.error(
      "[sparePartOrders] Admin SDK no disponible (se usa el client SDK):",
      err instanceof Error ? err.message : err,
    )
    adminDb = null
    return null
  }
}

/** Actualiza un pedido existente (client SDK en el navegador, Admin en Node). */
async function updateOrderDoc(id: string, updates: Record<string, unknown>): Promise<void> {
  const admin = await getAdminDb()
  if (admin) {
    await admin.collection(COLLECTION).doc(id).update(updates)
    return
  }
  await updateDoc(doc(db, COLLECTION, id), updates)
}

export async function getAllOrders(): Promise<SparePartOrder[]> {
  try {
    const q = query(collection(db, COLLECTION), orderBy("requestedAt", "desc"))
    const snap = await getDocs(q)
    return snap.docs.map(docToOrder)
  } catch (err) {
    // En Node (agente) el client SDK no está autenticado → Admin SDK.
    const admin = await getAdminDb()
    if (admin) {
      try {
        const snap = await admin.collection(COLLECTION).get()
        return snap.docs
          .map((d) => docToOrder({ id: d.id, data: () => d.data() }))
          .sort((a, b) => (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0))
      } catch (adminErr) {
        console.error(
          "[sparePartOrders] Admin getAllOrders falló:",
          adminErr instanceof Error ? adminErr.message : adminErr,
        )
      }
    }
    if (LOCAL_MODE) return []
    console.error("[sparePartOrders] getAllOrders falló:", err instanceof Error ? err.message : err)
    throw err
  }
}

export async function getOrdersByRepair(repairId: string): Promise<SparePartOrder[]> {
  if (!repairId) return []

  // Normaliza un valor (local:/maintenance:, X inicial, mayúsculas, espacios)
  // a la clave canónica para comparar.
  const normFor = (value: unknown): string => normOrderKey(
    String(value ?? "").replace(/^(local:|maintenance:)\s*/i, ""),
  )

  // Generar las posibles claves objetivo para esta reparación: con y sin "X".
  const base = normFor(repairId)
  const baseDigits = /^\d/.test(base) ? base : base.replace(/^X\s+/, "").trim()
  const targetKeys = new Set<string>([base, baseDigits])

  try {
    // Evitamos búsquedas Firestore compuestas (where + orderBy) que requieren
    // índices compuestos y, si faltan, lanzan error devolviendo vacío. En su
    // lugar cargamos todos los pedidos (consulta simple con orderBy ya
    // utilizada por getAllOrders) y filtramos en memoria por orden normalizada.
    const all = await getAllOrders()
    return all.filter((o) => {
      const match =
        targetKeys.has(normFor(o.repairId)) ||
        targetKeys.has(normFor(o.orderNumber))
      return match
    })
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

export async function createOrder(
  input: CreateSparePartOrderInput,
  // Los pedidos auto-importados de 3C pueden NO tener código propio de repuesto
  // (se guarda vacío, nunca "S/C"); el pedido manual sigue exigiendo código.
  opts?: { allowEmptyCode?: boolean },
): Promise<string> {
  if (!input.repairId) {
    throw new Error("El pedido debe estar asociado a una orden de trabajo")
  }
  if (!input.machineId) {
    throw new Error("El pedido debe estar asociado a una máquina")
  }
  if (!String(input.code ?? "").trim() && !opts?.allowEmptyCode) {
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
    machineModel: input.machineModel ?? null,
    sparePartId: input.sparePartId ?? null,
    code: String(input.code).trim(),
    description: String(input.description).trim(),
    unit: input.unit ?? "unidad",
    quantityRequested: input.quantity,
    quantityReceived: 0,
    quantityUsed: 0,
    status: "SOLICITADO",
    supplier: input.supplier ?? null,
    // REGLA: requestedAt es la fecha real de 3C del estado "A la Espera
    // Repuestos". Si no existe, queda null (la UI muestra "—"); nunca "ahora".
    requestedAt: toDate(input.requestedAt),
    receivedAt: null,
    usedAt: null,
    notes: input.notes ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  // En Node (agente) se escribe con el Admin SDK: mismo documento, misma forma.
  const admin = await getAdminDb()
  if (admin) {
    const created = await admin.collection(COLLECTION).add(docData)
    await createAuditLog("create", "spare_part_order", created.id, null, docData)
    return created.id
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
 * REGLA 3C: solo el ESTADO "A la Espera Repuestos" genera Pedidos Rep.
 * Los comentarios de otros estados pertenecen al historial de la reparación.
 */
export function isSpareWaitingStatus(status: unknown): boolean {
  const t = String(status ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
  return t.includes("espera") && t.includes("repuesto")
}

/**
 * Conceptos de MANO DE OBRA / códigos internos: NUNCA son repuestos.
 * Ej: "MO CES", "MO CESA", "mano de obra".
 */
export function isLaborText(text: unknown): boolean {
  const t = String(text ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  if (!t) return true
  if (/^MO\b/.test(t)) return true // MO CES, MO CESA, MO ...
  if (/MANO\s+DE\s+OBRA/.test(t)) return true
  return false
}

/**
 * Códigos internos de mano de obra (solo dígitos, ej: "1012") NUNCA son
 * códigos de repuesto. Los códigos reales de 3C llevan letras y/o formato
 * ("1619P16276", "600 A01 L7D").
 */
export function isInternalCode(code: unknown): boolean {
  const c = String(code ?? "").replace(/\s+/g, "")
  return /^\d{1,6}$/.test(c)
}

/**
 * Separa máquina y modelo desde la descripción de 3C.
 * Ej: "Amoladora bosch 230 GWS- 25-23" → { machine: "Amoladora bosch 230", model: "GWS-25-23" }
 * "ROTOMARTILLO BOSCH" → { machine: "ROTOMARTILLO BOSCH", model: null }
 * Solo detecta modelos escritos en MAYÚSCULAS con dígitos (GBH220, GWS-25-23).
 * La falla del cliente NUNCA se interpreta como modelo.
 */
export function splitMachineModel(name: unknown): { machine: string; model: string | null } {
  const raw = String(name ?? "")
    .replace(/^reparaci[oó]n:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!raw) return { machine: "", model: null }
  const m = raw.match(
    /^(.+?)\s+([A-ZÁÉÍÓÚÑ]{2,6}\s?[-\/]?\s?\d{2,}(?:\s?[-\/.]\s?\d+)*[A-Z0-9]*)$/,
  )
  if (m && m[1].trim().length >= 3) {
    const model = m[2]
      .replace(/\s*([\-\/.])\s*/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
    return { machine: m[1].trim(), model }
  }
  return { machine: raw, model: null }
}
/**
 * Separa máquina y modelo desde la IDENTIFICACIÓN COMPLETA de la máquina (la que
 * 3C muestra en la O.R.), conservando el MODELO ENTERO: no lo corta ni lo
 * normaliza.
 *
 * Ej. O.R. X 0001-00011233 — identificación real de 3C:
 *   "Amoladora bosch 230 GWS- 25-230 Bare | 3 601 HF4 0H0"
 *     - machine: "Amoladora bosch 230"
 *     - model:   "GWS- 25-230 Bare | 3 601 HF4 0H0"
 *
 * El modelo empieza en el primer bloque "código de modelo" (2-6 letras
 * mayúsculas + dígitos: "GWS- 25-230", "SKILL 5200", "GBH220") y **todo el
 * resto** pasa a ser el modelo, incluyendo "Bare" y "| 3 601 HF4 0H0".
 * Si no hay bloque de modelo, la identificación completa queda como máquina.
 */
export function splitMachineIdentification(name: unknown): { machine: string; model: string | null } {
  const raw = String(name ?? "")
    .replace(/^reparaci[oó]n:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!raw) return { machine: "", model: null }
  const m = raw.match(/^(.+?)\s+([A-ZÁÉÍÓÚÑ]{2,6}\s?[-/]?\s?\d{2,}.*)$/)
  if (m && m[1].trim().length >= 3) {
    // 3C usa " - " como separador entre nombre y modelo
    // (ej. "AMOLADORA 230 BOSCH - GWS 28 ..."): ese separador no pertenece
    // a ningún campo, se recorta de la máquina. El modelo queda intacto.
    return { machine: m[1].trim().replace(/[\s\-/]+$/, "").trim(), model: m[2].trim() }
  }
  return { machine: raw, model: null }
}

/** ¿El pedido fue auto-importado de 3C? (los cargados a mano NUNCA se tocan). */
function isAutoImportedOrder(order: SparePartOrder): boolean {
  return /importado desde .{0,20}rdenes de reparaci/i.test(order.notes ?? "")
}

/**
 * ¿El valor guardado es EL MISMO dato pero incompleto (recortado por 3C)?
 * Compara sin espacios y sin mayúsculas: "GWS-25-23" es el recorte de
 * "GWS- 25-230 Bare | 3 601 HF4 0H0". Nunca marca como actualizable un valor
 * más completo que el esperado (jamás degrada un dato bueno).
 *
 * Para la máquina, además del recorte exacto a mitad de texto, se contempla el
 * recorte "conservador": a veces 3C partió la identificación y el importador
 * guardó la identificación TRUNCADA completa como machineName (sin separarla),
 * ej. "Amoladora bosch 230 GWS- 25-23". En ese caso se completa con la máquina
 * de la identificación ya recuperada.
 */
function isSameOrTruncated(stored: string | null | undefined, expected: string | null | undefined): boolean {
  const s = String(stored ?? "").replace(/\s+/g, "").toUpperCase()
  const e = String(expected ?? "").replace(/\s+/g, "").toUpperCase()
  if (s === e) return false
  if (!s) return Boolean(e)
  return e.startsWith(s)
}

/**
 * ¿El machineName guardado es la identificación truncada de 3C
 * (guardada entera en machineName, sin separar máquina/modelo)?
 * Ej. guardado "Amoladora bosch 230 GWS- 25-23" vs. identificación completa
 * "Amoladora bosch 230 GWS- 25-230 Bare | 3 601 HF4 0H0".
 */
function isTruncatedIdentification(
  storedMachineName: string | null | undefined,
  identification: string | null | undefined,
): boolean {
  const s = String(storedMachineName ?? "").replace(/\s+/g, "").toUpperCase()
  const e = String(identification ?? "").replace(/\s+/g, "").toUpperCase()
  if (!s || !e || s === e) return false
  return e.startsWith(s)
}

/**
 * MODELO de Pedidos de repuesto = contenido EXACTO de la columna DENOMINACION
 * del Excel de Reparaciones de 3C (`Ítems → denominacion`), copiado TAL CUAL:
 * se conserva el prefijo "REPARACION: ", los espacios y las mayúsculas tal como
 * los exporta 3C. No se corta, no se reconstruye y no se completa con ninguna
 * otra columna (descripcion, orden_compra, expediente).
 *
 * Ej. O.R. X 0001-00011233 → "REPARACION: Amoladora bosch 230 GWS- 25-230 Bare | 3 601 HF4 0H0"
 *
 * Devuelve null cuando la orden no trae DENOMINACION: en ese caso el llamador
 * conserva el modelo derivado de la identificación (nunca se inventa el dato).
 */
export function modelFromDenominacion(denominacion: unknown): string | null {
  // Solo se quitan los espacios sobrantes de los EXTREMOS (convención de la
  // casa al leer celdas): el texto interno, el prefijo y las mayúsculas quedan
  // EXACTAMENTE como los exporta 3C.
  const raw = String(denominacion ?? "").trim()
  return raw || null
}

/**
 * Campos máquina/modelo a COMPLETAR en un pedido auto-importado cuyo dato de 3C
 * venía partido en dos celdas. Devuelve {} cuando ya está completo.
 *
 * Cubre TODAS estas formas truncadas (para todas las máquinas, no una orden):
 *  - máquina separada pero incompleta: "Amoladora bosch 230 GWS- 25-23"
 *    (el recorte de "Amoladora bosch 230" + resto del modelo)
 *  - identificación truncada entera en machineName:
 *    "Amoladora bosch 230 GWS- 25-23" como texto completo sin separar
 *  - modelo recortado: "GWS- 25-23" (recorte de "GWS- 25-230 Bare | …")
 *
 * El MODELO sale de `denominacion` (columna del Excel) copiado TAL CUAL cuando
 * está disponible; si no, del modelo derivado de la identificación.
 */
export function machineFieldsToRefresh(
  existingOrder: SparePartOrder,
  identification: string | null | undefined,
  denominacion?: string | null,
): Record<string, unknown> {
  const { machine, model: modelFromIdentification } = splitMachineIdentification(identification)
  // MODELO: si la orden trae DENOMINACION (columna del Excel de Reparaciones),
  // ese es el valor EXACTO y definitivo y se copia TAL CUAL, sin compararlo con
  // la identificación (son fuentes distintas y la denominación manda). Solo se
  // escribe cuando difiere, para no generar escrituras innecesarias.
  const denominacionModel = modelFromDenominacion(denominacion)
  const model = denominacionModel ?? modelFromIdentification
  const updates: Record<string, unknown> = {}
  if (isSameOrTruncated(existingOrder.machineName, machine)) updates.machineName = machine
  else if (isTruncatedIdentification(existingOrder.machineName, identification)) updates.machineName = machine
  else {
    // La máquina guardada trae pegado el resto del modelo truncado
    // (ej. "Amoladora bosch 230 GWS- 25-23"): el recorte de la identificación
    // completa empieza con la máquina correcta → se completa igual.
    const s = String(existingOrder.machineName ?? "").replace(/\s+/g, "").toUpperCase()
    const e = String(identification ?? "").replace(/\s+/g, "").toUpperCase()
    const m = String(machine ?? "").replace(/\s+/g, "").toUpperCase()
    if (s && e && m && e.startsWith(s) && s.startsWith(m)) updates.machineName = machine
  }
  if (denominacionModel) {
    if (String(existingOrder.machineModel ?? "") !== denominacionModel) {
      updates.machineModel = denominacionModel
    }
  } else if (isSameOrTruncated(existingOrder.machineModel, model)) {
    updates.machineModel = model ?? null
  }
  return updates
}



/**
 * Importa a "Pedidos de Repuestos" los repuestos que están en espera según las
 * Órdenes de Reparación de 3C (estado "A la Espera Repuestos" en Mantenimiento).
 *
 * Origen de los repuestos (en este orden):
 *  1. `workItems` del informe "Órdenes de Reparación con Items" (formato
 *     "código — nombre"), cuando 3C lo exporta.
 *  2. Si no hay `workItems` (caso habitual: 3C exporta "Detalle de Órdenes de
 *     Reparación"), se parsean los MOTIVO_ESTADO_REP registrados bajo el estado
 *     "A la Espera Repuestos" (ver parseSparePartsFromMotivo).
 *
 * Es idempotente: NO borra nada existente y NO duplica pedidos que ya existen
 * para la misma (orden + repuesto).
 */
export async function importPendingPartsFromMaintenance(): Promise<{
  created: number
  updated: number
  skippedExisting: number
  /** Repuestos cuyo registro de 3C no tiene fecha válida (requestedAt = null). */
  withoutDate: number
  createdOrders: { orderNumber: string; description: string }[]
}> {
  const existing = await getAllOrders()
  // Mapa (no Set) para poder reconstruir `requestedAt` desde la fecha real de 3C
  // cuando el pedido ya existe con una fecha incorrecta o vacía.
  const seen = new Map<string, SparePartOrder>(
    existing.map((o) => [
      `${normOrderKey(o.orderNumber)}||${o.description.trim().toLowerCase()}`,
      o,
    ]),
  )

  // Cargar órdenes consolidadas de 3C (fuente primaria Redis / Firestore)
  const maintenance = await loadMaintenanceRecords()

  const pendingKinds = /espera.*repuesto|repuesto.*espera|esperando.*repuesto/i

  /** Motivos registrados bajo un estado "A la Espera Repuestos" del registro. */
  const waitingMotivosOf = (rec: MaintenanceRecord): string[] => {
    const entries =
      Array.isArray(rec.motivoByStatus) && rec.motivoByStatus.length > 0
        ? rec.motivoByStatus
        : rec.motivoEstadoRep?.trim()
          ? [{ status: rec.status ?? "", motivo: rec.motivoEstadoRep.trim() }]
          : []
    return [
      ...new Set(
        entries
          .filter((e) => isSpareWaitingStatus(e.status) && e.motivo?.trim())
          .map((e) => e.motivo.trim()),
      ),
    ]
  }

  const awaiting = maintenance.filter(
    (m) =>
      pendingKinds.test(m.status ?? "") ||
      pendingKinds.test(m.statusDescription ?? "") ||
      waitingMotivosOf(m).length > 0,
  )

  const createdOrders: { orderNumber: string; description: string }[] = []
  let skippedExisting = 0
  let updated = 0
  let withoutDate = 0

  // Separa un ítem de trabajo/repuesto de 3C en { code, name }.
  // formato esperado: "1262 — rodamiento 6203" | "KD44221 — FICHA BIPOLAR AZUL"
  const splitItem = (item: string): { code: string; name: string } => {
    const m = String(item ?? "").match(/^\s*([^—–]+?)\s*[—–]\s*(.+)$/)
    if (m) {
      const code = m[1].trim()
      const name = m[2].trim()
      if (code && name) return { code, name }
    }
    return { code: "", name: String(item ?? "").trim() }
  }

  for (const rec of awaiting) {
    // Fecha REAL de 3C del estado "A la Espera Repuestos" (nunca "ahora").
    const waitingDate = resolveWaitingStatusDate(rec)
    if (!waitingDate) withoutDate++
    // Repuestos concretos de 3C: `workItems` ("código — nombre") cuando el
    // informe de items está disponible; si no, los MOTIVO_ESTADO_REP del estado
    // de espera (única fuente real que exporta 3C hoy). NO se usa
    // statusDescription como origen: es un comentario de falla del cliente y
    // producía pedidos basura del tipo "NO FUNCIONA", "PROTECTOR SUELTO...",
    // "MO CES", etc.
    const workItems = (rec.workItems ?? []).filter(Boolean)
    const detected =
      workItems.length > 0
        ? workItems.map(splitItem)
        : waitingMotivosOf(rec).flatMap((motivo) =>
            parseSparePartsFromMotivo(motivo).map((p) => ({ code: p.code ?? "", name: p.description })),
          )

    // Un mismo repuesto puede aparecer repetido en el motivo: se deduplica
    // dentro de la propia orden antes de contar "ya existentes".
    const uniqueParts = new Map<string, { code: string; name: string }>()
    for (const part of detected) {
      const name = String(part.name ?? "").trim()
      if (!name) continue
      const k = name.toLowerCase()
      if (!uniqueParts.has(k)) uniqueParts.set(k, { code: part.code || "", name })
    }

    for (const { code, name } of uniqueParts.values()) {
      const key = `${normOrderKey(rec.orderNumber)}||${name.toLowerCase()}`
      // MODELO: contenido EXACTO de la columna DENOMINACION del Excel de
      // Reparaciones (copiado tal cual). La máquina sigue saliendo de la
      // identificación completa, sin cambios.
      const { machine, model: modelFromIdentification } = splitMachineIdentification(rec.machineName)
      const model = modelFromDenominacion(rec.machineDenominacion) ?? modelFromIdentification
      const previously = seen.get(key)
      if (previously) {
        // El pedido ya existe: se respeta (idempotencia) pero se reconstruye la
        // fecha real de 3C si faltaba o si quedó mal (p. ej. fecha de importación).
        const updates: Record<string, unknown> = {}
        const current = previously.requestedAt
        if (waitingDate && (!current || current.getTime() !== waitingDate.getTime())) {
          updates.requestedAt = waitingDate
        }
        // Completar máquina/modelo cuando 3C había partido la identificación en
        // dos celdas (dato truncado). Solo pedidos auto-importados.
        if (isAutoImportedOrder(previously)) {
          Object.assign(updates, machineFieldsToRefresh(previously, rec.machineName, rec.machineDenominacion))
        }
        if (Object.keys(updates).length > 0) {
          await updateOrderDoc(previously.id, { ...updates, updatedAt: new Date() })
          if (updates.requestedAt) previously.requestedAt = waitingDate
          updated++
        }
        skippedExisting++
        continue
      }

      await createOrder({
        repairId: rec.id ?? rec.orderNumber,
        orderNumber: rec.orderNumber,
        machineId: rec.orderNumber,
        machineName: machine,
        machineModel: model,
        code,
        description: name,
        unit: "unidad",
        quantity: 1,
        requestedAt: waitingDate,
        notes: "Importado desde Órdenes de Reparación (3C): repuesto en espera",
      }, { allowEmptyCode: true })
      seen.set(key, {
        id: "pending",
        repairId: rec.id ?? rec.orderNumber,
        orderNumber: rec.orderNumber,
        machineId: rec.orderNumber,
        machineName: machine,
        machineModel: model,
        code,
        description: name,
        unit: "unidad",
        quantityRequested: 1,
        quantityReceived: 0,
        quantityUsed: 0,
        status: "SOLICITADO",
        requestedAt: waitingDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      createdOrders.push({ orderNumber: rec.orderNumber, description: name })
    }
  }

  return { created: createdOrders.length, updated, skippedExisting, withoutDate, createdOrders }
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
  /^REPARADA\s+LIMPIEZA\b/i,
  /^gastos\s+varios/i,
  /^MO\s+/i,
  /^REVISAR?\s*$/i,
  /^A\s+REVISAR\b/i,
]

/**
 * Patrones de diagnósticos, fallas, síntomas y observaciones que NO son repuestos.
 * Estos textos describen problemas, no piezas/materiales.
 */
const DIAGNOSIS_PATTERNS = [
  /^NO\s+FUNCIONA?\b/i,
  /^NO\s+PERCUTA?\b/i,
  /^NO\s+ENCIENDE?\b/i,
  /^NO\s+ANDA?\b/i,
  /^NO\s+TIENE\s+/i,
  /^NO\s+CARGA?\b/i,
  /^NO\s+SALE?\b/i,
  /^NO\s+SUBE?\b/i,
  /^NO\s+BAJA?\b/i,
  /^FUNCIONA\s+PERO\s+NO\b/i,
  /^ENCIENDE\s+PERO\s+NO\b/i,
  /^HACE\s+(MUCHO\s+)?RUIDO\b/i,
  /^RUIDO\s+RARO/i,
  /^PIERDE\s+/i,
  /^SALE?\s+OLOR\s+A\s+QUEMADO/i,
  /^SALE?\s+HUMO\b/i,
  /^SALE?\s+ACEITE\b/i,
  /^PROBLEMA\s+DE\b/i,
  /^PROBLEMA\s+CON\b/i,
  /^FALTA\s+/i,
  /^ESTA?\s+QUEMAD[OA]/i,
  /^ESTA?\s+ROT[OA]/i,
  /^ESTA?\s+TRABAD[OA]/i,
  /^ESTA?\s+SUELT[OA]/i,
  /^ROTA?\s+/i,
  /^ROTO\s+/i,
  /^TRABAD[OA]\s+/i,
  /^SUELT[OA]\s+/i,
  /^VIBRA\b/i,
  /^CALIENTA\b/i,
  /^SE\s+APAGA\b/i,
  /^SE\s+TRABA\b/i,
  /^SE\s+SALE\b/i,
  /^NO\s+SUJETA\b/i,
  /^NO\s+AJUSTA\b/i,
  /^FLOJ[OA]\b/i,
  /^MAL\s+ESTADO\b/i,
  /^MAL[OA]\s+/i,
  /^ROMPID[OA]\b/i,
  /^CORTAD[OA]\b/i,
  /^CORT[OA]\s+EL?\b/i,
  /^CORTÓ\s+/i,
  /^CORTO\s+/i,
  /^SE\s+CORT[OAÓ]\s+/i,
  /^PERCUTA?\s+MAL\b/i,
  /^PERCUTA?\s+POCO\b/i,
  /^NO\s+PERCUTA?\s+BIEN\b/i,
  /^FUNCIONA\s+PERO\b/i,
  /^ENCIENDE\s+Y\s+ANDA\b/i,
  /^ENCIENDE\s+PERO\b/i,
  /^ANDA\s+PERO\b/i,
  /^ANDA\s+BIEN\b/i,
  /^FUNCIONA\s+BIEN\b/i,
  /^SIN\s+VAINA\b/i,
  /^SIN\s+CABLE\b/i,
  /^SIN\s+PROTECC?ION\b/i,
  /^MO\s+/i,
  /^REVISAR?\s+/i,
  /^REVIS[AO]\s+/i,
  /^REVISADO\s+/i,
  /^A\s+REVISAR\b/i,
  /^PARA\s+REVISAR\b/i,
  /^PENDIENTE\b/i,
  /^SE\s+SACA?\s+/i,
  /^PARA\s+USAR\s+EN\s+ORDEN\b/i,
  /^SE\s+RETIRA?\s+/i,
  /^SE\s+RETIRE\s+/i,
  /^OBSERVACION\b/i,
  /^NOTA\s*:/i,
  /^CLIENTE\b/i,
  /^SEÑOR[OA]?\b/i,
  /^SR[TA]?\.?\s+\w/i,
  /^DON\s+\w/i,
  /^DOÑA\s+\w/i,
]

/**
 * Verifica si un texto es un diagnóstico/falla/síntoma (NO es un repuesto).
 */
function isDiagnosis(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  return DIAGNOSIS_PATTERNS.some((p) => p.test(t))
}

/**
 * Verifica si un texto contiene algún repuesto identificable.
 * Busca palabras clave que indican piezas/materiales concretas.
 */
function containsSparePart(text: string): boolean {
  const t = text.trim().toUpperCase()
  if (!t) return false

  // Si es solo diagnóstico, no contiene repuesto
  if (isDiagnosis(text)) return false

  // Palabras clave que indican repuestos/materiales
  const spareKeywords = [
    "INDUCIDO", "INDUZIDO", "CAMPO", "RODAMIENTO", "VENTILADOR", "CARBON", "CARBONES",
    "ESCOBILLA", "ESCOBILLAS", "EXPANSION", "POLAR", "MEMBRANA", "DIAFRAGMA",
    "BUJE", "DISCO", "FILTRO", "CORREA", "MANGUERA", "CABLE", "FICHA",
    "ENCHUFE", "BOTON", "PULSADOR", "INTERRUPTOR", "LAMPARA", "LED",
    "RESISTENCIA", "CONDENSADOR", "CAPACITOR", "DIODO", "TRANSISTOR",
    "INTEGRADO", "CIRCUITO", "PLACA", "TARJETA", "MOTOR", "BOMBA",
    "COMPRESOR", "CILINDRO", "PISTON", "VALVULA", "RETEN", "SELLO",
    "JUNTA", "TORNILLO", "TUERCA", "ARANDELA", "ARANDALE", "MUELLE", "RESORTE",
    "PERNO", "SEGURO", "ANILLO", "RODILLO", "RUEDA", "ENGRANAJE",
    "BRIDA", "BRIDAS", "FLAUTA", "PLATINA", "COPA", "FIJACION", "FIJACIÓN",
    "CORONA", "CADENA", "CREMALLERA", "BIELA", "MANIJA", "EMPUÑADURA",
    "CARCASA", "CUERPO", "TAPA", "BASE", "SOPORTE", "ABRAZADERA",
    "PROTECTOR", "VAINA", "CUBIERTA", "PROTECCION", "CUBRE",
    "JGO", "JUEGO", "KIT", "SET",
    "ACEITE", "GRASA", "COMBUSTIBLE", "GASOSELNA",
    "PUNTERA", "PUNTA", "BROCA", "MECHA", "HOJA",
    "BANDA", "FAJA",
    "EJE", "EJES", "MAZA", "LLANTA",
    "ASIENTO", "ASIENTOS", "GUÍA", "GUIAS",
    "RETENEDOR", "RETENEDORA",
    "ORING", "O-RING", "O.RING",
    "SILICONA", "SELLADOR", "PEGAMENTO", "ADHESIVO",
    "PORTA", "TRABA", "ENCENDIDO", "NUCLEO", "ALMA", "AGUJA",
    "TANQUE", "REGULADOR", "MEDIDOR", "INDICADOR",
  ]

  // Verificar si contiene alguna palabra clave de repuesto
  return spareKeywords.some((kw) => {
    // Buscar como palabra completa o al inicio/fin de palabra
    const regex = new RegExp(`(^|\\W)${kw}($|\\W)`, "i")
    return regex.test(t)
  })
}

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
    .replace(/\s+REVISAR?\s*$/i, "")
    .replace(/\s+REVISAR?\s+Y\s+/i, "")
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
 * Parsea MOTIVO_ESTADO_REP y extrae ÚNICAMENTE repuestos/materiales concretos.
 * Filtra diagnósticos, fallas, síntomas y observaciones.
 */
/**
 * Quita el prefijo "FALTA" cuando el resto identifica un repuesto concreto
 * ("FALTA FILTRO DE AIRE" -> "FILTRO DE AIRE").
 * También quita el prefijo "REPUESTO(S)" cuando viene seguido de una pieza
 * concreta ("FALTA REPUESTO VAINA PROTECTORA" -> "VAINA PROTECTORA").
 * NO aplica si el resto es genérico ("FALTA DE REPUESTOS" se queda igual).
 */
export function stripFaltaPrefix(text: string): string {
  const t = text.trim()
  const m = t.match(/^falta\s+(de\s+)?(.+)$/i)
  if (!m) return t
  const rest = m[2].trim()
  if (/^repuestos?\b/i.test(rest)) {
    // "FALTA DE REPUESTOS" (genérico) no es un repuesto; pero
    // "FALTA REPUESTO VAINA PROTECTORA" sí lo es: la pieza concreta es lo
    // que sigue a REPUESTO(S).
    const withoutRepuesto = rest.replace(/^repuestos?\s+(?=\S)/i, "").trim()
    if (withoutRepuesto !== rest && containsSparePart(withoutRepuesto)) {
      return withoutRepuesto
    }
    return t
  }
  return containsSparePart(rest) ? rest : t
}

/** División en " Y " cuando ambas mitades identifican repuestos. */
function splitConjunction(segment: string): string[] {
  const halves = segment.split(/\s+[YE]\s+/i)
  if (halves.length < 2) return [segment]
  const out: string[] = []
  for (const h of halves) {
    const t = stripFaltaPrefix(h.trim())
    if (!t) continue
    if (isAdminText(t) || isDiagnosis(t) || isLaborText(t)) {
      // Si una mitad NO es repuesto, no dividir: procesar el segmento entero.
      if (!containsSparePart(stripFaltaPrefix(h.trim()))) return [segment]
      continue
    }
    out.push(t)
  }
  return out.length > 0 ? out : [segment]
}

/**
 * Detecta un código de repuesto "puro" en una línea propia del motivo de 3C.
 *   "1 603 123 032"   → "1603123032"
 *   "F 000 611 090"   → "F000611090"
 *   "1 600 A01 L7D  " → "1600A01L7D"
 *   "Junta torica 4,0X1,0 MM" → null (es una descripción, no un código)
 * Los espacios del código del Excel se normalizan; se conservan las letras y el
 * "1" inicial (parte del código Bosch/3C: "1 609 B03 639" → "1609B03639").
 */
function asSoloCodigo(line: string): string | null {
  const t = line.trim()
  const compact = t.replace(/\s+/g, "")
  if (compact.length < 5 || compact.length > 16) return null
  if (!/^[A-Za-z0-9]+$/.test(compact)) return null
  if (!/\d/.test(compact)) return null
  const tokens = t.split(/\s+/)
  if (tokens.length > 4) return null
  // Palabras reales ("Juego", "Escobillas", "Expansion") → es texto, no código
  if (tokens.some((tok) => /^[A-Za-z]{4,}$/.test(tok))) return null
  return compact.toUpperCase()
}

/** ¿Este token es un código de repuesto de 3C (no una medida ni una palabra)? */
function isCodeToken(token: string): boolean {
  const t = token.replace(/^[("'[]+/, "").replace(/[)"'\],;:.]+$/, "")
  if (t.length < 4 || t.length > 16) return false
  if (!/^[A-Za-z0-9][A-Za-z0-9\-./]*$/.test(t)) return false
  if (!/\d/.test(t)) return false
  if (/^[A-Za-z]+$/.test(t)) return false
  // Medidas/especificaciones ("220-240V") → NO son códigos
  if (/^\d{1,3}([.,-]\d{1,3})+[A-Za-z]?$/.test(t)) return false
  if (/[A-Za-z]/.test(t) || /[-./]/.test(t)) return true
  return t.length >= 8
}

/**
 * Separa descripción y código DENTRO de una línea, sin cruzar códigos entre
 * repuestos (el código pertenece EXCLUSIVAMENTE al repuesto de esa línea).
 *   "JUEGO DE CARBONES 160432115T"        → "JUEGO DE CARBONES"     + 160432115T
 *   "R99939910 ORING 13 p/9993931"        → "ORING 13 p/9993931"    + R99939910
 *   "inducido 1619P15184 ( VENTILADOR )"  → "inducido (VENTILADOR)" + 1619P15184
 */
function splitDescriptionAndCode(line: string): { code: string | null; description: string } {
  const tokens = line.split(/\s+/)
  const idxs: number[] = []
  tokens.forEach((tok, i) => {
    if (isCodeToken(tok)) idxs.push(i)
  })
  if (idxs.length === 0) return { code: null, description: line.trim() }
  const i = idxs[0]
  const code = tokens[i].replace(/^[("'[]+/, "").replace(/[)"'\],;:.]+$/, "").toUpperCase()
  const before = tokens.slice(0, i).join(" ").trim()
  const after = tokens.slice(i + 1).join(" ").trim()
  const nota = after.match(/^\(\s*([^)]+?)\s*\)$/)
  if (before) return { code, description: nota ? `${before} (${nota[1]})` : before }
  return { code, description: after }
}

/**
/**
 * Limpia la descripción de un repuesto de 3C sin inventar datos:
 * referencias de máquina ("p/9993896"), cantidades iniciales ("92 JGO..."),
 * prefijos ("FALTA ", "se cambia...") y puntuación sobrante.
 */
function cleanPartDescription(raw: string): string {
  let d = String(raw ?? "").replace(/\t/g, " ").replace(/\s+/g, " ").trim()
  if (!d) return ""
  d = d.replace(/\s+p\/\s*[A-Za-z0-9\-.]+$/i, "").trim()
  d = d.replace(/^\d{1,4}\s+(?=[A-Za-zÁÉÍÓÚÑ])/, "").trim()
  d = stripFaltaPrefix(d)
  d = cleanDescription(d)
  d = d.replace(/[.,;:\-\s]+$/, "").trim()
  return d.toUpperCase()
}

/**
 * PARSER REAL de MOTIVO_ESTADO_REP (celda de 3C con saltos de línea):
 *
 *   JUEGO DE CARBONES 160432115T   → repuesto + código en la MISMA línea
 *   Perno De Fijacion              → repuesto...
 *   1 603 123 032                  → ...y su código en la línea SIGUIENTE
 *
 * - Un código solo se asigna al repuesto al que pertenece (el que lo precede).
 * - Varios repuestos dentro de la misma celda se detectan uno por uno.
 * - Sin código propio → code = null (NUNCA "S/C" ni el código de otro repuesto).
 * - Se descartan diagnósticos, fallas, observaciones y mano de obra.
 * - OBSERVACIONES nunca es fuente: la fuente es MOTIVO_ESTADO_REP.
 */
export function parseSparePartsFromMotivoDetailed(motivo: string): { code: string | null; description: string }[] {
  if (!motivo || isAdminText(motivo) || isLaborText(motivo)) return []

  const out: { code: string | null; description: string }[] = []
  const seen = new Set<string>()
  const push = (code: string | null, description: string): void => {
    const d = cleanPartDescription(description)
    if (!d) return
    if (isLaborText(d) || isAdminText(d) || isDiagnosis(d)) return
    const c = code && !isInternalCode(code) ? code.toUpperCase().replace(/\s+/g, "") : null
    // Regla GENERAL: un repuesto que trae su PROPIO código de 3C es un repuesto
    // válido aunque su nombre no figure en la lista de palabras clave (ej.:
    // "BRIDA DE FIJACIÓN" + "2 605 703 014" en la línea siguiente). El filtro
    // por palabra clave aplica solo a descripciones SIN código, donde el
    // nombre es la única señal disponible.
    if (!c && !containsSparePart(d)) return
    const key = `${c ?? ""}||${d.toUpperCase().replace(/\s+/g, " ")}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ code: c, description: d })
  }

  // Descripción que aún no encontró su código.
  let pending: string | null = null
  const flushPendiente = (): void => {
    if (!pending) return
    const desc = pending
    pending = null
    // Sin código propio: se emite la descripción sin código (nunca se le copia
    // el código de otro repuesto).
    for (const parte of splitAndParse(desc)) push(parte.code, parte.description)
  }

  for (const rawLine of cleanLine(motivo)) {
    const line = rawLine.replace(/\t/g, " ").replace(/\s+/g, " ").trim()
    if (!line) continue
    if (isAdminText(line) || isLaborText(line)) {
      flushPendiente()
      continue
    }

    // Caso 2: el código viene en su PROPIA línea, después del repuesto.
    const soloCodigo = asSoloCodigo(line)
    if (soloCodigo) {
      const desc = pending
      pending = null
      if (desc) push(soloCodigo, desc)
      continue
    }

    // Caso 1: repuesto y código en la MISMA línea.
    const inline = splitDescriptionAndCode(line)
    if (inline.code) {
      flushPendiente()
      push(inline.code, inline.description)
      continue
    }

    // Línea de descripción: queda pendiente por si la siguiente trae su código.
    flushPendiente()
    pending = line
  }
  flushPendiente()

  return out
}

/**
 * Repuestos de un MOTIVO_ESTADO_REP de 3C (implementación única).
 * Se mantiene este nombre por compatibilidad: importador, reconciliador y
 * cleanup usan EXACTAMENTE el mismo parser (antes divergían y se borraban
 * pedidos válidos).
 */
export function parseSparePartsFromMotivo(motivo: string): { code: string | null; description: string }[] {
  return parseSparePartsFromMotivoDetailed(motivo)
}

/**
 * Implementación ANTERIOR del parser (línea a línea con splitAndParse).
 * Se conserva para comparar/diagnosticar resultados históricos; ya NO se usa
 * en el flujo de importación.
 */
export function parseSparePartsFromMotivoLegacy(motivo: string): { code: string | null; description: string }[] {
  if (!motivo || isAdminText(motivo) || isLaborText(motivo)) return []

  const lines = cleanLine(motivo)
  if (lines.length === 0) return []

  const parts: { code: string | null; description: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Si la línea contiene puntos (.), dividir en frases y procesar cada una
    if (line.includes(".")) {
      const sentences = line.split(/\.\s*/)
      for (const sentence of sentences) {
        const trimmed = sentence.trim()
        if (!trimmed || isAdminText(trimmed) || isLaborText(trimmed)) continue

        // splitAndParse maneja: conjunciones ("Y"/"e"), prefijo "FALTA ",
        // delimitadores, códigos inline y filtros de diagnóstico.
        parts.push(...splitAndParse(trimmed))
      }
      continue
    }

    // La línea completa también pasa por splitAndParse (conjunciones,
    // "FALTA ", códigos inline, etc.)
    parts.push(...splitAndParse(line))
  }

  // Eliminar duplicados por descripción normalizada y aplicar reglas de
  // mano de obra / códigos internos (nunca son repuestos ni códigos de repuesto).
  const seen = new Set<string>()
  return parts
    .filter((p) => !isLaborText(p.description))
    .map((p) => ({ code: p.code && !isInternalCode(p.code) ? p.code : null, description: p.description }))
    .filter((p) => {
      const key = `${p.code || ""}||${p.description.toUpperCase().replace(/\s+/g, " ")}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * Divide un texto por delimitadores comunes (-, ;, ,) y procesa cada parte
 * para extraer repuestos individuales.
 */
function splitAndParse(text: string): { code: string | null; description: string }[] {
  const parts: { code: string | null; description: string }[] = []

  // Dividir por delimitadores comunes. El guión separa solo cuando está
  // rodeado de espacios ("Perno - Junta"): así NO se rompen referencias de 3C
  // como "210042-8" o "220-240V", que son parte del código de la pieza.
  const segments = text.split(/\s*[;,]\s*|\s+-\s+/)

  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    // Separar conjunciones entre piezas: "INDUCIDO Y PUNTERA DE PROTECCION"
    // o "campo e inducido". También quita prefijo "FALTA " ("FALTA FILTRO DE AIRE").
    for (const piece of splitConjunction(trimmed)) {
      const pieceTrimmed = piece.trim()
      if (!pieceTrimmed) continue
      // Quitar "FALTA " antes de clasificar: "FALTA FILTRO DE AIRE" es un
      // repuesto (FILTRO DE AIRE), no un diagnóstico.
      const candidate = stripFaltaPrefix(pieceTrimmed)
      if (!candidate || isAdminText(candidate) || isDiagnosis(candidate) || isLaborText(candidate)) continue
      if (!containsSparePart(candidate)) continue

      // Intentar extraer código y descripción
      const inlineCode = pieceTrimmed.match(/^(.+?)\s+([A-Z]?\d{4,}[A-Z0-9]*)(?:\s*\(([^)]+)\))?$/i)
      if (inlineCode && inlineCode[2] && inlineCode[2].length >= 4) {
        const descPart = inlineCode[3] ? `${inlineCode[1].trim()} (${inlineCode[3]})` : inlineCode[1].trim()
        if (looksLikeCode(inlineCode[2]) && containsSparePart(descPart)) {
          parts.push({ code: inlineCode[2].toUpperCase(), description: descPart })
          continue
        }
      }

      // Descripción sin código
      const cleaned = cleanDescription(candidate)
      if (cleaned && containsSparePart(cleaned) && !isDiagnosis(cleaned)) {
        parts.push({ code: null, description: cleaned })
      }
    }
  }

  return parts
}

/**
 * Reconcilia Pedidos Rep. auto-importados: elimina los que NO provienen
 * del estado "A la Espera Repuestos". Solo toca registros con la marca de
 * importación automática en notes. Los pedidos manuales no se tocan.
 */
export async function reconcileSpareOrdersFromWaitingStatus(): Promise<{
  deleted: number
  deletedOrders: { orderNumber: string; code: string; description: string }[]
}> {
  const { loadMaintenanceRecords } = await import("@/lib/local-sync")
  const maintenance = await loadMaintenanceRecords()
  const existing = await getAllOrders()

  const validKeys = new Set<string>()
  const orderHasWaiting = new Map<string, boolean>()
  for (const record of maintenance) {
    const rec = record as MaintenanceRecord & {
      motivoByStatus?: { status: string; motivo: string }[]
    }
    const ok = normOrderKey(rec.orderNumber)
    const entries = Array.isArray(rec.motivoByStatus)
      ? rec.motivoByStatus
      : []
    const waiting = entries.filter(
      (e) => isSpareWaitingStatus(e.status) && e.motivo?.trim(),
    )
    if (waiting.length > 0) orderHasWaiting.set(ok, true)
    else if (!orderHasWaiting.has(ok)) orderHasWaiting.set(ok, false)
    for (const e of waiting) {
      const parts = parseSparePartsFromMotivo(e.motivo.trim())
      for (const p of parts) {
        const c = p.code ? p.code.toUpperCase().replace(/\s+/g, " ") : ""
        const d = p.description.trim().toLowerCase()
        // Se validan AMBAS claves: por descripción (siempre) y por código
        // (cuando el parseo lo detectó). Así un pedido existente con código de
        // 3C no se borra solo porque esta corrida no volvió a extraer el código.
        validKeys.add(`${ok}||${d}`)
        if (c) validKeys.add(`${ok}||${c}`)
      }
    }
  }

  const deletedOrders: { orderNumber: string; code: string; description: string }[] = []
  let deleted = 0
  for (const o of existing) {
    const notes = String(o.notes ?? "")
    const auto =
      notes.includes("Importado desde") &&
      (notes.includes("MOTIVO_ESTADO_REP") || notes.includes("repuesto en espera"))
    if (!auto) continue
    const ok = normOrderKey(o.orderNumber)
    // Solo reconciliar órdenes de las que CONOCEMOS sus estados de 3C
    // (motivoByStatus). Si no hay datos de estados, no tocar la orden.
    const rec = maintenance.find(
      (r) => normOrderKey(r.orderNumber) === ok,
    ) as (MaintenanceRecord & { motivoByStatus?: { status: string; motivo: string }[] }) | undefined
    const known = Array.isArray(rec?.motivoByStatus) && (rec?.motivoByStatus?.length ?? 0) > 0
    if (!known) continue
    const codeN = o.code ? o.code.toUpperCase().replace(/\s+/g, " ") : ""
    const descN = String(o.description ?? "").trim().toLowerCase()
    // Clave con la que se reconoce el pedido (código si lo tiene, si no la
    // descripción) y clave por descripción. Se comparan AMBAS para no borrar un
    // pedido válido cuando esta corrida no volvió a extraer el código de 3C.
    const keyByCode = codeN ? `${ok}||${codeN}` : `${ok}||${descN}`
    const keyByDesc = `${ok}||${descN}`
    // Eliminar si: no fue revalidado como repuesto válido de un estado
    // "A la Espera Repuestos", O la orden ya no tiene ningún estado de espera.
    if ((validKeys.has(keyByDesc) || validKeys.has(keyByCode)) && orderHasWaiting.get(ok) === true) continue
    try {
      await deleteOrders([o.id])
      deleted++
      deletedOrders.push({ orderNumber: o.orderNumber, code: o.code, description: o.description })
    } catch {
      // No frenar por un documento puntual.
    }
  }
  return { deleted, deletedOrders }
}

/**
 * Limpia Pedidos Rep. auto-importados inválidos que NO son repuestos reales.
 *
 * Regla (alineada al flujo de 3C):
 * - SOLO procesa pedidos con la marca de importación automática (notes
 *   contiene "Importado desde"). Los pedidos manuales NO se tocan.
 * - CONSERVA un pedido si tiene código de repuesto REAL (no vacío/S/C, no
 *   interno de mano de obra como "1012") y su descripción es un repuesto
 *   concreto (no falla/diagnóstico/observación/mano de obra).
 * - ELIMINA si:
 *     a) código vacío o "S/C", o
 *     b) código interno de mano de obra ("1012", ej.), o
 *     c) la descripción es falla/diagnóstico/mano de obra/observación.
 *
 * NO borra datos de maintenance/Reparaciones ni pedidos manuales.
 */
export async function cleanupInvalidSpareOrders(): Promise<{
  deleted: number
  kept: number
  deletedOrders: { orderNumber: string; code: string; description: string }[]
}> {
  const existing = await getAllOrders()
  const deletedOrders: { orderNumber: string; code: string; description: string }[] = []
  let deleted = 0
  let kept = 0

  for (const o of existing) {
    const notes = String(o.notes ?? "")
    const auto = notes.includes("Importado desde")
    if (!auto) {
      kept++ // manual: nunca se toca
      continue
    }

    const code = String(o.code ?? "").trim()
    const desc = String(o.description ?? "").trim()

    // Un repuesto real de 3C puede NO tener código propio (el código se guarda
    // vacío, NUNCA "S/C") y su descripción debe ser una pieza concreta (no
    // falla/diagnóstico/MO/observación). Solo el código INTERNO de mano de obra
    // (ej: "1012") o una descripción que no es repuesto invalidan el pedido.
    const internalLaborCode = code !== "" && code.toUpperCase() !== "S/C" && isInternalCode(code) // ej: "1012"
    // Código PROPIO de repuesto de 3C (no interno de mano de obra): es prueba
    // suficiente de que el pedido es un repuesto válido, aunque su nombre no
    // figure en la lista de palabras clave. Mismo criterio que
    // parseSparePartsFromMotivoDetailed(), para que el parser y la limpieza no
    // se contradigan (uno lo crea y el otro lo borra).
    const ownPartCode = code !== "" && code.toUpperCase() !== "S/C" && !isInternalCode(code)
    const badDesc =
      isLaborText(desc) ||
      isAdminText(desc) ||
      isDiagnosis(desc) ||
      (!ownPartCode && !containsSparePart(desc))

    const invalid = internalLaborCode || badDesc

    if (invalid) {
      try {
        await deleteOrders([o.id])
        deleted++
        deletedOrders.push({ orderNumber: o.orderNumber, code, description: desc })
      } catch {
        // no frenar por un documento puntual
      }
    } else {
      kept++
    }
  }

  return { deleted, kept, deletedOrders }
}
/**
 * Compatibilidad: importa los repuestos en espera cargando los registros de
 * mantenimiento de la fuente primaria (Redis/Excel). El agente usa
 * importSparePartsFromRecords() con los registros que ya tiene en memoria.
 */
export async function importSparePartsFromRepairMotivo(): Promise<{
  created: number
  updated: number
  skippedAdmin: number
  createdOrders: { orderNumber: string; code: string | null; description: string }[]
}> {
  const { loadMaintenanceRecords } = await import("@/lib/local-sync")
  const maintenance = await loadMaintenanceRecords()
  return importSparePartsFromRecords(maintenance)
}

/**
 * Importa repuestos desde los motivos del estado "A la Espera Repuestos"
 * hacia "Pedidos Rep." (spare_part_orders), a partir de los registros de
 * mantenimiento que ya tiene el llamador (sin fetch relativo).
 *
 * REGLA 3C: solo los registros cuyo ESTADO sea "A la Espera Repuestos"
 * generan pedidos. Los motivos de otros estados quedan en el historial.
 *
 * Lógica:
 * - Recibe los MaintenanceRecords ya cargados por el llamador (fuente primaria
 *   Redis): el agente pasa el consolidado que acaba de escribir.
 * - Usa motivoByStatus (ESTADO_REPARA_TXT + MOTIVO_ESTADO_REP por registro)
 * - Parsea cada motivo del estado de espera para identificar repuestos
 * - Crea/actualiza spare_part_orders por cada repuesto detectado
 * - Es idempotente: no duplica si ya existe (orden + código/descripción)
 */
export async function importSparePartsFromRecords(records: MaintenanceRecord[]): Promise<{
  created: number
  updated: number
  skippedAdmin: number
  createdOrders: { orderNumber: string; code: string | null; description: string }[]
}> {
  // Los registros llegan del propio agente (misma fuente primaria Redis), sin
  // fetch relativo: esa ruta falla cuando el proceso corre en Node (agente).
  const maintenance = records

  const existing = await getAllOrders()
  const seen = new Map<string, SparePartOrder>()
  for (const o of existing) {
    // La clave debe normalizarse IGUAL que la consulta de abajo (código en
    // MAYÚSCULAS sin espacios / descripción en minúsculas). Si no coincide, el
    // mismo repuesto se importa dos veces y se duplican los pedidos.
    const codeN = o.code ? o.code.toUpperCase().replace(/\s+/g, " ") : ""
    const key = codeN
      ? `${normOrderKey(o.orderNumber)}||${codeN}`
      : `${normOrderKey(o.orderNumber)}||${String(o.description ?? "").trim().toLowerCase()}`
    seen.set(key, o)
  }

  const createdOrders: { orderNumber: string; code: string | null; description: string }[] = []
  let updated = 0
  let skippedAdmin = 0

  for (const record of maintenance) {
    const rec = record as MaintenanceRecord & {
      motivoByStatus?: { status: string; motivo: string }[]
    }
    // Solo los motivos del estado "A la Espera Repuestos" generan pedidos.
    const entries = Array.isArray(rec.motivoByStatus) && rec.motivoByStatus.length > 0
      ? rec.motivoByStatus
      : rec.motivoEstadoRep?.trim()
        ? [{ status: rec.status ?? "", motivo: rec.motivoEstadoRep.trim() }]
        : []
    const waitingMotivos = [
      ...new Set(
        entries
          .filter((e) => isSpareWaitingStatus(e.status) && e.motivo?.trim())
          .map((e) => e.motivo.trim()),
      ),
    ]
    if (waitingMotivos.length === 0) continue

    // Fecha REAL de 3C del estado "A la Espera Repuestos" (nunca "ahora").
    const waitingDate = resolveWaitingStatusDate(rec)

    for (const motivo of waitingMotivos) {

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

      const dedupKey = codeNorm
        ? `${normOrderKey(rec.orderNumber)}||${codeNorm}`
        : `${normOrderKey(rec.orderNumber)}||${descNorm}`

      const existingOrder = seen.get(dedupKey)
      if (existingOrder) {
        // Actualizar existente si cambió algo relevante
        const updates: Record<string, unknown> = {}
        // Reconstruir la fecha real de 3C si faltaba o quedó mal (p. ej. fecha de importación).
        const currentDate = existingOrder.requestedAt
        if (waitingDate && (!currentDate || currentDate.getTime() !== waitingDate.getTime())) {
          updates.requestedAt = waitingDate
        }
        if (!existingOrder.notes || !existingOrder.notes.includes(motivo)) {
          updates.notes = existingOrder.notes
            ? `${existingOrder.notes}\n---\nMOTIVO_ESTADO_REP: ${motivo}`
            : `MOTIVO_ESTADO_REP: ${motivo}`
        }
        // Completar máquina/modelo cuando 3C había partido la identificación en
        // dos celdas (dato truncado). Solo pedidos auto-importados.
        if (isAutoImportedOrder(existingOrder)) {
          Object.assign(updates, machineFieldsToRefresh(existingOrder, rec.machineName, rec.machineDenominacion))
        }
        if (Object.keys(updates).length > 0) {
          await updateOrderDoc(existingOrder.id, { ...updates, updatedAt: new Date() })
          updated++
        }
        continue
      }

      // Crear nuevo pedido
      // MODELO: contenido EXACTO de la columna DENOMINACION del Excel de
      // Reparaciones (copiado tal cual, con su prefijo "REPARACION: ").
      const { machine, model: modelFromIdentification } = splitMachineIdentification(rec.machineName)
      const model = modelFromDenominacion(rec.machineDenominacion) ?? modelFromIdentification
      await createOrder({
        repairId: rec.id ?? rec.orderNumber,
        orderNumber: rec.orderNumber,
        machineId: rec.orderNumber,
        machineName: machine,
        machineModel: model,
        code: part.code ?? "",
        description: part.description,
        unit: "unidad",
        quantity: 1,
        // REGLA: fecha real de 3C del estado "A la Espera Repuestos" (nunca "ahora").
        requestedAt: waitingDate,
        notes: `Importado desde Órdenes de Reparación (3C): repuesto en espera\nOrden: ${rec.orderNumber}\nCliente: ${rec.clientName}\nEstado: ${rec.status}\n---\nMOTIVO original: ${motivo}`,
      }, { allowEmptyCode: true })

      seen.set(dedupKey, {
        id: "pending",
        repairId: rec.id ?? rec.orderNumber,
        orderNumber: rec.orderNumber,
        machineId: rec.orderNumber,
        machineName: machine,
        machineModel: model,
        code: part.code ?? "",
        description: part.description,
        unit: "unidad",
        quantityRequested: 1,
        quantityReceived: 0,
        quantityUsed: 0,
        status: "SOLICITADO",
        requestedAt: waitingDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      createdOrders.push({
        orderNumber: rec.orderNumber,
        code: part.code,
        description: part.description,
      })
    }
    }
  }

  return { created: createdOrders.length, updated, skippedAdmin, createdOrders }
}
