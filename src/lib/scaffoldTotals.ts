// scaffoldTotals.ts — Cálculo de la vista "Andamios: alquilados vs depósito".
//
// REGLAS DE NEGOCIO (definidas por el usuario, 2026-09):
// - De los remitos de alquiler 3C solo se toman: andamios (módulos), ruedas y
//   tablones ALQUILADOS.
// - El stock guardado en DEPÓSITO se carga MANUALMENTE en la web.
// - TOTAL = ALQUILADOS + DEPÓSITO.  DISPONIBLES = DEPÓSITO (lo libre para alquilar).
// - Cada JUEGO de andamio (común o pasillero) = 2 módulos + 2 riendas largas
//   + 2 riendas cortas.

export interface ScaffoldDepositoStock {
  /** Cantidad guardada en depósito por familia. */
  items: Record<string, number>
  updatedAt?: string
}

export interface ScaffoldTotalRow {
  key: ScaffoldRowKey
  label: string
  alquilados: number
  deposito: number
  total: number
  disponibles: number
}

export type ScaffoldRowKey =
  | "modulos"
  | "pasilleros"
  | "riendasLargas"
  | "riendasCortas"
  | "ruedasSinFreno"
  | "ruedasConFreno"
  | "juegosRuedas"
  | "tablones"

export const SCAFFOLD_ROW_LABELS: Record<ScaffoldRowKey, string> = {
  modulos: "Módulos de andamio",
  pasilleros: "Módulos pasilleros",
  riendasLargas: "Riendas largas",
  riendasCortas: "Riendas cortas",
  ruedasSinFreno: "Ruedas sin freno",
  ruedasConFreno: "Ruedas con freno",
  juegosRuedas: "Juegos de ruedas (set x4)",
  tablones: "Tablones",
}

export interface ScaffoldJuegos {
  comunes: number
  pasilleros: number
}

export interface ScaffoldTotals {
  rows: ScaffoldTotalRow[]
  juegos: ScaffoldJuegos
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Calcula las filas (alquilados / depósito / total / disponibles) y los juegos
 * completos armables con el stock disponible.
 *
 * @param alquilados  Agregados de remitos 3C (resumen del parser de alquileres).
 * @param deposito    Stock en depósito cargado manualmente.
 */
export function computeScaffoldTotals(
  alquilados: Partial<Record<ScaffoldRowKey, number>> | null | undefined,
  deposito: Partial<Record<ScaffoldRowKey, number>> | null | undefined,
): ScaffoldTotals {
  const keys = Object.keys(SCAFFOLD_ROW_LABELS) as ScaffoldRowKey[]
  const rows: ScaffoldTotalRow[] = keys.map((key) => {
    const a = num(alquilados?.[key])
    const d = num(deposito?.[key])
    return {
      key,
      label: SCAFFOLD_ROW_LABELS[key],
      alquilados: a,
      deposito: d,
      total: a + d,
      // Lo disponible para alquilar es lo que está guardado en depósito.
      disponibles: d,
    }
  })

  const by = (k: ScaffoldRowKey) => rows.find((r) => r.key === k)!.disponibles
  const juegos: ScaffoldJuegos = {
    // 1 juego = 2 módulos + 2 riendas largas + 2 riendas cortas
    comunes: Math.min(
      Math.floor(by("modulos") / 2),
      Math.floor(by("riendasLargas") / 2),
      Math.floor(by("riendasCortas") / 2),
    ),
    // Los pasilleros usan la misma receta.
    pasilleros: Math.min(
      Math.floor(by("pasilleros") / 2),
      Math.floor(by("riendasLargas") / 2),
      Math.floor(by("riendasCortas") / 2),
    ),
  }

  return { rows, juegos }
}