"use client"

import { useEffect, useState, useCallback } from "react"
import type { SparePart, CreateSparePartInput } from "@/types"
import type { AppError } from "@/types/errors"
import { parseFirebaseError } from "@/lib/parseFirebaseError"
import * as sparePartsService from "@/services/spareParts"

export function useSpareParts(machineId: string) {
  const [spareParts, setSpareParts] = useState<SparePart[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await sparePartsService.getSparePartsByMachine(machineId)
      setSpareParts(data)
    } catch (e) {
      setError(parseFirebaseError(e, "machine_spare_parts"))
    } finally {
      setLoading(false)
    }
  }, [machineId])

  useEffect(() => { load() }, [load])

  const create = useCallback(async (input: CreateSparePartInput) => {
    await sparePartsService.createSparePart(input)
    await load()
  }, [load])

  const update = useCallback(async (id: string, data: Partial<Pick<SparePart, "partName" | "category" | "unit">>) => {
    await sparePartsService.updateSparePart(id, data)
    await load()
  }, [load])

  const remove = useCallback(async (id: string) => {
    await sparePartsService.deleteSparePart(id)
    await load()
  }, [load])

  const usePart = useCallback(async (id: string, quantity: number) => {
    await sparePartsService.usePart(id, quantity)
    await load()
  }, [load])

  const restockPart = useCallback(async (id: string, quantity: number) => {
    await sparePartsService.restockPart(id, quantity)
    await load()
  }, [load])

  return {
    spareParts, loading, error, create, update, remove, usePart, restockPart, reload: load,
  }
}
