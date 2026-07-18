"use client"

import { useEffect, useState } from "react"
import type { MaintenanceRecord } from "@/services/maintenance"
import MaintenanceClient from "./maintenance-client"

const ORDER_PATTERN = /^X\s?\d{4}-\d{8}$/i

export default function MaintenancePage() {
  const [orders, setOrders] = useState<MaintenanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { loadMaintenanceRecords } = await import("@/lib/local-sync")
      const loadedOrders = await loadMaintenanceRecords()
      const visibleOrders = [...loadedOrders]
        .filter((order) => ORDER_PATTERN.test(order.orderNumber))
        .sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())
      setOrders(visibleOrders)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <p className="text-muted-foreground">Cargando...</p>
  }

  return <MaintenanceClient initialOrders={orders} />
}
