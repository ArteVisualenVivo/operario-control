export type RentalStatus = "active" | "closed"

export interface Rental {
  id: string
  machineId: string
  client: string
  startDate: Date
  returnDate: Date | null
  status: RentalStatus
  createdAt: Date
  updatedAt: Date
}

export interface RentalFormData {
  machineId: string
  client: string
  startDate: Date
}
