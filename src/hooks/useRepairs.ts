"use client"

import { useEffect, useState, useCallback } from "react"
import type { Repair, RepairFormData, RepairStatus } from "@/types"
import * as repairService from "@/services/repairs"

export function useRepairs() {
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await repairService.getRepairs()
    setRepairs(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const create = useCallback(async (data: RepairFormData) => {
    await repairService.createRepair(data)
    await load()
  }, [load])

  const updateStatus = useCallback(async (id: string, status: RepairStatus) => {
    await repairService.updateRepairStatus(id, status)
    await load()
  }, [load])

  return { repairs, loading, create, updateStatus, reload: load }
}
