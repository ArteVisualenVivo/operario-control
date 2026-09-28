// verify-closure-states.ts — Verificación del consolidado de 3C (fechas y ruido).
//
// Uso: npx tsx scripts/verify-closure-states.ts
//
// ¿Por qué existe?
//  1) El consolidado guardaba una copia de cada fila de estado por CADA Excel
//     que la repetía: 27.414 estados para 1.137 órdenes cuando los distintos son
//     7.253 (3,8x de ruido) y 6,5 MB que el navegador bajaba entero (~8,5 s) en
//     cada pantalla. Si esa lectura falla, la regla de cierre de Pedidos Rep. se
//     queda sin datos y muestra órdenes ya reparadas en 3C.
//     → collapseRepeatedStates() (src/lib/sync-3c/consolidated.ts).
//  2) 3C repite la fecha de ALTA de la orden en todas las filas del informe de
//     estados, así que "Reparada" quedaba fechado el día de ingreso y la regla
//     de cierre (que descarta estados anteriores a la solicitud del repuesto)
//     ignoraba el cierre.
//     → cada estado se fecha con cuándo se bajó el Excel (mtime).
//
// Este script comprueba, sobre el snapshot REAL de Redis:
//  A) que colapsar los estados repetidos consecutivos NO cambia el cierre de
//     ningún pedido ni la fecha del primer "A la Espera Repuestos";
//  B) que al reconstruir el consolidado con los Excel reales del directorio de
//     exports el cierre sigue siendo el mismo y las fechas dejan de ser todas
//     iguales al día de ingreso.
// Sólo LEE Redis y los Excel: no escribe nada.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildConsolidatedOrders, consolidatedToMaintenanceRecords } from '../src/lib/sync-3c/consolidated'
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

/**
 * Misma identidad que stateIdentity() de src/lib/sync-3c/consolidated.ts:
 * estado + descripción + usuario + motivo. NO incluye la fecha (es cuándo lo
 * vimos) ni el archivo (es el mismo estado repetido en otro Excel).
 */
function identity(state: Record<string, unknown>): string {
  return [state.status, state.statusDescription, state.statusUser, state.motivoEstadoRep].join('\u0001')
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

  // —— B) Reconstruccion con los Excel reales (fechas = mtime del export) ——
  const exportsDir = path.resolve(process.cwd(), 'automation-watcher', '3c_exports')
  let files: string[] = []
  try {
    files = readdirSync(exportsDir).filter((f) => /\.xlsx?$/i.test(f))
  } catch {
    files = []
  }
  if (files.length === 0) {
    console.log('B) sin Excel en automation-watcher/3c_exports: no se puede reconstruir')
    return
  }
  const consolidated = await buildConsolidatedOrders(exportsDir)
  const rebuild = consolidatedToMaintenanceRecords(consolidated, maintenance as unknown as MaintenanceRecord[])
  const byRebuild = buildMaintenanceByOrder(rebuild)
  const fechasDeLaCorrida = files.map((f) => statSync(path.join(exportsDir, f)).mtime.getTime())
  const diasExport = new Set(fechasDeLaCorrida.map((t) => new Date(t).toISOString().slice(0, 10)))

  let cerradosRebuild = 0
  const cambios: string[] = []
  for (const p of pedidos) {
    const orderNumber = String(p.orderNumber ?? '')
    const requestedAt = p.requestedAt ? new Date(p.requestedAt as string) : null
    const key = normOrderKey(orderNumber)
    const a = getOrderClosure({ orderNumber, requestedAt }, (before.get(key) ?? null) as MaintenanceRecord | null)
    const b = getOrderClosure({ orderNumber, requestedAt }, (byRebuild.get(key) ?? null) as MaintenanceRecord | null)
    if (b.closed) cerradosRebuild++
    if (a.closed !== b.closed) cambios.push(`${orderNumber}: ${a.closed ? 'cerrada' : 'abierta'} -> ${b.closed ? 'cerrada' : 'abierta'}`)
  }
  const fechasPorRegistro = rebuild.filter((r) => new Set(((r.states as { statusDate?: string }[]) ?? []).map((s) => String(s.statusDate).slice(0, 10))).size > 1).length
  console.log(`B) Excel usados=${files.length} (dias de export: ${[...diasExport].sort().join(', ')}) ordenes consolidadas=${consolidated.size}`)
  console.log(`B) registros con fechas reales (mas de un dia en su linea de tiempo)=${fechasPorRegistro} de ${rebuild.length}`)
  console.log(`B) pedidos comparados=${pedidos.length} cerrados_antes=${cerrados} cerrados_reconstruido=${cerradosRebuild}`)
  console.log(cambios.length === 0
    ? 'B) OK: el cierre de los pedidos NO cambia con la reconstruccion'
    : `B) CAMBIOS DE CIERRE (revisar):\n${cambios.join('\n')}`)
}

void main()
