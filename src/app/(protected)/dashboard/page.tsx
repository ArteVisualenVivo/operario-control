"use client"

import { useEffect } from "react"
import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import SeedInventory from "@/components/machines/SeedInventory"
import Sync3CButton from "@/components/sync/Sync3CButton"
import WorkshopSummary from "@/components/dashboard/WorkshopSummary"
import SmartAlertsPanel from "@/components/dashboard/SmartAlertsPanel"
import { useStockIntelligence } from "@/hooks/useStockIntelligence"
import type { MachineStatus, Machine } from "@/types"
import { statusLabels, formatDate } from "@/lib/ui"
import { SCAFFOLD_RECIPE } from "@/lib/scaffoldConfig"

interface MachineGroup {
  key: string
  name: string
  model: string
  machines: Machine[]
  total: number
  available: number
  rented: number
  maintenance: number
}

export default function DashboardPage() {
  const { machines, loading } = useMachines()
  const { items: stockItems, loading: stockLoading } = useInventoryStock()
  const { intelligence: stockIntelligence, loading: siLoading } = useStockIntelligence()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<MachineStatus | "all">("all")
  const [showMachines, setShowMachines] = useState(false)

  useEffect(() => {
    if (!loading) {
      const rented = machines.filter(m => m.status === "rented")
      rented.forEach(m => {
        console.log(`[DASHBOARD] ${m.name} | status: ${m.status} | rental: ${m.rental ? "OK" : "NULL"} | location: ${m.location ? "OK" : "NULL"}`)
      })
    }
  }, [machines, loading])

  const filteredMachines = useMemo(() => {
    return machines.filter((m) => {
      const q = search.toLowerCase()
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        (m.rental?.clientName ?? "").toLowerCase().includes(q) ||
        (m.rental?.projectName ?? "").toLowerCase().includes(q)
      const matchesStatus = statusFilter === "all" || m.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [machines, search, statusFilter])

  const grouped = useMemo(() => {
    const groups: Record<string, MachineGroup> = {}
    for (const m of filteredMachines) {
      const key = `${m.name ?? "sin-nombre"}||${m.model ?? "sin-modelo"}`
      if (!groups[key]) {
        groups[key] = {
          key, name: m.name, model: m.model,
          machines: [], total: 0, available: 0, rented: 0, maintenance: 0,
        }
      }
      groups[key].machines.push(m)
      groups[key].total++
      if (m.status === "available") groups[key].available++
      else if (m.status === "rented") groups[key].rented++
      else if (m.status === "maintenance") groups[key].maintenance++
    }
    return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name))
  }, [filteredMachines])

  const alerts = useMemo(() => {
    const now = new Date()
    const getDaysLeft = (date: Date | string | null | undefined): number | null => {
      if (!date) return null
      return Math.ceil((new Date(date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    }

    return machines
      .filter(m =>
        m.status === "rented" &&
        m.rental?.expectedEndDate &&
        !m.rental?.isOpenEnded
      )
      .map(m => {
        const days = getDaysLeft(m.rental?.expectedEndDate)
        return { machine: m, days }
      })
      .filter((a): a is { machine: Machine; days: number } => a.days !== null && a.days <= 30)
      .sort((a, b) => a.days - b.days)
      .slice(0, 5)
  }, [machines])

  const cuerposCompletos = useMemo(() => {
    let min = Infinity
    for (const component of SCAFFOLD_RECIPE) {
      const match = component.size
        ? stockItems.filter(s => s.name === component.name && s.size === component.size)
        : stockItems.filter(s => s.name === component.name)
      const total = match.reduce((sum, s) => sum + s.stockAvailable, 0)
      const posibles = Math.floor(total / component.quantity)
      if (posibles < min) min = posibles
    }
    return min === Infinity ? 0 : min
  }, [stockItems])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <SeedInventory onComplete={() => window.location.reload()} />
        <Sync3CButton onComplete={() => window.location.reload()} variant="outline" />
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-red-700">Alquileres próximos a vencer</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.map(({ machine, days }) => (
              <Card
                key={machine.id}
                className="cursor-pointer transition-shadow hover:shadow-md bg-amber-50"
                onClick={() => router.push(`/machines/${machine.id}`)}
              >
                <CardContent className="p-3 text-sm space-y-1">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-1 ${
                    days <= 0
                      ? "bg-red-200 text-red-800"
                      : days === 1
                        ? "bg-orange-200 text-orange-800"
                        : "bg-yellow-200 text-yellow-800"
                  }`}>
                    {days <= 0 ? "VENCIDO" : days === 1 ? "VENCE MAÑANA" : "PRÓXIMO A VENCER"}
                  </span>
                  <p className="font-medium">{machine.name}</p>
                  <p className="text-xs text-muted-foreground">{machine.model}</p>
                  {machine.rental && (
                    <>
                      <p><span className="text-muted-foreground">Cliente: </span><strong>{machine.rental.clientName}</strong></p>
                      {machine.location?.client?.address && (
                        <p><span className="text-muted-foreground">Dir. cliente: </span><strong>{machine.location.client.address}</strong></p>
                      )}
                      <p><span className="text-muted-foreground">Obra: </span><strong>{machine.rental.projectName}</strong></p>
                      {machine.location?.project?.address && (
                        <p><span className="text-muted-foreground">Dir. obra: </span><strong>{machine.location.project.address}</strong></p>
                      )}
                      <p><span className="text-muted-foreground">Vence: </span>{formatDate(machine.rental.expectedEndDate)}</p>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <WorkshopSummary />

      <SmartAlertsPanel />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push("/machines")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total equipos</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{machines.length}</p></CardContent>
        </Card>
        <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push("/machines?status=available")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Disponibles</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-green-600">{machines.filter((m) => m.status === "available").length}</p></CardContent>
        </Card>
        <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push("/machines?status=rented")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Alquiladas</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-blue-600">{machines.filter((m) => m.status === "rented").length}</p></CardContent>
        </Card>
        <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push("/machines?status=maintenance")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Mantenimiento</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold text-yellow-600">{machines.filter((m) => m.status === "maintenance").length}</p></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push("/machines?category=machine")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Maquinaria</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{machines.filter((m) => m.category === "machine").length}</p></CardContent>
        </Card>
        <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push("/andamios")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Andamios</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <p><span className="text-3xl font-bold">{machines.filter((m) => m.category === "scaffold").length}</span> <span className="text-sm text-muted-foreground">cuerpos</span></p>
            <p><span className="text-xl font-bold text-orange-600">{cuerposCompletos}</span> <span className="text-sm text-muted-foreground">completos (según stock)</span></p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push("/machines?category=tool")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Herramientas</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{machines.filter((m) => m.category === "tool").length}</p></CardContent>
        </Card>
      </div>

      <button
        onClick={() => setShowMachines(!showMachines)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="text-xs">{showMachines ? "▼" : "▶"}</span>
        <span>Ver listado de máquinas</span>
        <span className="text-xs text-muted-foreground">({grouped.length} grupo{grouped.length !== 1 ? "s" : ""})</span>
      </button>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Input
          placeholder="Buscar por nombre, modelo, cliente u obra..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setShowMachines(true) }}
          className="max-w-sm"
        />
        <div className="flex gap-2">
          {(["all", "available", "rented", "maintenance"] as const).map((s) => (
            <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
              {s === "all" ? "Todos" : statusLabels[s]}
            </Button>
          ))}
        </div>
      </div>

      {showMachines && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {grouped.map((group) => (
            <Card key={group.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{group.name}</CardTitle>
                <p className="text-xs text-muted-foreground">Modelo: {group.model}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>Total: <strong>{group.total}</strong></span>
                  <span className="text-green-600">Disp: <strong>{group.available}</strong></span>
                  <span className="text-blue-600">Alq: <strong>{group.rented}</strong></span>
                  <span className="text-yellow-600">Mant: <strong>{group.maintenance}</strong></span>
                </div>
                {group.rented > 0 && group.machines.filter(m => m.status === "rented").map(rm => (
                  <div key={rm.id} className="border-t pt-2 text-xs space-y-0.5 text-muted-foreground">
                    {rm.rental && (
                      <>
                        <p>→ Cliente: {rm.rental.clientName}</p>
                        {rm.location?.client?.address && <p>→ Dir. cliente: {rm.location.client.address}</p>}
                        <p>→ Obra: {rm.rental.projectName}</p>
                        {rm.location?.project?.address && <p>→ Dir. obra: {rm.location.project.address}</p>}
                        <p>→ Inicio: {formatDate(rm.rental.startDate)}</p>
                        {!rm.rental.isOpenEnded && rm.rental.expectedEndDate && (
                          <p>→ Fin estimado: {formatDate(rm.rental.expectedEndDate)}</p>
                        )}
                        {rm.rental.isOpenEnded && (
                          <p className="text-blue-600">→ Plazo abierto</p>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
          {grouped.length === 0 && <p className="text-center text-muted-foreground col-span-full">No se encontraron máquinas</p>}
        </div>
      )}

      <div className="border-t pt-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Stock de materiales</h2>
          <Button size="sm" onClick={() => router.push("/inventory/new")}>
            + Nuevo material
          </Button>
        </div>

        {stockLoading ? (
          <p className="text-muted-foreground">Cargando stock...</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stockItems.map((item) => (
              <Card
                key={item.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => router.push(`/inventory/${item.id}`)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{item.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                {item.unit}{item.size ? ` | Medida: ${item.size}` : ""}
              </p>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>Total: <strong>{item.stockTotal}</strong></p>
                  <p className="text-green-600">Disponibles: <strong>{item.stockAvailable}</strong></p>
                  <p className="text-blue-600">Alquilados: <strong>{item.stockRented}</strong></p>
                </CardContent>
              </Card>
            ))}
            {stockItems.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center">No hay materiales registrados</p>
            )}
          </div>
        )}

      </div>

      <div className="border-t pt-6 mt-6">
        <h2 className="text-xl font-semibold mb-4">📦 Stock Intelligence</h2>

        {siLoading ? (
          <p className="text-muted-foreground">Analizando stock...</p>
        ) : stockIntelligence ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Health Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <p className="text-3xl font-bold">{stockIntelligence.healthScore.overall}</p>
                    <span className="text-lg">/100</span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-full bg-gray-200">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        stockIntelligence.healthScore.overall >= 70
                          ? "bg-green-500"
                          : stockIntelligence.healthScore.overall >= 40
                            ? "bg-yellow-500"
                            : "bg-red-500"
                      }`}
                      style={{ width: `${stockIntelligence.healthScore.overall}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">En riesgo</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-red-600">{stockIntelligence.criticalItems.length}</p>
                  <p className="text-xs text-muted-foreground">ítems críticos</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Consumo semanal</CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const top = stockIntelligence.topConsumed
                    const total = top.reduce((s, i) => s + i.total, 0)
                    return (
                      <>
                        <p className="text-3xl font-bold">{total}</p>
                        <p className="text-xs text-muted-foreground">unidades alquiladas (top 5)</p>
                      </>
                    )
                  })()}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Tendencia</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {stockIntelligence.trend === "up" ? "↑" : stockIntelligence.trend === "down" ? "↓" : "→"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {stockIntelligence.trend === "up" ? "En aumento" : stockIntelligence.trend === "down" ? "En descenso" : "Estable"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {stockIntelligence.topConsumed.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Top 5 materiales más consumidos</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {stockIntelligence.topConsumed.map((item, i) => (
                      <div
                        key={item.materialId}
                        className="flex items-center justify-between rounded border p-2 text-sm cursor-pointer hover:bg-muted/30"
                        onClick={() => router.push(`/inventory/${item.materialId}`)}
                      >
                        <span>
                          <span className="font-medium text-muted-foreground mr-2">#{i + 1}</span>
                          {item.materialName}
                        </span>
                        <span className="font-mono text-sm">{item.total} uds</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {stockIntelligence.criticalItems.length > 0 && (
              <Card className="border-t-4 border-red-400">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-red-700">
                    🔴 Ítems críticos ({stockIntelligence.criticalItems.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {stockIntelligence.criticalItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-lg border p-2 text-sm cursor-pointer hover:bg-red-50"
                        onClick={() => {
                          const path = item.entityType === "MATERIAL"
                            ? `/inventory/${item.entityId}`
                            : item.entityType === "SPARE_PART"
                              ? `/machines/${item.entityId}/parts`
                              : `/machines/${item.entityId}`
                          router.push(path)
                        }}
                      >
                        <span>{item.message}</span>
                        <span className="text-xs text-muted-foreground">{item.detail}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : null}
      </div>

    </div>
  )
}
