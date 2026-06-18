"use client"

import { useEffect, useState, useCallback } from "react"
import type { MachineBlueprint } from "@/services/machineBlueprints"
import * as blueprintsService from "@/services/machineBlueprints"

export function useMachineBlueprints(machineId: string) {
  const [blueprints, setBlueprints] = useState<MachineBlueprint[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await blueprintsService.getBlueprints(machineId)
    setBlueprints(data)
    setLoading(false)
  }, [machineId])

  useEffect(() => { load() }, [load])

  const uploadBlueprint = useCallback(async (file: File) => {
    await blueprintsService.uploadBlueprint(machineId, file)
    await load()
  }, [machineId, load])

  const removeBlueprint = useCallback(async (id: string) => {
    await blueprintsService.deleteBlueprint(id)
    await load()
  }, [load])

  return { blueprints, loading, uploadBlueprint, removeBlueprint, reload: load }
}
