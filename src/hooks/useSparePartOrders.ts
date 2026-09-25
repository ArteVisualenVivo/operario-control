"use client"

import { useEffect, useState, useCallback } from "react"
import type { SparePartOrder, SparePartOrderDatesInput, CreateSparePartOrderInput, MarkOrderedInput } from "@/types"
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

  /**
   * Fechas del circuito de compra cargadas a mano:
   * le pedí al dueño · lo pidió en la casa · me lo trajo.
   *
   * SIN recargar la lista: se aplica sobre el pedido en memoria SÓLO lo que se
   * guardó (fechas + estado que devuelve el servicio), así el panel no se
   * recarga ni pierde la posición mientras se cargan las fechas.
   */
  const updateDates = useCallback(async (id: string, input: SparePartOrderDatesInput) => {
    const written = await sparePartOrdersService.updateOrderDates(id, input)
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...written } : o)))
  }, [])

  return { orders, loading, reload: load, create, markOrdered, markReceived, markUsed, cancel, updateNotes, updateDates }
}
