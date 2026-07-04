"use client"

import { MaintenanceTable } from "@/components/maintenance/MaintenanceTable"
import type { MaintenanceRecord } from "@/services/maintenance"

type Props = {
  initialOrders: MaintenanceRecord[]
}

export default function MaintenanceClient({ initialOrders }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mantenimiento</h1>
      </div>

      <MaintenanceTable initialOrders={initialOrders} />
    </div>
  )
}
