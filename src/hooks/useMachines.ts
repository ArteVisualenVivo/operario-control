"use client"

import { useEffect, useState, useCallback } from "react"
import type { Machine, MachineRental, CreateMachineInput, UpdateMachineInput } from "@/types"
import * as machineService from "@/services/machines"

export function useMachines() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await machineService.getMachines()
    setMachines(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const create = useCallback(async (input: CreateMachineInput) => {
    await machineService.createMachine(input)
    await load()
  }, [load])

  const rent = useCallback(async (id: string, rental: MachineRental) => {
    await machineService.rentMachine(id, rental)
    await load()
  }, [load])

  const returnMachine = useCallback(async (id: string) => {
    await machineService.returnMachine(id)
    await load()
  }, [load])

  const update = useCallback(async (id: string, data: UpdateMachineInput) => {
    await machineService.updateMachine(id, data)
    await load()
  }, [load])

  const remove = useCallback(async (id: string) => {
    await machineService.deleteMachine(id)
    await load()
  }, [load])

  const deleteAll = useCallback(async () => {
    const count = await machineService.deleteAllMachines()
    await load()
    return count
  }, [load])

  return {
    machines, loading, create, update,
    rent, returnMachine,
    remove, deleteAll, reload: load,
  }
}
