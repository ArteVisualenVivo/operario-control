import type { MaintenanceRecord } from "@/services/maintenance"
import type { MachineRepair } from "@/types"

/**
 * Vinculación estable entre maintenance y repairs.
 * Clave: MaintenanceRecord.orderNumber ↔ MachineRepair.externalId/machineId
 *
 * NO usa machineName ni string matching de nombres.
 * Solo lectura, no modifica Firestore.
 */

export function groupRepairsByOrderNumber(
  repairs: MachineRepair[],
): Map<string, MachineRepair[]> {
  const map = new Map<string, MachineRepair[]>()
  for (const repair of repairs) {
    const key = (repair.externalId ?? repair.machineId)?.trim()
    if (!key) continue
    const list = map.get(key) ?? []
    list.push(repair)
    map.set(key, list)
  }
  return map
}

export function getRepairsForMaintenanceOrder(
  order: MaintenanceRecord,
  repairs: MachineRepair[],
): MachineRepair[] {
  const map = groupRepairsByOrderNumber(repairs)
  return map.get(order.orderNumber) ?? []
}

export function getMaintenanceForRepair(
  repair: MachineRepair,
  maintenance: MaintenanceRecord[],
): MaintenanceRecord | undefined {
  const key = (repair.externalId ?? repair.machineId)?.trim()
  if (!key) return undefined
  return maintenance.find((m) => m.orderNumber === key)
}

export function hasMaintenanceLink(
  repair: MachineRepair,
): boolean {
  return Boolean((repair.externalId ?? repair.machineId)?.trim())
}
