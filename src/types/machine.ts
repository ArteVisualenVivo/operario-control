export type MachineStatus = "available" | "rented" | "maintenance"
export type MachineLocation = "taller" | "deposito" | "obra"
export type MachineCategory = "andamio" | "maquinaria" | "herramienta"

export interface MachineMetadata {
  priceAction: boolean | null
}

export interface RentalInfo {
  client: string
  startDate: Date
  returnDate: Date | null
}

export interface MaintenanceInfo {
  reason: string
  startDate: Date
  estimatedEnd: Date | null
}

export interface Machine {
  id: string
  name: string
  model: string
  category: MachineCategory | null
  subcategory: string | null
  metadata: MachineMetadata | null
  status: MachineStatus
  location: MachineLocation
  rental: RentalInfo | null
  maintenance: MaintenanceInfo | null
  createdAt: Date
  updatedAt: Date
}

export interface UpdateMachineInput {
  name?: string
  model?: string
  category?: MachineCategory | null
  subcategory?: string | null
  metadata?: MachineMetadata | null
  location?: MachineLocation
}

export interface CreateMachineInput {
  name: string
  model: string
  category?: MachineCategory | null
  subcategory?: string | null
  metadata?: MachineMetadata | null
  location: MachineLocation
  status: MachineStatus
  rental: { client: string; startDate: Date; returnDate: Date | null } | null
  maintenance: { reason: string; startDate: Date; estimatedEnd: Date | null } | null
}
