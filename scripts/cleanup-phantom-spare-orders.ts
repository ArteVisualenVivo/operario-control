/**
 * Limpia los residuos del bug del placeholder `"pending"` (corregido el 2026-09-30)
 * y republica el snapshot de Pedidos Rep.:
 *
 *  1. COLA de escrituras pendientes
 *     (automation-watcher/cache/spare-part-orders-pending.json): se quitan las ops
 *     que NO identifican un pedido (id `"pending"`, sin nº de orden ni repuesto).
 *     Eran actualizaciones dirigidas a un documento inexistente: quedaban
 *     encoladas para siempre y publicaban una fila VACÍA en la lista y en la hoja
 *     de compra.
 *  2. CACHÉ en disco (spare-part-orders-cache.json): se quitan esas filas vacías,
 *     que ya habían quedado persistidas por un snapshot anterior.
 *  3. SNAPSHOT de Redis: se republica el estado limpio (la pantalla lee de ahí).
 *
 * No toca Firestore salvo lo que haga la publicación normal del snapshot. Si en
 * Firestore hubiera quedado un documento con id `"pending"`, el filtro
 * `isIdentifiableOrder()` ya lo deja fuera de la pantalla y de la hoja impresa.
 *
 * Uso: npx tsx scripts/cleanup-phantom-spare-orders.ts
 */
import "../sync-agent/env"
import { installSparePartOrdersServerStore } from "../src/services/sparePartOrderStore.server"
import { publishSparePartOrdersSnapshot } from "../src/services/sparePartOrders"
import {
  readCachedOrders,
  writeCachedOrders,
  readPendingOps,
  removePendingOps,
} from "../src/lib/sync-3c/orderStore"

/** ¿La fila identifica un pedido? Misma regla que `isIdentifiableOrder()`. */
function looksLikeOrder(row: Record<string, unknown> | undefined | null): boolean {
  if (!row) return false
  return Boolean(String(row.orderNumber ?? "").trim() || String(row.description ?? "").trim())
}

async function main() {
  installSparePartOrdersServerStore()

  // 1) Cola de escrituras pendientes
  const pending = await readPendingOps()
  const junkOps = pending.filter((op) => op.id === "pending" || !looksLikeOrder(op.data))
  if (junkOps.length > 0) await removePendingOps(junkOps.map((op) => op.id))
  console.log(
    `[cleanup] cola: ${pending.length} op(s) → ${pending.length - junkOps.length} (quitadas ${junkOps.length})`,
  )
  for (const op of junkOps) {
    console.log(`   - id=${JSON.stringify(op.id)} op=${op.op} data=${JSON.stringify(op.data ?? {}).slice(0, 140)}`)
  }

  // 2) Caché en disco
  const rows = (await readCachedOrders()) ?? []
  const clean = rows.filter(looksLikeOrder)
  if (clean.length !== rows.length) await writeCachedOrders(clean)
  console.log(`[cleanup] caché: ${rows.length} fila(s) → ${clean.length} (quitadas ${rows.length - clean.length})`)

  // 3) Snapshot de Redis (lo que ve la pantalla)
  const published = await publishSparePartOrdersSnapshot()
  console.log(`[cleanup] snapshot republicado: ${published} pedido(s)`)
}

main().catch((err) => {
  console.error("[cleanup] Error:", err instanceof Error ? err.message : err)
  process.exit(1)
})
