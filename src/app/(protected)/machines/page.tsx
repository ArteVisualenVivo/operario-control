"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import ImportInventory from "@/components/machines/ImportInventory"
import MachineCard from "@/components/machines/MachineCard"
import type { MachineStatus, MachineCategory } from "@/types"
import { statusLabels } from "@/lib/ui"
import { toast } from "sonner"

export default function MachinesPage() {
  const { machines, loading, remove, deleteAll } = useMachines()
  const { items: inventoryItems, loading: inventoryLoading } = useInventoryStock()
  const router = useRouter()
  const searchParams = useSearchParams()
  const sourceParam = searchParams.get("source")

  const statusParam = searchParams.get("status")
  const categoryParam = searchParams.get("category")

  const validStatuses: MachineStatus[] = ["available", "rented", "maintenance"]
  const validCategories: MachineCategory[] = ["machine", "tool"]

  const initialStatus =
    statusParam && validStatuses.includes(statusParam as MachineStatus)
      ? (statusParam as MachineStatus)
      : "all"

  const initialCategory =
    categoryParam && validCategories.includes(categoryParam as MachineCategory)
      ? (categoryParam as MachineCategory)
      : "all"

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<MachineStatus | "all">(initialStatus)
  const [categoryFilter, setCategoryFilter] = useState<MachineCategory | "all">(initialCategory)
  const [deleting, setDeleting] = useState(false)
  const [rememberedSource, setRememberedSource] = useState<string>("")

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("machines-source")
      if (saved) setRememberedSource(saved)
    } catch {
      // ignore
    }
  }, [])

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar esta máquina? Esta acción no se puede deshacer.")) return
    try {
      await remove(id)
      toast.success("MÃ¡quina eliminada")
    } catch {
      toast.error("Error al eliminar mÃ¡quina")
    }
  }

  const handleDeleteAll = async () => {
    const confirm = window.prompt("Esto eliminará TODAS las máquinas. Escribe ELIMINAR para confirmar:")
    if (confirm !== "ELIMINAR") return
    setDeleting(true)
    try {
      const count = await deleteAll()
      toast.success(`${count} mÃ¡quina${count !== 1 ? "s" : ""} eliminada${count !== 1 ? "s" : ""}`)
    } catch {
      toast.error("Error al eliminar mÃ¡quinas")
    } finally {
      setDeleting(false)
    }
  }

  const filteredMachines = useMemo(() => {
    return machines.filter((m) => {
      if (m.category === "scaffold") return false
      const q = search.toLowerCase()
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        (m.rental?.clientName ?? "").toLowerCase().includes(q) ||
        (m.rental?.projectName ?? "").toLowerCase().includes(q)
      const matchesStatus = statusFilter === "all" || m.status === statusFilter
      const matchesCategory = categoryFilter === "all" || m.category === categoryFilter
      return matchesSearch && matchesStatus && matchesCategory
    })
  }, [machines, search, statusFilter, categoryFilter])

  const inventoryPreview = useMemo(() => {
    const activeSource = sourceParam ?? rememberedSource
    if (activeSource !== "inventory") return []
    return inventoryItems.filter((item) => item.stockTotal > 0)
  }, [inventoryItems, sourceParam, rememberedSource])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Máquinas</h1>
        <div className="flex gap-2">
          <ImportInventory />
          <Button onClick={() => router.push("/machines/new")}>Nueva mÃ¡quina</Button>
          <Button variant="destructive" size="sm" onClick={handleDeleteAll} disabled={deleting || machines.length === 0}>
            {deleting ? "Eliminando..." : "Eliminar todas"}
          </Button>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredMachines.map((machine) => (
          <MachineCard key={machine.id} machine={machine} onDelete={handleDelete} />
        ))}
      </div>

      {filteredMachines.length === 0 && <p className="text-center text-muted-foreground">No se encontraron máquinas</p>}

      {(sourceParam === "inventory" || rememberedSource === "inventory") && (
        <div className="space-y-4 border-t pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Inventario conectado</h2>
            <Button variant="outline" size="sm" onClick={() => router.push("/inventory")}>
              Ver inventario
            </Button>
          </div>
          {inventoryLoading ? (
            <p className="text-muted-foreground">Cargando inventario...</p>
          ) : inventoryPreview.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay materiales en inventario para mostrar.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {inventoryPreview.map((item) => (
                <Card key={item.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{item.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {item.category}{item.size ? ` | ${item.size}` : ""}
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
      )}
    </div>
  )
}
