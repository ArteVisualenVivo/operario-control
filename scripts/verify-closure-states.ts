// verify-closure-states.ts — Verificación del colapso de estados repetidos.
//
// Uso: npx tsx scripts/verify-closure-states.ts
//
// ¿Por qué existe? El consolidado de 3C guardaba una copia de cada fila de
// estado por CADA Excel que la repetía (6,5 MB / 27.414 estados para 1.137
// órdenes). Ese peso viajaba entero al navegador en cada pantalla y la lectura
// de la fuente primaria tardaba ~8,5 s: cuando fallaba, la regla de cierre de
// Pedidos Rep. se quedaba sin datos y mostraba órdenes ya reparadas en 3C.
//
// El agente ahora colapsa los estados repetidos CONSECUTIVOS
// (collapseRepeatedStates en src/lib/sync-3c/consolidated.ts). Este script
// comprueba, sobre el snapshot REAL de Redis, que el cambio no altera:
//   1) el cierre de cada pedido (getOrderClosure), y
//   2) la fecha del primer estado "A la Espera Repuestos" (requestedAt de los
//      pedidos importados desde 3C).
// Sólo lee Redis: no escribe nada.
import { readFileSync } from 'node:fs'
import { buildMaintenanceByOrder, getOrderClosure, normOrderKey } from '../src/lib/orderClosure'
import type { MaintenanceRecord } from '../src/services/maintenance'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

async function cmd(...args: string[]) {
  const res = await fetch(env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const body = await res.json()
  if (body.error) throw new Error(`${args[0]}: ${body.error}`)
  return body.result
}

async function readModule(module: string) {
  const metaRaw = await cmd('GET', `sync-3c:data:${module}:meta`)
  const meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw
  const chunks: string[] = []
  for (let i = 1; i <= (meta.chunkCount ?? 1); i++) {
    const c = await cmd('GET', `sync-3c:data:${module}:chunk:${i}`)
    if (c) chunks.push(typeof c === 'string' ? c : JSON.stringify(c))
  }
  return JSON.parse(chunks.join('')) as Record<string, unknown>[]
}

function identity(state: Record<string, unknown>): string {
  return [state.status, state.statusDate, state.statusDescription, state.statusUser, state.motivoEstadoRep].join('\u0001')
}

function collapse<T extends Record<string, unknown>>(records: T[]): T[] {
  return records.map((r) => {
    const states = r.states as Record<string, unknown>[] | undefined
    if (!Array.isArray(states)) return r
    const out: Record<string, unknown>[] = []
    let prev: string | null = null
    for (const s of states) {
      const k = identity(s)
      if (k === prev) continue
      prev = k
      out.push(s)
    }
    return { ...r, states: out } as T
  })
}

async function main() {
  const maintenance = await readModule('maintenance')
  const pedidos = await readModule('spare_part_orders')
  const collapsed = collapse(maintenance)

  const before = buildMaintenanceByOrder(maintenance as unknown as MaintenanceRecord[])
  const after = buildMaintenanceByOrder(collapsed as unknown as MaintenanceRecord[])

  let compared = 0
  let cerrados = 0
  const diffs: string[] = []
  for (const p of pedidos) {
    const orderNumber = String(p.orderNumber ?? '')
    const requestedAt = p.requestedAt ? new Date(p.requestedAt as string) : null
    const key = normOrderKey(orderNumber)
    const a = JSON.stringify(getOrderClosure({ orderNumber, requestedAt }, (before.get(key) ?? null) as MaintenanceRecord | null))
    const b = JSON.stringify(getOrderClosure({ orderNumber, requestedAt }, (after.get(key) ?? null) as MaintenanceRecord | null))
    compared++
    if (JSON.parse(a).closed) cerrados++
    if (a !== b) diffs.push(`${orderNumber}: ${a} != ${b}`)
  }

  const estadosAntes = maintenance.reduce((n, r) => n + ((r.states as unknown[])?.length ?? 0), 0)
  const estadosDespues = collapsed.reduce((n, r) => n + ((r.states as unknown[])?.length ?? 0), 0)
  console.log(`pedidos comparados=${compared} (cerrados en 3C=${cerrados})`)
  console.log(`states: ${estadosAntes} -> ${estadosDespues}`)
  console.log(`bytes: ${(JSON.stringify(maintenance).length / 1024 / 1024).toFixed(2)}MB -> ${(JSON.stringify(collapsed).length / 1024 / 1024).toFixed(2)}MB`)
  console.log(diffs.length === 0 ? 'OK: cierre IDENTICO antes y despues del colapso' : `DIFERENCIAS:\n${diffs.slice(0, 20).join('\n')}`)

  // Misma regla que isSpareWaitingStatus() de services/sparePartOrders.ts
  // (includes "espera" && "repuesto"), para no importar ese módulo acá: arrastra
  // el client SDK de Firebase y exige las API keys del navegador.
  const isWaiting = (status: unknown): boolean => {
    const t = String(status ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return t.includes('espera') && t.includes('repuesto')
  }
  const firstWaitingDate = (rec: Record<string, unknown>): string | null => {
    const states = (rec.states as Record<string, unknown>[] | undefined) ?? []
    for (const s of states) {
      if (isWaiting(s.status) && s.statusDate) return String(s.statusDate)
    }
    if (isWaiting(rec.status)) return String(rec.statusDate ?? rec.entryDate ?? '')
    return null
  }
  let waitingDiffs = 0
  for (let i = 0; i < maintenance.length; i++) {
    if (firstWaitingDate(maintenance[i]) !== firstWaitingDate(collapsed[i])) waitingDiffs++
  }
  console.log(waitingDiffs === 0
    ? 'OK: fecha del primer estado "A la Espera Repuestos" (requestedAt de Pedidos Rep.) IDENTICA'
    : `DIFERENCIAS en la fecha de espera: ${waitingDiffs}`)

  const rec11154 = maintenance.find((r) => String(r.orderNumber ?? '').includes('11154'))
  const rec11154c = collapsed.find((r) => String(r.orderNumber ?? '').includes('11154'))
  console.log('11154 states:', (rec11154?.states as unknown[])?.length, '->', (rec11154c?.states as unknown[])?.length)
  const p11154 = pedidos.find((p) => String(p.orderNumber ?? '').includes('11154'))
  if (p11154) {
    const info = getOrderClosure(
      { orderNumber: String(p11154.orderNumber), requestedAt: p11154.requestedAt ? new Date(p11154.requestedAt as string) : null },
      (after.get(normOrderKey(String(p11154.orderNumber))) ?? null) as MaintenanceRecord | null,
    )
    console.log('11154 cierre tras el cambio:', JSON.stringify(info))
  }
}

void main()
