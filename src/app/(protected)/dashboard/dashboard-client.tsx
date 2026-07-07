"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Sync3CButton from "@/components/sync/Sync3CButton"
import WorkshopSummary from "@/components/dashboard/WorkshopSummary"
import SmartAlertsPanel from "@/components/dashboard/SmartAlertsPanel"
import { useStockIntelligence } from "@/hooks/useStockIntelligence"
import type { MachineStatus, Machine } from "@/types"
import { statusLabels, formatDate } from "@/lib/ui"
import { SCAFFOLD_RECIPE } from "@/lib/scaffoldConfig"
import { sumStockByCodes, SCAFFOLD_CODES, PUNTAL_CODES } from "@/lib/inventoryGroups"
import { searchEverywhere, type SearchResult } from "@/lib/search"
import { GlobalSearchResults } from "@/components/dashboard/GlobalSearchResults"
import type { MaintenanceRecord } from "@/services/maintenance"

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

type Props = {
  initialOrders: MaintenanceRecord[]
}

export default function DashboardClient({ initialOrders }: Props) {
  const { machines, loading, reload: reloadMachines } = useMachines()
  const { items: stockItems, loading: stockLoading, reload: reloadStock } = useInventoryStock()
  const { intelligence: stockIntelligence, loading: siLoading, refresh: refreshIntelligence } = useStockIntelligence()
  const router = useRouter()
  const refreshAll = useCallback(() => {
    reloadMachines()
    reloadStock()
    refreshIntelligence()
  }, [reloadMachines, reloadStock, refreshIntelligence])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<MachineStatus | "all">("all")
  const [showMachines, setShowMachines] = useState(false)
  const [showStock, setShowStock] = useState(false)

  useEffect(() => {
    // Debug log removido
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

  // ---------------------------------------------------------------------------
  // Cálculos de stock de andamios para el bloque visual del Dashboard
  // TODO: Cuando Paños y Riendas existan en 3C con código propio,
  //       reemplazar la búsqueda por nombre por búsqueda mediante código.
  // ---------------------------------------------------------------------------
  const scaffoldStock = useMemo(() => {
    const n = (s: string) => s.toLowerCase().trim()

    // Búsqueda parcial normalizada (temporal hasta que tengan código 3C)
    const panos = stockItems
      .filter((item) => n(item.name).includes("paño"))
      .reduce((sum, item) => sum + item.stockAvailable, 0)

    const riendasLargas = stockItems
      .filter((item) => {
        const name = n(item.name)
        return (name.includes("rienda")) && (name.includes("larga"))
      })
      .reduce((sum, item) => sum + item.stockAvailable, 0)

    const riendasCortas = stockItems
      .filter((item) => {
        const name = n(item.name)
        return (name.includes("rienda")) && (name.includes("corta"))
      })
      .reduce((sum, item) => sum + item.stockAvailable, 0)

    // Búsqueda por códigos 3C (estable)
    const estructuras = sumStockByCodes(stockItems, SCAFFOLD_CODES.structures)
    const tablones = sumStockByCodes(stockItems, SCAFFOLD_CODES.planks)
    const ruedasSinFreno = sumStockByCodes(stockItems, SCAFFOLD_CODES.wheels_nobrake)
    const ruedasConFreno = sumStockByCodes(stockItems, SCAFFOLD_CODES.wheels_brake)
    const juegosRuedas = sumStockByCodes(stockItems, SCAFFOLD_CODES.wheels_set)
    const puntales = sumStockByCodes(stockItems, SCAFFOLD_CODES.puntales)
    const extensiones = sumStockByCodes(stockItems, SCAFFOLD_CODES.extensions)
    const reguladores = sumStockByCodes(stockItems, SCAFFOLD_CODES.regulators)
    const barandas = sumStockByCodes(stockItems, SCAFFOLD_CODES.handrails)
    const bases = sumStockByCodes(stockItems, SCAFFOLD_CODES.bases)
    const caballetes = sumStockByCodes(stockItems, SCAFFOLD_CODES.caballetes)

    const cuerpos = Math.min(
      Math.floor(panos / 2),
      Math.floor(riendasLargas / 2),
      Math.floor(riendasCortas / 2)
    )

    return {
      estructuras, cuerpos,
      panos, riendasLargas, riendasCortas,
      tablones, ruedasSinFreno, ruedasConFreno, juegosRuedas,
      puntales, extensiones, reguladores, barandas, bases, caballetes,
    }
  }, [stockItems])

  // Cálculos de stock de puntales (solo códigos 3C, estable)
  const puntalStock = useMemo(() => ({
    structures: sumStockByCodes(stockItems, PUNTAL_CODES.structures),
    regulators: sumStockByCodes(stockItems, PUNTAL_CODES.regulators),
    basesPuntal: sumStockByCodes(stockItems, PUNTAL_CODES.bases),
    hooks: sumStockByCodes(stockItems, PUNTAL_CODES.hooks),
    spareParts: sumStockByCodes(stockItems, PUNTAL_CODES.spare_parts),
    extensionsPuntal: sumStockByCodes(stockItems, PUNTAL_CODES.extensions),
  }), [stockItems])

  /** Determina el color según el stock. */
  function stockColor(value: number): string {
    if (value <= 0) return "text-red-600"
    if (value <= 5) return "text-yellow-600"
    return "text-green-600"
  }

  // Resultados del buscador global (no consulta Firestore, usa datos en memoria)
  const searchResults = useMemo(() => {
    return searchEverywhere(search, {
      orders: initialOrders,
      machines,
      stockItems,
    })
  }, [search, initialOrders, machines, stockItems])

  const handleSelectResult = useCallback((result: SearchResult) => {
    router.push(result.route)
  }, [router])

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      {/* Header: Sync button + buscador global */}
      <div className="flex flex-wrap items-center gap-3">
        <Sync3CButton onComplete={refreshAll} variant="outline" />
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Input
            type="search"
            placeholder="Buscar órdenes, máquinas, inventario, alquileres..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          {search && (
            <Button variant="outline" size="sm" onClick={() => setSearch("")}>
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {/* Panel de resultados del buscador global (no cambia de pantalla) */}
      {search.trim() && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <GlobalSearchResults results={searchResults} onSelect={handleSelectResult} />
        </div>
      )}

      <>
        {/* Fila 1: KPI Bar */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
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
          <WorkshopSummary />
        </div>

        {/* Fila 2: Categorías */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push("/machines?category=machine")}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Maquinaria</CardTitle></CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{machines.filter((m) => m.category === "machine").length}</p>
              <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
                <div className="h-2 rounded-full bg-blue-500" style={{ width: `${machines.length > 0 ? Math.round((machines.filter(m => m.category === "machine").length / machines.length) * 100) : 0}%` }} />
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push("/andamios")}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Andamios</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              <p><span className="text-3xl font-bold">{machines.filter((m) => m.category === "scaffold").length}</span> <span className="text-sm text-muted-foreground">cuerpos</span></p>
              <p><span className="text-xl font-bold text-orange-600">{cuerposCompletos}</span> <span className="text-sm text-muted-foreground">completos (según stock)</span></p>
              <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
                <div className="h-2 rounded-full bg-orange-500" style={{ width: `${machines.length > 0 ? Math.round((machines.filter(m => m.category === "scaffold").length / machines.length) * 100) : 0}%` }} />
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push("/machines?category=tool")}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Herramientas</CardTitle></CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{machines.filter((m) => m.category === "tool").length}</p>
              <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
                <div className="h-2 rounded-full bg-green-500" style={{ width: `${machines.length > 0 ? Math.round((machines.filter(m => m.category === "tool").length / machines.length) * 100) : 0}%` }} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Fila 3: Estado de Andamios */}
        <div className="border-t pt-6 mt-6">
          <h2 className="text-xl font-semibold mb-4">🏗️ Estado de Andamios</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* 1. Estructuras */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🏗️ Estructuras</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.estructuras)}`}>{scaffoldStock.estructuras}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 2. Cuerpos completos */}
            <Card className="border-2 border-orange-500 bg-orange-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-orange-800">🏗️ Cuerpos completos</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-orange-700">{scaffoldStock.cuerpos}</p>
                <p className="text-xs text-muted-foreground">Requiere: 2 Paños + 2 Riendas largas + 2 Riendas cortas</p>
              </CardContent>
            </Card>

            {/* 3. Paños (temporal, sin código 3C) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🟦 Paños</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.panos)}`}>{scaffoldStock.panos}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 4. Riendas largas (temporal, sin código 3C) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🟨 Riendas largas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.riendasLargas)}`}>{scaffoldStock.riendasLargas}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 5. Riendas cortas (temporal, sin código 3C) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🟧 Riendas cortas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.riendasCortas)}`}>{scaffoldStock.riendasCortas}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 6. Tablones */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🟫 Tablones</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.tablones)}`}>{scaffoldStock.tablones}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 7. Ruedas sin freno */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">⚫ Ruedas sin freno</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.ruedasSinFreno)}`}>{scaffoldStock.ruedasSinFreno}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 8. Ruedas con freno */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🟢 Ruedas con freno</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.ruedasConFreno)}`}>{scaffoldStock.ruedasConFreno}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 9. Juegos de ruedas */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🔵 Juegos de ruedas (4)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.juegosRuedas)}`}>{scaffoldStock.juegosRuedas}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 10. Puntales */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🟤 Puntales</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.puntales)}`}>{scaffoldStock.puntales}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 11. Extensiones */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🟠 Extensiones</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.extensiones)}`}>{scaffoldStock.extensiones}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 12. Reguladores */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">⚙ Reguladores</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.reguladores)}`}>{scaffoldStock.reguladores}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 13. Barandas */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🛡️ Barandas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.barandas)}`}>{scaffoldStock.barandas}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 14. Bases */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🏗️ Bases</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.bases)}`}>{scaffoldStock.bases}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 15. Caballetes */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🪚 Caballetes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(scaffoldStock.caballetes)}`}>{scaffoldStock.caballetes}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Fila 3b: Estado de Puntales */}
        <div className="border-t pt-6 mt-6">
          <h2 className="text-xl font-semibold mb-4">🟤 Estado de Puntales</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* 1. Puntales completos */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🟤 Puntales</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(puntalStock.structures)}`}>{puntalStock.structures}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 2. Reguladores */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">⚙ Reguladores</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(puntalStock.regulators)}`}>{puntalStock.regulators}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 3. Bases */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🏗 Bases</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(puntalStock.basesPuntal)}`}>{puntalStock.basesPuntal}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 4. Ganchos */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🪝 Ganchos</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(puntalStock.hooks)}`}>{puntalStock.hooks}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 5. Repuestos */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🔩 Repuestos</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(puntalStock.spareParts)}`}>{puntalStock.spareParts}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>

            {/* 6. Extensiones */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">🟠 Extensiones</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stockColor(puntalStock.extensionsPuntal)}`}>{puntalStock.extensionsPuntal}</p>
                <p className="text-xs text-muted-foreground">Disponibles</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Fila 4: Alquileres próximos a vencer */}
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
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-1 ${days <= 0
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

        {/* Fila 4: WorkshopSummary */}
        <WorkshopSummary />

        {/* Fila 5: SmartAlertsPanel */}
        <SmartAlertsPanel />

        {/* Fila 5: Stock Intelligence */}
        <div className="border-t pt-6 mt-6">
          <h2 className="text-xl font-semibold mb-4">Stock Intelligence</h2>

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
                        className={`h-2 rounded-full transition-all ${stockIntelligence.healthScore.overall >= 70
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

            </div>
          ) : null}
        </div>

        {/* Fila 6: Máquinas — sección plegable */}
        <div className="border-t pt-6 mt-6">
          <button
            onClick={() => setShowMachines(!showMachines)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="text-xs">{showMachines ? "▼" : "▶"}</span>
            <span>Ver listado de máquinas</span>
            <span className="text-xs text-muted-foreground">({grouped.length} grupo{grouped.length !== 1 ? "s" : ""})</span>
          </button>

          {showMachines && (
            <>
              <div className="flex flex-col gap-4 sm:flex-row mt-4">
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

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4">
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
            </>
          )}
        </div>

        {/* Fila 7: Stock completo — sección plegable */}
        <div className="border-t pt-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setShowStock(!showStock)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="text-xs">{showStock ? "▼" : "▶"}</span>
              <span>Stock de materiales</span>
              <span className="text-xs text-muted-foreground">({stockItems.length} item{stockItems.length !== 1 ? "s" : ""})</span>
            </button>
            <Button size="sm" onClick={() => router.push("/inventory/new")}>
              + Nuevo material
            </Button>
          </div>

          {showStock && (
            <>
              {stockLoading ? (
                <p className="text-muted-foreground">Cargando stock...</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {stockItems.map((item) => {
                    const isLowStock = item.stockAvailable <= 0 || item.stockTotal <= 0
                    return (
                      <Card
                        key={item.id}
                        className={`cursor-pointer transition-shadow hover:shadow-md ${isLowStock ? "border-red-300 bg-red-50/50" : ""}`}
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
                          <p className={isLowStock ? "text-red-600 font-semibold" : "text-green-600"}>
                            Disponibles: <strong>{item.stockAvailable}</strong>
                            {isLowStock && " ⚠️ Sin stock"}
                          </p>
                          <p className="text-blue-600">Alquilados: <strong>{item.stockRented}</strong></p>
                        </CardContent>
                      </Card>
                    )
                  })}
                  {stockItems.length === 0 && (
                    <p className="text-muted-foreground col-span-full text-center">No hay materiales registrados</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </>
    </div>
  )
}
