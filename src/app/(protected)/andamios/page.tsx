"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import MachineCard from "@/components/machines/MachineCard"
import type { MachineStatus } from "@/types"
import { statusLabels } from "@/lib/ui"
import { SCAFFOLD_CATALOG, SCAFFOLD_RECIPE } from "@/lib/scaffoldConfig"
import { toast } from "sonner"

type ScaffoldSection = "estructura" | "pieza" | "accesorio"

function normalizeText(value: string): string {
  return value.toLowerCase().trim()
}

export default function AndamiosPage() {
  const { machines, loading, remove } = useMachines()
  const { items: stockItems, loading: stockLoading } = useInventoryStock()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<MachineStatus | "all">("all")

  const scaffoldMachines = useMemo(
    () => machines.filter((m) => m.category === "scaffold"),
    [machines],
  )

  const scaffoldItems = useMemo(() => {
    const rows = stockItems.filter((item) => {
      const scaffoldNames = SCAFFOLD_CATALOG.map((entry) => entry.name)
      return scaffoldNames.includes(item.name)
    })

    return rows.sort((a, b) => {
      const aLabel = `${a.name} ${a.size ?? ""}`
      const bLabel = `${b.name} ${b.size ?? ""}`
      return aLabel.localeCompare(bLabel)
    })
  }, [stockItems])

  const filteredMachines = useMemo(() => {
    const q = normalizeText(search)
    return scaffoldMachines.filter((m) => {
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

  const filteredItems = useMemo(() => {
    const q = normalizeText(search)
    return scaffoldItems.filter((item) => {
      const text = [
        item.name,
        item.size ?? "",
        item.category,
        item.subtype ?? "",
        item.codigo ?? "",
      ].join(" ").toLowerCase()
      return !q || text.includes(q)
    })
  }, [scaffoldItems, search])

  const groupedItems = useMemo(() => {
    const groups = new Map<ScaffoldSection, typeof filteredItems>()
    groups.set("estructura", [])
    groups.set("pieza", [])
    groups.set("accesorio", [])

    for (const item of filteredItems) {
      if (item.category === "puntales" || item.category === "riendas") {
        groups.get("pieza")!.push(item)
      } else {
        groups.get("accesorio")!.push(item)
      }
    }

    return groups
  }, [filteredItems])

  const handleDelete = async (id: string) => {
    if (!window.confirm("Eliminar esta maquina? Esta accion no se puede deshacer.")) return
    try {
      await remove(id)
      toast.success("Maquina eliminada")
    } catch {
      toast.error("Error al eliminar maquina")
    }
  }

  const totals = useMemo(() => {
    const machineCount = scaffoldMachines.length
    const totalParts = filteredItems.reduce((sum, item) => sum + item.stockTotal, 0)
    const availableParts = filteredItems.reduce((sum, item) => sum + item.stockAvailable, 0)
    return { machineCount, totalParts, availableParts }
  }, [filteredItems, scaffoldMachines.length])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Andamios</h1>
          <p className="text-sm text-muted-foreground">
            Vista unificada de estructuras, piezas y accesorios que forman cada andamio.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => router.push("/inventory/new")}>Nuevo material</Button>
          <Button onClick={() => router.push("/machines/new")}>Nueva maquina de andamio</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Estructuras</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totals.machineCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Partes visibles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totals.totalParts}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Disponibles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{totals.availableParts}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Input
          placeholder="Buscar por orden, cliente, maquina, pieza o accesorio..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xl"
        />
        <div className="flex gap-2 flex-wrap">
          {(["all", "available", "rented", "maintenance"] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "Todos" : statusLabels[s]}
            </Button>
          ))}
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Estructuras de andamio</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMachines.map((machine) => (
            <MachineCard key={machine.id} machine={machine} onDelete={handleDelete} />
          ))}
        </div>
        {filteredMachines.length === 0 && (
          <p className="text-center text-muted-foreground">No se encontraron estructuras de andamio</p>
        )}
      </section>

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-xl font-semibold">Partes y accesorios del andamio</h2>
        {stockLoading ? (
          <p className="text-muted-foreground">Cargando...</p>
        ) : (
          <div className="space-y-6">
            {(["pieza", "accesorio"] as const).map((section) => {
              const items = groupedItems.get(section) ?? []
              const title = section === "pieza" ? "Piezas" : "Accesorios"
              return (
                <div key={section} className="space-y-3">
                  <h3 className="text-base font-medium">{title}</h3>
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay registros.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((item) => (
                        <Card
                          key={item.id}
                          className="cursor-pointer transition-shadow hover:shadow-md"
                          onClick={() => router.push(`/inventory/${item.id}`)}
                        >
                          <CardHeader className="pb-2">
                            <CardTitle className="text-lg">{item.name}</CardTitle>
                            <p className="text-xs text-muted-foreground">
                              {item.category}
                              {item.size ? ` | Medida: ${item.size}` : ""}
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
                  )}
                </div>
              )
            })}

            <div className="rounded-lg border bg-muted/20 p-4">
              <h3 className="text-base font-medium">Receta base de andamio</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Estas son las piezas que el sistema usa como base para controlar un andamio completo.
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                {SCAFFOLD_RECIPE.map((component) => (
                  <li key={`${component.name}-${component.size ?? "base"}`}>
                    <strong>{component.quantity}x</strong> {component.name}
                    {component.size ? ` (${component.size})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
