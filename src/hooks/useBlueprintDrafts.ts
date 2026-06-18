"use client"

import { useEffect, useState, useCallback } from "react"
import type { BlueprintDraft, CreateDraftInput } from "@/services/blueprintDrafts"
import * as draftsService from "@/services/blueprintDrafts"

export function useBlueprintDrafts(machineId: string, blueprintId?: string) {
  const [drafts, setDrafts] = useState<BlueprintDraft[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await draftsService.getDrafts(machineId, blueprintId)
    setDrafts(data)
    setLoading(false)
  }, [machineId, blueprintId])

  useEffect(() => { load() }, [load])

  const create = useCallback(async (input: CreateDraftInput) => {
    await draftsService.createDraft(input)
    await load()
  }, [load])

  const update = useCallback(async (
    id: string,
    data: Partial<Pick<BlueprintDraft, "partName" | "partCode" | "category" | "stockTotal">>,
  ) => {
    await draftsService.updateDraft(id, data)
    await load()
  }, [load])

  const remove = useCallback(async (id: string) => {
    await draftsService.deleteDraft(id)
    await load()
  }, [load])

  const confirm = useCallback(async (
    machineName: string,
    machineModel: string,
  ): Promise<number> => {
    const count = await draftsService.confirmDrafts(machineId, blueprintId ?? "", machineName, machineModel)
    await load()
    return count
  }, [machineId, blueprintId, load])

  return { drafts, loading, create, update, remove, confirm, reload: load }
}
