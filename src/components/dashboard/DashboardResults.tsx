"use client"

import type {
  GroupedResults, MaterialRow, ComponenteRow, AlquilerRow, ReparacionRow, MaquinaRow,
} from "@/lib/search-grouped"
import { formatDate } from "@/lib/ui"

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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Andamios completos</p>
              <p className="text-3xl font-bold text-orange-600">{resumenAndamios.cuerposCompletos}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Cuerpos alquilados</p>
              <p className="text-3xl font-bold text-blue-600">{resumenAndamios.cuerposAlquilados}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Estructuras</p>
              <p className="text-3xl font-bold">{resumenAndamios.estructuras}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Riendas largas</p>
              <p className="text-3xl font-bold">{resumenAndamios.riendasLargas}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Riendas cortas</p>
              <p className="text-3xl font-bold">{resumenAndamios.riendasCortas}</p>
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
        <Section title={`Alquileres (3C) — ${alquileres.length} renglones`}>
          <SimpleTable
            headers={["Cliente", "Remito", "Cant.", "Fecha", "Devolución"]}
            rows={alquileres.map((a: AlquilerRow) => [a.cliente, <span key="r" className="font-mono text-xs">{a.remito}</span>, <span key="c" className="font-bold">{a.cantidad}</span>, a.fecha, a.devolucion])}
          />
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
            headers={["Orden", "Cliente", "Máquina", "Fecha", "Descripción"]}
            rows={reparaciones.map((r: ReparacionRow) => [
              <span key="o" className="font-mono text-xs">{r.orden}</span>,
              r.cliente,
              r.maquina || "—",
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