export interface LegacyRental {
  id: string
  machineId: string
  client: string
  startDate: Date
  returnDate: Date | null
  status: "active" | "closed"
  createdAt: Date
  updatedAt: Date
}
