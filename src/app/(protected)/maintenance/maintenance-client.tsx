"use client"

import { useEffect, useState, useMemo } from "react"
import type { MaintenanceRecord } from "@/services/maintenance"
import type { MachineRepair } from "@/types"
import { SearchInput } from "@/components/ui/SearchInput"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/ui"
import { getRepairsForMaintenanceOrder } from "@/lib/machine-links"

// Cargar repairs desde API local
async function fetchRepairs(): Promise<MachineRepair[]> {
  try {
    const res = await fetch("/api/local/repairs", { cache: "no-store" })
    if (res.ok) return await res.json()
  } catch {
    // silencioso
  }
  return []
}

type Props = {
  initialOrders: MaintenanceRecord[]
}

export default function MaintenanceClient({ initialOrders }: Props) {
  const [search, setSearch] = useState("")
  const [repairs, setRepairs] = useState<MachineRepair[]>([])

  useEffect(() => {
    fetchRepairs().then(setRepairs)
  }, [])

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase()

    return initialOrders.filter((order) => {
      if (!q) return true

      return (
        order.orderNumber.toLowerCase().includes(q) ||
        order.clientName.toLowerCase().includes(q) ||
        order.machineName.toLowerCase().includes(q)
      )
    })
  }, [initialOrders, search])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mantenimiento</h1>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>Ordenes de mantenimiento</CardTitle>

          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por orden, maquina o cliente"
            className="max-w-md"
          />
        </CardHeader>

        <CardContent>
          {visibleOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay ordenes de mantenimiento disponibles.
            </p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-left">Numero de Orden</th>
                    <th className="p-2 text-left">Cliente</th>
                    <th className="p-2 text-left">Maquina</th>
                    <th className="p-2 text-left">Tipo</th>
                    <th className="p-2 text-left">Fecha Ingreso</th>
                    <th className="p-2 text-left">Fecha Entrega</th>
                    <th className="p-2 text-left">Fecha Reparacion</th>
                    <th className="p-2 text-left">Estado</th>
                    <th className="p-2 text-left">Tecnico</th>
                    <th className="p-2 text-left">Doc / Item</th>
                    <th className="p-2 text-left">Reparaciones</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleOrders.map((order) => {
                    const linkedRepairs = getRepairsForMaintenanceOrder(order, repairs)

                    return (
                      <tr key={order.id} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-mono">{order.orderNumber}</td>
                        <td className="p-2">{order.clientName}</td>
                        <td className="p-2">{order.machineName}</td>
                        <td className="p-2">{order.type ?? " "}</td>
                        <td className="p-2">{formatDate(order.entryDate)}</td>
                        <td className="p-2">{formatDate(order.returnDate)}</td>
                        <td className="p-2">{formatDate(order.repairDate)}</td>
                        <td className="p-2">{order.status}</td>
                        <td className="p-2">{order.technician ?? " "}</td>
                        <td className="p-2">
                          {order.docId ?? " "}
                          {order.itemId != null ? ` / ${order.itemId}` : ""}
                        </td>
                        <td className="p-2">
                          {linkedRepairs.length > 0 ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                window.open(
                                  "/repairs?order=" + encodeURIComponent(order.orderNumber),
                                  "_self"
                                )
                              }
                            >
                              Ver reparaciones ({linkedRepairs.length})
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}