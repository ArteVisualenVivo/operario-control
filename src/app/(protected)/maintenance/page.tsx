"use client"

// /maintenance ya no tiene entrada propia en el menú: Mantenimiento ahora es la
// pestaña "Estado 3C" dentro de Reparaciones.
//
// Esta ruta se CONSERVA como redirect (no se elimina) para no romper los enlaces
// existentes: Dashboard (WorkshopSummary), botones de /repairs y marcadores
// guardados. Se preservan todos los parámetros recibidos (en especial ?order=...)
// y se fuerza tab=estado3c.
//
// La vista en sí (carga de datos + MaintenanceTable) vive en RepairsTabs, que la
// monta de forma lazy al entrar a la pestaña. No hay lógica duplicada.

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

function RedirectToEstado3C() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", "estado3c")
    router.replace(`/repairs?${params.toString()}`)
  }, [router, searchParams])

  return <p className="text-muted-foreground">Redirigiendo a Reparaciones...</p>
}

export default function MaintenanceRedirectPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Redirigiendo a Reparaciones...</p>}>
      <RedirectToEstado3C />
    </Suspense>
  )
}
