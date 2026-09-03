import { normalizeCode } from "@/lib/inventoryGroups"
import { getStockItems, rentStockItem, returnStockItem } from "./inventoryStock"

// =============================================================================
// scaffoldRental.ts — Descuento/devolución de componentes al alquilar una
// máquina de andamio (category: "scaffold").
//
// REGLA DE NEGOCIO (1 juego = 2 paños + 2 riendas largas + 2 riendas cortas).
// El matcheo es POR CÓDIGO 3C (identificador estable), NO por nombre:
//   - Paños comunes/especiales: 28601, A03 (en 3C el juego reforzado es A03)
//   - Paños pasilleros:         28501, A04, A 07
//   - Riendas largas:           R02, R 04
//   - Riendas cortas:           R 01, R 03
// =============================================================================

const PANOS_COMUNES = ["28601", "A03"]
const PANOS_PASILLERO = ["28501", "A04", "A07"]
const RIENDAS_LARGAS = ["R02", "R 04"]
const RIENDAS_CORTAS = ["R 01", "R 03"]

interface ComponentRequirement {
  label: string
  codes: string[]
  quantity: number
}

function requirementsFor(machineName: string): ComponentRequirement[] {
  const isPasillero = /pasillero/i.test(machineName ?? "")
  return [
    {
      label: isPasillero ? "Paño pasillero" : "Paño común/especial",
      codes: isPasillero ? PANOS_PASILLERO : PANOS_COMUNES,
      quantity: 2,
    },
    { label: "Rienda larga", codes: RIENDAS_LARGAS, quantity: 2 },
    { label: "Rienda corta", codes: RIENDAS_CORTAS, quantity: 2 },
  ]
}

function matchesCodes(itemCodigo: string | undefined, codes: string[]): boolean {
  const normalized = normalizeCode(itemCodigo)
  if (!normalized) return false
  return codes.some((c) => normalizeCode(c) === normalized)
}

export async function rentScaffoldComponents(
  options?: { clientName?: string; projectName?: string; reference?: string; machineName?: string },
): Promise<void> {
  const allStock = await getStockItems()
  const requirements = requirementsFor(options?.machineName ?? "")

  for (const req of requirements) {
    const matches = allStock.filter((s) => matchesCodes(s.codigo, req.codes))

    if (matches.length === 0) {
      throw new Error(
        `Componente "${req.label}" no encontrado en inventario por código (${req.codes.join(", ")}). Verificá la sincronización de stock.`,
      )
    }

    const totalAvailable = matches.reduce((s, i) => s + i.stockAvailable, 0)
    if (totalAvailable < req.quantity) {
      throw new Error(
        `Stock insuficiente para ${req.label}: disponible ${totalAvailable}, necesario ${req.quantity}.`,
      )
    }

    let remaining = req.quantity
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
  options?: { clientName?: string; projectName?: string; reference?: string; machineName?: string },
): Promise<void> {
  const allStock = await getStockItems()
  const requirements = requirementsFor(options?.machineName ?? "")

  for (const req of requirements) {
    const matches = allStock.filter((s) => matchesCodes(s.codigo, req.codes))
    if (matches.length === 0) continue

    let remaining = req.quantity
    const sorted = [...matches].sort((a, b) => b.stockRented - a.stockRented)
    for (const item of sorted) {
      if (remaining <= 0) break
      if (item.stockRented <= 0) continue
      const give = Math.min(item.stockRented, remaining)
      await returnStockItem(item.id, give, options)
      remaining -= give
    }
  }
}
