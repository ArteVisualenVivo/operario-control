"use client"

// RepairsTabs.tsx — Pestañas de la pantalla Reparaciones.
//
// Antes eran DOS entradas del menú; ahora son dos vistas de una sola pantalla:
//   - "Taller"    : exactamente lo que hacía /repairs     (editable)
//   - "Estado 3C" : exactamente lo que hacía /maintenance (solo lectura)
//
// REGLA DE ARQUITECTURA: esto es SOLO navegación/presentación. No cambia datos,
// servicios, parsers, sincronización ni la lógica de ninguna de las dos vistas:
// reutiliza el MaintenanceTable existente y NO duplica la tabla.
//
// - La pestaña activa vive en la URL (?tab=taller | ?tab=estado3c) para que al
//   recargar se conserve.
// - "Estado 3C" es LAZY: sus datos (loadMaintenanceRecords) y la tabla se montan
//   recién cuando el usuario entra a esa pestaña.

import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { MaintenanceTable } from "@/components/maintenance/MaintenanceTable"
import type { MaintenanceRecord } from "@/services/maintenance"

export type RepairsTab = "taller" | "estado3c"

const TABS: RepairsTab[] = ["taller", "estado3c"]

const TAB_LABELS: Record<RepairsTab, string> = {
  taller: "Taller",
  estado3c: "Estado 3C",
}

// Mismo patrón de N° de orden que usaba /maintenance (sin cambios).
const ORDER_PATTERN = /^X\s?\d{4}-\d{8}$/i

function tabFromParam(value: string | null): RepairsTab {
  return value === "estado3c" ? "estado3c" : "taller"
}

/**
 * Navegación entre las pestañas. Se exporta para que los enlaces cruzados
 * ("Ver orden" / "Ver reparaciones") cambien de pestaña sin salir de /repairs.
 *
 * Devuelve la pestaña activa (leída de la URL), el ?order= activo y las
 * funciones para moverse. REGLA: ?order= se conserva solo si el llamador lo pide.
 */
export function useRepairsTabNav() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = tabFromParam(searchParams.get("tab"))
  const order = searchParams.get("order")

  const goToTab = useCallback(
    (next: RepairsTab, orderNumber?: string | null) => {
      const params = new URLSearchParams()
      params.set("tab", next)
      if (orderNumber) params.set("order", orderNumber)
      router.push(`/repairs?${params.toString()}`)
    },
    [router],
  )

  const gotoEstado3C = useCallback(
    (orderNumber?: string | null) => goToTab("estado3c", orderNumber),
    [goToTab],
  )

  const gotoTaller = useCallback(
    (orderNumber?: string | null) => goToTab("taller", orderNumber),
    [goToTab],
  )

  return { tab, order, goToTab, gotoEstado3C, gotoTaller }
}

/**
 * Pestaña "Estado 3C": MISMA carga y MISMA tabla que tenía /maintenance.
 *
 * Se monta recién cuando el usuario entra a la pestaña (lazy) → hasta entonces
 * no se consulta Redis/Firestore para estos datos.
 */
function Estado3CPanel({ focusOrder }: { focusOrder: string | null }) {
  const [orders, setOrders] = useState<MaintenanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const { gotoTaller } = useRepairsTabNav()

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { loadMaintenanceRecords } = await import("@/lib/local-sync")
      const loaded = await loadMaintenanceRecords()
      if (cancelled) return
      const visible = [...loaded]
        .filter((order) => ORDER_PATTERN.test(order.orderNumber))
        .sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime())
      setOrders(visible)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return <p className="text-muted-foreground">Cargando...</p>
  }

  return (
    <MaintenanceTable
      initialOrders={orders}
      focusOrder={focusOrder}
      onOpenTaller={gotoTaller}
    />
  )
}

type Props = {
  /** Contenido de la pestaña "Taller" (la pantalla actual de /repairs). */
  taller: React.ReactNode
}

export default function RepairsTabs({ taller }: Props) {
  const { tab, order, goToTab } = useRepairsTabNav()
  // LAZY: Estado 3C se monta (y carga sus datos) recién al activarse.
  const [estado3cMounted, setEstado3cMounted] = useState(tab === "estado3c")

  useEffect(() => {
    if (tab === "estado3c" && !estado3cMounted) setEstado3cMounted(true)
  }, [tab, estado3cMounted])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Reparaciones</h1>

        <div className="flex gap-2">
          {TABS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={tab === value ? "default" : "outline"}
              onClick={() => goToTab(value)}
            >
              {TAB_LABELS[value]}
            </Button>
          ))}
        </div>
      </div>

      {tab === "taller" ? taller : estado3cMounted ? <Estado3CPanel focusOrder={order} /> : null}
    </div>
  )
}
