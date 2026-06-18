/**
 * REGLA DE DOMINIO:
 * - machines → alquiler unitario (1 doc = 1 unidad física)
 * - inventory_stock → inventario agregado (1 doc = stock total de un material)
 * - inventory_stock NO se alquila como unidad individual
 * - Solo se controla por cantidad (rentStockItem / returnStockItem)
 */

"use client"

import { useEffect, useState, useCallback } from "react"
import type { InventoryStock, CreateStockInput } from "@/types"
import * as inventoryStockService from "@/services/inventoryStock"

export function useInventoryStock() {
  const [items, setItems] = useState<InventoryStock[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await inventoryStockService.getStockItems()
    setItems(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const create = useCallback(async (input: CreateStockInput) => {
    await inventoryStockService.createStockItem(input)
    await load()
  }, [load])

  return { items, loading, create, reload: load }
}
