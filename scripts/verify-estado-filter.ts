// verify-estado-filter.ts — Verificación del filtro por ESTADO del Dashboard.
//
// Uso: npx tsx scripts/verify-estado-filter.ts [consulta ...]
// Sin argumentos usa consultas por defecto.
//
// ¿Por qué existe?
//   El Dashboard muestra la sección "Reparaciones / Mantenimiento" con las
//   órdenes que devuelve la búsqueda y, dentro del item ESTADO, un desplegable
//   para filtrar por las opciones que ese item tiene en ESE resultado
//   (src/components/dashboard/DashboardResults.tsx → ReparacionesSection).
//   La lógica vive en src/lib/search-grouped.ts: estadosDeReparaciones() y
//   filtrarReparacionesPorEstado().
//
// Este script comprueba, sobre la base REAL de Redis (sólo LEE):
//  1) la búsqueda agrupa las órdenes igual que la pantalla (searchGrouped);
//  2) las opciones del desplegable son los estados presentes en el resultado,
//     con su cantidad, y suman exactamente el total de filas (no se pierde ni se
//     inventa ninguna orden);
//  3) filtrar por cada opción devuelve EXACTAMENTE las filas contadas, todas con
//     ese estado (ni una de más ni de menos);
//  4) la unión de todos los filtros reconstruye el resultado completo y sin
//     filtro se devuelven las mismas filas en el mismo orden;
//  5) los estados se toman tal cual de 3C (no hay agrupaciones inventadas).
import { readFileSync } from 'node:fs'
import {
  estadosDeReparaciones,
  filtrarReparacionesPorEstado,
  searchGrouped,
  type GroupedSearchData,
  type ReparacionRow,
} from '../src/lib/search-grouped'
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
 * Mismo mapeo que mapRawRecords() de src/lib/local-sync.ts: fechas ISO de Redis
 * → Date reales, que es lo que la pantalla tiene en memoria.
 */
function mapRecords(data: Record<string, unknown>[]): MaintenanceRecord[] {
  return data.map((item) => ({
    ...item,
    entryDate: new Date((item.entryDate as string) ?? new Date()),
    returnDate: item.returnDate ? new Date(item.returnDate as string) : undefined,
    repairDate: item.repairDate ? new Date(item.repairDate as string) : undefined,
    statusDate: item.statusDate ? new Date(item.statusDate as string) : undefined,
    createdAt: new Date((item.createdAt as string) ?? new Date()),
    updatedAt: new Date((item.updatedAt as string) ?? new Date()),
  })) as MaintenanceRecord[]
}

/** Las mismas columnas que dibuja la tabla (orden + estado). */
const rowKey = (r: ReparacionRow) => `${r.orden}\u0001${r.estado}`

async function main() {
  const consultas = process.argv.slice(2)
  const queries = consultas.length > 0 ? consultas : ['donadille', 'a la espera repuestos', 'pison', 'en taller']
  const ordenes = mapRecords(await readModule('maintenance'))
  const data: GroupedSearchData = { orders: ordenes, machines: [], stockItems: [] }

  const problemas: string[] = []
  let combinaciones = 0

  for (const q of queries) {
    const resultado = searchGrouped(q, data)
    const filas = resultado.reparaciones
    const opciones = estadosDeReparaciones(filas)

    console.log(`\n=== "${q}" -> ${filas.length} ordenes en la seccion Reparaciones`)
    for (const o of opciones) console.log(`      ${String(o.cantidad).padStart(4)}  ${o.estado}`)

    // (2) las opciones suman el total de filas
    const suma = opciones.reduce((n, o) => n + o.cantidad, 0)
    if (suma !== filas.length) problemas.push(`${q}: las opciones suman ${suma} pero hay ${filas.length} filas`)

    // (3) cada filtro devuelve exactamente lo contado, y sólo de ese estado
    const union = new Set<string>()
    for (const o of opciones) {
      const filtradas = filtrarReparacionesPorEstado(filas, o.estado)
      combinaciones++
      if (filtradas.length !== o.cantidad) {
        problemas.push(`${q} / "${o.estado}": el filtro devuelve ${filtradas.length} y el desplegable dice ${o.cantidad}`)
      }
      const ajenas = filtradas.filter((r) => (r.estado || '').trim() !== o.estado && o.estado !== '(sin estado)')
      if (ajenas.length > 0) problemas.push(`${q} / "${o.estado}": ${ajenas.length} filas con OTRO estado`)
      for (const r of filtradas) union.add(rowKey(r))
    }

    // (4) la unión de los filtros = el resultado completo, y sin filtro no cambia
    if (union.size !== filas.length) {
      problemas.push(`${q}: la union de los filtros cubre ${union.size} de ${filas.length} filas`)
    }
    const sinFiltro = filtrarReparacionesPorEstado(filas, null)
    if (sinFiltro.length !== filas.length || sinFiltro.some((r, i) => r !== filas[i])) {
      problemas.push(`${q}: sin filtro NO se devuelven las mismas filas en el mismo orden`)
    }

    // (5) los estados son los de 3C, tal cual
    for (const o of opciones) {
      const original = filas.find((r) => r.estado.trim() === o.estado)
      if (o.estado !== '(sin estado)' && original && original.estado !== o.estado) {
        problemas.push(`${q} / "${o.estado}": el filtro usa un texto distinto al de 3C ("${original.estado}")`)
      }
    }
  }

  console.log(`\nconsultas=${queries.length} combinaciones estado/filtro=${combinaciones}`)
  console.log(problemas.length === 0 ? 'OK: el filtro por estado es exacto y no pierde filas' : `PROBLEMAS:\n${problemas.slice(0, 20).join('\n')}`)
  if (problemas.length > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
