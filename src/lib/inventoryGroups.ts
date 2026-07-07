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
 */
export const SCAFFOLD_CODES = {
    structures: ["A03", "A04", "A07", "28501", "28601"],
    planks: ["28901", "29001", "29101", "29201", "TA02", "TA03"],
    wheels_nobrake: ["N7-1"],
    wheels_brake: ["29501"],
    wheels_set: ["29601"],
    puntales: ["28318", "28510", "28511", "28512"],
    extensions: ["28505", "28506"],
    regulators: ["28502", "NNQBASP"],
    handrails: ["B01"],
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
