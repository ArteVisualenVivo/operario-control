import { loadMaintenanceRecords } from "@/lib/local-sync"
import { loadScaffoldRentalStats } from "@/lib/dashboardStats"
import DashboardClient from "./dashboard-client"

const ORDER_PATTERN = /^x\s?\d{3,6}-\d{4,10}$/i

export default async function DashboardPage() {
  const orders = await loadMaintenanceRecords()
  const visibleOrders = [...orders]
    .filter((order) => ORDER_PATTERN.test(order.orderNumber))
    .sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())

  const scaffoldRentals = await loadScaffoldRentalStats()

  return <DashboardClient initialOrders={visibleOrders} scaffoldRentals={scaffoldRentals} />
}
