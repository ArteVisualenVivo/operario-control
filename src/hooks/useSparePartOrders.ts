"use client"

import { useEffect, useState, useCallback } from "react"
import type { SparePartOrder, CreateSparePartOrderInput, MarkOrderedInput } from "@/types"
import * as sparePartOrdersService from "@/services/sparePartOrders"

export function useSparePartOrders(repairId: string) {
  const [orders, setOrders] = useState<SparePartOrder[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!repairId) {
      setOrders([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await sparePartOrdersService.getOrdersByRepair(repairId)
      setOrders(data)
    } catch (err) {
      console.error("[useSparePartOrders] Error cargando pedidos:", err)
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [repairId])

  useEffect(() => { load() }, [load])

  const create = useCallback(async (input: CreateSparePartOrderInput) => {
    const id = await sparePartOrdersService.createOrder(input)
    await load()
    return id
  }, [load])

  const markOrdered = useCallback(async (id: string, input: MarkOrderedInput) => {
    await sparePartOrdersService.markOrdered(id, input)
    await load()
  }, [load])

  const markReceived = useCallback(async (id: string, quantity: number, receivedAt?: Date, notes?: string) => {
    await sparePartOrdersService.markReceived(id, quantity, receivedAt, notes)
    await load()
  }, [load])

  const markUsed = useCallback(async (id: string, quantity: number, usedAt?: Date, notes?: string) => {
    await sparePartOrdersService.markUsed(id, quantity, usedAt, notes)
    await load()
  }, [load])

  const cancel = useCallback(async (id: string) => {
    await sparePartOrdersService.cancelOrder(id)
    await load()
  }, [load])

  const updateNotes = useCallback(async (id: string, notes: string) => {
    await sparePartOrdersService.updateOrderNotes(id, notes)
    await load()
  }, [load])

  return { orders, loading, reload: load, create, markOrdered, markReceived, markUsed, cancel, updateNotes }
}
