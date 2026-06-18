"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import MachineCard from "@/components/machines/MachineCard"
import type { MachineStatus } from "@/types"
import { statusLabels } from "@/lib/ui"
import { toast } from "sonner"

export default function AndamiosPage() {
  const { machines, loading, remove } = useMachines()
  const { items: stockItems, loading: stockLoading } = useInventoryStock()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<MachineStatus | "all">("all")

  const scaffoldMachines = useMemo(() => {
    return machines.filter(m => m.category === "scaffold")
  }, [machines])

  const filteredMachines = useMemo(() => {
    return scaffoldMachines.filter((m) => {
      const q = search.toLowerCase()
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        (m.rental?.clientName ?? "").toLowerCase().includes(q) ||
        (m.rental?.projectName ?? "").toLowerCase().includes(q)
      const matchesStatus = statusFilter === "all" || m.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [scaffoldMachines, search, statusFilter])

  const scaffoldStock = useMemo(() => {
    return stockItems.filter(i => i.category === "andamio_accesorios")
  }, [stockItems])

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar esta máquina? Esta acción no se puede deshacer.")) return
    try {
      await remove(id)
      toast.success("Máquina eliminada")
    } catch {
      toast.error("Error al eliminar máquina")
    }
  }

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Andamios</h1>
        <div className="flex gap-2">
          <Button onClick={() => router.push("/inventory/new")}>Nuevo material</Button>
          <Button onClick={() => router.push("/machines/new")}>Nueva máquina de andamio</Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Input
          placeholder="Buscar por nombre, modelo, cliente u obra..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-2">
          {(["all", "available", "rented", "maintenance"] as const).map((s) => (
            <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
              {s === "all" ? "Todos" : statusLabels[s]}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Máquinas de andamio</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMachines.map((machine) => (
            <MachineCard key={machine.id} machine={machine} onDelete={handleDelete} />
          ))}
        </div>
        {filteredMachines.length === 0 && (
          <p className="text-center text-muted-foreground">No se encontraron andamios</p>
        )}
      </div>

      <div className="border-t pt-6">
        <h2 className="text-xl font-semibold mb-4">Componentes de andamio</h2>
        {stockLoading ? (
          <p className="text-muted-foreground">Cargando...</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {scaffoldStock.map((item) => (
                <Card
                  key={item.id}
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => router.push(`/inventory/${item.id}`)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{item.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {item.unit}{item.size ? ` | Medida: ${item.size}` : ""}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <p>Total: <strong>{item.stockTotal}</strong></p>
                    <p className="text-green-600">Disponibles: <strong>{item.stockAvailable}</strong></p>
                    <p className="text-blue-600">Alquilados: <strong>{item.stockRented}</strong></p>
                  </CardContent>
                </Card>
              ))}
            </div>

          </>
        )}
      </div>
    </div>
  )
}
