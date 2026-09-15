"use client"

import type {
  GroupedResults, MaterialRow, ComponenteRow, AlquilerGrupo, ReparacionRow, MaquinaRow,
} from "@/lib/search-grouped"
import { ALQUILER_TOTAL_KEYS } from "@/lib/search-grouped"
import { formatDate } from "@/lib/ui"
import { useState } from "react"

interface Props {
  results: GroupedResults
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            {headers.map((h) => (
              <th key={h} className="p-2 text-left font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b last:border-0">
              {cells.map((c, j) => (
                <td key={j} className="p-2 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TotalLine({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between border-b py-1 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-bold">{value}</span>
    </div>
  )
}

function MaterialTable({ rows }: { rows: MaterialRow[] }) {
  const total = rows.reduce((s, r) => s + r.stock, 0)
  return (
    <>
      <SimpleTable
        headers={["Código", "Nombre", "Familia", "Marca", "Stock", "Disponible"]}
        rows={rows.map((r) => [
          <span key="c" className="font-mono text-xs">{r.codigo || "—"}</span>,
          <span key="n" className="font-medium">{r.nombre}</span>,
          r.familia || "—",
          r.marca || "—",
          <span key="s" className={r.stock < 0 ? "font-bold text-red-600" : "font-bold"}>{r.stock}</span>,
          <span key="d" className="text-green-700">{r.disponible}</span>,
        ])}
      />
      <p className="text-sm text-muted-foreground">TOTAL STOCK: <strong>{total}</strong></p>
    </>
  )
}
export function DashboardResults({ results }: Props) {
  const { query, resumenAndamios, materiales, componentes, alquileres, reparaciones, maquinas } = results
  const [openGrupo, setOpenGrupo] = useState<string | null>(null)

  if (results.totalResultados === 0 && !resumenAndamios) {
    return (
      <p className="rounded-md border bg-muted/20 p-6 text-center text-muted-foreground">
        No se encontraron resultados para &ldquo;{query}&rdquo;.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold">
        RESULTADOS PARA: <span className="uppercase">{query}</span>
      </h2>

      {resumenAndamios && (
        <Section title="Resumen de andamios">
          <div className="space-y-4">
            {/* Juegos de andamios */}
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Juegos de andamios</p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Comunes alquilados</p>
                  <p className="text-3xl font-bold text-blue-600">{resumenAndamios.juegosComunesAlq}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Comunes disponibles</p>
                  <p className="text-3xl font-bold text-green-600">{resumenAndamios.juegosComunesDisp}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Pasilleros alquilados</p>
                  <p className="text-3xl font-bold text-blue-600">{resumenAndamios.juegosPasillerosAlq}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Pasilleros disponibles</p>
                  <p className="text-3xl font-bold text-green-600">{resumenAndamios.juegosPasillerosDisp}</p>
                </div>
              </div>
            </div>
            {/* Puntales */}
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Puntales</p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-3xl font-bold text-blue-600">{resumenAndamios.puntalTotal}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Barovo 3,05m</p>
                  <p className="text-2xl font-bold">{resumenAndamios.puntalBarovo}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Marrón 3,00m</p>
                  <p className="text-2xl font-bold">{resumenAndamios.puntalMarron}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Naranja 3m</p>
                  <p className="text-2xl font-bold">{resumenAndamios.puntalNaranja}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Largo 3,80m</p>
                  <p className="text-2xl font-bold">{resumenAndamios.puntalLargo380}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">MMQ 3,05m</p>
                  <p className="text-2xl font-bold">{resumenAndamios.puntalMmq}</p>
                </div>
              </div>
            </div>
          </div>
        </Section>
      )}

      {componentes.length > 0 && (
        <Section title={`Andamios — componentes (${componentes.length})`}>
          <SimpleTable
            headers={["Componente", "Código", "Nombre", "Cantidad disponible"]}
            rows={componentes.map((c: ComponenteRow) => [
              c.grupo,
              <span key="c" className="font-mono text-xs">{c.codigo}</span>,
              c.nombre,
              <span key="q" className={`font-bold ${c.cantidad < 0 ? "text-red-600" : ""}`}>{c.cantidad}</span>,
            ])}
          />
          <div className="max-w-sm space-y-1">
            {[...new Set(componentes.map((c) => c.grupo))].map((g) => (
              <TotalLine key={g} label={`Total ${g}`} value={componentes.filter((c) => c.grupo === g).reduce((s, c) => s + c.cantidad, 0)} />
            ))}
          </div>
        </Section>
      )}

            {alquileres.length > 0 && (
        <Section title={`Alquileres (3C) — ${alquileres.reduce((s, g) => s + g.detalle.length, 0)} renglón(es) · ${alquileres.length} cliente(s)`}>
          <div className="space-y-4">
            {alquileres.map((g: AlquilerGrupo) => (
              <div key={g.cliente} className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <h4 className="font-bold text-lg">{g.cliente}</h4>
                  <span className="text-xs text-muted-foreground">{g.remitos.length} remito(s)</span>
                </div>

                {/* Totales por artículo (solo los > 0) */}
                <div className="grid gap-1">
                  {ALQUILER_TOTAL_KEYS
                    .filter((a) => (g.totales[a.clave] ?? 0) > 0)
                    .map((a) => (
                      <div key={a.clave} className="flex justify-between">
                        <span className="text-sm text-muted-foreground">{a.label}</span>
                        <span className="font-bold">{g.totales[a.clave]}</span>
                      </div>
                    ))}
                </div>

                {/* Detalle de renglones (colapsable) */}
                <button
                  type="button"
                  className="text-xs underline text-muted-foreground hover:text-foreground"
                  onClick={() => setOpenGrupo(openGrupo === g.cliente ? null : g.cliente)}
                >
                  {openGrupo === g.cliente
                    ? "Ocultar detalle"
                    : `Ver ${g.detalle.length} renglón(es) ▼`}
                </button>
                {openGrupo === g.cliente && (
                  <SimpleTable
                    headers={["Código", "Descripción", "Cant.", "Remito", "Fecha", "Devolución"]}
                    rows={g.detalle.map((d) => [
                      <span key="c" className="font-mono text-xs">{d.codigo || "—"}</span>,
                      d.descripcion,
                      <span key="cant" className="font-bold">{d.cantidad}</span>,
                      <span key="r" className="font-mono text-xs">{d.remito}</span>,
                      d.fecha,
                      d.devolucion,
                    ])}
                  />
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {maquinas.length > 0 && (
        <Section title={`Máquinas — ${maquinas.length} tipos`}>
          <SimpleTable
            headers={["Código", "Máquina", "Familia", "Stock", "Disponible"]}
            rows={maquinas.map((m: MaquinaRow) => [
              <span key="c" className="font-mono text-xs">{m.codigo || "—"}</span>,
              <span key="n" className="font-medium">{m.nombre}</span>,
              m.familia,
              <span key="s" className={`font-bold ${m.stock < 0 ? "text-red-600" : ""}`}>{m.stock}</span>,
              <span key="d" className="text-green-700">{m.disponible}</span>,
            ])}
          />
        </Section>
      )}

      {reparaciones.length > 0 && (
        <Section title={`Reparaciones / Mantenimiento — ${reparaciones.length} órdenes`}>
          <SimpleTable
            headers={["Orden", "Cliente", "Máquina", "Estado", "Fecha", "Descripción"]}
            rows={reparaciones.map((r: ReparacionRow) => [
              <span key="o" className="font-mono text-xs">{r.orden}</span>,
              r.cliente,
              r.maquina || "—",
              <span key="st" className={r.estado ? "font-medium" : "text-muted-foreground"}>{r.estado || "—"}</span>,
              r.fecha,
              <span key="d" className="text-muted-foreground">{r.descripcion}</span>,
            ])}
          />
        </Section>
      )}

      {materiales.length > 0 && (
        <Section title={`Materiales / Stock — ${materiales.length}`}>
          <MaterialTable rows={materiales.slice(0, 100)} />
          {materiales.length > 100 && (
            <p className="text-xs text-muted-foreground">Mostrando los primeros 100 de {materiales.length}. Refiná la búsqueda para acotar.</p>
          )}
        </Section>
      )}
    </div>
  )
}