import { loadMaintenanceRecords } from "@/lib/local-sync"
import DashboardClient from "./dashboard-client"

const ORDER_PATTERN = /^X\s?\d{4}-\d{8}$/i

export default async function DashboardPage() {
  const orders = await loadMaintenanceRecords()
  const visibleOrders = [...orders]
    .filter((order) => ORDER_PATTERN.test(order.orderNumber))
    .sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())

  return <DashboardClient initialOrders={visibleOrders} />
}
