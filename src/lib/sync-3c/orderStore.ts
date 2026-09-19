/**
 * orderStore.ts — Almacén LOCAL (disco) de Pedidos Rep. + COLA de escrituras
 * pendientes hacia Firestore.
 *
 * Por qué existe: la cuota gratuita de Firestore puede agotarse en cualquier
 * momento (lecturas o escrituras). Cuando eso pasa, el sistema NO debe frenarse:
 *  - el agente guarda el estado en disco y en Redis (la web lo muestra),
 *  - las escrituras que Firestore rechazó quedan ENCOLADAS y se reintentan solas
 *    cuando la cuota vuelve.
 *
 * Nada se pierde y la pantalla no depende de Firestore.
 *
 * Solo funciona en NODE (fs). En el navegador las funciones devuelven vacío/null.
 */

export interface PendingOrderOp {
  /** id del documento en Firestore (o id sintético para altas pendientes). */
  id: string
  op: "upsert" | "delete"
  /** Campos a escribir (upsert). */
  data?: Record<string, unknown>
  queuedAt: number
}

const CACHE_SUBPATH = ["automation-watcher", "cache"]
const ORDERS_FILE = "spare-part-orders-cache.json"
const PENDING_FILE = "spare-part-orders-pending.json"

async function files(): Promise<{ ordersPath: string; pendingPath: string } | null> {
  if (typeof window !== "undefined") return null
  try {
    const path = await import("path")
    const dir = path.resolve(process.cwd(), ...CACHE_SUBPATH)
    return {
      ordersPath: path.join(dir, ORDERS_FILE),
      pendingPath: path.join(dir, PENDING_FILE),
    }
  } catch {
    return null
  }
}

async function readJsonArray(filePath: string): Promise<Record<string, unknown>[] | null> {
  try {
    const fs = await import("fs")
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null
  } catch {
    return null
  }
}

async function writeJson(filePath: string, value: unknown): Promise<boolean> {
  try {
    const fs = await import("fs")
    const path = await import("path")
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(value, null, 0), "utf-8")
    return true
  } catch (err) {
    console.error("[orderStore] No se pudo escribir el caché local:", err instanceof Error ? err.message : err)
    return false
  }
}

/** Última foto local de Pedidos Rep. (null si nunca se guardó). */
export async function readCachedOrders(): Promise<Record<string, unknown>[] | null> {
  const f = await files()
  if (!f) return null
  return readJsonArray(f.ordersPath)
}

/** Guarda la última foto local de Pedidos Rep. */
export async function writeCachedOrders(rows: Record<string, unknown>[]): Promise<boolean> {
  const f = await files()
  if (!f) return false
  return writeJson(f.ordersPath, rows)
}

/** Escrituras que Firestore rechazó y quedan esperando (una por documento). */
export async function readPendingOps(): Promise<PendingOrderOp[]> {
  const f = await files()
  if (!f) return []
  return ((await readJsonArray(f.pendingPath)) as unknown as PendingOrderOp[]) ?? []
}

/**
 * Encola (o actualiza) la escritura pendiente de un documento. Si el documento
 * ya tenía una operación pendiente, se reemplaza por la última (evita colas
 * infinitas del mismo registro).
 */
export async function queuePendingOp(op: PendingOrderOp): Promise<void> {
  const f = await files()
  if (!f) return
  const current = await readPendingOps()
  const next = current.filter((o) => o.id !== op.id)
  next.push(op)
  await writeJson(f.pendingPath, next)
}

/** Quita de la cola la escritura de un documento (ya aplicada en Firestore). */
export async function removePendingOps(ids: string[]): Promise<void> {
  const f = await files()
  if (!f) return
  const current = await readPendingOps()
  const next = current.filter((o) => !ids.includes(o.id))
  if (next.length === current.length) return
  await writeJson(f.pendingPath, next)
}
