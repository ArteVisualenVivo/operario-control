"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export default function RepairDetailPage() {
  const router = useRouter()
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Button variant="outline" size="sm" onClick={() => router.back()}>← Volver</Button>
      <p className="text-muted-foreground">
        Las reparaciones se gestionan desde la ficha de cada máquina.
      </p>
    </div>
  )
}
