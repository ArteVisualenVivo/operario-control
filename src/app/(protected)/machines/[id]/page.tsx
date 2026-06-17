"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getMachine } from "@/services/machines"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import type { Machine, MachineCategory, MachineLocation, RentalInfo, MaintenanceInfo } from "@/types"
import { SUBCATEGORIES, CATEGORY_LABELS } from "@/lib/categories"

const statusColors: Record<string, string> = {
  available: "bg-green-100 text-green-800 hover:bg-green-100",
  rented: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  maintenance: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
}

const statusLabels: Record<string, string> = {
  available: "Disponible",
  rented: "Alquilada",
  maintenance: "Mantenimiento",
}

const locationLabels: Record<string, string> = {
  taller: "Taller", deposito: "Depósito", obra: "Obra",
}

export default function MachineDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { update, rent, returnMachine, setMaintenance, completeMaintenance, remove } = useMachines()
  const [machine, setMachine] = useState<Machine | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  const [editName, setEditName] = useState("")
  const [editModel, setEditModel] = useState("")
  const [editCategory, setEditCategory] = useState<MachineCategory>("maquinaria")
  const [editSubcategory, setEditSubcategory] = useState("")
  const [editLocation, setEditLocation] = useState<MachineLocation>("taller")

  const [showRentalForm, setShowRentalForm] = useState(false)
  const [rClient, setRClient] = useState("")
  const [rStart, setRStart] = useState("")
  const [rReturn, setRReturn] = useState("")

  const [showMaintenanceForm, setShowMaintenanceForm] = useState(false)
  const [mReason, setMReason] = useState("")
  const [mStart, setMStart] = useState("")
  const [mEnd, setMEnd] = useState("")

  useEffect(() => {
    getMachine(id).then((m) => { setMachine(m); setLoading(false) })
  }, [id])

  const reload = async () => {
    const updated = await getMachine(id)
    setMachine(updated)
  }

  const startEditing = () => {
    if (!machine) return
    setEditName(machine.name)
    setEditModel(machine.model)
    setEditCategory(machine.category ?? "maquinaria")
    setEditSubcategory(machine.subcategory ?? "")
    setEditLocation(machine.location)
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    if (!editName.trim()) { toast.error("El nombre no puede estar vacío"); return }
    setSaving(true)
    try {
      await update(id, {
        name: editName.trim(),
        model: editModel.trim(),
        category: editCategory,
        subcategory: editSubcategory || null,
        location: editLocation,
      })
      await reload()
      setEditing(false)
      toast.success("Máquina actualizada")
    } catch { toast.error("Error al guardar") }
    finally { setSaving(false) }
  }

  const handleRent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rClient) { toast.error("Cliente obligatorio"); return }
    setSaving(true)
    try {
      const rental: RentalInfo = { client: rClient, startDate: new Date(rStart || Date.now()), returnDate: rReturn ? new Date(rReturn) : null }
      await rent(id, rental); await reload(); setShowRentalForm(false); setRClient(""); setRStart(""); setRReturn("")
      toast.success("Máquina alquilada")
    } catch { toast.error("Error al alquilar") } finally { setSaving(false) }
  }

  const handleReturn = async () => {
    try { await returnMachine(id); await reload(); toast.success("Máquina devuelta") }
    catch { toast.error("Error al devolver") }
  }

  const handleStartMaintenance = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mReason) { toast.error("Describe el motivo"); return }
    setSaving(true)
    try {
      const maintenance: MaintenanceInfo = { reason: mReason, startDate: new Date(mStart || Date.now()), estimatedEnd: mEnd ? new Date(mEnd) : null }
      await setMaintenance(id, maintenance); await reload(); setShowMaintenanceForm(false); setMReason(""); setMStart(""); setMEnd("")
      toast.success("Mantenimiento iniciado")
    } catch { toast.error("Error") } finally { setSaving(false) }
  }

  const handleCompleteMaintenance = async () => {
    try { await completeMaintenance(id); await reload(); toast.success("Mantenimiento completado") }
    catch { toast.error("Error") }
  }

  const handleDelete = async () => {
    if (!confirm("¿Eliminar esta máquina?")) return
    try { await remove(id); toast.success("Máquina eliminada"); router.push("/machines") }
    catch { toast.error("Error al eliminar") }
  }

  if (loading) return <p className="text-muted-foreground">Cargando...</p>
  if (!machine) return <p className="text-muted-foreground">Máquina no encontrada</p>

  const subcategoryOptions = SUBCATEGORIES[editCategory] ?? []

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => router.back()}>← Volver</Button>
        {!editing && <Button variant="outline" size="sm" onClick={startEditing}>Editar</Button>}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className={editing ? "w-full space-y-2" : ""}>
              {editing ? (
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="text-xl font-bold" />
              ) : (
                <CardTitle className="text-2xl">{machine.name}</CardTitle>
              )}
              {editing ? (
                <Input value={editModel} onChange={(e) => setEditModel(e.target.value)} placeholder="Modelo" className="text-sm" />
              ) : (
                <p className="text-sm text-muted-foreground">{machine.model}</p>
              )}
              {machine.category && !editing && (
                <span className="mt-1 inline-block text-xs text-muted-foreground">
                  {CATEGORY_LABELS[machine.category] ?? machine.category}
                  {machine.subcategory && ` > ${machine.subcategory}`}
                </span>
              )}
            </div>
            <Badge className={statusColors[machine.status]}>{statusLabels[machine.status]}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {editing && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">Editando máquina</p>
              <div className="space-y-2">
                <Label>Categoría</Label>
                <select value={editCategory} onChange={(e) => { setEditCategory(e.target.value as MachineCategory); setEditSubcategory("") }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="maquinaria">Maquinaria</option>
                  <option value="andamio">Andamio</option>
                  <option value="herramienta">Herramienta</option>
                </select>
              </div>
              {subcategoryOptions.length > 0 && (
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <select value={editSubcategory} onChange={(e) => setEditSubcategory(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Seleccionar tipo...</option>
                    {subcategoryOptions.map((s) => (
                      <option key={s.label} value={s.label}>{s.label}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Ubicación</Label>
                <select value={editLocation} onChange={(e) => setEditLocation(e.target.value as MachineLocation)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="taller">Taller</option>
                  <option value="deposito">Depósito</option>
                  <option value="obra">Obra</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSaveEdit} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
                <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {!editing && (
            <p><span className="text-muted-foreground">Ubicación:</span> {locationLabels[machine.location] ?? machine.location}</p>
          )}

          {machine.rental && (
            <div className="rounded-lg border bg-blue-50 p-3 text-sm space-y-1">
              <p className="font-medium text-blue-900">Alquiler activo</p>
              <p><span className="text-blue-700">Cliente:</span> {machine.rental.client}</p>
              <p><span className="text-blue-700">Inicio:</span> {new Date(machine.rental.startDate).toLocaleDateString("es-ES")}</p>
              {machine.rental.returnDate && <p><span className="text-blue-700">Retorno:</span> {new Date(machine.rental.returnDate).toLocaleDateString("es-ES")}</p>}
              <Button variant="outline" size="sm" className="mt-2" onClick={handleReturn}>Devolver máquina</Button>
            </div>
          )}

          {machine.maintenance && (
            <div className="rounded-lg border bg-yellow-50 p-3 text-sm space-y-1">
              <p className="font-medium text-yellow-900">Mantenimiento en curso</p>
              <p><span className="text-yellow-700">Motivo:</span> {machine.maintenance.reason}</p>
              <p><span className="text-yellow-700">Inicio:</span> {new Date(machine.maintenance.startDate).toLocaleDateString("es-ES")}</p>
              {machine.maintenance.estimatedEnd && <p><span className="text-yellow-700">Fin estimado:</span> {new Date(machine.maintenance.estimatedEnd).toLocaleDateString("es-ES")}</p>}
              <Button variant="outline" size="sm" className="mt-2" onClick={handleCompleteMaintenance}>Completar mantenimiento</Button>
            </div>
          )}

          {showRentalForm && (
            <Card><CardHeader><CardTitle className="text-base">Registrar alquiler</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleRent} className="space-y-3">
                  <div className="space-y-1"><Label htmlFor="rClient">Cliente</Label><Input id="rClient" value={rClient} onChange={(e) => setRClient(e.target.value)} required /></div>
                  <div className="space-y-1"><Label htmlFor="rStart">Inicio</Label><Input id="rStart" type="date" value={rStart} onChange={(e) => setRStart(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor="rReturn">Retorno</Label><Input id="rReturn" type="date" value={rReturn} onChange={(e) => setRReturn(e.target.value)} /></div>
                  <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? "..." : "Confirmar"}</Button><Button type="button" variant="outline" onClick={() => setShowRentalForm(false)}>Cancelar</Button></div>
                </form>
              </CardContent>
            </Card>
          )}

          {showMaintenanceForm && (
            <Card><CardHeader><CardTitle className="text-base">Registrar mantenimiento</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleStartMaintenance} className="space-y-3">
                  <div className="space-y-1"><Label htmlFor="mReason">Motivo</Label><Input id="mReason" value={mReason} onChange={(e) => setMReason(e.target.value)} required /></div>
                  <div className="space-y-1"><Label htmlFor="mStart">Inicio</Label><Input id="mStart" type="date" value={mStart} onChange={(e) => setMStart(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor="mEnd">Fin estimado</Label><Input id="mEnd" type="date" value={mEnd} onChange={(e) => setMEnd(e.target.value)} /></div>
                  <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? "..." : "Iniciar"}</Button><Button type="button" variant="outline" onClick={() => setShowMaintenanceForm(false)}>Cancelar</Button></div>
                </form>
              </CardContent>
            </Card>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">Cambiar estado:</p>
            <div className="flex flex-wrap gap-2">
              {machine.status === "available" && (
                <Button variant="outline" size="sm" onClick={() => setShowRentalForm(true)}>Alquilar</Button>
              )}
              {machine.status === "available" && (
                <Button variant="outline" size="sm" onClick={() => setShowMaintenanceForm(true)}>Mantenimiento</Button>
              )}
              {machine.status !== "available" && (
                <Button variant="outline" size="sm" onClick={handleReturn}>Disponible</Button>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="destructive" size="sm" onClick={handleDelete}>Eliminar máquina</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
