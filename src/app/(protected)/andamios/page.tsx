"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMachines } from "@/hooks/useMachines"
import { useInventoryStock } from "@/hooks/useInventoryStock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import MachineCard from "@/components/machines/MachineCard"
import type { MachineStatus } from "@/types"
import { statusLabels } from "@/lib/ui"
import { SCAFFOLD_CATALOG } from "@/lib/scaffoldConfig"
import { loadScaffoldRentalStats } from "@/lib/dashboardStats"
import {
  computeScaffoldTotals,
  type ScaffoldRowKey,
} from "@/lib/scaffoldTotals"
import { toast } from "sonner"

// Artículos principales de la zona de carga (los que definen un juego).
const MAIN_ROWS: { key: ScaffoldRowKey; label: string }[] = [
  { key: "modulos", label: "Paños (módulos)" },
  { key: "riendasLargas", label: "Riendas largas" },
  { key: "riendasCortas", label: "Riendas cortas" },
  { key: "tablones", label: "Tablones" },
]

// Artículos secundarios (se muestran más chicos).
const SECONDARY_ROWS: { key: ScaffoldRowKey; label: string }[] = [
  { key: "pasilleros", label: "Módulos pasilleros" },
  { key: "ruedasSinFreno", label: "Ruedas sin freno" },
  { key: "ruedasConFreno", label: "Ruedas con freno" },
  { key: "juegosRuedas", label: "Juegos de ruedas (x4)" },
]

function normalizeText(value: string): string {
  return value.toLowerCase().trim()
}

export default function AndamiosPage() {
  const { machines, loading, remove } = useMachines()
  const { items: stockItems, loading: stockLoading } = useInventoryStock()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<MachineStatus | "all">("all")

  // ---- Control de stock: alquilados (remitos 3C) vs depósito (manual) ----
  const [deposito, setDeposito] = useState<Partial<Record<ScaffoldRowKey, number>>>({})
  const [alquiladosResumen, setAlquiladosResumen] = useState<Partial<Record<ScaffoldRowKey, number>>>({})
  const [depositoLoaded, setDepositoLoaded] = useState(false)
  const [savingDeposito, setSavingDeposito] = useState(false)
  const [depositoDirty, setDepositoDirty] = useState(false)

  // Alquilados desde remitos 3C.
  useEffect(() => {
    let cancelled = false
    loadScaffoldRentalStats().then((stats) => {
      if (cancelled || !stats) return
      const r = stats.resumen
      const modulosComunes = Math.max(0, (r?.estructuras ?? 0) - (r?.pasilleros ?? 0))
      const pasilleros = r?.pasilleros ?? 0
      setAlquiladosResumen({
        modulos: modulosComunes,
        pasilleros,
        // Las riendas no se alquilan sueltas en 3C: vienen incluidas con cada
        // módulo. Según la receta (1 juego = 2 módulos + 2 riendas largas +
        // 2 cortas), las riendas alquiladas equivalen a los módulos totales.
        riendasLargas: modulosComunes + pasilleros,
        riendasCortas: modulosComunes + pasilleros,
        ruedasSinFreno: r?.ruedasSinFreno ?? 0,
        ruedasConFreno: r?.ruedasConFreno ?? 0,
        juegosRuedas: r?.juegosRuedas ?? 0,
        tablones: r?.tablones ?? 0,
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Precarga del depósito con el stock disponible de 3C (solo valor inicial).
  const totals3C = useMemo(() => {
    const estructuras = stockItems
      .filter((item) => ["A03", "A04", "A07", "28501", "28601"].includes((item.codigo ?? "").trim()))
      .reduce((sum, item) => sum + item.stockAvailable, 0)
    const riendasLargas = stockItems
      .filter((item) => ["R02", "R04"].includes((item.codigo ?? "").trim()))
      .reduce((sum, item) => sum + item.stockAvailable, 0)
    const riendasCortas = stockItems
      .filter((item) => ["R01", "R03"].includes((item.codigo ?? "").trim()))
      .reduce((sum, item) => sum + item.stockAvailable, 0)
    const tablones = stockItems.filter((item) => item.name === "Tablones").reduce((sum, item) => sum + item.stockAvailable, 0)
    return { estructuras, riendasLargas, riendasCortas, tablones }
  }, [stockItems])

  useEffect(() => {
    let cancelled = false
    fetch("/api/andamios/deposito", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return
        if (body?.available && body.items && Object.keys(body.items).length > 0) {
          setDeposito(body.items as Partial<Record<ScaffoldRowKey, number>>)
        } else {
          setDeposito({
            modulos: totals3C.estructuras,
            riendasLargas: totals3C.riendasLargas,
            riendasCortas: totals3C.riendasCortas,
            tablones: totals3C.tablones,
            pasilleros: 0,
          })
        }
        setDepositoLoaded(true)
      })
      .catch(() => { if (!cancelled) setDepositoLoaded(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockLoading])

  const controlRows = useMemo(
    () => computeScaffoldTotals(alquiladosResumen, deposito),
    [alquiladosResumen, deposito],
  )

  const handleSaveDeposito = async () => {
    setSavingDeposito(true)
    try {
      const res = await fetch("/api/andamios/deposito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: deposito }),
      })
      if (!res.ok) throw new Error()
      toast.success("Stock de depósito guardado")
      setDepositoDirty(false)
    } catch {
      toast.error("Error al guardar el stock de depósito")
    } finally {
      setSavingDeposito(false)
    }
  }
  // ---- fin control de stock ----

  const scaffoldMachines = useMemo(
    () => machines.filter((m) => m.category === "scaffold"),
    [machines],
  )

  const scaffoldItems = useMemo(() => {
    const rows = stockItems.filter((item) => {
      const scaffoldNames = SCAFFOLD_CATALOG.map((entry) => entry.name)
      return scaffoldNames.includes(item.name)
    })
    return rows.sort((a, b) => {
      const aLabel = `${a.name} ${a.size ?? ""}`
      const bLabel = `${b.name} ${b.size ?? ""}`
      return aLabel.localeCompare(bLabel)
    })
  }, [stockItems])

  const filteredMachines = useMemo(() => {
    const q = normalizeText(search)
    return scaffoldMachines.filter((m) => {
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        (m.rental?.clientName ?? "").toLowerCase().includes(q) ||
        (m.rental?.projectName ?? "").toLowerCase().includes(q)
      const matchesStatus = statusFilter === "all" || m.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [scaffoldMachines, search, statusFilter])

  const filteredItems = useMemo(() => {
    const q = normalizeText(search)
    return scaffoldItems.filter((item) => {
      const text = [
        item.name,
        item.size ?? "",
        item.category,
        item.subtype ?? "",
        item.codigo ?? "",
      ].join(" ").toLowerCase()
      return !q || text.includes(q)
    })
  }, [scaffoldItems, search])

  const handleDelete = async (id: string) => {
    if (!window.confirm("Eliminar esta maquina? Esta accion no se puede deshacer.")) return
    try {
      await remove(id)
      toast.success("Maquina eliminada")
    } catch {
      toast.error("Error al eliminar maquina")
    }
  }

  const rowBy = (key: ScaffoldRowKey) => controlRows.rows.find((r) => r.key === key)!
  const juegosAlquilados = Math.floor(
    ((alquiladosResumen.modulos ?? 0) + (alquiladosResumen.pasilleros ?? 0)) / 2,
  )

  if (loading) return <p className="text-muted-foreground">Cargando...</p>

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Andamios</h1>
          <p className="text-sm text-muted-foreground">
            Placas de totales y carga del stock guardado en depósito.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/inventory/new")}>Nuevo material</Button>
          <Button variant="outline" onClick={() => router.push("/machines/new")}>Nueva máquina</Button>
        </div>
      </div>

      {/* ===== PLACAS PRINCIPALES ===== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="border-2 border-green-600 bg-green-50">
          <CardHeader className="pb-1">
            <CardTitle className="text-base font-semibold text-green-800">
              ✅ TOTAL ANDAMIOS DISPONIBLES
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-6xl font-bold text-green-700">
              {controlRows.juegos.comunes + controlRows.juegos.pasilleros}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {controlRows.juegos.comunes} comunes · {controlRows.juegos.pasilleros} pasilleros
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Según lo guardado en depósito: cada juego = 2 paños + 2 riendas largas + 2 cortas
            </p>
          </CardContent>
        </Card>

        <Card className="border-2 border-blue-600 bg-blue-50">
          <CardHeader className="pb-1">
            <CardTitle className="text-base font-semibold text-blue-800">
              📤 TOTAL ANDAMIOS ALQUILADOS
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-6xl font-bold text-blue-700">{juegosAlquilados}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {alquiladosResumen.modulos ?? 0} paños comunes · {alquiladosResumen.pasilleros ?? 0} pasilleros
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Según remitos de alquiler de 3C
            </p>
          </CardContent>
        </Card>
      </div>
  )

      {/* ===== ZONA DE CARGA MANUAL DEL DEPÓSITO ===== */}
      <section className="rounded-lg border p-4 bg-card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold">Stock guardado en depósito</h2>
            <p className="text-sm text-muted-foreground">
              Cargá la cantidad de cada artículo que hay en depósito y guardá.
            </p>
          </div>
          <Button onClick={handleSaveDeposito} disabled={savingDeposito || !depositoLoaded}>
            {savingDeposito ? "Guardando..." : "Guardar depósito"}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {MAIN_ROWS.map(({ key, label }) => (
            <div key={key} className="rounded-lg border p-3">
              <p className="text-sm font-medium">{label}</p>
              <Input
                type="number"
                min={0}
                className="mt-2 h-12 text-2xl font-bold text-center"
                value={deposito[key] ?? 0}
                disabled={!depositoLoaded}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0)
                  setDeposito((prev) => ({ ...prev, [key]: v }))
                  setDepositoDirty(true)
                }}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SECONDARY_ROWS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <span className="text-xs flex-1">{label}</span>
              <Input
                type="number"
                min={0}
                className="w-16 h-8 text-center"
                value={deposito[key] ?? 0}
                disabled={!depositoLoaded}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0)
                  setDeposito((prev) => ({ ...prev, [key]: v }))
                  setDepositoDirty(true)
                }}
              />
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Alquilados (automático): {rowBy("modulos").alquilados} paños · {rowBy("riendasLargas").alquilados} riendas
          largas · {rowBy("riendasCortas").alquilados} cortas · {rowBy("tablones").alquilados} tablones ·{" "}
          {rowBy("ruedasConFreno").alquilados} ruedas c/freno. Las riendas no se alquilan sueltas en 3C: se
          calculan por receta (2 largas + 2 cortas por juego).
        </p>
        {depositoDirty && <p className="text-xs text-amber-600">⚠ Hay cambios sin guardar.</p>}
      </section>

      {/* Buscador para los listados de abajo */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <Input
          placeholder="Buscar máquina, pieza o accesorio..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xl"
        />
        <div className="flex gap-2 flex-wrap">
          {(["all", "available", "rented", "maintenance"] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "Todos" : statusLabels[s]}
            </Button>
          ))}
        </div>
      </div>

      {/* ===== LISTADOS COLAPSABLES ===== */}
      <details className="rounded-lg border">
        <summary className="cursor-pointer px-4 py-3 font-medium">
          Estructuras de andamio ({filteredMachines.length})
        </summary>
        <div className="px-4 pb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMachines.map((machine) => (
            <MachineCard key={machine.id} machine={machine} onDelete={handleDelete} />
          ))}
          {filteredMachines.length === 0 && (
            <p className="text-center text-muted-foreground">No se encontraron estructuras</p>
          )}
        </div>
      </details>

      <details className="rounded-lg border">
        <summary className="cursor-pointer px-4 py-3 font-medium">
          Piezas y accesorios ({filteredItems.length})
        </summary>
        <div className="px-4 pb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <Card
              key={item.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => router.push(`/inventory/${item.id}`)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{item.name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {item.category}
                  {item.size ? ` | Medida: ${item.size}` : ""}
                </p>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>Total: <strong>{item.stockTotal}</strong></p>
                <p className="text-green-600">Disponibles: <strong>{item.stockAvailable}</strong></p>
                <p className="text-blue-600">Alquilados: <strong>{item.stockRented}</strong></p>
              </CardContent>
            </Card>
          ))}
          {filteredItems.length === 0 && (
            <p className="text-center text-muted-foreground">No hay registros.</p>
          )}
        </div>
      </details>
    </div>
  )
}