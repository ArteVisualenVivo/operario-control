/**
 * Verificación end-to-end del campo "Alquilado por" del Dashboard.
 *
 * Trae de PRODUCCIÓN (Redis primario vía API) el snapshot de stock/articulos y
 * el de alquileres, y ejecuta la MISMA función que usa el Dashboard
 * (`searchGrouped`) para imprimir qué mostraría la tabla de resultado.
 *
 * Uso:
 *   npx tsx scripts/verify-alquilado-por.ts                 # consultas por defecto
 *   npx tsx scripts/verify-alquilado-por.ts pison demoledor # consultas propias
 *
 * Si una máquina aparece con "Alquilado por" vacío, o su código no está en el
 * detalle de alquileres, el problema es de datos (sync), no de UI.
 */
import { searchGrouped } from "@/lib/search-grouped"
import type { GroupedSearchData } from "@/lib/search-grouped"
import { normalizeFlat } from "@/lib/fuzzySearch"
import type { InventoryStock } from "@/types"

const BASE = process.env.SYNC_API_BASE || "https://operario-control-chi.vercel.app"

/**
 * Mapeo mínimo idéntico en lo esencial a `mapPrimaryToStock`
 * (src/services/inventoryStock.ts): solo los campos que consume searchGrouped.
 * Se replica a propósito porque el servicio importa Firebase/Auth de cliente.
 */
function mapPrimary(raw: Record<string, unknown>): InventoryStock {
    const codigo = (raw.codigo as string) ?? ""
    return {
        id: String(codigo || raw.name || ""),
        codigo: codigo || undefined,
        name: (raw.name as string) ?? "",
        category: (raw.category as InventoryStock["category"]) ?? "consumibles",
        unit: (raw.unit as InventoryStock["unit"]) ?? "unidad",
        stockTotal: (raw.stockTotal as number) ?? 0,
        stockAvailable: (raw.stockTotal as number) ?? 0,
        stockRented: (raw.stockRented as number) ?? 0,
        subtype: null,
        size: null,
        locationType: "deposito",
        createdAt: new Date(),
        updatedAt: new Date(),
    } as InventoryStock
}

async function fetchModule(module: string): Promise<{ data: unknown; recordCount: number; updatedAt: string | null; available: boolean }> {
    const res = await fetch(`${BASE}/api/sync-3c/data/${module}`, { cache: "no-store" })
    const body = await res.json()
    return {
        available: Boolean(body?.available),
        data: body?.data ?? null,
        recordCount: typeof body?.recordCount === "number" ? body.recordCount : 0,
        updatedAt: body?.updatedAt ?? null,
    }
}

async function main() {
    const queries = process.argv.slice(2).filter((a) => !a.startsWith("-"))
    const lista = queries.length > 0 ? queries : ["pison", "demoledor", "motosierra", "22001"]

    const [stockRes, articulosRes, alqRes] = await Promise.all([
        fetchModule("stock"),
        fetchModule("articulos"),
        fetchModule("alquileres"),
    ])

    console.log(`BASE: ${BASE}`)
    console.log(`stock: ${stockRes.recordCount} filas (${stockRes.updatedAt})`)
    console.log(`articulos: ${articulosRes.recordCount} filas (${articulosRes.updatedAt})`)
    console.log(`alquileres: ${alqRes.recordCount} renglones (${alqRes.updatedAt})`)

    const scaffoldRentals = (alqRes.data ?? null) as GroupedSearchData["scaffoldRentals"]
    const detalle = scaffoldRentals?.detalle ?? []
    const conRemito = detalle.filter((d) => d.remito)
    console.log(`alquileres con remito: ${conRemito.length}`)
    console.log(`codigos con remito: ${[...new Set(conRemito.map((d) => d.codigo))].join(", ")}\n`)

    // Mismo merge que `loadPrimaryStock()` (inventoryStock.ts): los registros de
    // `articulos` cuyo nombre ya existe en `stock` se descartan, y `stock` gana.
    const stock = ((stockRes.data as Record<string, unknown>[]) ?? []).map(mapPrimary)
    const articulos = ((articulosRes.data as Record<string, unknown>[]) ?? []).map(mapPrimary)
    const nombresEnStock = new Set(stock.map((i) => normalizeFlat(i.name)))
    const stockItems = [
        ...articulos.filter((i) => !nombresEnStock.has(normalizeFlat(i.name))),
        ...stock,
    ]
    console.log(`stockItems fusionados (stock gana): ${stockItems.length}\n`)

    for (const q of lista) {
        const results = searchGrouped(q, {
            orders: [],
            machines: [],
            stockItems,
            scaffoldRentals,
            spareParts: [],
            spareOrders: [],
        })
        console.log(`── consulta "${q}" → ${results.totalResultados} resultados (${results.maquinas.length} máquinas, ${results.materiales.length} materiales, ${results.componentes.length} componentes, ${results.alquileres.length} grupos de alquiler)`)
        for (const m of results.maquinas) {
            console.log(`   [MAQ] ${m.codigo} "${m.nombre}" (${m.familia}) → Alquilado por: ${m.alquiladoPor || "—"}`)
        }
        for (const c of results.componentes.slice(0, 3)) {
            console.log(`   [COMP] ${c.codigo} "${c.nombre}" → Alquilado por: ${c.alquiladoPor || "—"}`)
        }
        for (const m of results.materiales.slice(0, 5)) {
            console.log(`   [MAT] ${m.codigo} "${m.nombre}" (${m.familia}) → Alquilado por: ${m.alquiladoPor || "—"}`)
        }
        for (const a of results.alquileres.slice(0, 5)) {
            console.log(`   [ALQ] ${a.cliente} | remitos: ${a.remitos.join(", ")}`)
        }
    }
}

main().catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e)
    process.exit(1)
})
