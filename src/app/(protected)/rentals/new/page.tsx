"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useRentals } from "@/hooks/useRentals"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

export default function NewRentalPage() {
  const { create } = useRentals()
  const { machines } = useMachines()
  const router = useRouter()

  const availableMachines = machines.filter((m) => m.status === "available")

  const [machineId, setMachineId] = useState("")
  const [client, setClient] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!machineId) {
      toast.error("Selecciona una máquina")
      return
    }
    setLoading(true)
    try {
      await create({ machineId, client, startDate: new Date() })
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
              <select
                id="machine"
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              >
                <option value="">Seleccionar máquina...</option>
                {availableMachines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.model})
                  </option>
                ))}
              </select>
              {availableMachines.length === 0 && (
                <p className="text-xs text-muted-foreground">No hay máquinas disponibles</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="client">Cliente</Label>
              <Input id="client" value={client} onChange={(e) => setClient(e.target.value)} required />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading || availableMachines.length === 0}>
                {loading ? "Guardando..." : "Registrar alquiler"}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
