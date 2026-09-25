"use client"

import { useRef, useState } from "react"
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
 * haciendo la acción "Recibir" del pedido).
 *
 * CÓMO GUARDA (y por qué):
 * - Un `<input type="date">` NO avisa "fecha completa": mientras se tipea, y
 *   también si el campo queda a medio tipear, el control reporta `value === ""`
 *   AUNQUE tenga una fecha guardada. Escribir en la base con ese "" borraba la
 *   fecha y, al volver el dato vacío, el input se reiniciaba: la fecha
 *   desaparecía de la pantalla y de la hoja impresa.
 *   REGLA: sólo se escribe una fecha COMPLETA (`YYYY-MM-DD`). El borrado se
 *   confirma al SALIR del campo vacío y un texto a medio tipear se descarta
 *   (`badInput`), volviendo al valor que sigue guardado.
 * - Las escrituras de un mismo campo van EN ORDEN (encadenadas): dos
 *   `updateDoc` en vuelo pueden resolverse al revés y dejar guardada la fecha
 *   anterior.
 * - Si la escritura falla, el campo vuelve al valor que sigue guardado: la
 *   pantalla nunca muestra una fecha que no quedó en la base.
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

/** Fecha completa de un `<input type="date">` (`YYYY-MM-DD`). */
const COMPLETE_DATE = /^\d{4}-\d{2}-\d{2}$/

interface Props {
  order: SparePartOrder
  /** Guarda UNA fecha (`SparePartOrderDatesInput` con sólo esa clave). Puede
   *  devolver lo que quedó escrito (fechas + estado) para aplicarlo en memoria. */
  onSave: (id: string, input: SparePartOrderDatesInput) => Promise<unknown>
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
  /** Lo que se ve en cada input. Es optimista: acompaña el tipeo al instante. */
  const [draft, setDraft] = useState<Record<DateFieldKey, string>>(() => initialDraft(order))
  /** Últimos valores del PEDIDO ya volcados al input (ver "SINCRONIZACIÓN"). */
  const [applied, setApplied] = useState<Record<DateFieldKey, string>>(() => initialDraft(order))
  /** Campo con el foco: mientras el usuario escribe, el pedido no pisa el input. */
  const [focusedKey, setFocusedKey] = useState<DateFieldKey | null>(null)
  const [savingKey, setSavingKey] = useState<DateFieldKey | null>(null)
  /** Cadena de escrituras por campo: los cambios de un mismo campo se guardan
   *  EN ORDEN (dos `updateDoc` en vuelo pueden resolverse al revés y dejar
   *  guardada la fecha anterior). */
  const chains = useRef<Partial<Record<DateFieldKey, Promise<void>>>>({})
  /** Escrituras en vuelo por campo (para no pisar lo que se está escribiendo). */
  const [inFlight, setInFlight] = useState<Partial<Record<DateFieldKey, number>>>({})
  /** Último valor pedido por campo: evita reescribir lo mismo (change + blur). */
  const requested = useRef<Partial<Record<DateFieldKey, string>>>({})

  /** Con `only` se renderiza una sola fecha (columnas de la hoja impresa). */
  const fields = only ? FIELDS.filter((f) => f.key === only) : FIELDS
  // Valores GUARDADOS hoy en el pedido (llegan por props): se usan para no
  // reescribir lo mismo y para volver a ellos si una escritura falla.
  const saved = initialDraft(order)

  // —— SINCRONIZACIÓN ————————————————————————————————————————————————
  // El pedido puede cambiar por fuera (otra pantalla, el sync del agente, la
  // recarga): lo que cambió se vuelca al input. NO se pisa lo que el usuario
  // está escribiendo: si el campo tiene el foco o hay una escritura en vuelo,
  // el volcado queda pendiente y se aplica en el próximo render (cuando el
  // campo queda libre). Sin esta guarda, el dato que llegaba del pedido
  // reescribía el input y el valor tipeado "se reiniciaba" solo.
  const pendingSync: Partial<Record<DateFieldKey, string>> = {}
  for (const field of fields) {
    if (saved[field.key] === applied[field.key]) continue
    if (focusedKey === field.key || (inFlight[field.key] ?? 0) > 0) continue
    pendingSync[field.key] = saved[field.key]
  }
  if (Object.keys(pendingSync).length > 0) {
    setApplied((prev) => ({ ...prev, ...pendingSync }))
    setDraft((prev) => ({ ...prev, ...pendingSync }))
  }

  /** Devuelve el input al valor que sigue guardado en el pedido. */
  const revert = (key: DateFieldKey, input?: HTMLInputElement) => {
    const fallback = saved[key] ?? ""
    requested.current[key] = fallback
    if (input) input.value = fallback
    setDraft((prev) => ({ ...prev, [key]: fallback }))
    setApplied((prev) => ({ ...prev, [key]: fallback }))
  }

  const persist = async (key: DateFieldKey, value: string) => {
    // Sin cambios: ya es el valor guardado (o el que ya se pidió).
    if ((requested.current[key] ?? saved[key] ?? "") === value) return

    requested.current[key] = value
    setInFlight((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
    setSavingKey(key)

    const run = (chains.current[key] ?? Promise.resolve()).then(() =>
      onSave(order.id, { [key]: toDateValue(value) } as SparePartOrderDatesInput),
    )
    // La cadena del campo sigue viva aunque esta escritura falle.
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    chains.current[key] = tail

    try {
      await run
      toast.success(value === "" ? "Fecha borrada" : "Fecha guardada")
    } catch (err) {
      // Se vuelve a lo que realmente quedó guardado: la pantalla nunca muestra
      // una fecha que no está en la base.
      revert(key)
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la fecha")
    } finally {
      setInFlight((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 1) - 1) }))
      // "guardando…" se apaga recién con la ÚLTIMA escritura de ese campo.
      if (chains.current[key] === tail) setSavingKey((k) => (k === key ? null : k))
    }
  }

  /**
   * `<input type="date">` no avisa "fecha completa": mientras se tipea (y si el
   * campo queda a medio tipear) reporta `value === ""` AUNQUE tenga una fecha
   * guardada. Ese "" NO es un borrado: acá sólo se escribe una fecha COMPLETA.
   * El borrado se confirma al salir del campo vacío (ver `handleBlur`).
   */
  const handleChange = (key: DateFieldKey, value: string) => {
    setDraft((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }))
    if (COMPLETE_DATE.test(value)) void persist(key, value)
  }

  const handleBlur = (key: DateFieldKey, input: HTMLInputElement) => {
    setFocusedKey(null)
    // Texto a medio tipear (`badInput`): se descarta y vuelve el valor guardado.
    // Se escribe el value a mano porque React no toca el DOM cuando el value del
    // input ya es "" y el control todavía muestra el texto incompleto.
    if (input.validity.badInput) {
      revert(key, input)
      return
    }
    // Vacío = borrado deliberado del usuario. Con fecha = confirmación (la
    // escritura ya salió en `onChange`, acá no se reescribe lo mismo).
    void persist(key, input.value)
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
            type="date"
            value={draft[field.key]}
            aria-label={field.hint}
            title={field.hint}
            onFocus={() => setFocusedKey(field.key)}
            onChange={(e) => handleChange(field.key, e.target.value)}
            onBlur={(e) => handleBlur(field.key, e.target)}
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

