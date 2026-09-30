/**
 * Diagnóstico de Pedidos Rep.: qué hay HOY en el snapshot que lee la pantalla.
 *
 * Muestra, sin escribir nada:
 *  - cuántos pedidos hay y si quedó alguna fila FANTASMA (sin nº de orden ni repuesto),
 *  - cuántas fechas de pedido siguen PISADAS (posteriores al día de creación: el
 *    próximo sync las cura — ver `repairBumpedRequestedDates`),
 *  - la distribución de fechas de los pedidos pendientes (antes/después de curar).
 *
 * Uso: npx tsx scripts/verify-spare-orders-snapshot.ts
 */
import "../sync-agent/env"
import { installSparePartOrdersServerStore } from "../src/services/sparePartOrderStore.server"
import { getRedis, readModuleData } from "../src/lib/sync-3c/redisPrimary"
import { readCachedOrders } from "../src/lib/sync-3c/orderStore"

const PENDING_STATUSES = ["RECIBIDO", "UTILIZADO", "CANCELADO"]

function dayOf(value: unknown): { key: number; iso: string } | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value as string)
  if (Number.isNaN(d.getTime())) return null
  const noon = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0))
  return { key: Date.UTC(noon.getUTCFullYear(), noon.getUTCMonth(), noon.getUTCDate()), iso: noon.toISOString().slice(0, 10) }
}

function isAutoImported(notes: unknown): boolean {
  const t = String(notes ?? "")
  return t.includes("Importado desde Órdenes de Reparación") || t.includes("MOTIVO_ESTADO_REP")
}

async function main() {
  installSparePartOrdersServerStore()
  const env = await readModuleData("spare_part_orders", getRedis())
  const snapshot = Array.isArray(env?.data) ? (env.data as Record<string, unknown>[]) : []
  const cache = (await readCachedOrders()) ?? []

  console.log(`snapshot Redis (lo que lee la pantalla): ${snapshot.length} pedido(s)`)
  console.log(`caché en disco del agente            : ${cache.length} pedido(s)`)

  const identify = (row: Record<string, unknown>) =>
    Boolean(String(row.orderNumber ?? "").trim() || String(row.description ?? "").trim())
  const phantoms = [...snapshot, ...cache].filter((r) => !identify(r))
  console.log(`filas fantasma (sin orden ni repuesto): ${phantoms.length}`)
  for (const p of phantoms) console.log(`   - ${JSON.stringify(p).slice(0, 140)}`)

  const before = new Map<string, number>()
  const after = new Map<string, number>()
  let bumped = 0
  let pending = 0
  for (const row of snapshot) {
    const status = String(row.status ?? "").toUpperCase()
    const isPending = !PENDING_STATUSES.includes(status)
    const req = dayOf(row.requestedAt)
    const cre = dayOf(row.createdAt)
    const isBumped = Boolean(req && cre && isAutoImported(row.notes) && req.key > cre.key)
    if (isBumped) bumped++
    if (!isPending || !req) continue
    pending++
    before.set(req.iso, (before.get(req.iso) ?? 0) + 1)
    const target = isBumped && cre ? cre.iso : req.iso
    after.set(target, (after.get(target) ?? 0) + 1)
  }

  console.log(`\npedidos pendientes: ${pending}`)
  console.log(`fechas PISADAS que el próximo sync va a curar: ${bumped}`)
  const show = (label: string, map: Map<string, number>) =>
    console.log(`${label} ` + [...map.entries()].sort().map(([d, n]) => `${d}=${n}`).join("  "))
  show("pendientes con la fecha de HOY  :", before)
  show("pendientes con la fecha CURADA  :", after)
}

main().catch((err) => {
  console.error("[verify] Error:", err instanceof Error ? err.message : err)
  process.exit(1)
})
