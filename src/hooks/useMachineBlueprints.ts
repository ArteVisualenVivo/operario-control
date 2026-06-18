"use client"

import { useEffect, useState, useCallback } from "react"
import type { MachineBlueprint } from "@/services/machineBlueprints"
import type { AppError } from "@/types/errors"
import { parseFirebaseError } from "@/lib/parseFirebaseError"
import * as blueprintsService from "@/services/machineBlueprints"

export function useMachineBlueprints(machineId: string) {
  const [blueprints, setBlueprints] = useState<MachineBlueprint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await blueprintsService.getBlueprints(machineId)
      setBlueprints(data)
    } catch (e) {
      setError(parseFirebaseError(e, "machine_blueprints"))
    } finally {
      setLoading(false)
    }
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

  return { blueprints, loading, error, uploadBlueprint, removeBlueprint, reload: load }
}
