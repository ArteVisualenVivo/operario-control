"use client"

import { useState, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import ImportInventory from "@/components/machines/ImportInventory"
import MachineCard from "@/components/machines/MachineCard"
import type { MachineStatus, MachineCategory } from "@/types"
import { statusLabels } from "@/lib/ui"
import { toast } from "sonner"

export default function MachinesPage() {
  const { machines, loading, remove, deleteAll } = useMachines()
  const router = useRouter()
  const searchParams = useSearchParams()

  const statusParam = searchParams.get("status")
  const categoryParam = searchParams.get("category")

  const validStatuses: MachineStatus[] = ["available", "rented", "maintenance"]
  const validCategories: MachineCategory[] = ["machine", "scaffold", "tool"]

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

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar esta máquina? Esta acción no se puede deshacer.")) return
    try {
      await remove(id)
      toast.success("Máquina eliminada")
    } catch {
      toast.error("Error al eliminar máquina")
    }
  }

  const handleDeleteAll = async () => {
    const confirm = window.prompt("Esto eliminará TODAS las máquinas. Escribe ELIMINAR para confirmar:")
    if (confirm !== "ELIMINAR") return
    setDeleting(true)
    try {
      const count = await deleteAll()
      toast.success(`${count} máquina${count !== 1 ? "s" : ""} eliminada${count !== 1 ? "s" : ""}`)
    } catch {
      toast.error("Error al eliminar máquinas")
    } finally {
      setDeleting(false)
    }
  }

  const filteredMachines = useMemo(() => {
    return machines.filter((m) => {
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

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Máquinas</h1>
        <div className="flex gap-2">
          <ImportInventory />
          <Button onClick={() => router.push("/machines/new")}>Nueva máquina</Button>
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
    </div>
  )
}
