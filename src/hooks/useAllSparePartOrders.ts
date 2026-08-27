"use client"

import { useEffect, useState, useCallback } from "react"
import type { SparePartOrder } from "@/types"
import { getAllOrders, markOrdered } from "@/services/sparePartOrders"
import type { MarkOrderedInput } from "@/types"

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

  return { orders, loading, reload: load, markAsOrdered }
}
