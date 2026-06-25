"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getRepair, updateRepair, deleteRepair } from "@/services/repairs"
import { useMaintenanceSettings } from "@/hooks/useMaintenanceSettings"
import RepairForm from "@/components/repairs/RepairForm"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/ui"
import { toast } from "sonner"
import type { MachineRepair, CreateRepairInput } from "@/types"

function daysUntil(date: Date | undefined | null): number | null {
  if (!date) return null
  return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function dueBadge(label: string, days: number | null): { color: string; text: string } {
  if (days === null) return { color: "bg-muted text-muted-foreground", text: "—" }
  if (days <= 0) return { color: "bg-red-200 text-red-800", text: "Vencido" }
  if (days <= 7) return { color: "bg-amber-200 text-amber-800", text: `En ${days}d` }
  return { color: "bg-green-200 text-green-800", text: `${days}d restantes` }
}

export default function RepairDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { settings, loading: settingsLoading } = useMaintenanceSettings()
  const [repair, setRepair] = useState<MachineRepair | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    getRepair(id).then((r) => { setRepair(r); setLoading(false) })
  }, [id])

  const handleUpdate = async (data: CreateRepairInput) => {
    await updateRepair(id, data)
    const updated = await getRepair(id)
    setRepair(updated)
    setEditing(false)
    toast.success("Reparación actualizada")
  }

  const handleDelete = async () => {
    if (!window.confirm("¿Eliminar esta reparación?")) return
    try {
      await deleteRepair(id)
      toast.success("Reparación eliminada")
      router.push("/repairs")
    } catch {
      toast.error("Error al eliminar")
    }
  }

  if (loading || settingsLoading) return <p className="text-muted-foreground">Cargando...</p>
  if (!repair) return <p className="text-muted-foreground">Reparación no encontrada</p>
  if (!settings) return <p className="text-muted-foreground">Error al cargar configuración</p>

  if (editing) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <RepairForm
          initialData={{
            id: repair.id,
            machineId: repair.machineId,
            machineName: repair.machineName,
            machineModel: repair.machineModel,
            clientName: repair.clientName,
            clientNumber: repair.clientNumber,
            reportedIssue: repair.reportedIssue,
            diagnosis: repair.diagnosis,
            repairPerformed: repair.repairPerformed,
            technician: repair.technician,
            entryDate: repair.entryDate,
            exitDate: repair.exitDate,
            hoursUsed: repair.hoursUsed,
            notes: repair.notes,
            partsUsed: repair.partsUsed,
            status: repair.status as "EN_TALLER" | "FINALIZADO" | undefined,
            warrantyDays: repair.warrantyDays,
          }}
          settings={settings}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  const wDays = daysUntil(repair.warrantyUntil)
  const oDays = daysUntil(repair.oilChangeDueDate)
  const bDays = daysUntil(repair.bearingChangeDueDate)
  const mDays = daysUntil(repair.maintenanceDueDate)
  const wBadge = dueBadge("Garantía", wDays)
  const oBadge = dueBadge("Aceite", oDays)
  const bBadge = dueBadge("Rodamientos", bDays)
  const mBadge = dueBadge("Mantenimiento", mDays)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => router.back()}>← Volver</Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Editar</Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>Eliminar</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{repair.machineName}</CardTitle>
              <p className="text-sm text-muted-foreground">{repair.machineModel ?? ""}</p>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className={
                repair.status === "EN_TALLER" ? "bg-blue-200 text-blue-800" : "bg-green-200 text-green-800"
              }>
                {repair.status === "EN_TALLER" ? "En taller" : "Finalizado"}
              </Badge>
              <Badge variant="outline" className={wBadge.color}>{wBadge.text}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Cliente:</span>
              <p className="font-medium">{repair.clientName}</p>
              {repair.clientNumber && <p className="text-xs text-muted-foreground">N° cliente: {repair.clientNumber}</p>}
            </div>
            <div>
              <span className="text-muted-foreground">Técnico:</span>
              <p className="font-medium">{repair.technician}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Ingreso taller:</span>
              <p className="font-medium">{formatDate(repair.entryDate)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Egreso taller:</span>
              <p className="font-medium">{formatDate(repair.exitDate)}</p>
            </div>
            {repair.hoursUsed !== undefined && (
              <div>
                <span className="text-muted-foreground">Horas de uso:</span>
                <p className="font-medium">{repair.hoursUsed}</p>
              </div>
            )}
            {repair.internalNumber && (
              <div>
                <span className="text-muted-foreground">N° interno:</span>
                <p className="font-medium">{repair.internalNumber}</p>
              </div>
            )}
            {repair.notes && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Observaciones:</span>
                <p className="font-medium whitespace-pre-wrap">{repair.notes}</p>
              </div>
            )}
          </div>

          <div className="border-t pt-3 space-y-2">
            <p className="text-sm font-medium">Falla reportada</p>
            <p className="text-sm whitespace-pre-wrap rounded-lg bg-muted/30 p-3">{repair.reportedIssue}</p>
          </div>

          {repair.diagnosis && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Diagnóstico</p>
              <p className="text-sm whitespace-pre-wrap rounded-lg bg-muted/30 p-3">{repair.diagnosis}</p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Reparación realizada</p>
            <p className="text-sm whitespace-pre-wrap rounded-lg bg-muted/30 p-3">{repair.repairPerformed}</p>
          </div>

          {repair.partsUsed && repair.partsUsed.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <p className="text-sm font-medium">Repuestos utilizados ({repair.partsUsed.length})</p>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Código</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground">Descripción</th>
                      <th className="text-right py-2 px-3 font-medium text-muted-foreground">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repair.partsUsed.map((p, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 px-3 font-mono text-xs">{p.code}</td>
                        <td className="py-2 px-3">{p.description}</td>
                        <td className="py-2 px-3 text-right">{p.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-medium mb-3">Estados de mantenimiento</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Garantía</p>
                <span className={`inline-block px-2 py-1 rounded text-xs font-semibold mt-1 ${wBadge.color}`}>
                  {wBadge.text}
                </span>
                {repair.warrantyUntil && <p className="text-xs text-muted-foreground mt-1">{formatDate(repair.warrantyUntil)}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cambio aceite</p>
                <span className={`inline-block px-2 py-1 rounded text-xs font-semibold mt-1 ${oBadge.color}`}>
                  {oBadge.text}
                </span>
                {repair.oilChangeDueDate && <p className="text-xs text-muted-foreground mt-1">{formatDate(repair.oilChangeDueDate)}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cambio rodamientos</p>
                <span className={`inline-block px-2 py-1 rounded text-xs font-semibold mt-1 ${bBadge.color}`}>
                  {bBadge.text}
                </span>
                {repair.bearingChangeDueDate && <p className="text-xs text-muted-foreground mt-1">{formatDate(repair.bearingChangeDueDate)}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Mantenimiento general</p>
                <span className={`inline-block px-2 py-1 rounded text-xs font-semibold mt-1 ${mBadge.color}`}>
                  {mBadge.text}
                </span>
                {repair.maintenanceDueDate && <p className="text-xs text-muted-foreground mt-1">{formatDate(repair.maintenanceDueDate)}</p>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
