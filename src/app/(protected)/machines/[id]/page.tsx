"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getMachine } from "@/services/machines"
import { getSparePartsByMachine } from "@/services/spareParts"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import type { Machine, MachineCategory, MachineLocation, MachineRental, LocationInfo, SparePart } from "@/types"
import { CATEGORY_LABELS } from "@/lib/categories"
import { statusColors, statusLabels, locationLabels, formatDate } from "@/lib/ui"

export default function MachineDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { update, rent, returnMachine, remove } = useMachines()
  const [machine, setMachine] = useState<Machine | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  const [editName, setEditName] = useState("")
  const [editModel, setEditModel] = useState("")
  const [editCategory, setEditCategory] = useState<MachineCategory>("machine")
  const [editLocationType, setEditLocationType] = useState<MachineLocation>("taller")
  const [editLocClientName, setEditLocClientName] = useState("")
  const [editLocClientAddress, setEditLocClientAddress] = useState("")
  const [editLocProjectName, setEditLocProjectName] = useState("")
  const [editLocProjectAddress, setEditLocProjectAddress] = useState("")

  const [showRentalForm, setShowRentalForm] = useState(false)
  const [rClientName, setRClientName] = useState("")
  const [rClientAddress, setRClientAddress] = useState("")
  const [rProjectName, setRProjectName] = useState("")
  const [rProjectAddress, setRProjectAddress] = useState("")
  const [rStartDate, setRStartDate] = useState("")
  const [rExpectedEndDate, setRExpectedEndDate] = useState("")
  const [rIsOpenEnded, setRIsOpenEnded] = useState(false)

  const [spareParts, setSpareParts] = useState<SparePart[]>([])
  const [spLoading, setSpLoading] = useState(true)

  useEffect(() => {
    getMachine(id).then((m) => { setMachine(m); setLoading(false) })
  }, [id])

  useEffect(() => {
    if (id) {
      getSparePartsByMachine(id).then((parts) => {
        setSpareParts(parts)
        setSpLoading(false)
      })
    }
  }, [id])

  const reload = async () => {
    const updated = await getMachine(id)
    setMachine(updated)
  }

  const startEditing = () => {
    if (!machine) return
    setEditName(machine.name)
    setEditModel(machine.model)
    setEditCategory(machine.category ?? "machine")
    setEditLocationType(machine.locationType)
    setEditLocClientName(machine.location?.client.name ?? "")
    setEditLocClientAddress(machine.location?.client.address ?? "")
    setEditLocProjectName(machine.location?.project.name ?? "")
    setEditLocProjectAddress(machine.location?.project.address ?? "")
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    if (!editName.trim()) { toast.error("El nombre no puede estar vacío"); return }
    setSaving(true)
    try {
      const location: LocationInfo | null =
        editLocClientName || editLocProjectName
          ? {
              client: { name: editLocClientName, address: editLocClientAddress },
              project: { name: editLocProjectName, address: editLocProjectAddress },
            }
          : null
      await update(id, {
        name: editName.trim(),
        model: editModel.trim(),
        category: editCategory,
        locationType: editLocationType,
        location,
      })
      await reload()
      setEditing(false)
      toast.success("Máquina actualizada")
    } catch { toast.error("Error al guardar") }
    finally { setSaving(false) }
  }

  const handleRent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rClientName || !rProjectName) { toast.error("Cliente y obra son obligatorios"); return }
    setSaving(true)
    try {
      const rental: MachineRental = {
        clientName: rClientName,
        clientAddress: rClientAddress,
        projectName: rProjectName,
        projectAddress: rProjectAddress,
        startDate: new Date(rStartDate || Date.now()),
        expectedEndDate: rExpectedEndDate ? new Date(rExpectedEndDate) : null,
        isOpenEnded: rIsOpenEnded,
      }
      await rent(id, rental)
      await reload()
      setShowRentalForm(false)
      setRClientName("")
      setRClientAddress("")
      setRProjectName("")
      setRProjectAddress("")
      setRStartDate("")
      setRExpectedEndDate("")
      setRIsOpenEnded(false)
      toast.success("Máquina alquilada")
    } catch { toast.error("Error al alquilar") } finally { setSaving(false) }
  }

  const handleReturn = async () => {
    try { await returnMachine(id); await reload(); toast.success("Máquina devuelta") }
    catch { toast.error("Error al devolver") }
  }

  const handleDelete = async () => {
    if (!confirm("¿Eliminar esta máquina?")) return
    try { await remove(id); toast.success("Máquina eliminada"); router.push("/machines") }
    catch { toast.error("Error al eliminar") }
  }

  if (loading) return <p className="text-muted-foreground">Cargando...</p>
  if (!machine) return <p className="text-muted-foreground">Máquina no encontrada</p>

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
                <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as MachineCategory)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  <option value="machine">Máquina</option>
                  <option value="scaffold">Andamio</option>
                  <option value="tool">Herramienta</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Ubicación</Label>
                <select value={editLocationType} onChange={(e) => setEditLocationType(e.target.value as MachineLocation)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  <option value="taller">Taller</option>
                  <option value="deposito">Depósito</option>
                  <option value="obra">Obra</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Nombre del cliente (ubicación)</Label>
                <Input value={editLocClientName} onChange={(e) => setEditLocClientName(e.target.value)} placeholder="Opcional" />
              </div>
              <div className="space-y-2">
                <Label>Dirección del cliente</Label>
                <Input value={editLocClientAddress} onChange={(e) => setEditLocClientAddress(e.target.value)} placeholder="Opcional" />
              </div>
              <div className="space-y-2">
                <Label>Nombre de la obra</Label>
                <Input value={editLocProjectName} onChange={(e) => setEditLocProjectName(e.target.value)} placeholder="Opcional" />
              </div>
              <div className="space-y-2">
                <Label>Dirección de la obra</Label>
                <Input value={editLocProjectAddress} onChange={(e) => setEditLocProjectAddress(e.target.value)} placeholder="Opcional" />
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSaveEdit} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button>
                <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {!editing && (
            <div className="space-y-1 text-sm">
              <p><span className="text-muted-foreground">Ubicación:</span> {locationLabels[machine.locationType] ?? machine.locationType}</p>
              {machine.location?.client.name && (
                <p><span className="text-muted-foreground">Cliente:</span> {machine.location.client.name}</p>
              )}
              {machine.location?.client.address && (
                <p><span className="text-muted-foreground">Dir. cliente:</span> {machine.location.client.address}</p>
              )}
              {machine.location?.project.name && (
                <p><span className="text-muted-foreground">Obra:</span> {machine.location.project.name}</p>
              )}
              {machine.location?.project.address && (
                <p><span className="text-muted-foreground">Dir. obra:</span> {machine.location.project.address}</p>
              )}
            </div>
          )}

          {machine.rental && (
            <div className="rounded-lg border bg-blue-50 p-3 text-sm space-y-1">
              <p className="font-medium text-blue-900">Alquiler activo</p>
              <p><span className="text-blue-700">Cliente:</span> {machine.rental.clientName}</p>
              {machine.location?.client?.address && (
                <p><span className="text-blue-700">Dir. cliente:</span> {machine.location.client.address}</p>
              )}
              <p><span className="text-blue-700">Obra:</span> {machine.rental.projectName}</p>
              {machine.location?.project?.address && (
                <p><span className="text-blue-700">Dir. obra:</span> {machine.location.project.address}</p>
              )}
              <p><span className="text-blue-700">Inicio:</span> {formatDate(machine.rental.startDate)}</p>
              {!machine.rental.isOpenEnded && machine.rental.expectedEndDate && (
                <p><span className="text-blue-700">Fin estimado:</span> {formatDate(machine.rental.expectedEndDate)}</p>
              )}
              {machine.rental.isOpenEnded && (
                <p><span className="text-xs text-blue-600">Plazo abierto</span></p>
              )}
              <Button variant="outline" size="sm" className="mt-2" onClick={handleReturn}>Devolver máquina</Button>
            </div>
          )}

          {showRentalForm && (
            <Card>
              <CardHeader><CardTitle className="text-base">Registrar alquiler</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleRent} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="rClientName">Cliente</Label>
                    <Input id="rClientName" value={rClientName} onChange={(e) => setRClientName(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rClientAddress">Dirección del cliente</Label>
                    <Input id="rClientAddress" value={rClientAddress} onChange={(e) => setRClientAddress(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rProjectName">Obra / Proyecto</Label>
                    <Input id="rProjectName" value={rProjectName} onChange={(e) => setRProjectName(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rProjectAddress">Dirección de la obra</Label>
                    <Input id="rProjectAddress" value={rProjectAddress} onChange={(e) => setRProjectAddress(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rStartDate">Inicio</Label>
                    <Input id="rStartDate" type="date" value={rStartDate} onChange={(e) => setRStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rExpectedEndDate">Fin estimado</Label>
                    <Input id="rExpectedEndDate" type="date" value={rExpectedEndDate} onChange={(e) => setRExpectedEndDate(e.target.value)} disabled={rIsOpenEnded} />
                  </div>
                  <div className="flex items-center gap-2">
                    <input id="rIsOpenEnded" type="checkbox" checked={rIsOpenEnded} onChange={(e) => setRIsOpenEnded(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label htmlFor="rIsOpenEnded">Plazo abierto</Label>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={saving}>{saving ? "..." : "Confirmar"}</Button>
                    <Button type="button" variant="outline" onClick={() => setShowRentalForm(false)}>Cancelar</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <div className="border-t pt-3 mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                Repuestos ({spareParts.length})
              </p>
              <Button variant="outline" size="sm" onClick={() => router.push(`/machines/${id}/parts`)}>
                Ver todos
              </Button>
            </div>
            {spLoading ? (
              <p className="text-xs text-muted-foreground">Cargando...</p>
            ) : spareParts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No hay repuestos definidos. {machine.status === "maintenance" && "Agregá repuestos desde el detalle de la máquina."}
              </p>
            ) : (
              <div className="space-y-2">
                {spareParts.slice(0, 3).map((part) => (
                  <div key={part.id} className="rounded border bg-muted/20 p-2 text-xs space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{part.partName}</span>
                      <span className="font-mono text-muted-foreground">{part.partCode}</span>
                    </div>
                    <div className="flex gap-3 text-muted-foreground">
                      <span>Total: {part.stockTotal}</span>
                      <span className="text-green-600">Disp: {part.stockAvailable}</span>
                      <span className="text-blue-600">Uso: {part.stockUsed}</span>
                    </div>
                  </div>
                ))}
                {spareParts.length > 3 && (
                  <p className="text-xs text-muted-foreground">
                    +{spareParts.length - 3} repuestos más
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Acciones:</p>
            <div className="flex flex-wrap gap-2">
              {machine.status === "available" && (
                <Button variant="outline" size="sm" onClick={() => setShowRentalForm(true)}>Alquilar</Button>
              )}
              {machine.status === "rented" && (
                <Button variant="outline" size="sm" onClick={handleReturn}>Devolver</Button>
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
