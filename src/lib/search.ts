import type { Machine, InventoryStock } from "@/types"
import type { MaintenanceRecord } from "@/services/maintenance"
import type { SparePartOrder } from "@/types"

export type SearchResultType =
    | "orden"
    | "maquina"
    | "inventario"
    | "stock"
    | "alquiler"
    | "andamio"
    | "puntal"
    | "pedido"

export interface SearchResult {
    type: SearchResultType
    title: string
    subtitle: string
    route: string
    id: string
    score: number
}

export interface SearchData {
    orders: MaintenanceRecord[]
    machines: Machine[]
    stockItems: InventoryStock[]
    sparePartOrders?: SparePartOrder[]
}

/** Normaliza quitando acentos y pasando a minúsculas (mantiene espacios). */
function normalize(value: string | undefined | null): string {
    if (!value) return ""
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim()
}

/** Versión compacta: sin acentos, sin espacios ni guiones (para matching flexible). */
function compact(value: string | undefined | null): string {
    return normalize(value).replace(/[\s-]/g, "")
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Calcula la relevancia de un item respecto a los tokens del query.
 * Lógica OR: coincide si al menos un token está presente; el score se
 * acumula por cada token encontrado (búsqueda más útil primero).
 */
function scoreMatch(compactText: string, rawText: string, tokens: string[]): number {
    let score = 0
    for (const token of tokens) {
        if (!compactText.includes(token)) continue
        score += 2
        const wholeWord = new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}([^a-z0-9]|$)`, "i")
        if (wholeWord.test(rawText)) score += 4
        else if (new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}`, "i").test(rawText)) score += 1
    }
    return score
}

function classifyStock(item: InventoryStock): SearchResultType {
    if (item.category === "puntales") return "puntal"
    if (item.category === "andamio_accesorios" || item.category === "riendas") return "andamio"
    if (item.category === "consumibles") return "inventario"
    return "stock"
}

/**
 * Búsqueda global flexible sobre los datos ya cargados en memoria.
 * No consulta Firestore. Ignora acentos, mayúsculas, espacios y guiones.
 * Permite búsqueda parcial y por múltiples tokens (OR acumulativo).
 */
export function searchEverywhere(query: string, data: SearchData): SearchResult[] {
    const q = query.trim()
    if (!q) return []

    const tokens = compact(q).split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return []

    const joinedTokens = tokens.join("")
    const results: SearchResult[] = []

    // 1. Órdenes de mantenimiento
    for (const o of data.orders) {
        const fields = [
            o.orderNumber,
            o.clientName,
            o.clientCode,
            o.machineName,
            o.brand,
            o.model,
            o.observations,
            o.observaciones,
            o.technician,
            o.status,
            o.expediente,
            o.tipDoc,
            o.vendedor,
            o.reason,
            o.history,
        ]
        const allRaw = fields.join(" ")
        const allCompact = compact(allRaw)
        const s = scoreMatch(allCompact, allRaw, tokens)
        if (s <= 0) continue
        let score = s
        if (compact(o.orderNumber).startsWith(joinedTokens)) score += 5
        results.push({
            type: "orden",
            title: `#${o.orderNumber}`,
            subtitle: [o.machineName, o.clientName, o.status].filter(Boolean).join(" · "),
            route: "/repairs",
            id: o.id,
            score,
        })
    }

    // 2. Máquinas
    for (const m of data.machines) {
        const fields = [
            m.name,
            m.model,
            m.category,
            m.status,
            m.rental?.clientName,
            m.rental?.projectName,
            m.rental?.clientAddress,
            m.rental?.projectAddress,
        ]
        const allRaw = fields.join(" ")
        const allCompact = compact(allRaw)
        const s = scoreMatch(allCompact, allRaw, tokens)
        if (s <= 0) continue
        let score = s
        if (compact(m.name).startsWith(joinedTokens)) score += 5
        results.push({
            type: "maquina",
            title: m.name,
            subtitle: [m.model, m.status].filter(Boolean).join(" · "),
            route: `/machines/${m.id}`,
            id: m.id,
            score,
        })
    }

    // 5. Alquileres (máquinas con rental activo)
    for (const m of data.machines) {
        const r = m.rental
        if (!r) continue
        const fields = [
            r.clientName,
            r.projectName,
            r.clientAddress,
            r.projectAddress,
            m.name,
            m.model,
            m.status,
        ]
        const allRaw = fields.join(" ")
        const allCompact = compact(allRaw)
        const s = scoreMatch(allCompact, allRaw, tokens)
        if (s <= 0) continue
        let score = s + 1
        if (compact(r.clientName).startsWith(joinedTokens)) score += 5
        results.push({
            type: "alquiler",
            title: r.clientName,
            subtitle: `${[m.name, m.model].filter(Boolean).join(" ")} · Obra: ${r.projectName}`,
            route: "/rentals",
            id: m.id,
            score,
        })
    }

    // 3, 4, 6, 7. Inventario / Stock Global / Andamios / Puntales
    for (const item of data.stockItems) {
        const fields = [
            item.name,
            item.codigo,
            item.category,
            item.subtype,
            item.size,
            item.unit,
        ]
        const allRaw = fields.join(" ")
        const allCompact = compact(allRaw)
        const s = scoreMatch(allCompact, allRaw, tokens)
        if (s <= 0) continue
        const type = classifyStock(item)
        let score = s
        if (compact(item.name).startsWith(joinedTokens)) score += 5
        const route =
            type === "andamio" ? "/andamios" : `/inventory/${item.id}`
        results.push({
            type,
            title: item.name,
            subtitle: `Stock: ${item.stockAvailable}${item.codigo ? ` · Código: ${item.codigo}` : ""}`,
            route,
            id: item.id,
            score,
        })
    }

    // Pedidos de repuestos
    for (const o of data.sparePartOrders ?? []) {
        const fields = [
            o.description,
            o.code,
            o.orderNumber,
            o.machineName,
        ]
        const allRaw = fields.join(" ")
        const allCompact = compact(allRaw)
        const s = scoreMatch(allCompact, allRaw, tokens)
        if (s <= 0) continue
        let score = s
        if (compact(o.code).startsWith(joinedTokens)) score += 5
        results.push({
            type: "pedido",
            title: `${o.description} · ${o.code}`,
            subtitle: `${o.orderNumber || "—"} · ${o.machineName} · ${o.status}`,
            route: `/spare-part-orders/${o.id}`,
            id: o.id,
            score,
        })
    }

    return results.sort((a, b) => b.score - a.score)
}