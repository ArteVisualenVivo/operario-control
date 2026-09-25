import {
  collection, addDoc, getDocs, getDoc, doc, updateDoc, deleteDoc, query, where, orderBy, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { LOCAL_MODE } from "@/lib/runtimeMode"
import { loadMaintenanceRecords } from "@/lib/local-sync"
import { createAuditLog } from "./audit"
import { restockPart, usePart as consumePart } from "./spareParts"
import type { SparePartOrder, SparePartOrderDatesInput, CreateSparePartOrderInput, SparePartOrderStatus, MarkOrderedInput } from "@/types"
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
    ownerRequestedAt: toDate(d.ownerRequestedAt) ?? undefined,
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
// - NODE (agente local, sin sesión): el llamador (agente/API routes) usa el
//   puente `sparePartOrderStore.server.ts` con el Admin SDK y la service
//   account de sync-agent/service-account.json. Este módulo cliente NUNCA
//   importa ese puente (ni siquiera vía import dinámico: Turbopack lo bundlearía).
// ============================================================================

/**
 * Forma del Admin SDK que usa este módulo. Es SOLO un tipo: TypeScript lo borra
 * al compilar, así que no agrega nada al bundle del navegador.
 */
interface AdminFirestoreLike {
  collection: (name: string) => {
    get: () => Promise<{ docs: { id: string; data: () => Record<string, unknown> }[] }>
    add: (data: Record<string, unknown>) => Promise<{ id: string }>
    doc: (id: string) => {
      update: (data: Record<string, unknown>) => Promise<unknown>
      get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>
      delete: () => Promise<unknown>
    }
  }
}

/** Escritura que Firestore rechazó (cuota/permisos) y quedó encolada en disco. */
export interface PendingOrderOp {
  id: string
  op: "upsert" | "delete"
  data?: Record<string, unknown>
  queuedAt: number
}

/**
 * Backend SERVIDOR de este módulo: Admin SDK de Firestore + cola y caché en
 * disco (fs). Lo provee el puente server-only `sparePartOrderStore.server.ts`.
 *
 * REGLA DE ARQUITECTURA: este módulo es ISOMORFO (lo importan páginas cliente),
 * así que NO puede importar fs/path/firebase-admin ni siquiera con `import()`
 * dinámico: Turbopack resuelve los especificadores literales de forma ESTÁTICA y
 * los incluiría en el bundle del navegador → "Can't resolve 'fs'". Por eso el
 * backend NO se importa: se INYECTA desde Node (ver
 * `registerSparePartOrdersServerStore`).
 */
export interface SparePartOrdersServerStore {
  getAdminDb: () => Promise<AdminFirestoreLike | null>
  readPendingOps: () => Promise<PendingOrderOp[]>
  removePendingOps: (ids: string[]) => Promise<void>
  queuePendingOp: (op: PendingOrderOp) => Promise<void>
  readCachedOrders: () => Promise<Record<string, unknown>[] | null>
  writeCachedOrders: (rows: Record<string, unknown>[]) => Promise<boolean>
}

let serverStore: SparePartOrdersServerStore | null = null

/**
 * Instala el backend servidor (Admin SDK + disco). La llama el agente local al
 * arrancar, que SÍ corre en Node. En el navegador nunca se llama → `serverStore`
 * queda null y todas las rutas siguen usando el client SDK (comportamiento
 * actual de la web).
 */
export function registerSparePartOrdersServerStore(store: SparePartOrdersServerStore): void {
  serverStore = store
}

/** Admin SDK de Firestore cuando corremos en Node; null en el navegador. */
async function getAdminDb(): Promise<AdminFirestoreLike | null> {
  if (typeof window !== "undefined") return null
  if (!serverStore) return null
  return serverStore.getAdminDb()
}

/**
 * Registra una escritura que Firestore rechazó (cuota/permisos) en la cola local.
 * El cambio NO se pierde: se refleja en el snapshot que muestra la web y se
 * reintenta cuando la cuota vuelva (ver flushPendingOrderWrites).
 *
 * La cola vive en disco (orderStore), que solo existe en Node: se accede por el
 * backend inyectado para no meter fs en el bundle del navegador.
 */
async function queueOfflineOp(
  op: "upsert" | "delete",
  id: string,
  data: Record<string, unknown> | undefined,
  err: unknown,
): Promise<void> {
  console.error(
    `[sparePartOrders] Escritura encolada (${op} ${id}) por Firestore no disponible:`,
    err instanceof Error ? err.message : err,
  )
  try {
    await serverStore?.queuePendingOp({ id, op, data, queuedAt: Date.now() })
  } catch {
    // sin cola local disponible: el snapshot en Redis igual refleja el cambio
  }
}

/** Actualiza un pedido existente (client SDK en el navegador, Admin en Node). */
async function updateOrderDoc(id: string, updates: Record<string, unknown>): Promise<void> {
  const admin = await getAdminDb()
  if (admin) {
    try {
      await admin.collection(COLLECTION).doc(id).update(updates)
      return
    } catch (err) {
      // Cuota agotada en el agente: se encola y el cambio se ve en la web.
      await queueOfflineOp("upsert", id, updates, err)
      return
    }
  }
  await updateDoc(doc(db, COLLECTION, id), updates)
}

/** id sintético para un alta que Firestore rechazó (se reemplaza al reintentar). */
function offlineOrderId(input: CreateSparePartOrderInput): string {
  const code = String(input.code ?? "").trim() || String(input.description ?? "").trim()
  return `local:${normOrderKey(input.orderNumber)}|${code}`
}

/**
 * Aplica en Firestore la cola de escrituras pendientes (cuando la cuota volvió).
 * Se llama desde el agente después de publicar el snapshot.
 *
 * La cola vive en disco (orderStore): solo Node puede leerla/escribirla, por eso
 * se accede por el backend inyectado. En el navegador es un no-op.
 */
export async function flushPendingOrderWrites(): Promise<{ applied: number; remaining: number }> {
  if (typeof window !== "undefined") return { applied: 0, remaining: 0 }
  if (!serverStore) return { applied: 0, remaining: 0 }
  const pending = await serverStore.readPendingOps()
  if (pending.length === 0) return { applied: 0, remaining: 0 }
  const admin = await getAdminDb()
  if (!admin) return { applied: 0, remaining: pending.length }

  const applied: string[] = []
  let remaining = 0
  for (const op of pending) {
    try {
      if (op.op === "delete") {
        remaining++
        continue // las bajas se resuelven con el próximo reconcile
      }
      if (!op.data) continue
      if (op.id.startsWith("local:")) {
        // Alta pendiente (creada sin cuota): se materializa como documento
        // nuevo en Firestore con los mismos datos.
        await admin.collection(COLLECTION).add(op.data)
      } else {
        await admin.collection(COLLECTION).doc(op.id).update(op.data)
      }
      applied.push(op.id)
    } catch {
      remaining++
    }
  }
  if (applied.length > 0) await serverStore.removePendingOps(applied)
  return { applied: applied.length, remaining }
}

/**
 * Lee los pedidos desde FIRESTORE y, si la cuota está agotada, cae a las FUENTES
 * LOCALES que reflejan el mismo estado: snapshot de Redis → caché en disco.
 *
 * Devuelve null cuando NINGUNA fuente está disponible ("estado desconocido"): en
 * ese caso las rutas de importación se abortan en lugar de crear duplicados.
 */
async function getAllOrdersFromFirestore(): Promise<SparePartOrder[] | null> {
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
          "[sparePartOrders] Firestore no disponible (cuota/permisos):",
          adminErr instanceof Error ? adminErr.message : adminErr,
        )
      }
    }
    if (LOCAL_MODE) return []
    // —— RESILIENCIA: fuentes locales (misma foto que Firestore) ——
    const fallback = await loadOrdersFromLocalSources()
    if (fallback) {
      console.error(
        `[sparePartOrders] Se usa la fuente local (${fallback.length} pedidos) porque Firestore no respondió.`,
      )
      return fallback
    }
    console.error("[sparePartOrders] Sin fuentes disponibles:", err instanceof Error ? err.message : err)
    return null
  }
}

/** Snapshot de Redis → caché en disco. null si ninguna de las dos tiene datos. */
async function loadOrdersFromLocalSources(): Promise<SparePartOrder[] | null> {
  if (typeof window !== "undefined") return null
  try {
    // redisPrimary es JS puro (@upstash/redis por REST): NO usa fs.
    const { readModuleData, getRedis } = await import("@/lib/sync-3c/redisPrimary")
    const env = await readModuleData("spare_part_orders", getRedis())
    if (env && Array.isArray(env.data) && env.data.length > 0) {
      return (env.data as Record<string, unknown>[]).map(rawToOrder)
    }
  } catch {
    // sigue con el caché en disco
  }
  try {
    const rows = await serverStore?.readCachedOrders()
    if (rows && rows.length > 0) return rows.map(rawToOrder)
  } catch {
    // sin fuentes locales
  }
  return null
}

/** Pedidos conocidos (Firestore → local). [] cuando no hay ninguna fuente. */
async function getAllOrdersKnown(): Promise<SparePartOrder[]> {
  return (await getAllOrdersFromFirestore()) ?? []
}

/**
 * Convierte un registro crudo del snapshot de Redis (fechas ISO) a SparePartOrder.
 * Misma forma de documento que docToOrder(), sin Timestamp de Firestore.
 */
function rawToOrder(raw: Record<string, unknown>): SparePartOrder {
  return {
    id: String(raw.id ?? ""),
    repairId: (raw.repairId as string) ?? "",
    orderNumber: (raw.orderNumber as string) ?? "",
    machineId: (raw.machineId as string) ?? "",
    machineName: (raw.machineName as string) ?? "",
    machineModel: (raw.machineModel as string | null | undefined) ?? null,
    sparePartId: (raw.sparePartId as string) || undefined,
    code: (raw.code as string) ?? "",
    description: (raw.description as string) ?? "",
    unit: (raw.unit as string) ?? "unidad",
    quantityRequested: (raw.quantityRequested as number) ?? 0,
    quantityReceived: (raw.quantityReceived as number) ?? 0,
    quantityUsed: (raw.quantityUsed as number) ?? 0,
    status: (raw.status as SparePartOrderStatus) ?? "SOLICITADO",
    supplier: (raw.supplier as string) || undefined,
    requestedAt: toDate(raw.requestedAt),
    ownerRequestedAt: toDate(raw.ownerRequestedAt) ?? undefined,
    orderedAt: toDate(raw.orderedAt) ?? undefined,
    expectedAt: toDate(raw.expectedAt) ?? undefined,
    receivedAt: toDate(raw.receivedAt) ?? undefined,
    usedAt: toDate(raw.usedAt) ?? undefined,
    notes: (raw.notes as string) || undefined,
    createdAt: toDate(raw.createdAt) ?? new Date(),
    updatedAt: toDate(raw.updatedAt) ?? new Date(),
  }
}

/** Serializa un pedido para el snapshot de Redis (fechas ISO, sin Timestamps). */
function orderToPlain(order: SparePartOrder): Record<string, unknown> {
  const iso = (d?: Date | null): string | null => (d instanceof Date ? d.toISOString() : null)
  return {
    id: order.id,
    repairId: order.repairId,
    orderNumber: order.orderNumber,
    machineId: order.machineId,
    machineName: order.machineName,
    machineModel: order.machineModel ?? null,
    sparePartId: order.sparePartId ?? null,
    code: order.code,
    description: order.description,
    unit: order.unit,
    quantityRequested: order.quantityRequested,
    quantityReceived: order.quantityReceived,
    quantityUsed: order.quantityUsed,
    status: order.status,
    supplier: order.supplier ?? null,
    requestedAt: iso(order.requestedAt),
    ownerRequestedAt: iso(order.ownerRequestedAt),
    orderedAt: iso(order.orderedAt),
    expectedAt: iso(order.expectedAt),
    receivedAt: iso(order.receivedAt),
    usedAt: iso(order.usedAt),
    notes: order.notes ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  }
}

/**
 * Invalida el snapshot de Pedidos Rep. en Redis tras una mutación manual de la
 * web (encargar, borrar, casa de repuesto, notas), para que la pantalla no siga
 * mostrando el snapshot anterior. Mismo criterio que REGLA 22 (stock).
 */
async function invalidatePrimarySparePartOrders(): Promise<void> {
  if (typeof window === "undefined") return
  try {
    await fetch(`/api/sync-3c/data/spare_part_orders`, { method: "DELETE", cache: "no-store" })
  } catch {
    // Si falla, la próxima sincronización repone el snapshot.
  }
}

/**
 * Publica el snapshot de Pedidos Rep. en Redis desde la WEB (tras una
 * importación o refresco manual), para que la pantalla siga leyendo de la fuente
 * primaria y no dependa de la cuota de Firestore. Nunca interrumpe el flujo: si
 * falla, la próxima sincronización del agente lo repone.
 */
async function publishSnapshotFromBrowser(): Promise<number> {
  if (typeof window === "undefined") return 0
  try {
    const orders = (await getAllOrdersFromFirestore()) ?? []
    if (orders.length === 0) return 0
    const payload = orders.map(orderToPlain)
    await fetch(`/api/sync-3c/data/spare_part_orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ data: payload, recordCount: payload.length }),
    })
    return payload.length
  } catch {
    return 0
  }
}

/**
 * Pedidos Rep. para MOSTRAR.
 *
 * - NAVEGADOR: lee PRIMERO el snapshot de Redis (lo último que dejó el agente) y,
 *   si no existe, cae a Firestore. Así la pantalla funciona aunque la cuota de
 *   Firestore esté agotada.
 * - NODE (agente): lee Firestore/Admin (fuente de verdad para escribir).
 *
 * Las rutas de ESCRITURA usan getAllOrdersFromFirestore() explícitamente.
 */
export async function getAllOrders(): Promise<SparePartOrder[]> {
  if (typeof window !== "undefined") {
    const { loadSparePartOrdersPrimary } = await import("@/lib/local-sync")
    const primary = await loadSparePartOrdersPrimary()
    if (primary && primary.length > 0) return primary.map(rawToOrder)
  }
  return (await getAllOrdersFromFirestore()) ?? []
}

/**
 * Aplica las escrituras pendientes (las que Firestore rechazó por cuota/
 * permisos) sobre una lista de pedidos: altas/actualizaciones se fusionan por
 * id y las bajas se quitan. Así el snapshot publicado refleja SIEMPRE el
 * estado real, aunque Firestore no esté disponible.
 */
function applyPendingOrderOps(
  orders: SparePartOrder[],
  pending: { id: string; op: "upsert" | "delete"; data?: Record<string, unknown> }[],
): SparePartOrder[] {
  const map = new Map<string, SparePartOrder>()
  for (const o of orders) map.set(o.id, o)
  for (const op of pending) {
    if (!op?.id) continue
    if (op.op === "delete") {
      map.delete(op.id)
      continue
    }
    if (!op.data) continue
    const base = map.get(op.id)
    const merged: Record<string, unknown> = {
      ...(base ? orderToPlain(base) : {}),
      ...op.data,
      id: op.id,
    }
    map.set(op.id, rawToOrder(merged))
  }
  return [...map.values()].sort(
    (a, b) => (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0),
  )
}

/**
 * Unión de TODAS las fuentes de Pedidos Rep., deduplicada por id:
 *   Firestore (Admin/client) + snapshot de Redis + caché en disco,
 *   con las escrituras pendientes aplicadas encima.
 *
 * Por qué existe: el importador deduplica contra esta lista. Si deduplicara
 * solo contra Firestore (o solo contra el snapshot de Redis), todo pedido que
 * exista en una fuente y no en la otra se volvía a crear → duplicados (eso
 * produjo 269 documentos para 40 repuestos reales). Con la unión, un pedido
 * existente en CUALQUIER fuente nunca se vuelve a crear.
 */
export async function getAllOrdersMerged(): Promise<SparePartOrder[]> {
  const byId = new Map<string, SparePartOrder>()
  const push = (list: SparePartOrder[] | null | undefined): void => {
    if (!list) return
    for (const o of list) if (o?.id) byId.set(o.id, o)
  }
  try {
    push(await getAllOrdersFromFirestore())
  } catch {
    // Firestore no disponible: siguen las fuentes locales
  }
  try {
    push(await loadOrdersFromLocalSources())
  } catch {
    // sin fuentes locales disponibles
  }
  let list = [...byId.values()]
  try {
    const pending = (await serverStore?.readPendingOps()) ?? []
    if (pending.length > 0) list = applyPendingOrderOps(list, pending)
  } catch {
    // sin cola local disponible
  }
  return list
}

/**
 * PUBLICACIÓN DEL SNAPSHOT en Redis (solo NODE / agente).
 *
 * Deja en Redis la última foto COMPLETA de Pedidos Rep. para que la web la
 * muestre sin depender de Firestore.
 *
 * SALTO AUTOMÁTICO A REDIS: si Firestore no responde (cuota/permisos), en
 * lugar de abortar se publica el estado LOCAL (caché en disco / snapshot
 * anterior de Redis) CON las escrituras pendientes aplicadas — la web sigue
 * viendo el estado actualizado y, cuando la cuota vuelve, flushPendingOrderWrites
 * sincroniza Firestore.
 */
export async function publishSparePartOrdersSnapshot(): Promise<number> {
  if (typeof window !== "undefined") return 0
  try {
    // redisPrimary es JS puro (@upstash/redis por REST): NO usa fs.
    const { getRedis, saveModuleData } = await import("@/lib/sync-3c/redisPrimary")
    const redis = getRedis()
    let orders: SparePartOrder[] | null = null
    try {
      orders = await getAllOrdersFromFirestore()
    } catch {
      orders = null
    }
    if (orders === null || orders.length === 0) {
      const local = await loadOrdersFromLocalSources()
      if (local && local.length > 0) orders = local
    }
    if (!orders || orders.length === 0) return 0
    // Escrituras que Firestore rechazó: se aplican al snapshot para que la
    // web las vea de inmediato (se reintentan en Firestore cuando la cuota
    // vuelva, ver flushPendingOrderWrites).
    try {
      const pending = (await serverStore?.readPendingOps()) ?? []
      if (pending.length > 0) orders = applyPendingOrderOps(orders, pending)
    } catch {
      // sin cola local disponible: se publica el estado conocido
    }
    // Foto local duradera (disco) para el próximo salto a Redis.
    try {
      await serverStore?.writeCachedOrders(orders.map(orderToPlain))
    } catch {
      // si falla el caché en disco, el snapshot en Redis igual queda publicado
    }
    await saveModuleData(redis, {
      module: "spare_part_orders",
      syncId: `spare-part-orders-${Date.now()}`,
      data: orders.map(orderToPlain),
      recordCount: orders.length,
      degraded: false,
      firestoreStatus: "synced",
    })
    // Si Firestore ya responde, vaciar la cola de escrituras pendientes.
    try {
      await flushPendingOrderWrites()
    } catch {
      // se reintenta en la próxima sincronización
    }
    return orders.length
  } catch (err) {
    console.error(
      "[sparePartOrders] No se pudo publicar el snapshot en Redis:",
      err instanceof Error ? err.message : err,
    )
    return 0
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
    // Día en que el operario le pidió el repuesto al dueño (lo carga a mano).
    ownerRequestedAt: toDate(input.ownerRequestedAt),
    receivedAt: null,
    usedAt: null,
    notes: input.notes ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  // En Node (agente) se escribe con el Admin SDK: mismo documento, misma forma.
  // RESILIENCIA: si Firestore rechaza la escritura (cuota/permisos), el alta NO
  // aborta la importación: se encola localmente con un id sintético
  // determinista y queda reflejada en el snapshot que el agente publica en
  // Redis. Cuando la cuota vuelve, flushPendingOrderWrites la materializa.
  const admin = await getAdminDb()
  if (admin) {
    try {
      const created = await admin.collection(COLLECTION).add(docData)
      await createAuditLog("create", "spare_part_order", created.id, null, docData)
      return created.id
    } catch (err) {
      const syntheticId = offlineOrderId(input)
      await queueOfflineOp("upsert", syntheticId, docData, err)
      return syntheticId
    }
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
  // REGLA: la web muestra desde Redis → invalidar el snapshot para no mostrar
  // el estado anterior (la próxima lectura cae a Firestore con el dato nuevo).
  await invalidatePrimarySparePartOrders()
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
  await invalidatePrimarySparePartOrders()
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
  await invalidatePrimarySparePartOrders()
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
  await invalidatePrimarySparePartOrders()
}

export async function deleteOrders(ids: string[]): Promise<void> {
  const unique = Array.from(new Set(ids)).filter(Boolean)
  if (unique.length === 0) return
  const admin = await getAdminDb()
  await Promise.all(
    unique.map(async (id) => {
      let before: Record<string, unknown> | null = null
      if (admin) {
        // Node (agente): Admin SDK con resiliencia. Si Firestore rechaza la
        // baja (cuota/permisos) se encola y el snapshot local deja de mostrar
        // el pedido hasta que la baja se materialice al volver la cuota.
        try {
          const snap = await admin.collection(COLLECTION).doc(id).get()
          if (snap.exists) before = snap.data() as Record<string, unknown>
        } catch {
          before = null
        }
        try {
          await admin.collection(COLLECTION).doc(id).delete()
        } catch (err) {
          await queueOfflineOp("delete", id, undefined, err)
        }
      } else {
        const ref = doc(db, COLLECTION, id)
        try {
          const snap = await getDoc(ref)
          if (snap.exists()) before = snap.data()
        } catch {
          before = null
        }
        await deleteDoc(ref)
      }
      try {
        await createAuditLog("delete", "spare_part_order", id, before ?? {}, {})
      } catch {
        // la auditoría no debe bloquear la operación de datos
      }
    }),
  )
  await invalidatePrimarySparePartOrders()
}

export async function updateOrderNotes(id: string, notes: string): Promise<void> {
  const { ref, before } = await loadOrder(id)
  const updates: Record<string, unknown> = { notes: notes || null, updatedAt: new Date() }
  await updateDoc(ref, updates)
  await createAuditLog("update", "spare_part_order", id, before, { ...before, ...updates })
  await invalidatePrimarySparePartOrders()
}
/**
 * Edita a mano las fechas del circuito de compra (pantalla "Pedidos Rep.",
 * hoja de compra, panel de la reparación y detalle del pedido):
 *
 *   1) `ownerRequestedAt` → día en que el operario le pidió el repuesto al dueño.
 *   2) `orderedAt`        → día en que el dueño pidió el repuesto en la casa.
 *   3) `receivedAt`       → día en que el dueño trajo los repuestos.
 *
 * REGLAS:
 * - Sólo se escriben las claves PRESENTES en `input` (undefined = no tocar,
 *   null = borrar la fecha). Así cada celda de la UI guarda sólo su campo.
 * - NUNCA toca cantidades ni stock: la entrada de stock sigue siendo
 *   responsabilidad de `markReceived()`.
 * - Si se carga la fecha del pedido a la casa en un pedido SOLICITADO/PEDIDO,
 *   el pedido pasa a ENCARGADO (mismo criterio que `markOrdered`), para que el
 *   resumen, los filtros y la hoja impresa ("Encargados") reflejen lo que
 *   realmente pasó. Y al revés: si se BORRA esa fecha, vuelve a SOLICITADO
 *   (pendiente de encargar), así no queda un ENCARGADO sin ninguna fecha.
 * - Devuelve SÓLO lo que quedó escrito (fechas + estado) con la forma que
 *   muestra la pantalla, para que quien llama lo aplique en memoria sin releer
 *   la lista entera.
 */
export async function updateOrderDates(
  id: string,
  input: SparePartOrderDatesInput,
): Promise<Partial<SparePartOrder>> {
  const { ref, before } = await loadOrder(id)
  const updates: Record<string, unknown> = {}

  if ("ownerRequestedAt" in input) {
    updates.ownerRequestedAt = normalizeEditableDate(
      input.ownerRequestedAt,
      "fecha en que se pidió el repuesto al dueño",
    )
  }
  if ("orderedAt" in input) {
    updates.orderedAt = normalizeEditableDate(
      input.orderedAt,
      "fecha en que el dueño pidió el repuesto en la casa",
    )
  }
  if ("receivedAt" in input) {
    updates.receivedAt = normalizeEditableDate(
      input.receivedAt,
      "fecha en que trajeron los repuestos",
    )
  }
  if (Object.keys(updates).length === 0) return {}

  const status = before.status as SparePartOrderStatus
  if (updates.orderedAt && (status === "SOLICITADO" || status === "PEDIDO")) {
    updates.status = "ENCARGADO"
  }
  // Se BORRÓ la fecha de encargo: el pedido ya no está encargado → vuelve a
  // "Solicitado" (pendiente de encargar). Sólo aplica cuando el usuario borró
  // ESA fecha, para no tocar el estado por borrar las otras dos.
  if ("orderedAt" in input && !updates.orderedAt && status === "ENCARGADO") {
    updates.status = "SOLICITADO"
  }

  updates.updatedAt = new Date()
  await updateDoc(ref, updates)
  await createAuditLog("update", "spare_part_order", id, before, { ...before, ...updates })
  await invalidatePrimarySparePartOrders()
  // Lo escrito, listo para aplicar en memoria (la pantalla NO relee la lista).
  return writtenDatesPatch(updates)
}

/**
 * Edita a MANO el CÓDIGO de un repuesto (pantalla "Pedidos Rep." y detalle del
 * pedido), para corregir lo que 3C trae mal o vacío: por ejemplo el voltaje
 * "220V" en lugar del código real, o "—" cuando no hay ninguno.
 *
 * - Se guarda normalizado (`normalizePartCode`): mayúsculas y espacios simples.
 * - Vacío = "sin código" (la UI muestra "—"), nunca "S/C".
 * - NO toca cantidades, stock, estado ni fechas.
 * - Devuelve lo escrito para que la pantalla lo aplique en memoria sin releer
 *   la lista entera (mismo criterio que `updateOrderDates`).
 */
export async function updateOrderCode(id: string, code: string): Promise<Partial<SparePartOrder>> {
  const raw = String(code ?? "").trim()
  const normalized = raw && raw.toUpperCase() !== "S/C" ? normalizePartCode(raw) : ""
  const { ref, before } = await loadOrder(id)
  const updates: Record<string, unknown> = { code: normalized, updatedAt: new Date() }
  await updateDoc(ref, updates)
  await createAuditLog("update", "spare_part_order", id, before, { ...before, ...updates })
  await invalidatePrimarySparePartOrders()
  return { code: normalized, updatedAt: updates.updatedAt as Date }
}

/**
 * Lo que se acaba de escribir, como parte de un `SparePartOrder` y con la misma
 * forma que `docToOrder`: una fecha borrada queda `null`/`undefined` (nunca
 * `null` donde el tipo espera `undefined`), para poder mezclarlo sobre el
 * pedido en memoria sin romper lo que ya se muestra.
 */
function writtenDatesPatch(updates: Record<string, unknown>): Partial<SparePartOrder> {
  const patch: Partial<SparePartOrder> = {}
  if ("ownerRequestedAt" in updates) {
    patch.ownerRequestedAt = (updates.ownerRequestedAt as Date | null) ?? null
  }
  if ("orderedAt" in updates) {
    patch.orderedAt = (updates.orderedAt as Date | null) ?? undefined
  }
  if ("receivedAt" in updates) {
    patch.receivedAt = (updates.receivedAt as Date | null) ?? undefined
  }
  if (typeof updates.status === "string") {
    patch.status = updates.status as SparePartOrderStatus
  }
  patch.updatedAt = updates.updatedAt instanceof Date ? updates.updatedAt : new Date()
  return patch
}

/**
 * Normaliza una fecha editable a mano: `null`/`undefined` → null (se borra la
 * fecha), Date válida → Date, cualquier otra cosa → error. NUNCA inventa "ahora".
 */
function normalizeEditableDate(value: Date | null | undefined, label: string): Date | null {
  if (value === null || value === undefined) return null
  const parsed = toDate(value)
  if (!parsed) throw new Error(`La ${label} es inválida`)
  return parsed
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
 * Códigos de 3C escritos con espacios ("1 619 P14 777"). Clave canónica para
 * comparar: mayúsculas SIN espacios. Así "1 619 P14 777" == "1619P14777" y un
 * cambio de formato no duplica el pedido.
 */
export function canonicalSparePartCode(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "").trim()
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
 * ("1 619 P14 777", "600 A01 L7D").
 */
export function isInternalCode(code: unknown): boolean {
  const c = String(code ?? "").replace(/\s+/g, "")
  return /^\d{1,6}$/.test(c)
}

/**
 * El VOLTAJE no es un código de repuesto: "220V" / "220 V" / "110V" / "24V"
 * aparecen en 3C pegados a la descripción ("INDUCIDO 220V") y antes se
 * tomaban como si fueran el código del repuesto. Devuelven true → el valor
 * se descarta como código (el repuesto queda con code null → "—").
 *
 * NOTA: no toca códigos reales que contienen dígitos + letras con otro
 * formato ("1 619 P14 777", "1600A01L7D"): esos tienen 4+ dígitos mezclados
 * con letras en otra posición.
 */
export function isVoltageCode(code: unknown): boolean {
  const c = String(code ?? "").toUpperCase().replace(/[\s.]+/g, "")
  return /^(110|115|127|220|230|240|380|400|440)V(OLT|OLTIOS|OLTS|OLTAGE)?$/.test(c)
}

/**
 * Código de repuesto tal como se GUARDA y se muestra: mayúsculas y espacios
 * simples ("1 619 P14 777"), igual que lo escribe 3C. Para COMPARAR o
 * deduplicar se usa `sparePartCodeKey()` (ignora los espacios).
 */
export function normalizePartCode(code: unknown): string {
  return String(code ?? "").toUpperCase().replace(/\s+/g, " ").trim()
}

/** ¿El valor sirve como CÓDIGO de repuesto? (vacío, "S/C", interno o voltaje → no). */
export function isUsablePartCode(code: unknown): boolean {
  const raw = String(code ?? "").trim()
  if (!raw) return false
  const upper = raw.toUpperCase().replace(/\s+/g, " ").trim()
  if (upper === "S/C" || upper === "SC" || upper === "SIN CODIGO") return false
  return !isInternalCode(upper) && !isVoltageCode(upper)
}

/**
 * Clave de COMPARACIÓN de un código: mayúsculas y SIN espacios
 * ("1 619 P14 777" == "1619P14777"), y VACÍA cuando el valor no es un código
 * real (vacío, "S/C", interno de mano de obra o un voltaje como "220V").
 *
 * Con esta clave, un pedido importado viejo con "220V" de código se reconoce
 * por su DESCRIPCIÓN en lugar de duplicarse.
 */
export function sparePartCodeKey(code: unknown): string {
  return isUsablePartCode(code) ? canonicalSparePartCode(code) : ""
}

/**
 * Descripción normalizada de un repuesto: es la IDENTIDAD del pedido junto al
 * nº de orden (el código es un atributo que 3C puede traer mal o vacío).
 */
function normPartDescription(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase()
}

/** Rango de avance: cuanto más avanzado el estado, más historia tiene la fila. */
function orderProgressRank(status: SparePartOrderStatus): number {
  switch (status) {
    case "UTILIZADO": return 5
    case "RECIBIDO": return 4
    case "ENCARGADO": return 3
    case "PEDIDO": return 2
    case "SOLICITADO": return 1
    default: return 0
  }
}

/**
 * CONSOLIDA los pedidos DUPLICADOS del MISMO repuesto que hayan quedado de
 * importaciones anteriores: por ejemplo una fila con el código real de 3C y otra
 * con un valor falso ("220V") porque el parser viejo tomaba el voltaje como
 * código y creaba una fila nueva al no coincidir.
 *
 * Reglas:
 * - SOLO pedidos auto-importados (los cargados a mano NUNCA se tocan).
 * - Se agrupa por nº de orden + descripción normalizada: en 3C el repuesto se
 *   identifica por su nombre; el código llega como dato aparte.
 * - Se CONSERVA la fila con más historia (estado más avanzado → cantidades
 *   recibidas/usadas → fechas cargadas → la más vieja) y se le copia el código
 *   REAL del grupo; las demás se eliminan.
 * - Si el grupo tiene DOS O MÁS códigos reales distintos NO se toca: son
 *   repuestos distintos que comparten el nombre (p. ej. dos "RODAMIENTO" de
 *   medidas distintas) y borrar uno perdería un pedido válido.
 *
 * Devuelve la lista de pedidos YA consolidada (para deduplicar sobre ella).
 */
async function mergeDuplicateOrders(existing: SparePartOrder[]): Promise<SparePartOrder[]> {
  const groups = new Map<string, SparePartOrder[]>()
  for (const o of existing) {
    if (!isAutoImportedOrder(o)) continue
    const key = `${normOrderKey(o.orderNumber)}||${normPartDescription(o.description)}`
    const list = groups.get(key)
    if (list) list.push(o)
    else groups.set(key, [o])
  }

  const removed = new Set<string>()
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const codeKeys = new Set(list.map((o) => sparePartCodeKey(o.code)).filter(Boolean))
    // Dos códigos reales distintos = dos repuestos distintos: no se toca nada.
    if (codeKeys.size > 1) continue
    const realCodeKey = codeKeys.size === 1 ? [...codeKeys][0] : ""
    const countDates = (o: SparePartOrder) =>
      (o.ownerRequestedAt ? 1 : 0) + (o.orderedAt ? 1 : 0) + (o.receivedAt ? 1 : 0) + (o.usedAt ? 1 : 0)
    const keep = [...list].sort((a, b) => {
      const rank = orderProgressRank(b.status) - orderProgressRank(a.status)
      if (rank !== 0) return rank
      const qty = (b.quantityReceived + b.quantityUsed) - (a.quantityReceived + a.quantityUsed)
      if (qty !== 0) return qty
      const dates = countDates(b) - countDates(a)
      if (dates !== 0) return dates
      return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)
    })[0]

    // El código real del grupo queda en la fila que se conserva.
    if (realCodeKey && sparePartCodeKey(keep.code) !== realCodeKey) {
      const donor = list.find((o) => sparePartCodeKey(o.code) === realCodeKey)
      const code = normalizePartCode(donor?.code ?? realCodeKey)
      try {
        await updateOrderDoc(keep.id, { code, updatedAt: new Date() })
        keep.code = code
      } catch {
        // No frenar la importación por una escritura puntual.
      }
    }

    for (const o of list) {
      if (o.id === keep.id) continue
      try {
        await deleteOrders([o.id])
        removed.add(o.id)
      } catch {
        // No frenar la importación por un documento puntual.
      }
    }
  }

  return removed.size === 0 ? existing : existing.filter((o) => !removed.has(o.id))
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
 * MODELO de Pedidos de repuesto = contenido de la columna DENOMINACION
 * del Excel de Reparaciones de 3C (`Ítems → denominacion`), copiado con su
 * prefijo "REPARACION: ", espacios y mayúsculas tal como los exporta 3C.
 *
 * Opción B (corte automático): 3C mezcla en ese mismo texto la máquina con
 * la descripción del trabajo realizado
 * (ej. "...GWS 2200-230, SE CAMBIA CABLE..."). Se corta SOLO la parte del
 * trabajo, quedando la máquina completa: se recorta en la primera coma que
 * NO sea decimal (no está entre dos dígitos, para no romper "0,9 X 2 MTS")
 * o en el primer punto seguido de espacio o guion (casos "NIWA.- ...",
 * "MANUAL. se coloca..."). Si no hay ninguno, se devuelve el texto igual.
 *
 * No se usa descripcion / orden_compra / expediente.
 *
 * Ej. O.R. X 0001-00011233 → "REPARACION: Amoladora bosch 230 GWS- 25-230 Bare | 3 601 HF4 0H0"
 * Ej. O.R. X 0001-00011270 → "REPARACION: AMOLADORA BOSCH 230- GWS 2200-230"
 *     (se corta ", SE CAMBIA CABLE DE ALIMENTACION, SE CAMBIAN CARBONES")
 *
 * Devuelve null cuando la orden no trae DENOMINACION: en ese caso el llamador
 * conserva el modelo derivado de la identificación (nunca se inventa el dato).
 */
export function modelFromDenominacion(denominacion: unknown): string | null {
  // Solo se quitan los espacios sobrantes de los EXTREMOS (convención de la
  // casa al leer celdas). El texto interno, el prefijo y las mayúsculas quedan
  // EXACTAMENTE como los exporta 3C.
  const raw = String(denominacion ?? "").trim()
  if (!raw) return null
  // 1. Primera coma que NO sea decimal (no rodeada de dígitos a ambos lados).
  let commaIdx = -1
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== ",") continue
    const prev = i > 0 ? raw[i - 1] : ""
    const next = i + 1 < raw.length ? raw[i + 1] : ""
    const prevIsDigit = prev >= "0" && prev <= "9"
    const nextIsDigit = next >= "0" && next <= "9"
    if (prevIsDigit && nextIsDigit) continue
    commaIdx = i
    break
  }
  // 2. Primer punto seguido de espacio o guion ("NIWA.- ...", "MANUAL. ...").
  let dotIdx = -1
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== ".") continue
    const next = i + 1 < raw.length ? raw[i + 1] : ""
    if (next === " " || next === "-" || next === "\t") {
      dotIdx = i
      break
    }
  }
  let cut = -1
  if (commaIdx >= 0 && dotIdx >= 0) cut = Math.min(commaIdx, dotIdx)
  else if (commaIdx >= 0) cut = commaIdx
  else if (dotIdx >= 0) cut = dotIdx
  const result = (cut >= 0 ? raw.slice(0, cut) : raw).trim()
  return result || null
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
 * REFRESCO GENERAL del MODELO de los pedidos YA EXISTENTES.
 *
 * Regla ÚNICA, para TODAS las órdenes (no para un caso puntual):
 *   pedido existente → nº de orden → orden de Reparación de 3C →
 *   columna DENOMINACION → campo Modelo de Pedidos de repuesto.
 *
 * El contenido se copia TAL CUAL: sin quitar "REPARACION:", sin cortar, sin
 * separar, sin reconstruir y sin completar con descripcion / orden_compra /
 * expediente. Sólo cuando la orden TIENE DENOMINACION; si no la tiene, el
 * pedido se deja exactamente como está (nunca se sustituye por otra columna).
 *
 * No crea pedidos, no borra, no toca códigos, cantidades, fechas, estados,
 * Pedido/Recibido/Uso ni notas. Es idempotente: si el Modelo guardado ya es el
 * de DENOMINACION, no escribe.
 */
export async function refreshModelsFromDenominacion(records?: MaintenanceRecord[]): Promise<{
  scanned: number
  updated: number
  withDenominacion: number
  withoutDenominacion: number
  examples: { orderNumber: string; machineModel: string }[]
}> {
  // Fuente de DENOMINACION por NÚMERO DE ORDEN (una entrada por orden).
  const source = records ?? (await loadMaintenanceRecords())
  const denominacionByOrder = new Map<string, string>()
  for (const rec of source) {
    const value = modelFromDenominacion((rec as MaintenanceRecord).machineDenominacion)
    if (!value) continue
    const key = normOrderKey(rec.orderNumber)
    if (!key) continue
    // Una misma orden puede venir repetida en el consolidado: se conserva la
    // copia MÁS COMPLETA de ESA MISMA columna (nunca se mezcla con otra).
    const prev = denominacionByOrder.get(key)
    if (!prev || value.length > prev.length) denominacionByOrder.set(key, value)
  }

  const existing = await getAllOrdersMerged()
  const examples: { orderNumber: string; machineModel: string }[] = []
  let updated = 0
  let withDenominacion = 0
  let withoutDenominacion = 0

  for (const order of existing) {
    const denominacion = denominacionByOrder.get(normOrderKey(order.orderNumber))
    if (!denominacion) {
      // La orden no trae DENOMINACION: el pedido queda intacto.
      withoutDenominacion++
      continue
    }
    withDenominacion++
    if (String(order.machineModel ?? "") === denominacion) continue
    await updateOrderDoc(order.id, { machineModel: denominacion, updatedAt: new Date() })
    updated++
    if (examples.length < 10) {
      examples.push({ orderNumber: order.orderNumber, machineModel: denominacion })
    }
  }

  return { scanned: existing.length, updated, withDenominacion, withoutDenominacion, examples }
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
  /** Pedidos existentes cuyo Modelo se llevó a la DENOMINACION real de 3C. */
  modelsUpdated: number
  createdOrders: { orderNumber: string; description: string }[]
}> {
  const existing = await getAllOrdersMerged()
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

  // REFRESCO GENERAL: el Modelo de TODOS los pedidos existentes se lleva a la
  // DENOMINACION real de 3C (cruce por nº de orden). No crea ni borra pedidos.
  const models = await refreshModelsFromDenominacion(maintenance)

  // Si esta corrida cambió algo, se republica el snapshot en Redis para que la
  // pantalla (que lee de la fuente primaria) vea el resultado sin depender de la
  // cuota de Firestore. Si no hubo cambios, no se gasta una lectura extra.
  if (updated > 0 || createdOrders.length > 0 || models.updated > 0) {
    await publishSnapshotFromBrowser()
  }

  return { created: createdOrders.length, updated, skippedExisting, withoutDate, createdOrders, modelsUpdated: models.updated }
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
  // Se devuelve el código con los espacios que trae 3C ("1 619 P14 777"), que es
  // su formato real; el largo se valida sobre la versión compacta.
  return t.replace(/\s+/g, " ").toUpperCase()
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
    // Códigos de 3C: se guardan como los escribe 3C ("1 619 P14 777"), con
    // espacios simples. Un valor que NO es un código real (voltaje "220V",
    // interno de mano de obra "1012", "S/C") → null (la UI muestra "—").
    const c = isUsablePartCode(code) ? normalizePartCode(code) : null
    // Regla GENERAL: un repuesto que trae su PROPIO código de 3C es un repuesto
    // válido aunque su nombre no figure en la lista de palabras clave (ej.:
    // "BRIDA DE FIJACIÓN" + "2 605 703 014" en la línea siguiente). El filtro
    // por palabra clave aplica solo a descripciones SIN código, donde el
    // nombre es la única señal disponible.
    if (!c && !containsSparePart(d)) return
    // Clave de deduplicación: el código sin espacios, para que "1 619 P14 777"
    // y "1619P14777" sean el MISMO repuesto y no se emita dos veces.
    const key = `${c ? canonicalSparePartCode(c) : ""}||${d.toUpperCase().replace(/\s+/g, " ")}`
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
      // En 3C el "código" de esa línea puede ser una ESPECIFICACIÓN
      // ("Expansion Polar 220V"): no es un código real y el código verdadero
      // viene en la línea SIGUIENTE. Se deja PENDIENTE para que esa línea se lo
      // asigne. Antes se guardaba el "220V" como código y el código real se
      // descartaba (por eso la hoja de compra salía sin códigos).
      if (!isUsablePartCode(inline.code) && inline.description) {
        pending = inline.description
        continue
      }
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
    .map((p) => ({ code: isUsablePartCode(p.code) ? normalizePartCode(p.code) : null, description: p.description }))
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
  const existing = await getAllOrdersMerged()

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
        // Clave de código sin espacios y vacía cuando no es un código real
        // (así "1 619 P14 777" valida al pedido guardado "1619P14777").
        const c = sparePartCodeKey(p.code)
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
    const codeN = sparePartCodeKey(o.code)
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
  const existing = await getAllOrdersMerged()
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
    const internalLaborCode = isInternalCode(code) // ej: "1012"
    // Código PROPIO de repuesto de 3C (no interno de mano de obra, no un voltaje
    // como "220V"): es prueba suficiente de que el pedido es un repuesto válido,
    // aunque su nombre no figure en la lista de palabras clave. Mismo criterio
    // que parseSparePartsFromMotivoDetailed(), para que el parser y la limpieza
    // no se contradigan (uno lo crea y el otro lo borra).
    const ownPartCode = isUsablePartCode(code)
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
  /** Pedidos existentes cuyo Modelo se llevó a la DENOMINACION real de 3C. */
  modelsUpdated: number
  createdOrders: { orderNumber: string; code: string | null; description: string }[]
}> {
  // Los registros llegan del propio agente (misma fuente primaria Redis), sin
  // fetch relativo: esa ruta falla cuando el proceso corre en Node (agente).
  const maintenance = records

  // Duplicados del MISMO repuesto que hayan quedado de importaciones anteriores
  // (una fila con el código real de 3C y otra con un valor falso, p. ej. "220V"):
  // se consolidan ANTES de deduplicar, así cada repuesto queda con UNA sola fila
  // (la que tiene las fechas/estado del operario) y con su código real.
  const existing = await mergeDuplicateOrders(await getAllOrdersMerged())
  const seen = new Map<string, SparePartOrder>()
  // Pedidos guardados SIN un código real (vacío, o un valor que no es código
  // como el voltaje "220V" de importaciones viejas): se indexan ADEMÁS por
  // descripción, para reconocerlos y corregirles el código en esta corrida.
  const byDescription = new Map<string, SparePartOrder>()
  for (const o of existing) {
    // La clave debe normalizarse IGUAL que la consulta de abajo: código en
    // MAYÚSCULAS SIN espacios ("1 619 P14 777" == "1619P14777") y descripción
    // en minúsculas. Si no coincide, el mismo repuesto se importa dos veces y
    // se duplican los pedidos.
    const codeN = sparePartCodeKey(o.code)
    const descN = String(o.description ?? "").trim().toLowerCase()
    const orderKey = normOrderKey(o.orderNumber)
    seen.set(`${orderKey}||${codeN || descN}`, o)
    if (!codeN) byDescription.set(`${orderKey}||${descN}`, o)
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
      // Clave sin espacios + vacía si el valor no es un código real.
      const codeNorm = sparePartCodeKey(part.code)
      const descNorm = part.description.trim().toLowerCase()
      const orderKey = normOrderKey(rec.orderNumber)

      const dedupKey = `${orderKey}||${codeNorm || descNorm}`
      // Fallback: pedido guardado SIN código real para esa orden y descripción
      // (importación vieja con el voltaje "220V" como código) → se reconoce y se
      // le corrige el código, en lugar de crear un pedido duplicado al lado.
      const existingOrder = seen.get(dedupKey) ?? byDescription.get(`${orderKey}||${descNorm}`)
      if (existingOrder) {
        // Actualizar existente si cambió algo relevante
        const updates: Record<string, unknown> = {}
        // CÓDIGO: si el guardado NO es un código real (vacío o "220V") se copia
        // el de 3C; si el guardado SÍ es un código real y difiere, no se pisa
        // (puede haber sido corregido a mano en la pantalla).
        const storedCode = String(existingOrder.code ?? "").trim()
        const storedKey = sparePartCodeKey(existingOrder.code)
        if (codeNorm && !storedKey) {
          updates.code = normalizePartCode(part.code)
        } else if (!codeNorm && storedCode && !storedKey) {
          updates.code = ""
        }
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

  // REFRESCO GENERAL: el Modelo de TODOS los pedidos existentes se lleva a la
  // DENOMINACION real de 3C (cruce por nº de orden). No crea ni borra pedidos.
  const models = await refreshModelsFromDenominacion(maintenance)

  return { created: createdOrders.length, updated, skippedAdmin, createdOrders, modelsUpdated: models.updated }
}
