"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSpareParts } from "@/hooks/useSpareParts"
import { getMachine } from "@/services/machines"
import { getBlueprints } from "@/services/machineBlueprints"
import BlueprintImportPanel from "@/components/machines/BlueprintImportPanel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import SparePartCard from "@/components/machines/SparePartCard"
import ErrorState from "@/components/ui/ErrorState"
import { toast } from "sonner"
import type { Machine, SparePartCategory, CreateSparePartInput } from "@/types"
import type { MachineBlueprint } from "@/services/machineBlueprints"
import { useEffect } from "react"

const CATEGORY_OPTIONS: { value: SparePartCategory; label: string }[] = [
  { value: "motor", label: "Motor" },
  { value: "filtro", label: "Filtro" },
  { value: "electrico", label: "Eléctrico" },
  { value: "estructural", label: "Estructural" },
  { value: "consumible", label: "Consumible" },
  { value: "otro", label: "Otro" },
]

export default function MachinePartsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { spareParts, loading, error, create, update, remove, usePart, restockPart } = useSpareParts(id)
  const [machine, setMachine] = useState<Machine | null>(null)
  const [machineLoading, setMachineLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [fPartName, setFPartName] = useState("")
  const [fPartCode, setFPartCode] = useState("")
  const [fCategory, setFCategory] = useState<SparePartCategory>("otro")
  const [fStockTotal, setFStockTotal] = useState(1)
  const [saving, setSaving] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editCategory, setEditCategory] = useState<SparePartCategory>("otro")

  const [blueprints, setBlueprints] = useState<MachineBlueprint[]>([])
  const [bpLoading, setBpLoading] = useState(true)
  const [showImportPanel, setShowImportPanel] = useState(false)
  const [selectedBlueprint, setSelectedBlueprint] = useState<MachineBlueprint | null>(null)
  const [showBlueprintSelector, setShowBlueprintSelector] = useState(false)

  useEffect(() => {
    getMachine(id).then((m) => { setMachine(m); setMachineLoading(false) })
  }, [id])

  useEffect(() => {
    getBlueprints(id).then((bps) => { setBlueprints(bps); setBpLoading(false) })
  }, [id])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fPartName.trim()) { toast.error("El nombre del repuesto es obligatorio"); return }
    if (!fPartCode.trim()) { toast.error("El código de pieza es obligatorio"); return }
    if (!machine) return

    setSaving(true)
    try {
      const input: CreateSparePartInput = {
        machineId: id,
        machineName: machine.name,
        machineModel: machine.model,
        partName: fPartName.trim(),
        partCode: fPartCode.trim(),
        category: fCategory,
        unit: "unidad",
        stockTotal: fStockTotal,
        source: "manual",
      }
      await create(input)
      setShowForm(false)
      setFPartName("")
      setFPartCode("")
      setFCategory("otro")
      setFStockTotal(1)
      toast.success("Repuesto agregado")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear repuesto")
    } finally { setSaving(false) }
  }

  const handleEdit = (partId: string) => {
    const part = spareParts.find(p => p.id === partId)
    if (!part) return
    setEditId(partId)
    setEditName(part.partName)
    setEditCategory(part.category)
  }

  const handleSaveEdit = async () => {
    if (!editId || !editName.trim()) return
    try {
      await update(editId, { partName: editName.trim(), category: editCategory })
      setEditId(null)
      toast.success("Repuesto actualizado")
    } catch { toast.error("Error al actualizar") }
  }

  const handleDelete = async (partId: string) => {
    if (!confirm("¿Eliminar este repuesto?")) return
    try {
      await remove(partId)
      toast.success("Repuesto eliminado")
    } catch { toast.error("Error al eliminar") }
  }

  const startImportFromBlueprint = () => {
    if (blueprints.length === 0) {
      toast.info("Primero subí un despiece desde la sección 'Despiece técnico' de la máquina")
      return
    }
    setShowBlueprintSelector(true)
  }

  if (error) return <ErrorState error={error} />
  if (machineLoading || loading) return <p className="text-muted-foreground">Cargando...</p>
  if (!machine) return <p className="text-muted-foreground">Máquina no encontrada</p>

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Button variant="outline" size="sm" onClick={() => router.push(`/machines/${id}`)}>
            ← Volver máquina
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={startImportFromBlueprint}>
            Importar desde despiece
          </Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancelar" : "Agregar repuesto"}
          </Button>
        </div>
      </div>

      <h1 className="text-xl font-bold">
        Repuestos — {machine.name} {machine.model}
      </h1>

      {showBlueprintSelector && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seleccionar despiece</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {bpLoading ? (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            ) : (
              <div className="space-y-2">
                {blueprints.map((bp) => (
                  <div key={bp.id} className="flex items-center justify-between rounded border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{bp.fileName}</p>
                      <p className="text-xs text-muted-foreground">{bp.fileType === "pdf" ? "PDF" : "Imagen"}</p>
                    </div>
                    <Button size="sm" onClick={() => {
                      setSelectedBlueprint(bp)
                      setShowBlueprintSelector(false)
                      setShowImportPanel(true)
                    }}>
                      Usar este despiece
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowBlueprintSelector(false)}>
              Cancelar
            </Button>
          </CardContent>
        </Card>
      )}

      {showImportPanel && selectedBlueprint && (
        <Card>
          <CardContent className="pt-4">
            <BlueprintImportPanel
              machineId={id}
              machineName={machine.name}
              machineModel={machine.model}
              blueprintId={selectedBlueprint.id}
              fileUrl={selectedBlueprint.fileUrl}
              fileType={selectedBlueprint.fileType}
              onClose={() => {
                setShowImportPanel(false)
                setSelectedBlueprint(null)
              }}
            />
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nuevo repuesto</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="partName">Nombre del repuesto</Label>
                <Input id="partName" value={fPartName} onChange={(e) => setFPartName(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="partCode">Código de pieza <span className="text-red-500">*</span></Label>
                <Input id="partCode" value={fPartCode} onChange={(e) => setFPartCode(e.target.value)} placeholder="Ej: NGK-BPR6ES" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="category">Categoría</Label>
                  <select id="category" value={fCategory} onChange={(e) => setFCategory(e.target.value as SparePartCategory)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {CATEGORY_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="stockTotal">Stock inicial</Label>
                  <Input id="stockTotal" type="number" min={1} value={fStockTotal}
                    onChange={(e) => setFStockTotal(Number(e.target.value))} />
                </div>
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando..." : "Guardar repuesto"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {spareParts.map((part) => (
          editId === part.id ? (
            <Card key={part.id}>
              <CardContent className="pt-4 space-y-2">
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as SparePartCategory)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {CATEGORY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveEdit}>Guardar</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditId(null)}>Cancelar</Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <SparePartCard
              key={part.id}
              part={part}
              onUse={usePart}
              onRestock={restockPart}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          )
        ))}
      </div>

      {spareParts.length === 0 && !showForm && (
        <p className="text-center text-muted-foreground">
          No hay repuestos definidos para esta máquina.
        </p>
      )}
    </div>
  )
}
