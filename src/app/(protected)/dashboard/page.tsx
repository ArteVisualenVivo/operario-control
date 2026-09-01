"use client"

import { useEffect, useState } from "react"
import type { MaintenanceRecord } from "@/services/maintenance"
import type { ScaffoldRentalStats } from "@/lib/dashboardStats"
import DashboardClient from "./dashboard-client"

const ORDER_PATTERN = /^x?\s?\d{3,6}-\d{4,10}$/i

export default function DashboardPage() {
  const [orders, setOrders] = useState<MaintenanceRecord[]>([])
  const [scaffoldRentals, setScaffoldRentals] = useState<ScaffoldRentalStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { loadMaintenanceRecords } = await import("@/lib/local-sync")
      const { loadScaffoldRentalStats } = await import("@/lib/dashboardStats")
      const loadedOrders = await loadMaintenanceRecords()
      const visibleOrders = [...loadedOrders]
        .filter((order) => ORDER_PATTERN.test(order.orderNumber))
        .sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())
      setOrders(visibleOrders)
      const loadedRentals = await loadScaffoldRentalStats()
      setScaffoldRentals(loadedRentals)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <p className="text-muted-foreground">Cargando...</p>
  }

  return <DashboardClient initialOrders={orders} scaffoldRentals={scaffoldRentals} />
}
