import { loadMaintenanceRecords } from "@/lib/local-sync"
import MaintenanceClient from "./maintenance-client"

const ORDER_PATTERN = /^X\s?\d{4}-\d{8}$/i

export default async function MaintenancePage() {
  const orders = await loadMaintenanceRecords()
  const visibleOrders = [...orders]
    .filter((order) => ORDER_PATTERN.test(order.orderNumber))
    .sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())

  return <MaintenanceClient initialOrders={visibleOrders} />
}
