/**
 * sparePartOrderStore.server.ts — Puentes SOLO SERVIDOR (Node) de Pedidos Rep.
 *
 * REGLA DE ARQUITECTURA: este archivo importa fs/path/firebase-admin (vía
 * orderStore y adminDb). NUNCA debe importarse desde el cliente (ni directa ni
 * transitivamente): Turbopack lo incluiría en el bundle del navegador →
 * "Module not found: Can't resolve 'fs'".
 *
 * La web usa `sparePartOrders.ts` (client SDK + fetch a /api/*). El agente y
 * las API routes usan este puente.
 */
import type { SparePartOrder } from "@/types"
import { registerSparePartOrdersServerStore } from "./sparePartOrders"

export interface AdminFirestoreLike {
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

let adminDb: AdminFirestoreLike | null = null
let adminDbResolved = false

/** Admin SDK de Firestore cuando corremos en Node; null en el navegador. */
export async function getSparePartsAdminDb(): Promise<AdminFirestoreLike | null> {
  if (typeof window !== "undefined") return null
  if (adminDbResolved) return adminDb
  adminDbResolved = true
  try {
    // API modular + service account: MISMA credencial que ya usa el agente
    // (src/lib/sync-3c/engine.ts y scripts/*.mjs).
    const fs = await import("node:fs")
    const path = await import("node:path")
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

export type PendingOrderOp = {
  id: string
  op: "upsert" | "delete"
  data?: Record<string, unknown>
  queuedAt: number
}

/** Encola una escritura que Firestore rechazó (solo disco del servidor). */
export async function queuePendingOrderOp(op: PendingOrderOp): Promise<void> {
  if (typeof window !== "undefined") return
  const { queuePendingOp } = await import("@/lib/sync-3c/orderStore")
  await queuePendingOp(op)
}

/** Lee la cola de escrituras pendientes (solo disco del servidor). */
export async function readPendingOrderOps(): Promise<PendingOrderOp[]> {
  if (typeof window !== "undefined") return []
  const { readPendingOps } = await import("@/lib/sync-3c/orderStore")
  return readPendingOps()
}

/** Quita operaciones ya aplicadas de la cola (solo disco del servidor). */
export async function removePendingOrderOps(ids: string[]): Promise<void> {
  if (typeof window !== "undefined") return
  const { removePendingOps } = await import("@/lib/sync-3c/orderStore")
  await removePendingOps(ids)
}

/** Lee la última foto local de Pedidos Rep. (solo disco del servidor). */
export async function readCachedSparePartOrders(): Promise<Record<string, unknown>[] | null> {
  if (typeof window !== "undefined") return null
  const { readCachedOrders } = await import("@/lib/sync-3c/orderStore")
  return readCachedOrders()
}

/** Guarda la última foto local de Pedidos Rep. (solo disco del servidor). */
export async function writeCachedSparePartOrders(rows: Record<string, unknown>[]): Promise<boolean> {
  if (typeof window !== "undefined") return false
  const { writeCachedOrders } = await import("@/lib/sync-3c/orderStore")
  return writeCachedOrders(rows)
}

export type { SparePartOrder }

/**
 * Instala este puente como backend SERVIDOR de `sparePartOrders.ts`.
 *
 * La llama el agente local al arrancar (corre en Node, fuera de Turbopack). Es
 * el único punto donde el Admin SDK y el acceso a disco (fs/path) se conectan
 * con el módulo isomorfo de Pedidos Rep., y se hace por INYECCIÓN: el navegador
 * nunca importa este archivo, así que fs/path no pueden entrar a su bundle.
 */
export function installSparePartOrdersServerStore(): void {
  registerSparePartOrdersServerStore({
    getAdminDb: getSparePartsAdminDb,
    readPendingOps: readPendingOrderOps,
    removePendingOps: removePendingOrderOps,
    queuePendingOp: queuePendingOrderOp,
    readCachedOrders: readCachedSparePartOrders,
    writeCachedOrders: writeCachedSparePartOrders,
  })
}
