/**
 * REGLA DE DOMINIO:
 * - machines → alquiler unitario (1 doc = 1 unidad física)
 * - inventory_stock → inventario agregado (1 doc = stock total de un material)
 * - inventory_stock NO se alquila como unidad individual
 * - Solo se controla por cantidad (rentStockItem / returnStockItem)
 */

export type StockCategory = "puntales" | "riendas" | "andamio_accesorios" | "consumibles"
export type StockUnit = "unidad" | "metro" | "kg"

export type StockSubtype = "puntal" | "rienda" | "plataforma" | "diagonal" | "otros"

export type StockSize = "1m" | "1.5m" | "2m" | "2.5m" | "3m" | "4m" | "6m" | "custom"

export interface InventoryStock {
  id: string
  name: string
  category: StockCategory
  unit: StockUnit
  stockTotal: number
  stockAvailable: number
  stockRented: number
  subtype?: StockSubtype | null
  size?: StockSize | string | null
  locationType: "deposito"
  createdAt: Date
  updatedAt: Date
}

export interface CreateStockInput {
  name: string
  category: StockCategory
  unit: StockUnit
  stockTotal: number
  subtype?: StockSubtype | null
  size?: StockSize | string | null
}
