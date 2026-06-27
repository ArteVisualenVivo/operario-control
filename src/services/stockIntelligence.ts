import { getStockItems } from "./inventoryStock"
import { getAllSpareParts } from "./spareParts"
import { getMachines } from "./machines"
import { getRepairs } from "./repairs"
import { getRecentInventoryMovements } from "./inventoryMovements"
import type {
  StockIntelligence, StockAlert, StockHealthScore,
} from "@/types/stockAlert"
import type { InventoryStock, SparePart, Machine, MachineRepair, InventoryMovement } from "@/types"

let cache: StockIntelligence | null = null
let lastFetch = 0
let globalPromise: Promise<StockIntelligence> | null = null
const CACHE_TTL = 60_000

function getMaterialAlerts(items: InventoryStock[]): StockAlert[] {
  const alerts: StockAlert[] = []
  for (const item of items) {
    if (item.stockAvailable === 0) {
      alerts.push({
        id: `mat-critical-${item.id}`,
        type: "CRITICAL",
        entityType: "MATERIAL",
        entityId: item.id,
        message: `Stock crítico: ${item.name}`,
        detail: `Disponible: 0 — Sin stock para alquiler`,
        createdAt: new Date(),
      })
    } else if (item.stockTotal > 0 && item.stockAvailable <= item.stockTotal * 0.2) {
      alerts.push({
        id: `mat-warning-${item.id}`,
        type: "WARNING",
        entityType: "MATERIAL",
        entityId: item.id,
        message: `Stock bajo: ${item.name}`,
        detail: `Disponible: ${item.stockAvailable} / ${item.stockTotal} (${Math.round(item.stockAvailable / item.stockTotal * 100)}%)`,
        createdAt: new Date(),
      })
    }
  }
  return alerts
}

function getSparePartAlerts(parts: SparePart[]): StockAlert[] {
  const alerts: StockAlert[] = []
  for (const part of parts) {
    if (part.stockAvailable === 0) {
      alerts.push({
        id: `sp-critical-${part.id}`,
        type: "CRITICAL",
        entityType: "SPARE_PART",
        entityId: part.id,
        message: `Repuesto crítico: ${part.partName}`,
        detail: `Disponible: 0 — ${part.machineName} (${part.partCode})`,
        createdAt: new Date(),
      })
    } else if (part.stockTotal > 0 && part.stockAvailable <= part.stockTotal * 0.15) {
      alerts.push({
        id: `sp-warning-${part.id}`,
        type: "WARNING",
        entityType: "SPARE_PART",
        entityId: part.id,
        message: `Repuesto bajo: ${part.partName}`,
        detail: `Disponible: ${part.stockAvailable} / ${part.stockTotal} — ${part.machineName}`,
        createdAt: new Date(),
      })
    }
  }
  return alerts
}

function getMachineAlerts(machines: Machine[], repairs: MachineRepair[]): StockAlert[] {
  const alerts: StockAlert[] = []

  const now = new Date()
  const overdueRepairIds = new Set<string>()
  for (const r of repairs) {
    if (r.maintenanceDueDate && r.maintenanceDueDate < now) {
      overdueRepairIds.add(r.machineId)
    }
  }

  for (const m of machines) {
    if (m.status === "maintenance" && overdueRepairIds.has(m.id)) {
      alerts.push({
        id: `mach-critical-${m.id}`,
        type: "CRITICAL",
        entityType: "MACHINE",
        entityId: m.id,
        message: `Mantenimiento vencido: ${m.name}`,
        detail: `Máquina en mantenimiento con fecha vencida`,
        createdAt: new Date(),
      })
    } else if (m.status === "maintenance") {
      alerts.push({
        id: `mach-warning-${m.id}`,
        type: "WARNING",
        entityType: "MACHINE",
        entityId: m.id,
        message: `Máquina en mantenimiento: ${m.name}`,
        detail: `Requiere seguimiento`,
        createdAt: new Date(),
      })
    }
  }

  return alerts
}

function getTopConsumedMaterials(
  movements: InventoryMovement[],
  items: InventoryStock[],
  n: number,
): { materialId: string; materialName: string; total: number }[] {
  const map = new Map<string, number>()
  for (const m of movements) {
    if (m.type === "ALQUILER") {
      map.set(m.materialId, (map.get(m.materialId) ?? 0) + m.quantity)
    }
  }

  const nameMap = new Map<string, string>()
  for (const item of items) nameMap.set(item.id, item.name)

  return Array.from(map.entries())
    .map(([materialId, total]) => ({
      materialId,
      materialName: nameMap.get(materialId) ?? "Desconocido",
      total,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
}

function getStockHealthScore(
  items: InventoryStock[],
  parts: SparePart[],
  machines: Machine[],
  alerts: StockAlert[],
): StockHealthScore {
  const totalItems = items.length + parts.length + machines.length
  if (totalItems === 0) return { overall: 100, materials: 100, spareParts: 100, machines: 100 }

  const criticalCount = alerts.filter((a) => a.type === "CRITICAL").length

  const materialCritical = alerts.filter((a) => a.entityType === "MATERIAL" && a.type === "CRITICAL").length
  const materialScore = items.length === 0 ? 100 : Math.round((1 - materialCritical / items.length) * 100)

  const partCritical = alerts.filter((a) => a.entityType === "SPARE_PART" && a.type === "CRITICAL").length
  const partScore = parts.length === 0 ? 100 : Math.round((1 - partCritical / parts.length) * 100)

  const machineCritical = alerts.filter((a) => a.entityType === "MACHINE" && a.type === "CRITICAL").length
  const machineScore = machines.length === 0 ? 100 : Math.round((1 - machineCritical / machines.length) * 100)

  const overall = Math.round((1 - criticalCount / totalItems) * 100)

  return { overall, materials: materialScore, spareParts: partScore, machines: machineScore }
}

function getOverallTrend(movements: InventoryMovement[]): "up" | "down" | "stable" {
  const now = new Date()
  const last7 = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const last14 = now.getTime() - 14 * 24 * 60 * 60 * 1000

  let recent = 0
  let previous = 0
  for (const m of movements) {
    const t = m.date.getTime()
    if (t >= last7 && m.type === "ALQUILER") recent += m.quantity
    else if (t >= last14 && t < last7 && m.type === "ALQUILER") previous += m.quantity
  }

  if (previous === 0) return recent > 0 ? "up" : "stable"
  const ratio = recent / previous
  if (ratio > 1.15) return "up"
  if (ratio < 0.85) return "down"
  return "stable"
}

export async function getStockIntelligence(): Promise<StockIntelligence> {
  const now = Date.now()
  if (cache && now - lastFetch < CACHE_TTL) return cache
  if (globalPromise) return globalPromise

  globalPromise = (async () => {
    const [items, parts, machines, repairs, movements] = await Promise.all([
      getStockItems(),
      getAllSpareParts(),
      getMachines(),
      getRepairs(),
      getRecentInventoryMovements(30, 200),
    ])

    const materialAlerts = getMaterialAlerts(items)
    const partAlerts = getSparePartAlerts(parts)
    const machineAlerts = getMachineAlerts(machines, repairs)

    const allAlerts = [...materialAlerts, ...partAlerts, ...machineAlerts]
    const criticalItems = allAlerts.filter((a) => a.type === "CRITICAL")
    const healthScore = getStockHealthScore(items, parts, machines, allAlerts)
    const topConsumed = getTopConsumedMaterials(movements, items, 5)
    const trend = getOverallTrend(movements)

    const result: StockIntelligence = {
      alerts: allAlerts,
      healthScore,
      topConsumed,
      criticalItems,
      trend,
    }

    cache = result
    lastFetch = now
    globalPromise = null
    return result
  })()

  return globalPromise
}
