"use client"

import { Fragment } from "react"
import Link from "next/link"
import type { CompatibilidadRepuesto, CompatibleMachine } from "@/lib/partCompatibility"

/**
 * Resultado del buscador de repuestos: una fila por MÁQUINA (identificada por el
 * MODELO COMPLETO) con el historial de pedidos desplegable.
 *
 * Por qué el modelo completo y no el nombre: 3C manda el nombre corto y repetido
 * ("AMOLADORA" son tres máquinas distintas). Y por qué NO se fusionan los nombres
 * parecidos: si se fusionara mal, la pantalla diría "es la misma máquina" justo
 * cuando se busca un repuesto para OTRA máquina. El aviso "⚠ se parece a" es sólo
 * un dato para que decida el operario.
 */

const ESTADO_LABELS: Record<string, string> = {
  SOLICITADO: "Solicitado",
  PEDIDO: "Pedido",
  ENCARGADO: "Encargado",
  RECIBIDO: "Recibido",
  UTILIZADO: "Utilizado",
  CANCELADO: "Cancelado",
}

const ORIGEN_LABELS: Record<string, string> = {
  ficha: "ficha",
  pedido: "pedido 3C",
  plano: "plano",
}

interface Props {
  resultado: CompatibilidadRepuesto
  /** Clave de la fila con el historial desplegado. */
  abierta: string | null
  onToggle: (key: string) => void
}

/** Clave estable de una fila (las máquinas de 3C no tienen id de catálogo). */
function rowKey(m: CompatibleMachine): string {
  return m.machineId || `modelo:${m.modeloCompleto}`
}

export function PartCompatibilityTable({ resultado, abierta, onToggle }: Props) {
  const { maquinas } = resultado
  const porCodigo = resultado.modo === "codigo"

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {porCodigo ? `Código ${resultado.clave}` : `Nombre «${resultado.clave}»`} ·{" "}
          {maquinas.length} máquina(s)
        </h2>
        <p className="text-xs text-muted-foreground">
          {maquinas.length > 1
            ? "⚠ El mismo repuesto se usa en más de una máquina: sirve como reemplazo."
            : "Sólo aparece en una máquina."}
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th className="p-2 font-medium">Máquina (modelo completo)</th>
              <th className="p-2 font-medium">Nombre en 3C</th>
              <th className="p-2 font-medium">Repuesto</th>
              <th className="p-2 font-medium">Código</th>
              <th className="p-2 text-right font-medium">Stock disp.</th>
              <th className="p-2 text-right font-medium">Veces</th>
              <th className="p-2 font-medium">Última vez</th>
              <th className="p-2 font-medium">Origen</th>
              <th className="p-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {maquinas.map((m) => {
              const key = rowKey(m)
              const open = abierta === key
              return (
                <Fragment key={key}>
                  <tr className="border-b align-top">
                    <td className="p-2">
                      <span className="font-medium">{m.modeloCompleto || "—"}</span>
                      {m.sePareceA && (
                        <span className="mt-0.5 block text-xs text-amber-700">
                          ⚠ se parece a: {m.sePareceA}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{m.machineName || "—"}</td>
                    <td className="p-2">{m.partNames[0] ?? "—"}</td>
                    <td className="p-2 font-mono text-xs">
                      {m.partCodes.length > 0 ? m.partCodes.join(" · ") : "—"}
                    </td>
                    <td className="p-2 text-right text-green-700">{m.stockDisponible}</td>
                    <td className="p-2 text-right font-bold">{m.pedidosCount}</td>
                    <td className="p-2">{m.ultimoPedido}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {m.origenes.map((o) => ORIGEN_LABELS[o] ?? o).join(" + ")}
                    </td>
                    <td className="p-2">
                      {m.detallePedidos.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onToggle(key)}
                          className="text-xs underline underline-offset-2 hover:text-primary"
                        >
                          {open ? "Ocultar" : `Historial (${m.detallePedidos.length})`}
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={9} className="p-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Historial de {m.modeloCompleto}
                        </p>
                        <div className="overflow-x-auto rounded border bg-background">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b bg-muted/40 text-left">
                                <th className="p-2 font-medium">Orden</th>
                                <th className="p-2 font-medium">Repuesto</th>
                                <th className="p-2 font-medium">Código</th>
                                <th className="p-2 font-medium">Estado</th>
                                <th className="p-2 font-medium">Pedido</th>
                                <th className="p-2 font-medium">Traído</th>
                                <th className="p-2 font-medium">Utilizado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.detallePedidos.map((p) => (
                                <tr key={`${p.id}-${p.description}`} className="border-b last:border-0">
                                  <td className="p-2 font-mono text-[11px]">
                                    {p.id ? (
                                      <Link
                                        href={`/spare-part-orders/${p.id}`}
                                        className="underline underline-offset-2"
                                      >
                                        {p.orderNumber || "ver"}
                                      </Link>
                                    ) : (
                                      p.orderNumber || "—"
                                    )}
                                  </td>
                                  <td className="p-2">{p.description || "—"}</td>
                                  <td className="p-2 font-mono">{p.code || "—"}</td>
                                  <td className="p-2">{ESTADO_LABELS[p.status] ?? p.status}</td>
                                  <td className="p-2">{p.pedido}</td>
                                  <td className="p-2">{p.traido}</td>
                                  <td className="p-2">{p.utilizado}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Cada fila es una máquina distinta y el «⚠ se parece a» avisa cuando dos nombres de 3C
        parecen la MISMA máquina escrita distinto: revisá antes de dar por hecho que sirve.
      </p>
    </div>
  )
}
