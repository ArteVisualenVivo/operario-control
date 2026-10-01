// scaffoldTotals.ts — Cálculo de la vista "Andamios: alquilados vs disponible".
//
// REGLAS DE NEGOCIO (definidas por el usuario, 2026-10):
// - El TOTAL FÍSICO real por familia se carga UNA sola vez en la web y queda fijo.
// - ALQUILADOS viene de los remitos 3C ("Alquileres pendientes").
// - DISPONIBLE = max(0, TOTAL FÍSICO − ALQUILADOS). Sale alquiler → baja solo.
//   Hay devolución (desaparece del informe) → sube solo.
// - Si ALQUILADOS > TOTAL se marca `faltante` (alerta: revisar físico).
// - RIENDAS: no salen sueltas, salen como juego con los paños. Como 3C no trae
//   códigos de rienda, se derivan: 1 módulo/pasillero alquilado = 1 larga + 1 corta.
// - PUNTALES: total físico POR TIPO, descuento directo del remito.
// - RUEDAS/TABLONES: solo descuentan lo que dice el remito (el cliente las pide
//   si las necesita). 1 juego set x4 (29601) = stock APARTE (opción A): no toca sueltas.
// - Cada JUEGO de andamio (común o pasillero) = 2 módulos + 2 riendas largas
//   + 2 riendas cortas.

export interface ScaffoldDepositoStock {
  /** Total físico real por familia (carga única en la web). */
  items: Record<string, number>
  updatedAt?: string
}

export interface ScaffoldTotalRow {
  key: ScaffoldRowKey
  label: string
  alquilados: number
  /** Total físico real (carga única). */
  totalFisico: number
  disponibles: number
  /** true cuando lo alquilado supera el físico cargado. */
  faltante: boolean
  /** @deprecated alias de totalFisico (compatibilidad con la vista vieja). */
  deposito: number
  /** @deprecated alias de totalFisico (compatibilidad con la vista vieja). */
  total: number
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
  | "puntalBarovo"
  | "puntalMarron"
  | "puntalNaranja"
  | "puntalLargo380"
  | "puntalMmq"

export const SCAFFOLD_ROW_LABELS: Record<ScaffoldRowKey, string> = {
  modulos: "Módulos de andamio",
  pasilleros: "Módulos pasilleros",
  riendasLargas: "Riendas largas",
  riendasCortas: "Riendas cortas",
  ruedasSinFreno: "Ruedas sin freno",
  ruedasConFreno: "Ruedas con freno",
  juegosRuedas: "Juegos de ruedas (set x4)",
  tablones: "Tablones",
  puntalBarovo: "Puntal Barovo 3,05 m",
  puntalMarron: "Puntal marrón 3,00 m",
  puntalNaranja: "Puntal naranja 3 m",
  puntalLargo380: "Puntal largo 3,80 m",
  puntalMmq: "Puntal MMQ 3,05 m",
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
 * Calcula las filas (alquilados / total físico / disponibles) y los juegos
 * completos armables con el stock disponible.
 *
 * @param alquilados   Agregados de remitos 3C (resumen del parser de alquileres).
 *                     Las riendas se DERIVAN de módulos+pasilleros (se ignoran
 *                     valores pasados para esas claves).
 * @param totalFisico  Total físico real cargado una sola vez en la web.
 */
export function computeScaffoldTotals(
  alquilados: Partial<Record<ScaffoldRowKey, number>> | null | undefined,
  totalFisico: Partial<Record<ScaffoldRowKey, number>> | null | undefined,
): ScaffoldTotals {
  const aModulos = num(alquilados?.["modulos"])
  const aPasilleros = num(alquilados?.["pasilleros"])
  const riendasAlquiladas = aModulos + aPasilleros

  const keys = Object.keys(SCAFFOLD_ROW_LABELS) as ScaffoldRowKey[]
  const rows: ScaffoldTotalRow[] = keys.map((key) => {
    const a =
      key === "riendasLargas" || key === "riendasCortas"
        ? riendasAlquiladas
        : num(alquilados?.[key])
    const t = num(totalFisico?.[key])
    const disponibles = Math.max(0, t - a)
    return {
      key,
      label: SCAFFOLD_ROW_LABELS[key],
      alquilados: a,
      totalFisico: t,
      disponibles,
      faltante: t > 0 && a > t,
      // aliases de compatibilidad
      deposito: t,
      total: t,
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