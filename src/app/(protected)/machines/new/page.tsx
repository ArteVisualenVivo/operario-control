"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SUBCATEGORIES } from "@/lib/categories"
import type { MachineLocation, MachineStatus, MachineCategory, CreateMachineInput } from "@/types"
import { toast } from "sonner"

const locations: { value: MachineLocation; label: string }[] = [
  { value: "taller", label: "Taller" },
  { value: "deposito", label: "Depósito" },
  { value: "obra", label: "Obra" },
]

const categoryOptions: { value: MachineCategory; label: string }[] = [
  { value: "andamio", label: "Andamio" },
  { value: "maquinaria", label: "Maquinaria" },
  { value: "herramienta", label: "Herramienta" },
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
  const [category, setCategory] = useState<MachineCategory>("maquinaria")
  const [subcategory, setSubcategory] = useState("")
  const [location, setLocation] = useState<MachineLocation>("taller")
  const [status, setStatus] = useState<MachineStatus>("available")

  const [client, setClient] = useState("")
  const [rentalStartDate, setRentalStartDate] = useState("")
  const [rentalReturnDate, setRentalReturnDate] = useState("")

  const [mReason, setMReason] = useState("")
  const [mStart, setMStart] = useState("")
  const [mEnd, setMEnd] = useState("")

  const [loading, setLoading] = useState(false)

  const subcategoryOptions = SUBCATEGORIES[category] ?? []

  const handleCategoryChange = (c: MachineCategory) => {
    setCategory(c)
    setSubcategory("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const input: CreateMachineInput = {
        name, model, category, location, status,
        subcategory: subcategory || null,
        rental: null, maintenance: null,
      }

      if (status === "rented") {
        if (!client) { toast.error("Cliente es obligatorio"); setLoading(false); return }
        input.rental = { client, startDate: new Date(rentalStartDate || Date.now()), returnDate: rentalReturnDate ? new Date(rentalReturnDate) : null }
      }
      if (status === "maintenance") {
        if (!mReason) { toast.error("Describe el motivo"); setLoading(false); return }
        input.maintenance = { reason: mReason, startDate: new Date(mStart || Date.now()), estimatedEnd: mEnd ? new Date(mEnd) : null }
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
              <select id="category" value={category} onChange={(e) => handleCategoryChange(e.target.value as MachineCategory)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {categoryOptions.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
              </select>
            </div>
            {subcategoryOptions.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="subcategory">Tipo</Label>
                <select id="subcategory" value={subcategory} onChange={(e) => setSubcategory(e.target.value)}
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
              <Label htmlFor="location">Ubicación</Label>
              <select id="location" value={location} onChange={(e) => setLocation(e.target.value as MachineLocation)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {locations.map((l) => (<option key={l.value} value={l.value}>{l.label}</option>))}
              </select>
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
                <div className="space-y-2"><Label htmlFor="client">Cliente</Label><Input id="client" value={client} onChange={(e) => setClient(e.target.value)} required /></div>
                <div className="space-y-2"><Label htmlFor="rentalStartDate">Fecha de inicio</Label><Input id="rentalStartDate" type="date" value={rentalStartDate} onChange={(e) => setRentalStartDate(e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="rentalReturnDate">Fecha de retorno</Label><Input id="rentalReturnDate" type="date" value={rentalReturnDate} onChange={(e) => setRentalReturnDate(e.target.value)} /></div>
              </div>
            )}
            {status === "maintenance" && (
              <div className="space-y-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                <p className="text-sm font-medium text-yellow-900">Datos del mantenimiento</p>
                <div className="space-y-2"><Label htmlFor="mReason">Motivo</Label><Input id="mReason" value={mReason} onChange={(e) => setMReason(e.target.value)} required /></div>
                <div className="space-y-2"><Label htmlFor="mStart">Fecha de inicio</Label><Input id="mStart" type="date" value={mStart} onChange={(e) => setMStart(e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="mEnd">Fin estimado</Label><Input id="mEnd" type="date" value={mEnd} onChange={(e) => setMEnd(e.target.value)} /></div>
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
