"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export default function NewRepairPage() {
  const router = useRouter()

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">Nueva reparación</h1>
      <p className="text-muted-foreground">
        Las reparaciones se gestionan desde la ficha de cada máquina.
      </p>
      <Button onClick={() => router.push("/machines")}>Ir a máquinas</Button>
    </div>
  )
}
