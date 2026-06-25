"use client"

import { useRouter } from "next/navigation"
import { useRepairs } from "@/hooks/useRepairs"
import { useMaintenanceSettings } from "@/hooks/useMaintenanceSettings"
import RepairForm from "@/components/repairs/RepairForm"
import type { CreateRepairInput } from "@/types"

export default function NewRepairPage() {
  const router = useRouter()
  const { create } = useRepairs()
  const { settings, loading } = useMaintenanceSettings()

  if (loading) return <p className="text-muted-foreground">Cargando...</p>
  if (!settings) return <p className="text-muted-foreground">Error al cargar configuración</p>

  const handleSubmit = async (data: CreateRepairInput) => {
    await create(data)
    router.push("/repairs")
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <RepairForm settings={settings} onSubmit={handleSubmit} onCancel={() => router.push("/repairs")} />
    </div>
  )
}
