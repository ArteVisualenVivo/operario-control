"use client"

import { useSearchParams } from "next/navigation"
import { MaintenanceTable } from "@/components/maintenance/MaintenanceTable"
import type { MaintenanceRecord } from "@/services/maintenance"

type Props = {
  initialOrders: MaintenanceRecord[]
}

export default function MaintenanceClient({ initialOrders }: Props) {
  // La orden de focalización llega desde /repairs mediante ?order=<N° de orden>
  const searchParams = useSearchParams()
  const focusOrder = searchParams.get("order")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mantenimiento</h1>
      </div>

      <MaintenanceTable initialOrders={initialOrders} focusOrder={focusOrder} />
    </div>
  )
}
