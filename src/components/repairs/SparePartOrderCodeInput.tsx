"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import type { SparePartOrder } from "@/types"

/**
 * CÓDIGO del repuesto, editable a mano.
 *
 * Por qué existe: 3C a veces trae el código mal (por ejemplo el VOLTAJE "220V"
 * en lugar del código real) o no lo trae. Acá se corrige sin salir de la
 * pantalla; la hoja de compra imprime siempre lo que quedó guardado.
 *
 * CÓMO GUARDA (y por qué):
 * - Se escribe al presionar Enter o al SALIR del campo (`onBlur`), nunca en cada
 *   tecla: mientras se tipea, el texto vive en estado local, así la tabla no se
 *   recarga ni se pierde el lugar donde se estaba editando.
 * - Mientras haya texto tipeado, ese texto manda; al terminar, el campo vuelve a
 *   mostrar lo GUARDADO (que ya trae el valor nuevo). Por eso NO hace falta
 *   ningún efecto de sincronización: si el pedido cambia por fuera (importación
 *   del agente, otra pantalla) el campo muestra ese valor sin remontarse.
 * - Si la escritura falla, el campo vuelve al valor guardado: la pantalla nunca
 *   muestra un código que no está en la base.
 * - Dejarlo VACÍO borra el código (la UI muestra "—").
 */
interface Props {
  order: SparePartOrder
  /** Guarda el código y devuelve lo escrito (para aplicarlo en memoria). */
  onSave: (id: string, code: string) => Promise<unknown>
  className?: string
}

export function SparePartOrderCodeInput({ order, onSave, className }: Props) {
  const stored = (order.code ?? "").trim()
  /** `null` = mostrar lo guardado; texto = lo que el usuario está escribiendo. */
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const value = draft ?? stored

  const save = async (next: string) => {
    if (next.trim() === stored) {
      setDraft(null)
      return
    }
    setSaving(true)
    try {
      await onSave(order.id, next)
      toast.success(next.trim() ? "Código guardado" : "Código borrado")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el código")
    } finally {
      // Vuelve a mostrar lo que quedó GUARDADO: el valor nuevo si se guardó, el
      // anterior si la escritura falló.
      setDraft(null)
      setSaving(false)
    }
  }

  return (
    <Input
      value={value}
      placeholder="—"
      aria-label="Código del repuesto"
      title="Código del repuesto: se guarda con Enter o al salir del campo (vacío = sin código)"
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        const next = e.target.value
        setDraft(next)
        void save(next)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === "Escape") {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
      className={`h-7 w-[132px] font-mono text-xs ${saving ? "opacity-60" : ""} ${className ?? ""}`}
    />
  )
}
