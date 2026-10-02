"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import { loadScaffoldRentalStats, type ScaffoldRentalStats, type PuntalAlquilados } from "@/lib/dashboardStats"
import { SearchInput } from "@/components/ui/SearchInput"
import {
  computeScaffoldTotals,
  estimateScaffoldTotalFromStock,
  SCAFFOLD_ROW_LABELS,
  type ScaffoldRowKey,
  type ScaffoldStockLike,
} from "@/lib/scaffoldTotals"
import { toast } from "sonner"

// Artículos principales de la zona de carga (los que definen un juego).
const MAIN_ROWS: { key: ScaffoldRowKey; label: string }[] = [
  { key: "modulos", label: "Paños (módulos)" },
  { key: "riendasLargas", label: "Riendas largas" },
  { key: "riendasCortas", label: "Riendas cortas" },
  { key: "tablones", label: "Tablones" },
]

// Artículos secundarios (se muestran más chicos, sin puntales: tienen su sector).
const SECONDARY_ROWS: { key: ScaffoldRowKey; label: string }[] = [
  { key: "pasilleros", label: "Módulos pasilleros" },
  { key: "ruedasSinFreno", label: "Ruedas sin freno" },
  { key: "ruedasConFreno", label: "Ruedas con freno" },
  { key: "juegosRuedas", label: "Juegos de ruedas (x4)" },
]

// Puntales: total físico POR TIPO (cada medida es una familia propia).
const PUNTAL_ROWS: { key: ScaffoldRowKey; label: string }[] = [
  { key: "puntalBarovo", label: "Barovo 3,05 m" },
  { key: "puntalMarron", label: "Marrón 3,00 m" },
  { key: "puntalNaranja", label: "Naranja 3 m" },
  { key: "puntalMmq", label: "MMQ 3,05 m" },
  { key: "puntalLargo380", label: "Largo 3,80 m" },
]

// El formato viejo guardaba los puntales con la clave corta (barovo, marron…).
// Al leer lo guardado aceptamos ambas para no perder la carga previa.
const LEGACY_ROW_KEY: Partial<Record<ScaffoldRowKey, string>> = {
  puntalBarovo: "barovo",
  puntalMarron: "marron",
  puntalNaranja: "naranja",
  puntalLargo380: "largo380",
  puntalMmq: "mmq",
}

/** Normaliza los ítems guardados (clave nueva o vieja) a las claves de fila. */
function readStoredItems(items: Record<string, unknown>): Partial<Record<ScaffoldRowKey, number>> {
  const rowKeys = Object.keys(SCAFFOLD_ROW_LABELS) as ScaffoldRowKey[]
  const result: Partial<Record<ScaffoldRowKey, number>> = {}
  for (const key of rowKeys) {
    const legacy = LEGACY_ROW_KEY[key]
    const value = items[key] ?? (legacy ? items[legacy] : undefined)
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) result[key] = n
  }
  return result
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim()
}

export default function AndamiosPage() {
  const { items: stockItems, loading: stockLoading } = useInventoryStock()
  // Existencia de 3C leída EN VIVO desde la fuente primaria (Redis), para no
  // depender de la cuota de Firestore. Se usa para AUTOCARGAR el total físico.
  const [stock3C, setStock3C] = useState<ScaffoldStockLike[]>([])
  const [stock3CLoaded, setStock3CLoaded] = useState(false)
  const router = useRouter()
  const appliedQueryParam = useRef(false)

  // Si se llega derivado desde el Dashboard (?q=...), precargar ese texto
  // en el buscador de alquileres por cliente (solo una vez por montaje).
  // Se lee window.location en el cliente para no requerir <Suspense>
  // alrededor de useSearchParams en esta página.
  useEffect(() => {
    if (appliedQueryParam.current) return
    appliedQueryParam.current = true
    try {
      const q = new URLSearchParams(window.location.search).get("q")
      if (q) setClienteSearch(q)
    } catch { /* sin query: no precargar */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // ---- Control de stock: TOTAL FÍSICO (carga única) vs ALQUILADOS (remitos 3C) ----
  // El total físico real se carga UNA sola vez desde la web; de ahí en más la
  // página calcula disponible = max(0, total − alquilados). Sale un alquiler →
  // baja solo; entra una devolución (sale del informe) → sube solo.
  const [totalFisico, setTotalFisico] = useState<Partial<Record<ScaffoldRowKey, number>>>({})
  const [alquiladosResumen, setAlquiladosResumen] = useState<Partial<Record<ScaffoldRowKey, number>>>({})
  const [totalLoaded, setTotalLoaded] = useState(false)
  const [savingTotal, setSavingTotal] = useState(false)
  const [totalDirty, setTotalDirty] = useState(false)
  const [alquiladosLoaded, setAlquiladosLoaded] = useState(false)
  // De dónde salió la carga actual: guardada, migrada desde el depósito viejo
  // (base = depósito + alquilados) o estimada con el stock de 3C.
  const [totalSource, setTotalSource] = useState<"saved" | "migrated" | "estimate">("saved")

  // ---- Sector PUNTALES: alquilados (remitos 3C) ----
  // El total físico por tipo vive dentro de `totalFisico` (claves puntal*).
  const [puntalAlquilados, setPuntalAlquilados] = useState<PuntalAlquilados | null>(null)

  // ---- Buscador de alquileres por cliente (remitos 3C) ----
  // En Andamios solo se muestran andamios y accesorios: los renglones que
  // no son del rubro (máquinas como pisones, hormigoneras, etc.) se excluyen
  // del buscador. Esos se ven en el Dashboard / Máquinas / Alquileres.
  const [clienteSearch, setClienteSearch] = useState("")
  const [scaffoldDetalle, setScaffoldDetalle] = useState<ScaffoldRentalStats["detalle"]>([])

  // Alquilados desde remitos 3C.
  useEffect(() => {
    let cancelled = false
    loadScaffoldRentalStats().then((stats) => {
      if (cancelled || !stats) { if (!cancelled) setAlquiladosLoaded(true); return }
      setScaffoldDetalle(stats.detalle ?? [])
      const r = stats.resumen
      const modulosComunes = Math.max(0, (r?.estructuras ?? 0) - (r?.pasilleros ?? 0))
      const pasilleros = r?.pasilleros ?? 0
      // Puntales alquilados (remitos 3C) con desglose por tipo.
      const p = r?.puntalEstructuras
      setPuntalAlquilados(p && typeof p === "object" ? p : null)
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
        // Puntales alquilados por tipo (se descuentan del total físico de cada uno).
        puntalBarovo: p?.barovo ?? 0,
        puntalMarron: p?.marron ?? 0,
        puntalNaranja: p?.naranja ?? 0,
        puntalLargo380: p?.largo380 ?? 0,
        puntalMmq: p?.mmq ?? 0,
      })
      setAlquiladosLoaded(true)
    }).catch(() => { if (!cancelled) setAlquiladosLoaded(true) })
    return () => { cancelled = true }
  }, [])

  // Existencia de 3C (fuente primaria Redis). Permite estimar el total físico
  // automáticamente. Si Redis no responde, se cae al inventario de Firestore.
  useEffect(() => {
    let cancelled = false
    fetch("/api/sync-3c/data/stock", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return
        if (body?.available && Array.isArray(body.data)) {
          setStock3C(body.data as ScaffoldStockLike[])
        }
        setStock3CLoaded(true)
      })
      .catch(() => { if (!cancelled) setStock3CLoaded(true) })
    return () => { cancelled = true }
  }, [])

  // Fuente para la estimación: preferimos la existencia viva de 3C (Redis).
  const estimateSource = useMemo<ScaffoldStockLike[]>(
    () => (stock3C.length > 0 ? stock3C : (stockItems as ScaffoldStockLike[])),
    [stock3C, stockItems],
  )

  // TOTAL FÍSICO auto-estimado. La existencia de 3C YA VIENE NETA de alquileres
  // (los alquilados se registran como negativo en el depósito principal), por eso
  // el físico propio = existencia + alquilados. Así el disponible calculado
  // (max(0, total − alquilados)) coincide con la existencia real de 3C.
  const totalEstimate = useMemo(
    () => estimateScaffoldTotalFromStock(estimateSource, alquiladosResumen),
    [estimateSource, alquiladosResumen],
  )

  // Ref: la carga del total físico corre una sola vez.
  const totalInitDone = useRef(false)

  // Carga del TOTAL FÍSICO. Espera a tener la existencia de 3C y los alquilados
  // para poder auto-estimar el físico propio. Si ya hay un total guardado
  // (manual), se respeta; si no, se AUTOCARGA desde 3C.
  useEffect(() => {
    if (totalInitDone.current) return
    if (stockLoading || !alquiladosLoaded || !stock3CLoaded) return
    totalInitDone.current = true
    let cancelled = false
    fetch("/api/andamios/deposito", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return
        if (body?.available && body.items && Object.keys(body.items).length > 0) {
          const stored = readStoredItems(body.items as Record<string, unknown>)
          if (body.migrated) {
            // Base inicial = depósito viejo + alquilados actuales. Se puede
            // corregir con el conteo físico y guardar.
            const base: Partial<Record<ScaffoldRowKey, number>> = { ...stored }
            const riendasAlq = (alquiladosResumen.modulos ?? 0) + (alquiladosResumen.pasilleros ?? 0)
            for (const key of Object.keys(SCAFFOLD_ROW_LABELS) as ScaffoldRowKey[]) {
              const alq =
                key === "riendasLargas" || key === "riendasCortas"
                  ? riendasAlq
                  : alquiladosResumen[key] ?? 0
              base[key] = (base[key] ?? 0) + alq
            }
            setTotalFisico(base)
            setTotalSource("migrated")
            setTotalDirty(true)
          } else {
            setTotalFisico(stored)
            setTotalSource("saved")
          }
        } else {
          // Sin total cargado: AUTOCARGA del total físico desde la existencia de
          // 3C (todas las filas). La existencia ya viene neta de alquileres, así
          // que el total físico propio = existencia + alquilados.
          setTotalFisico({ ...totalEstimate })
          setTotalSource("estimate")
          setTotalDirty(true)
        }
        setTotalLoaded(true)
      })
      .catch(() => { if (!cancelled) setTotalLoaded(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockLoading, alquiladosLoaded, stock3CLoaded])

  const controlRows = useMemo(
    () => computeScaffoldTotals(alquiladosResumen, totalFisico),
    [alquiladosResumen, totalFisico],
  )

  // Valor de una fila por campo (alquilados / disponibles / totalFisico).
  const rowVal = (key: ScaffoldRowKey, field: "alquilados" | "disponibles" | "totalFisico") =>
    controlRows.rows.find((r) => r.key === key)?.[field] ?? 0

  // Juegos de andamios: 1 juego = 2 módulos + 2 riendas largas + 2 riendas cortas + 1 tablón.
  const { juegosComunesDisp, juegosComunesAlq, juegosPasillerosDisp, juegosPasillerosAlq } = useMemo(() => {
    const calcJuegos = (m: number, rl: number, rc: number, t: number) =>
      Math.min(Math.floor(m / 2), Math.floor(rl / 2), Math.floor(rc / 2), t)
    return {
      juegosComunesDisp: calcJuegos(rowVal("modulos", "disponibles"), rowVal("riendasLargas", "disponibles"), rowVal("riendasCortas", "disponibles"), rowVal("tablones", "disponibles")),
      juegosComunesAlq: calcJuegos(rowVal("modulos", "alquilados"), rowVal("riendasLargas", "alquilados"), rowVal("riendasCortas", "alquilados"), rowVal("tablones", "alquilados")),
      juegosPasillerosDisp: calcJuegos(rowVal("pasilleros", "disponibles"), rowVal("riendasLargas", "disponibles"), rowVal("riendasCortas", "disponibles"), rowVal("tablones", "disponibles")),
      juegosPasillerosAlq: calcJuegos(rowVal("pasilleros", "alquilados"), rowVal("riendasLargas", "alquilados"), rowVal("riendasCortas", "alquilados"), rowVal("tablones", "alquilados")),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlRows])

  const handleSaveTotal = async () => {
    setSavingTotal(true)
    try {
      const res = await fetch("/api/andamios/deposito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: totalFisico }),
      })
      if (!res.ok) throw new Error()
      toast.success("Total físico guardado")
      setTotalDirty(false)
      setTotalSource("saved")
    } catch {
      toast.error("Error al guardar el total físico")
    } finally {
      setSavingTotal(false)
    }
  }
  // ---- fin control de stock ----

  // Recalcula el TOTAL FÍSICO desde la existencia actual de 3C. Útil cuando ya
  // había un total guardado o cuando se sincronizó stock nuevo. No guarda en el
  // servidor: deja los valores en pantalla y marca "dirty" para revisar/guardar.
  const handleRecalcFrom3C = () => {
    setTotalFisico({ ...totalEstimate })
    setTotalSource("estimate")
    setTotalDirty(true)
    toast.success("Físico recalculado desde 3C (revisá y guardá)")
  }

  // Catálogo visible: solo andamios y accesorios (sin máquinas).
  // El buscador de esta página opera sobre remitos 3C (clienteSearch);
  // no se filtra por fichas manuales de máquinas.

  const rowBy = (key: ScaffoldRowKey) => controlRows.rows.find((r) => r.key === key)!
  const juegosAlquilados = Math.floor(
    ((alquiladosResumen.modulos ?? 0) + (alquiladosResumen.pasilleros ?? 0)) / 2,
  )

  // ================================================================
  // BUSCADOR POR CLIENTE: agrupa los renglones de los remitos 3C
  // por cliente y suma cantidades por artículo (misma clasificación
  // que usa el parser de remitos en scaffoldRentals.ts).
  // ================================================================
  type ClienteGrupo = {
    cliente: string
    remitos: string[]
    renglones: ScaffoldRentalStats["detalle"]
    totales: Record<string, number>
  }

  const clasificarRenglon = (codigo: string, descripcion: string): { clave: string; label: string } => {
    const c = (codigo ?? "").trim().toUpperCase()
    const d = (descripcion ?? "").toUpperCase()
    const esPasillero = d.includes("PASILLERO")

    // Puntales (por medida).
    if (c === "28510" || d.includes("BAROVO")) return { clave: "puntal_barovo", label: "Puntales Barovo 3,05 m" }
    if (c === "28318") return { clave: "puntal_marron", label: "Puntales Marrón 3,00 m" }
    if (c === "28511") return { clave: "puntal_naranja", label: "Puntales Naranja 3 m" }
    if (c === "28512") return { clave: "puntal_largo380", label: "Puntales Largo 3,80 m" }
    if (c === "PH305") return { clave: "puntal_mmq", label: "Puntales MMQ 3,05 m" }

    // Paños (módulos) de andamio.
    if (c === "28501" || (esPasillero && ["A03", "A04", "A07", "28601"].includes(c)))
      return { clave: "pasilleros", label: "Paños pasilleros" }
    if (["A03", "A04", "A07", "28601"].includes(c) || d.includes("ANDAMIO"))
      return { clave: "modulos", label: "Paños (módulos) comunes" }

    // Riendas (si el remito las lista sueltas).
    if (["R01", "R03"].includes(c)) return { clave: "riendasCortas", label: "Riendas cortas" }
    if (["R02", "R04"].includes(c)) return { clave: "riendasLargas", label: "Riendas largas" }

    // Tablones.
    if (["TA02", "TA03", "28901", "29001", "29101", "29201"].includes(c) || d.includes("TABLON"))
      return { clave: "tablones", label: "Tablones" }

    // Ruedas.
    if (c === "29601") return { clave: "juegosRuedas", label: "Juegos de ruedas (x4)" }
    if (c === "29501" || d.includes("C/FRENO")) return { clave: "ruedasConFreno", label: "Ruedas con freno" }
    if (["N7-1", "N71"].includes(c) || (d.includes("RUEDA") && !d.includes("FRENO")))
      return { clave: "ruedasSinFreno", label: "Ruedas sin freno" }

    return { clave: "otros", label: "Otros" }
  }

  const ORDEN_ARTICULOS: { clave: string; label: string }[] = [
    { clave: "modulos", label: "Paños (módulos) comunes" },
    { clave: "pasilleros", label: "Paños pasilleros" },
    { clave: "riendasLargas", label: "Riendas largas" },
    { clave: "riendasCortas", label: "Riendas cortas" },
    { clave: "tablones", label: "Tablones" },
    { clave: "ruedasSinFreno", label: "Ruedas sin freno" },
    { clave: "ruedasConFreno", label: "Ruedas con freno" },
    { clave: "juegosRuedas", label: "Juegos de ruedas (x4)" },
    { clave: "puntal_barovo", label: "Puntales Barovo 3,05 m" },
    { clave: "puntal_marron", label: "Puntales Marrón 3,00 m" },
    { clave: "puntal_naranja", label: "Puntales Naranja 3 m" },
    { clave: "puntal_largo380", label: "Puntales Largo 3,80 m" },
    { clave: "puntal_mmq", label: "Puntales MMQ 3,05 m" },
    { clave: "otros", label: "Otros" },
  ]

  const clienteGrupos = useMemo<ClienteGrupo[]>(() => {
    const q = normalizeText(clienteSearch)
    if (!q) return []

    const match = (d: ScaffoldRentalStats["detalle"][number]) =>
      (d.cliente ?? "").toLowerCase().includes(q) ||
      (d.clienteId ?? "").toLowerCase().includes(q) ||
      d.remito.toLowerCase().includes(q) ||
      d.descripcion.toLowerCase().includes(q) ||
      d.codigo.toLowerCase().includes(q)

    const filtrados = scaffoldDetalle.filter(match)
    const map = new Map<string, ClienteGrupo>()
    for (const d of filtrados) {
      const key = (d.cliente ?? d.clienteId ?? "Sin cliente").trim() || "Sin cliente"
      if (!map.has(key)) {
        map.set(key, { cliente: key, remitos: [], renglones: [], totales: {} })
      }
      const grupo = map.get(key)!
      if (!grupo.remitos.includes(d.remito)) grupo.remitos.push(d.remito)
      grupo.renglones.push(d)
      const { clave } = clasificarRenglon(d.codigo, d.descripcion)
      grupo.totales[clave] = (grupo.totales[clave] ?? 0) + (d.cantidad || 0)
    }
    return [...map.values()].sort((a, b) => b.renglones.length - a.renglones.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteSearch, scaffoldDetalle])

  if (stockLoading) return <p className="text-muted-foreground">Cargando...</p>

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

      {/* ===== BUSCADOR DE ALQUILERES POR CLIENTE ===== */}
      <div className="space-y-3">
        <SearchInput
          value={clienteSearch}
          onChange={setClienteSearch}
          placeholder="Buscar alquilados por cliente, remito o código..."
          className="max-w-md"
        />

        {clienteSearch.trim() !== "" && (
          <div className="space-y-4">
            {clienteGrupos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay alquileres que coincidan con "{clienteSearch}".
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {clienteGrupos.length} cliente(s) encontrado(s)
                </p>
                {clienteGrupos.map((grupo) => (
                  <div key={grupo.cliente} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-baseline justify-between flex-wrap gap-2">
                      <h3 className="text-base font-bold">{grupo.cliente}</h3>
                      <p className="text-xs text-muted-foreground">
                        {grupo.remitos.length} remito(s) · {grupo.renglones.length} renglones
                      </p>
                    </div>

                    {/* Totales por artículo */}
                    <div className="rounded-md border overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="p-2 text-left font-medium">Artículo</th>
                            <th className="p-2 text-right font-medium">Cantidad alquilada</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ORDEN_ARTICULOS.filter((a) => (grupo.totales[a.clave] ?? 0) > 0).map((a) => (
                            <tr key={a.clave} className="border-b last:border-0">
                              <td className="p-2">{a.label}</td>
                              <td className="p-2 text-right font-bold">{grupo.totales[a.clave]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Detalle de remitos */}
                    <div className="rounded-md border overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="p-2 text-left font-medium">Código</th>
                            <th className="p-2 text-left font-medium">Descripción</th>
                            <th className="p-2 text-right font-medium">Cant.</th>
                            <th className="p-2 text-left font-medium">Remito</th>
                            <th className="p-2 text-left font-medium">Fecha</th>
                            <th className="p-2 text-left font-medium">Devolución</th>
                          </tr>
                        </thead>
                        <tbody>
                          {grupo.renglones.map((d, i) => (
                            <tr key={`${d.remito}-${d.codigo}-${i}`} className="border-b last:border-0">
                              <td className="p-2 font-mono text-xs">{d.codigo}</td>
                              <td className="p-2">{d.descripcion}</td>
                              <td className="p-2 text-right">{d.cantidad}</td>
                              <td className="p-2 text-xs">{d.remito}</td>
                              <td className="p-2 text-xs">{d.fecha}</td>
                              <td className="p-2 text-xs">{d.devolucion || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
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

      {/* ===== TOTAL FÍSICO (carga única) ===== */}
      <section className="rounded-lg border p-4 bg-card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold">Total físico (autocompletado desde 3C)</h2>
            <p className="text-sm text-muted-foreground">
              Se autocompleta con la existencia de 3C (existencia + alquilados = físico
              propio). Corregí con el conteo real si hace falta. El disponible se calcula
              solo: <span className="font-medium">disponible = max(0, total − alquilados)</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleRecalcFrom3C}
              disabled={!totalLoaded || !stock3CLoaded}
              title="Vuelve a tomar la existencia actual de 3C y recalcula el físico propio (existencia + alquilados)"
            >
              Recalcular desde 3C
            </Button>
            <Button onClick={handleSaveTotal} disabled={savingTotal || !totalLoaded}>
              {savingTotal ? "Guardando..." : "Guardar total"}
            </Button>
          </div>
        </div>

        {totalSource === "migrated" && (
          <p className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-700 px-3 py-2">
            ⚠ Base migrada del depósito viejo: se sumó el depósito anterior + los alquilados
            actuales. Revisá con el conteo físico y guardá.
          </p>
        )}
        {totalSource === "estimate" && (
          <p className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-700 px-3 py-2">
            ⚠ No había total físico cargado: se AUTOCARGÓ desde la existencia de 3C
            (existencia + alquilados = físico propio). Revisá con el conteo físico y guardá
            para fijarlo. Usá &quot;Recalcular desde 3C&quot; para volver a tomarlo.
          </p>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {MAIN_ROWS.map(({ key, label }) => (
            <div key={key} className="rounded-lg border p-3">
              <p className="text-sm font-medium">{label}</p>
              <Input
                type="number"
                min={0}
                className="mt-2 h-12 text-2xl font-bold text-center"
                value={totalFisico[key] ?? 0}
                disabled={!totalLoaded}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0)
                  setTotalFisico((prev) => ({ ...prev, [key]: v }))
                  setTotalDirty(true)
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
                value={totalFisico[key] ?? 0}
                disabled={!totalLoaded}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0)
                  setTotalFisico((prev) => ({ ...prev, [key]: v }))
                  setTotalDirty(true)
                }}
              />
            </div>
          ))}
        </div>

        {/* Detalle: alquilados / disponible / total físico */}
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="p-2 text-left font-medium">Artículo</th>
                <th className="p-2 text-right font-medium">Alquilados</th>
                <th className="p-2 text-right font-medium">Disponible</th>
                <th className="p-2 text-right font-medium">Total físico</th>
              </tr>
            </thead>
            <tbody>
              {[...MAIN_ROWS, ...SECONDARY_ROWS].map(({ key, label }) => {
                const row = rowBy(key)
                return (
                  <tr key={key} className="border-b last:border-0">
                    <td className="p-2">
                      {label}
                      {row.faltante && <span className="ml-2 text-xs text-red-600">⚠ revisar físico</span>}
                    </td>
                    <td className="p-2 text-right font-semibold text-blue-600">{row.alquilados}</td>
                    <td className={`p-2 text-right font-bold ${row.faltante ? "text-red-600" : "text-green-600"}`}>
                      {row.disponibles}
                    </td>
                    <td className="p-2 text-right">{row.totalFisico}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          Alquilados (automático): {rowBy("modulos").alquilados} módulos · {rowBy("riendasLargas").alquilados} riendas
          largas · {rowBy("riendasCortas").alquilados} cortas · {rowBy("tablones").alquilados} tablones ·{" "}
          {rowBy("ruedasConFreno").alquilados} ruedas c/freno. Las riendas no se alquilan sueltas en 3C: se
          derivan de los paños (1 larga + 1 corta por módulo/pasillero alquilado).
        </p>
        {totalDirty && <p className="text-xs text-amber-600">⚠ Hay cambios sin guardar.</p>}
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
                {PUNTAL_ROWS.reduce((s, { key }) => s + rowVal(key, "disponibles"), 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Total físico {PUNTAL_ROWS.reduce((s, { key }) => s + rowVal(key, "totalFisico"), 0)} ·{" "}
                alquilados {PUNTAL_ROWS.reduce((s, { key }) => s + rowVal(key, "alquilados"), 0)}
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

        {/* Carga del total físico por tipo + detalle */}
        <div className="rounded-lg border p-4 bg-card space-y-4">
          <p className="text-sm text-muted-foreground">
            Cargá cuántos puntales tenés en total (físico), separado por medida. El
            disponible se calcula solo con los alquilados de 3C.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {PUNTAL_ROWS.map(({ key, label }) => (
              <div key={key} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{label}</p>
                <Input
                  type="number" min={0}
                  className="mt-2 h-12 text-2xl font-bold text-center"
                  value={totalFisico[key] ?? 0}
                  disabled={!totalLoaded}
                  onChange={(e) => {
                    const v = Math.max(0, Number(e.target.value) || 0)
                    setTotalFisico((prev) => ({ ...prev, [key]: v }))
                    setTotalDirty(true)
                  }}
                />
              </div>
            ))}
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="p-2 text-left font-medium">Tipo de puntal</th>
                  <th className="p-2 text-right font-medium">Alquilados</th>
                  <th className="p-2 text-right font-medium">Disponible</th>
                  <th className="p-2 text-right font-medium">Total físico</th>
                </tr>
              </thead>
              <tbody>
                {PUNTAL_ROWS.map(({ key, label }) => {
                  const row = rowBy(key)
                  return (
                    <tr key={key} className="border-b last:border-0">
                      <td className="p-2">
                        {label}
                        {row.faltante && <span className="ml-2 text-xs text-red-600">⚠ revisar físico</span>}
                      </td>
                      <td className="p-2 text-right font-semibold text-blue-600">{row.alquilados}</td>
                      <td className={`p-2 text-right font-bold ${row.faltante ? "text-red-600" : "text-green-600"}`}>
                        {row.disponibles}
                      </td>
                      <td className="p-2 text-right">{row.totalFisico}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

    </div>
  )
}


