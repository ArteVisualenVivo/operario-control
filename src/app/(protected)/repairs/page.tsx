"use client"

import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { Button } from "@/components/ui/button"

export default function RepairsPage() {
  const { machines, loading } = useMachines()
  const router = useRouter()

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reparaciones</h1>
      </div>
      <p className="text-muted-foreground">
        Las reparaciones y mantenciones se gestionan directamente desde la ficha de cada máquina.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => router.push("/machines")}>Ir a máquinas</Button>
      </div>
    </div>
  )
}
