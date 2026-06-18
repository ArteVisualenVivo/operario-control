export type MachineStatus = "available" | "rented" | "maintenance"
export type MachineLocation = "deposito" | "obra" | "taller"
export type MachineCategory = "machine" | "tool" | "scaffold"

export interface ClientInfo {
  name: string
  address: string
}

export interface ProjectInfo {
  name: string
  address: string
}

export interface LocationInfo {
  client: ClientInfo
  project: ProjectInfo
}

export interface MachineRental {
  clientName: string
  clientAddress: string
  projectName: string
  projectAddress: string
  startDate: Date
  expectedEndDate: Date | null
  isOpenEnded: boolean
}

export interface Machine {
  id: string
  name: string
  model: string
  category: MachineCategory | null
  status: MachineStatus
  locationType: MachineLocation
  location: LocationInfo | null
  rental: MachineRental | null
  createdAt: Date
  updatedAt: Date
}

export interface UpdateMachineInput {
  name?: string
  model?: string
  category?: MachineCategory | null
  status?: MachineStatus
  locationType?: MachineLocation
  location?: LocationInfo | null
}

export interface CreateMachineInput {
  name: string
  model: string
  category?: MachineCategory | null
  locationType: MachineLocation
  location?: LocationInfo | null
  status: MachineStatus
  rental: MachineRental | null
}
