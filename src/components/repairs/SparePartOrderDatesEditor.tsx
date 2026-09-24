"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import type { SparePartOrder, SparePartOrderDatesInput } from "@/types"

/**
 * Fechas del circuito de compra de un repuesto, para cargar a mano.
 *
 *   1) `ownerRequestedAt` → día en que le pediste el repuesto al dueño.
 *   2) `orderedAt`        → día en que el dueño lo pidió en la casa de repuestos.
 *   3) `receivedAt`       → día en que el dueño te trajo los repuestos.
 *
 * Sólo guarda FECHAS: las cantidades y el stock NO se tocan acá (eso lo sigue
 * haciendo la acción "Recibir" del pedido). Se guarda al elegir la fecha en el
 * calendario y, si Firestore rechaza la escritura, el valor se revierte: la
 * pantalla nunca muestra una fecha que no quedó guardada.
 */
type DateFieldKey = "ownerRequestedAt" | "orderedAt" | "receivedAt"

interface FieldDef {
  key: DateFieldKey
  /** Etiqueta corta (tablas). */
  short: string
  /** Etiqueta completa (detalle / hoja de compra). */
  long: string
  hint: string
}

const FIELDS: FieldDef[] = [
  { key: "ownerRequestedAt", short: "P. dueño", long: "Le pedí al dueño", hint: "Día en que le pediste el repuesto al dueño" },
  { key: "orderedAt", short: "P. repuestero", long: "Lo pidió en la casa", hint: "Día en que el dueño hizo el pedido en la casa de repuestos" },
  { key: "receivedAt", short: "Traído", long: "Me lo trajo", hint: "Día en que el dueño te trajo los repuestos" },
]

interface Props {
  order: SparePartOrder
  /** Guarda UNA fecha (`SparePartOrderDatesInput` con sólo esa clave). */
  onSave: (id: string, input: SparePartOrderDatesInput) => Promise<void>
  /** `stack` = una debajo de otra (tablas). `columns` = las 3 en línea. */
  layout?: "stack" | "columns"
  /** `compact` = etiquetas cortas y inputs chicos (tablas). `full` = etiquetas
   *  completas. `sheet` = para la hoja de compra impresa (input mínimo). */
  variant?: "compact" | "full" | "sheet"
  /** Renderiza UNA sola de las 3 fechas (columnas separadas de la hoja impresa). */
  only?: DateFieldKey
  /** Oculta la etiqueta (cuando el encabezado de la tabla ya la muestra). */
  hideLabel?: boolean
  /** `false` = inputs sin borde (hoja de compra impresa). */
  bordered?: boolean
  className?: string
}

/** Date → valor de `<input type="date">` (hora local, sin corrimiento de día). */
function toInputValue(d: Date | null | undefined): string {
  if (!d) return ""
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ""
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
}

/**
 * Valor del input → Date (o `null` si se borró). Se usa el MEDIODÍA local,
 * mismo criterio que los diálogos "Encargar"/"Recibir": 3C informa sólo el día
 * y el mediodía evita que el día mostrado se corra por zona horaria.
 */
function toDateValue(value: string): Date | null {
  if (!value) return null
  return new Date(`${value}T12:00:00`)
}

function initialDraft(order: SparePartOrder): Record<DateFieldKey, string> {
  return {
    ownerRequestedAt: toInputValue(order.ownerRequestedAt),
    orderedAt: toInputValue(order.orderedAt),
    receivedAt: toInputValue(order.receivedAt),
  }
}

export function SparePartOrderDatesEditor({
  order,
  onSave,
  layout = "stack",
  variant = "compact",
  only,
  hideLabel = false,
  bordered = true,
  className,
}: Props) {
  const [savingKey, setSavingKey] = useState<DateFieldKey | null>(null)
  // Cambia de valor sólo cuando hay que REMONTAR los inputs: al revertir una
  // escritura que falló, así vuelven al valor que realmente quedó guardado.
  const [version, setVersion] = useState(0)
  /** Con `only` se renderiza una sola fecha (columnas de la hoja impresa). */
  const fields = only ? FIELDS.filter((f) => f.key === only) : FIELDS
  // Valores GUARDADOS hoy en el pedido (llegan por props): se usan para no
  // reescribir lo mismo. Sin estado local ni efectos: el input muestra siempre
  // el dato del pedido y se remonta cuando ese dato cambia (otra acción, sync
  // del agente, recarga), así nunca queda mostrando una fecha vieja.
  const saved = initialDraft(order)

  const persist = async (key: DateFieldKey, value: string) => {
    if ((saved[key] ?? "") === value) return
    setSavingKey(key)
    try {
      await onSave(order.id, { [key]: toDateValue(value) } as SparePartOrderDatesInput)
      toast.success("Fecha guardada")
    } catch (err) {
      setVersion((v) => v + 1)
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la fecha")
    } finally {
      setSavingKey(null)
    }
  }

  const handleChange = (key: DateFieldKey, value: string) => {
    // Se guarda cuando la fecha está completa o cuando se borró: los pasos
    // intermedios del tipeo no generan escrituras.
    if (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)) void persist(key, value)
  }

  const handleBlur = (key: DateFieldKey, value: string) => {
    if (value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      // Quedó un texto incompleto: se descarta (vuelve al valor guardado).
      setVersion((v) => v + 1)
      return
    }
    void persist(key, value)
  }

  return (
    <div
      className={
        layout === "columns"
          ? `flex flex-wrap items-end gap-2 ${className ?? ""}`
          : `space-y-1 ${className ?? ""}`
      }
    >
      {fields.map((field) => (
        <label
          key={field.key}
          title={field.hint}
          className={layout === "columns" ? "flex flex-col gap-0.5" : "flex items-center gap-2"}
        >
          {!hideLabel && (
            <span className="whitespace-nowrap text-[10px] uppercase tracking-wide text-muted-foreground">
              {savingKey === field.key ? "guardando…" : variant === "compact" ? field.short : field.long}
            </span>
          )}
          <Input
            key={`${order.id}-${field.key}-${version}-${toInputValue(order[field.key])}`}
            type="date"
            defaultValue={toInputValue(order[field.key])}
            aria-label={field.hint}
            title={field.hint}
            onChange={(e) => handleChange(field.key, e.target.value)}
            onBlur={(e) => handleBlur(field.key, e.target.value)}
            className={
              variant === "sheet"
                ? `h-6 w-[104px] px-0.5 text-[11px] ${bordered ? "" : "border-0 shadow-none"}`
                : variant === "compact"
                  ? `h-7 w-[130px] text-xs ${bordered ? "px-2" : "border-0 px-1 shadow-none"}`
                  : `w-[170px] ${bordered ? "" : "border-0 px-1 shadow-none"}`
            }
          />
        </label>
      ))}
    </div>
  )
}

