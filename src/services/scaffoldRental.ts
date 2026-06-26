import { SCAFFOLD_RECIPE } from "@/lib/scaffoldConfig"
import { getStockItems, rentStockItem, returnStockItem } from "./inventoryStock"

function label(component: { name: string; size?: string }): string {
  return component.size ? `${component.name} (${component.size})` : component.name
}

export async function rentScaffoldComponents(
  options?: { clientName?: string; projectName?: string; reference?: string },
): Promise<void> {
  const allStock = await getStockItems()

  for (const component of SCAFFOLD_RECIPE) {
    const matches = component.size
      ? allStock.filter(s => s.name === component.name && s.size === component.size)
      : allStock.filter(s => s.name === component.name)

    if (matches.length === 0) {
      throw new Error(
        `Componente "${label(component)}" no encontrado en inventario. Regístralo primero.`
      )
    }

    const totalAvailable = matches.reduce((s, i) => s + i.stockAvailable, 0)
    if (totalAvailable < component.quantity) {
      throw new Error(
        `Stock insuficiente para ${label(component)}: ` +
        `disponible ${totalAvailable}, necesario ${component.quantity}.`
      )
    }

    let remaining = component.quantity
    const sorted = [...matches].sort((a, b) => b.stockAvailable - a.stockAvailable)
    for (const item of sorted) {
      if (remaining <= 0) break
      if (item.stockAvailable <= 0) continue
      const take = Math.min(item.stockAvailable, remaining)
      await rentStockItem(item.id, take, options)
      remaining -= take
    }
  }
}

export async function returnScaffoldComponents(
  options?: { clientName?: string; projectName?: string; reference?: string },
): Promise<void> {
  const allStock = await getStockItems()

  for (const component of SCAFFOLD_RECIPE) {
    const matches = component.size
      ? allStock.filter(s => s.name === component.name && s.size === component.size)
      : allStock.filter(s => s.name === component.name)

    if (matches.length === 0) {
      throw new Error(
        `Componente "${label(component)}" no encontrado en inventario.`
      )
    }

    let remaining = component.quantity
    const sorted = [...matches].sort((a, b) => b.stockRented - a.stockRented)
    for (const item of sorted) {
      if (remaining <= 0) break
      if (item.stockRented <= 0) continue
      const take = Math.min(item.stockRented, remaining)
      await returnStockItem(item.id, take, options)
      remaining -= take
    }
  }
}
