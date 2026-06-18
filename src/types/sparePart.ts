export type SparePartCategory =
  | "motor" | "filtro" | "electrico" | "estructural" | "consumible" | "otro"

export type SparePartSource = "manual" | "imported"

export interface SparePart {
  id: string
  machineId: string
  machineName: string
  machineModel: string
  partName: string
  partCode: string
  category: SparePartCategory
  unit: string
  stockTotal: number
  stockAvailable: number
  stockUsed: number
  source: SparePartSource
  createdAt: Date
  updatedAt: Date
}

export interface CreateSparePartInput {
  machineId: string
  machineName: string
  machineModel: string
  partName: string
  partCode: string
  category: SparePartCategory
  unit: string
  stockTotal: number
  source?: SparePartSource
}
