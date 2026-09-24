"use client"

import { useEffect, useState, useCallback } from "react"
import type { SparePartOrder } from "@/types"
import { getAllOrders, markOrdered, markReceived, markUsed, deleteOrders, updateOrderDates } from "@/services/sparePartOrders"
import type { MarkOrderedInput, SparePartOrderDatesInput } from "@/types"

export function useAllSparePartOrders() {
  const [orders, setOrders] = useState<SparePartOrder[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setOrders(await getAllOrders())
    } catch (err) {
      console.error("[useAllSparePartOrders] Error:", err)
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const markAsOrdered = useCallback(async (id: string, input: MarkOrderedInput) => {
    await markOrdered(id, input)
    await load()
  }, [load])

  const remove = useCallback(async (ids: string[]) => {
    await deleteOrders(ids)
    await load()
  }, [load])

  /** Recepción con cantidad (mueve stock si el repuesto está catalogado). */
  const markAsReceived = useCallback(async (id: string, quantity: number, receivedAt?: Date, notes?: string) => {
    await markReceived(id, quantity, receivedAt, notes)
    await load()
  }, [load])

  /** Utilización con cantidad (egreso de stock si el repuesto está catalogado). */
  const markAsUsed = useCallback(async (id: string, quantity: number, usedAt?: Date, notes?: string) => {
    await markUsed(id, quantity, usedAt, notes)
    await load()
  }, [load])

  /**
   * Fechas del circuito de compra cargadas a mano:
   * le pedí al dueño · lo pidió en la casa · me lo trajo.
   */
  const updateDates = useCallback(async (id: string, input: SparePartOrderDatesInput) => {
    await updateOrderDates(id, input)
    await load()
  }, [load])

  return { orders, loading, reload: load, markAsOrdered, remove, markAsReceived, markAsUsed, updateDates }
}
