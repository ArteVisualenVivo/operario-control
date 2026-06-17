"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useRepairs } from "@/hooks/useRepairs"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

export default function NewRepairPage() {
  const { create } = useRepairs()
  const { machines } = useMachines()
  const router = useRouter()

  const repairableMachines = machines.filter((m) => m.status !== "maintenance")

  const [machineId, setMachineId] = useState("")
  const [issue, setIssue] = useState("")
  const [estimatedReturn, setEstimatedReturn] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!machineId) {
      toast.error("Selecciona una máquina")
      return
    }
    setLoading(true)
    try {
      await create({
        machineId,
        issue,
        estimatedReturn: estimatedReturn ? new Date(estimatedReturn) : null,
      })
      toast.success("Reparación registrada")
      router.push("/repairs")
    } catch {
      toast.error("Error al registrar reparación")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">Nueva reparación</h1>
      <Card>
        <CardHeader>
          <CardTitle>Datos de la reparación</CardTitle>
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
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.status === "available" ? "Disponible" : m.status === "rented" ? "Alquilada" : "En reparación"})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="issue">Problema / Descripción</Label>
              <Input id="issue" value={issue} onChange={(e) => setIssue(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="estimatedReturn">Retorno estimado</Label>
              <Input id="estimatedReturn" type="date" value={estimatedReturn} onChange={(e) => setEstimatedReturn(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? "Guardando..." : "Registrar reparación"}
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
