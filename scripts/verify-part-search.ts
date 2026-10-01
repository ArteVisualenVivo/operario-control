/**
 * Diagnóstico del buscador de repuestos ("Repuestos" → ¿en qué máquinas se usa?).
 *
 * Corre `findCompatibleMachines()` contra los datos REALES del espejo: el
 * snapshot de Pedidos Rep. de Redis + las fichas de repuestos en disco. Muestra,
 * por cada búsqueda, las máquinas DISTINTAS (por modelo completo), los avisos
 * «se parece a» y las primeras filas del historial.
 *
 * Sirve para comprobar sin abrir el navegador:
 *  - que el mismo repuesto se vea en varias máquinas (reemplazo posible),
 *  - que NO se repita una fila por pedido (la agrupación es por máquina),
 *  - que un código/nombre inexistente no devuelva nada.
 *
 * Uso: npx tsx scripts/verify-part-search.ts
 *      npx tsx scripts/verify-part-search.ts 1600210034 "buje de aguja"
 */
import "../sync-agent/env"
import fs from "node:fs"
import path from "node:path"
import { findCompatibleMachines } from "../src/lib/partCompatibility"
import type { CompatibilidadRepuesto } from "../src/lib/partCompatibility"
import { getRedis, readModuleData } from "../src/lib/sync-3c/redisPrimary"
import type { Machine, SparePart, SparePartOrder } from "../src/types"

/** Consultas por defecto: un código que aparece en varias máquinas, otro de una
 *  sola máquina, dos nombres y dos casos que NO deben devolver nada. */
const DEFAULT_QUERIES = ["1600210034", "1 619 PB9 430", "inducido", "rodamiento", "motosierr", "zzzz9999"]

function readJson<T>(file: string): T[] {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function show(query: string, r: CompatibilidadRepuesto | null) {
  console.log(`\n═══ "${query}" ═══`)
  if (!r) {
    console.log("   (sin resultados)")
    return
  }
  console.log(`   modo=${r.modo} clave=${r.clave} → ${r.maquinas.length} máquina(s) DISTINTA(S)`)
  for (const m of r.maquinas) {
    const hint = m.sePareceA ? `   ⚠ se parece a: ${m.sePareceA}` : ""
    console.log(
      `   · ${m.modeloCompleto}   [3C: ${m.machineName}]   veces=${m.pedidosCount} última=${m.ultimoPedido} códigos=${JSON.stringify(
        m.partCodes,
      )}${hint}`,
    )
    for (const p of m.detallePedidos.slice(0, 3)) {
      console.log(
        `        - ${p.orderNumber} | ${p.description} | ${p.status} | pedido:${p.pedido} traído:${p.traido} util:${p.utilizado}`,
      )
    }
  }
}

async function main() {
  const env = await readModuleData("spare_part_orders", getRedis())
  const orders = (Array.isArray(env?.data) ? env.data : []) as unknown as SparePartOrder[]
  const parts = readJson<SparePart>("automation-watcher/cache/spare-parts-cache.json")
  const machines = readJson<Machine>("automation-watcher/cache/machines-cache.json")
  console.log(`datos: ${orders.length} pedidos · ${parts.length} fichas · ${machines.length} máquinas`)

  const data = { orders, parts, machines }
  const queries = process.argv.slice(2)
  for (const q of queries.length > 0 ? queries : DEFAULT_QUERIES) {
    show(q, findCompatibleMachines(q, data))
  }
}

main().catch((err) => {
  console.error("[verify] Error:", err instanceof Error ? err.message : err)
  process.exit(1)
})
