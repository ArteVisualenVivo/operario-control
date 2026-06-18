import { SCAFFOLD_RECIPE } from "@/lib/scaffoldConfig"
import { getStockItems, rentStockItem, returnStockItem } from "./inventoryStock"

export async function rentScaffoldComponents(): Promise<void> {
  const allStock = await getStockItems()

  for (const component of SCAFFOLD_RECIPE) {
    const match = allStock.find(
      s => s.name === component.name && s.size === component.size
    )

    if (!match) {
      throw new Error(
        `Componente "${component.name} (${component.size})" no encontrado en inventario. Regístralo primero.`
      )
    }

    if (match.stockAvailable < component.quantity) {
      throw new Error(
        `Stock insuficiente para ${component.name} (${component.size}): ` +
        `disponible ${match.stockAvailable}, necesario ${component.quantity}.`
      )
    }

    await rentStockItem(match.id, component.quantity)
  }
}

export async function returnScaffoldComponents(): Promise<void> {
  const allStock = await getStockItems()

  for (const component of SCAFFOLD_RECIPE) {
    const match = allStock.find(
      s => s.name === component.name && s.size === component.size
    )

    if (!match) {
      throw new Error(
        `Componente "${component.name} (${component.size})" no encontrado en inventario.`
      )
    }

    await returnStockItem(match.id, component.quantity)
  }
}
