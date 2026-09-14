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
    // Buscar por repairId (id interno de la reparación)
    const q1 = query(
      collection(db, COLLECTION),
      where("repairId", "==", repairId),
      orderBy("requestedAt", "desc"),
    )
    const snap1 = await getDocs(q1)

    // Normalizar el ID para generar todas las variantes posibles de número de orden
    // que podrían estar guardadas en spare_part_orders.
    const trimmed = repairId.trim()
    // Quitar prefijo "local:" / "maintenance:" y colapsar espacios
    const core = trimmed
      .replace(/^(local:|maintenance:)\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
    const upper = core.toUpperCase()

    // Variantes: quitar "X" prefijo, agregar "X" prefijo
    const hasX = /^X\s+\d/.test(upper)
    const withX = hasX ? upper : `X ${upper}`
    const withoutX = hasX ? upper.replace(/^X\s+/, "") : upper

    // Unir todas las variantes (sin duplicados)
    const orderNumbers = [...new Set([upper, withX, withoutX])].filter(Boolean)

    const results = new Map<string, SparePartOrder>()

    // Agregar resultados de búsqueda por repairId
    for (const doc of snap1.docs) {
      const order = docToOrder(doc)
      results.set(order.id, order)
    }

    // Buscar por cada variante de orderNumber
    for (const orderNum of orderNumbers) {
      const q2 = query(
        collection(db, COLLECTION),
        where("orderNumber", "==", orderNum),
        orderBy("requestedAt", "desc"),
      )
      const snap2 = await getDocs(q2)
      for (const doc of snap2.docs) {
        const order = docToOrder(doc)
        results.set(order.id, order)
      }
    }

    return Array.from(results.values()).sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())
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
    "INDUCIDO", "CAMPO", "RODAMIENTO", "VENTILADOR", "CARBON", "CARBONES",
    "BUJE", "DISCO", "FILTRO", "CORREA", "MANGUERA", "CABLE", "FICHA",
    "ENCHUFE", "BOTON", "PULSADOR", "INTERRUPTOR", "LAMPARA", "LED",
    "RESISTENCIA", "CONDENSADOR", "CAPACITOR", "DIODO", "TRANSISTOR",
    "INTEGRADO", "CIRCUITO", "PLACA", "TARJETA", "MOTOR", "BOMBA",
    "COMPRESOR", "CILINDRO", "PISTON", "VALVULA", "RETEN", "SELLO",
    "JUNTA", "TORNILLO", "TUERCA", "ARANDALE", "MUELLE", "RESORTE",
    "PERNO", "SEGURO", "ANILLO", "RODILLO", "RUEDA", "ENGRANAJE",
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
export function parseSparePartsFromMotivo(motivo: string): { code: string | null; description: string }[] {
  if (!motivo || isAdminText(motivo)) return []

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
        if (!trimmed || isAdminText(trimmed) || isDiagnosis(trimmed)) continue

        // Si contiene delimitadores, usar splitAndParse
        if (/[-;,]/.test(trimmed)) {
          parts.push(...splitAndParse(trimmed))
          continue
        }

        if (!containsSparePart(trimmed)) continue

        // Intentar extraer código y descripción
        const inlineCode = trimmed.match(/^(.+?)\s+([A-Z]?\d{4,}[A-Z0-9]*)(?:\s*\(([^)]+)\))?$/i)
        if (inlineCode && inlineCode[2] && inlineCode[2].length >= 4) {
          const descPart = inlineCode[3] ? `${inlineCode[1].trim()} (${inlineCode[3]})` : inlineCode[1].trim()
          if (looksLikeCode(inlineCode[2]) && containsSparePart(descPart)) {
            parts.push({ code: inlineCode[2].toUpperCase(), description: descPart })
            continue
          }
        }

        const cleaned = cleanDescription(trimmed)
        if (cleaned && containsSparePart(cleaned) && !isDiagnosis(cleaned)) {
          parts.push({ code: null, description: cleaned })
        }
      }
      continue
    }

    // Si la línea contiene delimitadores (-, ;, ,), intentar dividir y procesar cada parte
    if (/[-;,]/.test(line)) {
      const splitParts = splitAndParse(line)
      parts.push(...splitParts)
      continue
    }

    // Verificar si la línea contiene un repuesto identificable
    if (!containsSparePart(line)) continue

    // Detectar patrón "CÓDIGO [modelo] descripción" (código al inicio)
    const codeFirst = line.match(/^([A-Z]\d{4,})(?:\s+\d{1,3})?\s{1,3}(.+)$/i)
    if (codeFirst && codeFirst[2] && codeFirst[2].length > 3 && containsSparePart(codeFirst[2])) {
      parts.push({ code: codeFirst[1].toUpperCase(), description: codeFirst[2].trim() })
      continue
    }

    // Detectar patrón "descripción CÓDIGO" (código al final con paréntesis opcional)
    const inlineCode = line.match(/^(.+?)\s+([A-Z]?\d{4,}[A-Z0-9]*)(?:\s*\(([^)]+)\))?$/i)
    if (inlineCode && inlineCode[2] && inlineCode[2].length >= 4) {
      const potentialCode = inlineCode[2]
      const descPart = inlineCode[3]
        ? `${inlineCode[1].trim()} (${inlineCode[3]})`
        : inlineCode[1].trim()
      if (looksLikeCode(potentialCode) && containsSparePart(descPart)) {
        parts.push({ code: potentialCode.toUpperCase(), description: descPart })
        continue
      }
    }

    // Detectar patrón "CÓDIGO descripción" con código al inicio (letra + dígitos)
    const codeAtStart = line.match(/^([A-Z]\d{4,})\s+(.+)$/i)
    if (codeAtStart && codeAtStart[2] && containsSparePart(codeAtStart[2])) {
      parts.push({ code: codeAtStart[1].toUpperCase(), description: codeAtStart[2].trim() })
      continue
    }

    // La línea contiene un repuesto pero no tiene código identificable
    // Limpiar la descripción de verbos y prefijos
    const cleaned = cleanDescription(line)
    if (cleaned && containsSparePart(cleaned) && !isDiagnosis(cleaned)) {
      parts.push({ code: null, description: cleaned })
    }
  }

  // Eliminar duplicados por descripción normalizada
  const seen = new Set<string>()
  return parts.filter((p) => {
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

  // Dividir por delimitadores comunes
  const segments = text.split(/\s*[-;,]\s*/)

  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    if (isAdminText(trimmed) || isDiagnosis(trimmed)) continue
    if (!containsSparePart(trimmed)) continue

    // Intentar extraer código y descripción
    const inlineCode = trimmed.match(/^(.+?)\s+([A-Z]?\d{4,}[A-Z0-9]*)(?:\s*\(([^)]+)\))?$/i)
    if (inlineCode && inlineCode[2] && inlineCode[2].length >= 4) {
      const descPart = inlineCode[3] ? `${inlineCode[1].trim()} (${inlineCode[3]})` : inlineCode[1].trim()
      if (looksLikeCode(inlineCode[2]) && containsSparePart(descPart)) {
        parts.push({ code: inlineCode[2].toUpperCase(), description: descPart })
        continue
      }
    }

    // Descripción sin código
    const cleaned = cleanDescription(trimmed)
    if (cleaned && containsSparePart(cleaned) && !isDiagnosis(cleaned)) {
      parts.push({ code: null, description: cleaned })
    }
  }

  return parts
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
