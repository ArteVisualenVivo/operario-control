"use client"

import { useMachines } from "./useMachines"

export function useRentals() {
  const { machines, loading } = useMachines()
  const rentals = machines.filter((m) => m.rental)
  return { rentals, loading }
}
