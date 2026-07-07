// =============================================================================
// inventoryGroups.ts — Catálogo oficial de grupos de productos
// Basado exclusivamente en códigos 3C (identificador estable del Sync Agent).
// Este archivo será reutilizado por toda la aplicación (Dashboard, Estadísticas,
// Alquileres, Remitos, etc.).
//
// REGLAS:
// - Solo usar códigos 3C (campo `codigo`) como identificador.
// - No usar nombres ni categorías (cambian en 3C).
// =============================================================================

/**
 * Códigos 3C oficiales de la familia ANDAMIOS.
 * Verificados contra stock-cache.json (17.227 artículos analizados).
 */
export const SCAFFOLD_CODES = {
    // Estructuras completas (juegos de andamio)
    structures: ["A03", "A04", "A 07", "28501", "28601"],

    // Riendas (búsqueda por código 3C)
    riendas_largas: ["R02", "R 04"],
    riendas_cortas: ["R 01", "R 03"],

    // Tablones para andamio
    planks: ["TA02", "TA03", "28901", "29001", "29101", "29201"],

    // Ruedas
    wheels_nobrake: ["N7-1"],
    wheels_brake: ["29501"],
    wheels_set: ["29601"],

    // Puntales
    puntales: ["28318", "28510", "28511", "28512", "PH305"],

    // Accesorios
    handrails: ["B01"],
    bases: ["BASE600", "NNQBASP"],
    regulators: ["28502"],
    extensions: ["28505", "28506"],

    // Caballetes (se alquilan como unidad)
    caballetes: ["28101", "CP01", "CP02"],
} as const

/**
 * Códigos 3C oficiales de la familia PUNTALES.
 * Verificados contra stock-cache.json (17.227 artículos analizados).
 */
export const PUNTAL_CODES = {
    // Puntales completos (estructuras)
    structures: ["28318", "28510", "28511", "28512", "PH305"],

    // Reguladores
    regulators: ["28502"],

    // Bases para puntal
    bases: ["BASE600", "NNQBASP"],

    // Ganchos
    hooks: ["GANCHO"],

    // Repuestos de puntal
    spare_parts: ["APH305", "PPH305", "RPH305"],

    // Extensiones relacionadas
    extensions: ["28505", "28506"],
} as const

/** Unión plana de todos los códigos de andamios. */
export const ALL_SCAFFOLD_CODES: string[] = Object.values(SCAFFOLD_CODES).flat()

// =============================================================================
// Helper: filtrar artículos de inventory_stock que pertenezcan a un grupo
// =============================================================================
import type { InventoryStock } from "@/types"

/**
 * Filtra un array de InventoryStock para quedarse solo con los que tengan
 * un código 3C incluido en `codes`.
 */
export function filterByCodes(items: InventoryStock[], codes: readonly string[]): InventoryStock[] {
    return items.filter((item) => item.codigo && codes.includes(item.codigo))
}

/**
 * Suma el stockAvailable de los artículos que coincidan con los códigos dados.
 */
export function sumStockByCodes(items: InventoryStock[], codes: readonly string[]): number {
    return filterByCodes(items, codes).reduce((sum, item) => sum + item.stockAvailable, 0)
}