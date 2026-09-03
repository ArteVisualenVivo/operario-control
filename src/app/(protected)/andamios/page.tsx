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
import { type PuntalAlquilados } from "@/lib/sync-3c/scaffoldRentals"
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
  const [pasillerosAlq, setPasillerosAlq] = useState(0)
  const [depositoLoaded, setDepositoLoaded] = useState(false)
  const [savingDeposito, setSavingDeposito] = useState(false)
  const [depositoDirty, setDepositoDirty] = useState(false)

  // ---- Sector PUNTALES ----
  const [depositoPuntal, setDepositoPuntal] = useState<PuntalAlquilados>({ barovo: 0, marron: 0, naranja: 0, largo380: 0, mmq: 0, total: 0 })
  const [puntalAlquilados, setPuntalAlquilados] = useState<PuntalAlquilados | null>(null)

  // Alquilados desde remitos 3C.
  useEffect(() => {
    let cancelled = false
    loadScaffoldRentalStats().then((stats) => {
      if (cancelled || !stats) return
      const r = stats.resumen
      const modulosComunes = Math.max(0, (r?.estructuras ?? 0) - (r?.pasilleros ?? 0))
      const pasilleros = r?.pasilleros ?? 0
      setPasillerosAlq(pasilleros)
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
      // Puntales alquilados (remitos 3C) con desglose por tipo.
      const p = r?.puntalEstructuras
      setPuntalAlquilados(p && typeof p === "object" ? p : null)
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
          const all = body.items as Record<string, unknown>
          setDeposito(all as Partial<Record<ScaffoldRowKey, number>>)
          setDepositoPuntal({ barovo: Number(all.barovo)||0, marron: Number(all.marron)||0, naranja: Number(all.naranja)||0, largo380: Number(all.largo380)||0, mmq: Number(all.mmq)||0, total: Number(all.total)||0 })
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

  // Juegos de andamios: 1 juego = 2 módulos + 2 riendas largas + 2 riendas cortas + 1 tablón.
  const { juegosComunesDisp, juegosComunesAlq, juegosPasillerosDisp, juegosPasillerosAlq } = useMemo(() => {
    const disp = {
      modulos: deposito.modulos ?? 0,
      pasilleros: deposito.pasilleros ?? 0,
      riendasLargas: deposito.riendasLargas ?? 0,
      riendasCortas: deposito.riendasCortas ?? 0,
      tablones: deposito.tablones ?? 0,
    }
    const alq = {
      modulos: Math.max(0, (alquiladosResumen.modulos ?? 0)),
      pasilleros: pasillerosAlq,
      riendasLargas: alquiladosResumen.riendasLargas ?? 0,
      riendasCortas: alquiladosResumen.riendasCortas ?? 0,
      tablones: alquiladosResumen.tablones ?? 0,
    }
    const calcJuegos = (m: number, rl: number, rc: number, t: number) =>
      Math.min(Math.floor(m / 2), Math.floor(rl / 2), Math.floor(rc / 2), t)
    return {
      juegosComunesDisp: calcJuegos(disp.modulos, disp.riendasLargas, disp.riendasCortas, disp.tablones),
      juegosComunesAlq: calcJuegos(alq.modulos, alq.riendasLargas, alq.riendasCortas, alq.tablones),
      juegosPasillerosDisp: calcJuegos(disp.pasilleros, disp.riendasLargas, disp.riendasCortas, disp.tablones),
      juegosPasillerosAlq: calcJuegos(alq.pasilleros, alq.riendasLargas, alq.riendasCortas, alq.tablones),
    }
  }, [deposito, pasillerosAlq, alquiladosResumen])

  const handleSaveDeposito = async () => {
    setSavingDeposito(true)
    try {
      const res = await fetch("/api/andamios/deposito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: { ...deposito, ...depositoPuntal, total: depositoPuntal.barovo+depositoPuntal.marron+depositoPuntal.naranja+depositoPuntal.largo380+depositoPuntal.mmq } }),
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

      {/* ===== PLACAS ANDAMIOS: COMUNES + PASILLEROS ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Andamios comunes */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold text-muted-foreground">ANDAMIOS COMUNES</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Alquilados</p>
              <p className="text-2xl font-bold text-blue-600">{juegosComunesAlq}</p>
              <p className="text-xs text-muted-foreground">{juegosComunesAlq} juegos</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Disponibles</p>
              <p className="text-2xl font-bold text-green-600">{juegosComunesDisp}</p>
              <p className="text-xs text-muted-foreground">{juegosComunesDisp} juegos</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{juegosComunesAlq + juegosComunesDisp}</p>
              <p className="text-xs text-muted-foreground">juegos</p>
            </div>
          </div>
        </div>

        {/* Andamios pasilleros */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold text-muted-foreground">ANDAMIOS PASILLEROS</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Alquilados</p>
              <p className="text-2xl font-bold text-blue-600">{juegosPasillerosAlq}</p>
              <p className="text-xs text-muted-foreground">{juegosPasillerosAlq} juegos</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Disponibles</p>
              <p className="text-2xl font-bold text-green-600">{juegosPasillerosDisp}</p>
              <p className="text-xs text-muted-foreground">{juegosPasillerosDisp} juegos</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{juegosPasillerosAlq + juegosPasillerosDisp}</p>
              <p className="text-xs text-muted-foreground">juegos</p>
            </div>
          </div>
        </div>
      
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
          Alquilados (automático): {rowBy("modulos").alquilados} módulos · {rowBy("riendasLargas").alquilados} riendas
          largas · {rowBy("riendasCortas").alquilados} cortas · {rowBy("tablones").alquilados} tablones ·{" "}
          {rowBy("ruedasConFreno").alquilados} ruedas c/freno. Las riendas no se alquilan sueltas en 3C: se
          calculan por receta (2 largas + 2 cortas por juego).
        </p>
        {depositoDirty && <p className="text-xs text-amber-600">⚠ Hay cambios sin guardar.</p>}
      </section>

      {/* ===== SECTOR PUNTALES ===== */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Puntales</h2>

        {/* Placas de totales */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="border-2 border-green-600 bg-green-50">
            <CardHeader className="pb-1">
              <CardTitle className="text-base font-semibold text-green-800">
                ✅ PUNTALES DISPONIBLES
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-6xl font-bold text-green-700">
                {depositoPuntal.barovo + depositoPuntal.marron + depositoPuntal.naranja + depositoPuntal.largo380 + depositoPuntal.mmq}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Según lo guardado en depósito
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 border-blue-600 bg-blue-50">
            <CardHeader className="pb-1">
              <CardTitle className="text-base font-semibold text-blue-800">
                📤 PUNTALES ALQUILADOS
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-5xl font-bold text-blue-700">{puntalAlquilados?.total ?? 0}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-white/60 p-2">
                  <p className="font-medium">Barovo 3,05 m</p>
                  <p className="text-lg font-bold">{puntalAlquilados?.barovo ?? 0}</p>
                </div>
                <div className="rounded bg-white/60 p-2">
                  <p className="font-medium">Marrón 3,00 m</p>
                  <p className="text-lg font-bold">{puntalAlquilados?.marron ?? 0}</p>
                </div>
                <div className="rounded bg-white/60 p-2">
                  <p className="font-medium">Naranja 3 m</p>
                  <p className="text-lg font-bold">{puntalAlquilados?.naranja ?? 0}</p>
                </div>
                <div className="rounded bg-white/60 p-2">
                  <p className="font-medium">MMQ 3,05 m</p>
                  <p className="text-lg font-bold">{puntalAlquilados?.mmq ?? 0}</p>
                </div>
                <div className="rounded bg-white/60 p-2">
                  <p className="font-medium">Largo 3,80 m</p>
                  <p className="text-lg font-bold">{puntalAlquilados?.largo380 ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Zona de carga manual por tipo */}
        <div className="rounded-lg border p-4 bg-card space-y-4">
          <p className="text-sm text-muted-foreground">
            Cargá la cantidad de puntales que hay en depósito, separado por medida.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Barovo 3,05 m</p>
              <Input
                type="number" min={0}
                className="mt-2 h-12 text-2xl font-bold text-center"
                value={depositoPuntal.barovo}
                disabled={!depositoLoaded}
                onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setDepositoPuntal((p) => ({ ...p, barovo: v })); setDepositoDirty(true) }}
              />
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Marrón 3,00 m</p>
              <Input
                type="number" min={0}
                className="mt-2 h-12 text-2xl font-bold text-center"
                value={depositoPuntal.marron}
                disabled={!depositoLoaded}
                onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setDepositoPuntal((p) => ({ ...p, marron: v })); setDepositoDirty(true) }}
              />
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Naranja 3 m</p>
              <Input
                type="number" min={0}
                className="mt-2 h-12 text-2xl font-bold text-center"
                value={depositoPuntal.naranja}
                disabled={!depositoLoaded}
                onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setDepositoPuntal((p) => ({ ...p, naranja: v })); setDepositoDirty(true) }}
              />
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">MMQ 3,05 m</p>
              <Input
                type="number" min={0}
                className="mt-2 h-12 text-2xl font-bold text-center"
                value={depositoPuntal.mmq}
                disabled={!depositoLoaded}
                onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setDepositoPuntal((p) => ({ ...p, mmq: v })); setDepositoDirty(true) }}
              />
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">Largo 3,80 m</p>
              <Input
                type="number" min={0}
                className="mt-2 h-12 text-2xl font-bold text-center"
                value={depositoPuntal.largo380}
                disabled={!depositoLoaded}
                onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setDepositoPuntal((p) => ({ ...p, largo380: v })); setDepositoDirty(true) }}
              />
            </div>
          </div>
        </div>
      </section>

    </div>
  )
}


