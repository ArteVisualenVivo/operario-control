"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { getMachines } from "@/services/machines"
import PartsSelector from "./PartsSelector"
import type { Machine, CreateRepairInput, MaintenanceSettings, PartUsage, RepairOrderStatus } from "@/types"

interface RepairFormProps {
  initialData?: CreateRepairInput & { id?: string }
  settings: MaintenanceSettings
  onSubmit: (data: CreateRepairInput) => Promise<void>
  onCancel: () => void
}

function toDateInputValue(date: Date | undefined | null): string {
  if (!date) return ""
  return new Date(date).toISOString().split("T")[0]
}

export default function RepairForm({ initialData, settings, onSubmit, onCancel }: RepairFormProps) {
  const router = useRouter()
  const [machines, setMachines] = useState<Machine[]>([])
  const [saving, setSaving] = useState(false)
  const [machineFilter, setMachineFilter] = useState("")

  const [machineId, setMachineId] = useState(initialData?.machineId ?? "")
  const [machineName, setMachineName] = useState(initialData?.machineName ?? "")
  const [machineModel, setMachineModel] = useState(initialData?.machineModel ?? "")
  const [internalNumber, setInternalNumber] = useState(initialData?.internalNumber ?? "")
  const [clientName, setClientName] = useState(initialData?.clientName ?? "")
  const [clientNumber, setClientNumber] = useState(initialData?.clientNumber ?? "")
  const [entryDate, setEntryDate] = useState(toDateInputValue(initialData?.entryDate))
  const [exitDate, setExitDate] = useState(toDateInputValue(initialData?.exitDate))
  const [reportedIssue, setReportedIssue] = useState(initialData?.reportedIssue ?? "")
  const [diagnosis, setDiagnosis] = useState(initialData?.diagnosis ?? "")
  const [repairPerformed, setRepairPerformed] = useState(initialData?.repairPerformed ?? "")
  const [technician, setTechnician] = useState(initialData?.technician ?? "")
  const [hoursUsed, setHoursUsed] = useState(initialData?.hoursUsed?.toString() ?? "")
  const [notes, setNotes] = useState(initialData?.notes ?? "")
  const [partsUsed, setPartsUsed] = useState<PartUsage[]>(initialData?.partsUsed ?? [])
  const [status, setStatus] = useState<RepairOrderStatus>(initialData?.status ?? "EN_TALLER")

  const [warrantyDays, setWarrantyDays] = useState(initialData?.warrantyDays?.toString() ?? "")
  const [oilChangeDays, setOilChangeDays] = useState("")
  const [bearingChangeDays, setBearingChangeDays] = useState("")
  const [maintenanceDays, setMaintenanceDays] = useState("")

  useEffect(() => {
    getMachines().then(setMachines)
  }, [])

  const selectedMachine = machines.find((m) => m.id === machineId)

  const handleMachineSelect = (id: string) => {
    const m = machines.find((x) => x.id === id)
    if (m) {
      setMachineId(m.id)
      setMachineName(m.name)
      setMachineModel(m.model)
    }
  }

  const filteredMachines = machines.filter((m) => {
    if (!machineFilter) return true
    const q = machineFilter.toLowerCase()
    return (
      m.name.toLowerCase().includes(q) ||
      m.model.toLowerCase().includes(q) ||
      (m.rental?.clientName ?? "").toLowerCase().includes(q)
    )
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!machineId) { toast.error("Seleccioná una máquina"); return }
    if (!clientName.trim()) { toast.error("El cliente es obligatorio"); return }
    if (!entryDate) { toast.error("La fecha de ingreso es obligatoria"); return }
    if (!exitDate) { toast.error("La fecha de egreso es obligatoria"); return }
    if (!reportedIssue.trim()) { toast.error("La falla reportada es obligatoria"); return }
    if (!repairPerformed.trim()) { toast.error("La reparación realizada es obligatoria"); return }
    if (!technician.trim()) { toast.error("El técnico es obligatorio"); return }

    setSaving(true)
    try {
      await onSubmit({
        machineId,
        machineName,
        machineModel: machineModel || undefined,
        internalNumber: internalNumber || undefined,
        clientName: clientName.trim(),
        clientNumber: clientNumber.trim() || undefined,
        reportedIssue: reportedIssue.trim(),
        diagnosis: diagnosis.trim() || undefined,
        repairPerformed: repairPerformed.trim(),
        technician: technician.trim(),
        entryDate: new Date(entryDate),
        exitDate: new Date(exitDate),
        hoursUsed: hoursUsed ? Number(hoursUsed) : undefined,
        notes: notes.trim() || undefined,
        partsUsed,
        status,
        warrantyDays: warrantyDays ? Number(warrantyDays) : undefined,
        oilChangeDays: oilChangeDays ? Number(oilChangeDays) : undefined,
        bearingChangeDays: bearingChangeDays ? Number(bearingChangeDays) : undefined,
        maintenanceDays: maintenanceDays ? Number(maintenanceDays) : undefined,
      })
      toast.success(initialData?.id ? "Reparación actualizada" : "Reparación registrada")
    } catch {
      toast.error("Error al guardar la reparación")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initialData?.id ? "Editar reparación" : "Nueva reparación"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="machine-search">Máquina</Label>
            <Input
              id="machine-search"
              placeholder="Buscá por nombre, modelo o cliente..."
              value={machineFilter}
              onChange={(e) => setMachineFilter(e.target.value)}
            />
            <select
              value={machineId}
              onChange={(e) => handleMachineSelect(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              required
            >
              <option value="">Seleccionar máquina...</option>
              {filteredMachines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.model}
                </option>
              ))}
            </select>
            {selectedMachine && (
              <p className="text-xs text-muted-foreground">
                Modelo: {selectedMachine.model}
                {selectedMachine.category && ` | ${selectedMachine.category}`}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="clientName">Cliente</Label>
              <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientNumber">Número de cliente</Label>
              <Input id="clientNumber" value={clientNumber} onChange={(e) => setClientNumber(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="internalNumber">Número interno</Label>
              <Input id="internalNumber" value={internalNumber} onChange={(e) => setInternalNumber(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="entryDate">Fecha ingreso taller</Label>
              <Input id="entryDate" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exitDate">Fecha egreso taller</Label>
              <Input id="exitDate" type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reportedIssue">Falla reportada por el cliente</Label>
            <textarea
              id="reportedIssue"
              value={reportedIssue}
              onChange={(e) => setReportedIssue(e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="diagnosis">Diagnóstico</Label>
            <textarea
              id="diagnosis"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              placeholder="Opcional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="repairPerformed">Reparación realizada</Label>
            <textarea
              id="repairPerformed"
              value={repairPerformed}
              onChange={(e) => setRepairPerformed(e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="technician">Técnico responsable</Label>
              <Input id="technician" value={technician} onChange={(e) => setTechnician(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hoursUsed">Horas de uso</Label>
              <Input id="hoursUsed" type="number" min="0" value={hoursUsed} onChange={(e) => setHoursUsed(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observaciones</Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              placeholder="Opcional"
            />
          </div>

          <div className="space-y-2">
            <Label>Repuestos utilizados</Label>
            <PartsSelector selected={partsUsed} onChange={setPartsUsed} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Estado</Label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as RepairOrderStatus)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
            >
              <option value="EN_TALLER">En taller</option>
              <option value="FINALIZADO">Finalizado</option>
            </select>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm font-medium">Intervalos de mantenimiento (opcional)</p>
            <p className="text-xs text-muted-foreground">Si no se completan, se usan los valores globales de configuración.</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="warrantyDays">Garantía (días)</Label>
                <Input id="warrantyDays" type="number" min="1" value={warrantyDays} onChange={(e) => setWarrantyDays(e.target.value)} placeholder={String(settings.warrantyDays)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="oilChangeDays">Cambio aceite (días)</Label>
                <Input id="oilChangeDays" type="number" min="1" value={oilChangeDays} onChange={(e) => setOilChangeDays(e.target.value)} placeholder={String(settings.oilChangeDays)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bearingChangeDays">Cambio rodamientos (días)</Label>
                <Input id="bearingChangeDays" type="number" min="1" value={bearingChangeDays} onChange={(e) => setBearingChangeDays(e.target.value)} placeholder={String(settings.bearingChangeDays)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="maintenanceDays">Mantenimiento general (días)</Label>
                <Input id="maintenanceDays" type="number" min="1" value={maintenanceDays} onChange={(e) => setMaintenanceDays(e.target.value)} placeholder={String(settings.maintenanceDays)} />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando..." : initialData?.id ? "Actualizar" : "Guardar reparación"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
