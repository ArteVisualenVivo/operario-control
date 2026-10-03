"use client"

import { useEffect, useState, useCallback } from "react"
import type { SparePartOrder } from "@/types"
import { getAllOrders, markOrdered, markOrderedMany, markReceived, markUsed, deleteOrders, updateOrderDates, updateOrderCode } from "@/services/sparePartOrders"
import type { MarkOrderedInput, SparePartOrderDatesInput } from "@/types"

export function useAllSparePartOrders() {
  const [orders, setOrders] = useState<SparePartOrder[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setOrders(await getAllOrders())
    } catch (err) {
      console.error("[useAllSparePartOrders] Error:", err)
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const markAsOrdered = useCallback(async (id: string, input: MarkOrderedInput) => {
    await markOrdered(id, input)
    await load()
  }, [load])

  /**
   * Encargo en LOTE: marca ENCARGADOS varios repuestos con LA MISMA fecha de
   * encargo (el caso real: una orden = una máquina con 5-6 repuestos que el dueño
   * se lleva todos juntos).
   *
   * SIN recargar la lista, igual que `updateDates`: se aplica en memoria SÓLO lo
   * que quedó guardado (`orderedIds`) y con la misma forma que muestra la tabla.
   * Una recarga completa mostraría "Cargando pedidos…", vaciaría la tabla y
   * perdería el scroll justo después de encargar (que es la acción más seguida de
   * la ronda de compra). Devuelve el resumen (`skipped` = ya no estaban
   * pendientes, `failed` = no se pudieron guardar) para que la pantalla lo cuente.
   */
  const markAsOrderedMany = useCallback(async (ids: string[], input: MarkOrderedInput) => {
    const result = await markOrderedMany(ids, input)
    if (result.orderedIds.length > 0) {
      const written: Partial<SparePartOrder> = {
        status: "ENCARGADO",
        ownerRequestedAt: input.orderedAt,
        expectedAt: input.expectedAt ?? undefined,
        updatedAt: new Date(),
      }
      if (input.notes !== undefined) written.notes = input.notes
      const writtenIds = new Set(result.orderedIds)
      setOrders((prev) => prev.map((o) => (writtenIds.has(o.id) ? { ...o, ...written } : o)))
    }
    return result
  }, [])

  const remove = useCallback(async (ids: string[]) => {
    await deleteOrders(ids)
    await load()
  }, [load])

  /** Recepción con cantidad (mueve stock si el repuesto está catalogado). */
  const markAsReceived = useCallback(async (id: string, quantity: number, receivedAt?: Date, notes?: string) => {
    await markReceived(id, quantity, receivedAt, notes)
    await load()
  }, [load])

  /** Utilización con cantidad (egreso de stock si el repuesto está catalogado). */
  const markAsUsed = useCallback(async (id: string, quantity: number, usedAt?: Date, notes?: string) => {
    await markUsed(id, quantity, usedAt, notes)
    await load()
  }, [load])

  /**
   * Fechas del circuito de compra cargadas a mano:
   * le pedí al dueño · lo pidió en la casa · me lo trajo.
   *
   * SIN recargar la lista: se aplica sobre el pedido en memoria SÓLO lo que se
   * guardó (fechas + estado que devuelve el servicio). Antes se releía todo
   * (`load`) y eso mostraba "Cargando pedidos…": la tabla desaparecía, el scroll
   * volvía arriba y había que buscar de nuevo la fila que se estaba editando.
   */
  const updateDates = useCallback(async (id: string, input: SparePartOrderDatesInput) => {
    const written = await updateOrderDates(id, input)
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...written } : o)))
  }, [])

  /**
   * Código del repuesto corregido a mano (3C a veces trae el voltaje "220V" o
   * nada). Igual que las fechas: se aplica SÓLO lo escrito sobre el pedido en
   * memoria, sin releer la lista.
   */
  const updateCode = useCallback(async (id: string, code: string) => {
    const written = await updateOrderCode(id, code)
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...written } : o)))
  }, [])

  return { orders, loading, reload: load, markAsOrdered, markAsOrderedMany, remove, markAsReceived, markAsUsed, updateDates, updateCode }
}
