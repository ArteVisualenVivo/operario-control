"use client"

import { useEffect, useState, useCallback } from "react"
import type { Rental, RentalFormData } from "@/types"
import * as rentalService from "@/services/rentals"

export function useRentals() {
  const [rentals, setRentals] = useState<Rental[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await rentalService.getRentals()
    setRentals(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const create = useCallback(async (data: RentalFormData) => {
    await rentalService.createRental(data)
    await load()
  }, [load])

  const close = useCallback(async (id: string) => {
    await rentalService.closeRental(id)
    await load()
  }, [load])

  return { rentals, loading, create, close, reload: load }
}
