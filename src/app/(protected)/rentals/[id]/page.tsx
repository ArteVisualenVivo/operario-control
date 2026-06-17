"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getRental } from "@/services/rentals"
import { getMachine } from "@/services/machines"
import { useRentals } from "@/hooks/useRentals"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Rental, Machine } from "@/types"

export default function RentalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { close } = useRentals()
  const [rental, setRental] = useState<Rental | null>(null)
  const [machine, setMachine] = useState<Machine | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const r = await getRental(id)
      setRental(r)
      if (r) {
        setMachine(await getMachine(r.machineId))
      }
      setLoading(false)
    }
    load()
  }, [id])

  const handleClose = async () => {
    await close(id)
    const r = await getRental(id)
    setRental(r)
  }

  if (loading) return <p className="text-muted-foreground">Cargando...</p>
  if (!rental) return <p className="text-muted-foreground">Alquiler no encontrado</p>

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Button variant="outline" size="sm" onClick={() => router.back()}>← Volver</Button>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle>Alquiler</CardTitle>
            <Badge variant={rental.status === "active" ? "default" : "outline"}>
              {rental.status === "active" ? "Activo" : "Cerrado"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-muted-foreground">Máquina:</span> {machine?.name ?? rental.machineId}</p>
          <p><span className="text-muted-foreground">Cliente:</span> {rental.client}</p>
          <p><span className="text-muted-foreground">Inicio:</span> {new Date(rental.startDate).toLocaleDateString("es-ES")}</p>
          <p><span className="text-muted-foreground">Retorno:</span> {rental.returnDate ? new Date(rental.returnDate).toLocaleDateString("es-ES") : "—"}</p>
          {rental.status === "active" && (
            <Button onClick={handleClose} className="mt-4">Cerrar alquiler</Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
