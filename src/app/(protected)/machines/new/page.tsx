"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { MachineLocation, MachineStatus, MachineCategory, CreateMachineInput } from "@/types"
import { toast } from "sonner"

const locationOptions: { value: MachineLocation; label: string }[] = [
  { value: "taller", label: "Taller" },
  { value: "deposito", label: "Depósito" },
  { value: "obra", label: "Obra" },
]

const categoryOptions: { value: MachineCategory; label: string }[] = [
  { value: "scaffold", label: "Andamio" },
  { value: "machine", label: "Máquina" },
  { value: "tool", label: "Herramienta" },
]

const statusOptions: { value: MachineStatus; label: string }[] = [
  { value: "available", label: "Disponible" },
  { value: "rented", label: "Alquilada" },
  { value: "maintenance", label: "Mantenimiento" },
]

export default function NewMachinePage() {
  const { create } = useMachines()
  const router = useRouter()

  const [name, setName] = useState("")
  const [model, setModel] = useState("")
  const [category, setCategory] = useState<MachineCategory>("machine")
  const [locationType, setLocationType] = useState<MachineLocation>("taller")
  const [status, setStatus] = useState<MachineStatus>("available")

  const [clientName, setClientName] = useState("")
  const [clientAddress, setClientAddress] = useState("")
  const [projectName, setProjectName] = useState("")
  const [projectAddress, setProjectAddress] = useState("")

  const [rentalClientName, setRentalClientName] = useState("")
  const [rentalClientAddress, setRentalClientAddress] = useState("")
  const [rentalProjectName, setRentalProjectName] = useState("")
  const [rentalProjectAddress, setRentalProjectAddress] = useState("")
  const [startDate, setStartDate] = useState("")
  const [expectedEndDate, setExpectedEndDate] = useState("")
  const [isOpenEnded, setIsOpenEnded] = useState(false)

  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const input: CreateMachineInput = {
        name, model, category, locationType, status,
        location: null,
        rental: null,
      }

      if (clientName || projectName) {
        input.location = {
          client: { name: clientName, address: clientAddress },
          project: { name: projectName, address: projectAddress },
        }
      }

      if (status === "rented") {
        if (!rentalClientName || !rentalProjectName) {
          toast.error("Cliente y obra son obligatorios")
          setLoading(false)
          return
        }
        input.rental = {
          clientName: rentalClientName,
          clientAddress: rentalClientAddress,
          projectName: rentalProjectName,
          projectAddress: rentalProjectAddress,
          startDate: new Date(startDate || Date.now()),
          expectedEndDate: expectedEndDate ? new Date(expectedEndDate) : null,
          isOpenEnded,
        }
      }

      await create(input)
      toast.success("Máquina creada")
      router.push("/machines")
    } catch {
      toast.error("Error al crear máquina")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">Nueva máquina</h1>
      <Card>
        <CardHeader>
          <CardTitle>Datos de la máquina</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Modelo</Label>
              <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Categoría</Label>
              <select id="category" value={category} onChange={(e) => setCategory(e.target.value as MachineCategory)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              >
                {categoryOptions.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Ubicación</Label>
              <select id="location" value={locationType} onChange={(e) => setLocationType(e.target.value as MachineLocation)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              >
                {locationOptions.map((l) => (<option key={l.value} value={l.value}>{l.label}</option>))}
              </select>
            </div>

            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-medium">Datos de ubicación (opcional)</p>
              <div className="space-y-2">
                <Label htmlFor="clientName">Nombre del cliente</Label>
                <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientAddress">Dirección del cliente</Label>
                <Input id="clientAddress" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="projectName">Nombre de la obra</Label>
                <Input id="projectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="projectAddress">Dirección de la obra</Label>
                <Input id="projectAddress" value={projectAddress} onChange={(e) => setProjectAddress(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Estado inicial</Label>
              <div className="flex flex-wrap gap-2">
                {statusOptions.map((s) => (
                  <Button key={s.value} type="button" variant={status === s.value ? "default" : "outline"} size="sm" onClick={() => setStatus(s.value)}>
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>

            {status === "rented" && (
              <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm font-medium text-blue-900">Datos del alquiler</p>
                <div className="space-y-2">
                  <Label htmlFor="rentalClientName">Cliente</Label>
                  <Input id="rentalClientName" value={rentalClientName} onChange={(e) => setRentalClientName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rentalClientAddress">Dirección del cliente</Label>
                  <Input id="rentalClientAddress" value={rentalClientAddress} onChange={(e) => setRentalClientAddress(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rentalProjectName">Obra / Proyecto</Label>
                  <Input id="rentalProjectName" value={rentalProjectName} onChange={(e) => setRentalProjectName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rentalProjectAddress">Dirección de la obra</Label>
                  <Input id="rentalProjectAddress" value={rentalProjectAddress} onChange={(e) => setRentalProjectAddress(e.target.value)} />
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
              </div>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar"}</Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancelar</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
