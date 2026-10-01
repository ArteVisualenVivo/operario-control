"use client"

import { useMemo, useState } from "react"
import { useAllSparePartOrders } from "@/hooks/useAllSparePartOrders"
import { useSparePartsCache } from "@/hooks/useSparePartsCache"
import { useMachines } from "@/hooks/useMachines"
import { findCompatibleMachines } from "@/lib/partCompatibility"
import { PartCompatibilityTable } from "@/components/parts/PartCompatibilityTable"
import { SearchInput } from "@/components/ui/SearchInput"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Con 1 letra el resultado no dice nada: se pide un mínimo. */
const MIN_CHARS = 2

/**
 * Buscador de repuestos por CÓDIGO o NOMBRE → en qué MÁQUINAS se usa.
 *
 * PARA QUÉ: cuando no se consigue el repuesto original de una máquina, saber si
 * el mismo repuesto se usa en otra máquina (y en cuál) para poder reemplazarlo.
 *
 * Datos: los pedidos de 3C ("Pedidos Rep.") + las fichas de repuestos de cada
 * máquina + el catálogo de máquinas. Se leen de la fuente primaria (Redis/caché),
 * así funciona aunque la cuota de Firestore esté agotada.
 */
export default function RepuestosPage() {
  const { orders, loading: ordersLoading } = useAllSparePartOrders()
  const { parts, loading: partsLoading } = useSparePartsCache()
  const { machines } = useMachines()
  const [query, setQuery] = useState("")
  const [abierta, setAbierta] = useState<string | null>(null)

  const consulta = query.trim()
  const buscando = consulta.length >= MIN_CHARS
  const resultado = useMemo(
    () =>
      consulta.length >= MIN_CHARS
        ? findCompatibleMachines(consulta, { parts, orders, machines })
        : null,
    [consulta, parts, orders, machines],
  )
  const cargando = ordersLoading || partsLoading

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Repuestos</h1>
        <p className="text-muted-foreground">
          Buscá un repuesto por <strong>código</strong> o por <strong>nombre</strong> y mirá en
          qué <strong>máquinas</strong> se usa. Si aparece en otra máquina, sirve como reemplazo
          cuando no conseguís el original.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">¿En qué máquinas se usa este repuesto?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SearchInput
            value={query}
            onChange={(value) => {
              setQuery(value)
              setAbierta(null)
            }}
            placeholder="Código (ej. 1 619 PB9 430) o nombre (ej. inducido, rodamiento)"
            className="max-w-xl"
          />
          <p className="text-xs text-muted-foreground">
            El código ignora espacios y mayúsculas («1619PB9430» = «1 619 PB9 430»); el nombre
            tolera variantes de escritura («motosierr» encuentra «motosierra»).
          </p>
          <p className="text-xs text-muted-foreground">
            Datos: {orders.length} pedido(s) de 3C · {parts.length} ficha(s) de repuestos
            {cargando ? " · cargando…" : ""}
          </p>
        </CardContent>
      </Card>

      {buscando && resultado && (
        <PartCompatibilityTable
          resultado={resultado}
          abierta={abierta}
          onToggle={(key) => setAbierta((prev) => (prev === key ? null : key))}
        />
      )}

      {buscando && !resultado && (
        <div className="rounded-md border bg-muted/20 p-6 text-center">
          <p className="font-medium">No se encontró «{consulta}» en ninguna máquina.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Probá con el código sin espacios o con parte del nombre. Ojo: los repuestos que
            quedaron <strong>sin código</strong> en 3C (por ejemplo «SEGUN MUESTRA») sólo se
            encuentran por nombre; al corregirles el código en «Pedidos Rep.» el buscador los
            toma al instante.
          </p>
        </div>
      )}

      {!buscando && (
        <div className="rounded-md border bg-muted/20 p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Cómo leer el resultado</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Cada fila es una <strong>máquina distinta</strong>, identificada por su{" "}
              <strong>modelo completo</strong> (el nombre corto de 3C va al lado, como dato).
            </li>
            <li>
              <strong>Veces</strong> = cuántos pedidos de esa máquina llevaban este repuesto;{" "}
              <strong>Última vez</strong> = el más reciente.
            </li>
            <li>
              <strong>Historial</strong> despliega el detalle: nº de orden, estado y las fechas
              (pedido · traído · utilizado).
            </li>
            <li>
              <strong>⚠ se parece a</strong> avisa cuando dos nombres de 3C parecen la MISMA
              máquina escrita distinto. No se fusionan solos: revisá antes de decidir.
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
