import { SCAFFOLD_RECIPE } from "@/lib/scaffoldConfig"
import { getStockItems, rentStockItem, returnStockItem } from "./inventoryStock"

export async function rentScaffoldComponents(): Promise<void> {
  const allStock = await getStockItems()

  for (const component of SCAFFOLD_RECIPE) {
    const matches = allStock.filter(s => s.name === component.name)
    if (matches.length === 0) {
      throw new Error(
        `Componente "${component.name}" no encontrado en inventario. Regístralo primero.`
      )
    }

    const totalAvailable = matches.reduce((s, i) => s + i.stockAvailable, 0)
    if (totalAvailable < component.quantity) {
      throw new Error(
        `Stock insuficiente para ${component.name}: ` +
        `disponible ${totalAvailable}, necesario ${component.quantity}.`
      )
    }

    let remaining = component.quantity
    const sorted = [...matches].sort((a, b) => b.stockAvailable - a.stockAvailable)
    for (const item of sorted) {
      if (remaining <= 0) break
      if (item.stockAvailable <= 0) continue
      const take = Math.min(item.stockAvailable, remaining)
      await rentStockItem(item.id, take)
      remaining -= take
    }
  }
}

export async function returnScaffoldComponents(): Promise<void> {
  const allStock = await getStockItems()

  for (const component of SCAFFOLD_RECIPE) {
    const matches = allStock.filter(s => s.name === component.name)
    if (matches.length === 0) {
      throw new Error(
        `Componente "${component.name}" no encontrado en inventario.`
      )
    }

    let remaining = component.quantity
    const sorted = [...matches].sort((a, b) => b.stockRented - a.stockRented)
    for (const item of sorted) {
      if (remaining <= 0) break
      if (item.stockRented <= 0) continue
      const take = Math.min(item.stockRented, remaining)
      await returnStockItem(item.id, take)
      remaining -= take
    }
  }
}
