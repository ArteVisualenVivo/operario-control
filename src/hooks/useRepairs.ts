"use client"

import { useEffect, useState, useCallback } from "react"
import type { MachineRepair, CreateRepairInput } from "@/types"
import * as repairsService from "@/services/repairs"

export function useRepairs() {
  const [repairs, setRepairs] = useState<MachineRepair[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await repairsService.getRepairs()
    setRepairs(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const create = useCallback(async (input: CreateRepairInput) => {
    const id = await repairsService.createRepair(input)
    await load()
    return id
  }, [load])

  const update = useCallback(async (id: string, data: Partial<CreateRepairInput>) => {
    await repairsService.updateRepair(id, data)
    await load()
  }, [load])

  const remove = useCallback(async (id: string) => {
    await repairsService.deleteRepair(id)
    await load()
  }, [load])

  const getByMachine = useCallback(async (machineId: string) => {
    return repairsService.getRepairsByMachine(machineId)
  }, [])

  return { repairs, loading, create, update, remove, reload: load, getByMachine }
}
