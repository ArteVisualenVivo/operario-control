"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

export default function NewRentalPage() {
  const { machines, rent } = useMachines()
  const router = useRouter()

  const availableMachines = machines.filter((m) => m.status === "available")

  const [machineId, setMachineId] = useState("")
  const [clientName, setClientName] = useState("")
  const [clientAddress, setClientAddress] = useState("")
  const [projectName, setProjectName] = useState("")
  const [projectAddress, setProjectAddress] = useState("")
  const [startDate, setStartDate] = useState("")
  const [expectedEndDate, setExpectedEndDate] = useState("")
  const [isOpenEnded, setIsOpenEnded] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!machineId) { toast.error("Selecciona una máquina"); return }
    if (!clientName || !projectName) { toast.error("Cliente y obra son obligatorios"); return }
    setLoading(true)
    try {
      await rent(machineId, {
        clientName,
        clientAddress,
        projectName,
        projectAddress,
        startDate: new Date(startDate || Date.now()),
        expectedEndDate: expectedEndDate ? new Date(expectedEndDate) : null,
        isOpenEnded,
      })
      toast.success("Alquiler registrado")
      router.push("/rentals")
    } catch {
      toast.error("Error al registrar alquiler")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">Nuevo alquiler</h1>
      <Card>
        <CardHeader>
          <CardTitle>Datos del alquiler</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="machine">Máquina</Label>
              <select id="machine" value={machineId} onChange={(e) => setMachineId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              >
                <option value="">Seleccionar máquina...</option>
                {availableMachines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.model})</option>
                ))}
              </select>
              {availableMachines.length === 0 && (
                <p className="text-xs text-muted-foreground">No hay máquinas disponibles</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientName">Cliente</Label>
              <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientAddress">Dirección del cliente</Label>
              <Input id="clientAddress" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="projectName">Obra / Proyecto</Label>
              <Input id="projectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="projectAddress">Dirección de la obra</Label>
              <Input id="projectAddress" value={projectAddress} onChange={(e) => setProjectAddress(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="startDate">Fecha de inicio</Label>
              <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expectedEndDate">Fecha estimada de fin</Label>
              <Input id="expectedEndDate" type="date" value={expectedEndDate} onChange={(e) => setExpectedEndDate(e.target.value)} disabled={isOpenEnded} />
            </div>
            <div className="flex items-center gap-2">
              <input id="isOpenEnded" type="checkbox" checked={isOpenEnded} onChange={(e) => setIsOpenEnded(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="isOpenEnded">Plazo abierto (sin fecha de fin)</Label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading || availableMachines.length === 0}>
                {loading ? "Guardando..." : "Registrar alquiler"}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancelar</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
