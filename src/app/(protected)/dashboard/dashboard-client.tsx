"use client"

import { useState, useMemo } from "react"
import Sync3CButton from "@/components/sync/Sync3CButton"
import { SearchInput } from "@/components/ui/SearchInput"
import { DashboardResults } from "@/components/dashboard/DashboardResults"
import { useMachines } from "@/hooks/useMachines"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { searchGrouped } from "@/lib/search-grouped"
import type { MaintenanceRecord } from "@/services/maintenance"
import type { ScaffoldRentalStats } from "@/lib/dashboardStats"

type Props = {
  initialOrders: MaintenanceRecord[]
  scaffoldRentals?: ScaffoldRentalStats | null
}

export default function DashboardClient({ initialOrders, scaffoldRentals }: Props) {
  const { machines, loading: machinesLoading } = useMachines()
  const { items: stockItems, loading: stockLoading } = useInventoryStock()
  const [search, setSearch] = useState("")

  const results = useMemo(() => {
    return searchGrouped(search, {
      orders: initialOrders,
      machines,
      stockItems,
      scaffoldRentals,
    })
  }, [search, initialOrders, machines, stockItems, scaffoldRentals])

  return (
    <div className="space-y-6">
      <Sync3CButton />

      <div className="space-y-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar materiales, andamios, máquinas, clientes, remitos, códigos, reparaciones..."
        />
        {search.trim() && (
          <p className="text-xs text-muted-foreground">Resultados: {results.totalResultados}</p>
        )}
      </div>

      {search.trim() !== "" && <DashboardResults results={results} />}

      {search.trim() === "" && (
        <p className="text-center text-sm text-muted-foreground">
          {stockLoading || machinesLoading
            ? "Cargando información..."
            : stockItems.length === 0 && initialOrders.length === 0
              ? "Sin datos aún. Usá el sincronizador para cargar la información desde 3C."
              : `Disponible: ${stockItems.length} materiales · ${initialOrders.length} órdenes de reparación. Escribí para buscar.`}
        </p>
      )}
    </div>
  )
}