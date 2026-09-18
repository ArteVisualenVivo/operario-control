import { doc, getDoc, updateDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createAuditLog } from "./audit"

const COLLECTION = "spare_part_orders"

/**
 * Guarda la "Casa de repuesto" (dónde se compró o encargó) de un pedido.
 *
 * Se usa EXCLUSIVAMENTE desde la hoja de impresión de la lista de compra.
 * Reutiliza el campo `supplier` que ya existía en el modelo (hoy vacío en todos
 * los pedidos), para no crear campos duplicados ni migrar datos.
 *
 * Reglas:
 * - Escritura PARCIAL: solo toca `supplier` y `updatedAt`. NUNCA pisa fechas,
 *   cantidades, estado ni ningún otro campo del pedido.
 * - Texto vacío guarda `null`, lo que permite borrar una casa mal cargada.
 * - Deja registro en audit_logs, igual que el resto de las mutaciones.
 */
export async function updateOrderSupplier(id: string, supplier: string): Promise<void> {
  if (!id) throw new Error("Pedido inválido")

  const value = supplier.trim()
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error("Pedido no encontrado")

  // Si no hay nada que cambiar, no se escribe (no gasta cuota de Firestore).
  const before = snap.data() as Record<string, unknown>
  const current = typeof before.supplier === "string" ? before.supplier.trim() : ""
  if (current === value) return

  const updates: Record<string, unknown> = {
    supplier: value || null,
    updatedAt: new Date(),
  }
  await updateDoc(ref, updates)
  await createAuditLog("update", "spare_part_order", id, before, { ...before, ...updates })
  // La pantalla muestra desde el snapshot de Redis: se invalida para no seguir
  // mostrando la casa anterior (la próxima lectura cae a Firestore).
  try {
    await fetch(`/api/sync-3c/data/spare_part_orders`, { method: "DELETE", cache: "no-store" })
  } catch {
    // Si falla, la próxima sincronización repone el snapshot.
  }
}
