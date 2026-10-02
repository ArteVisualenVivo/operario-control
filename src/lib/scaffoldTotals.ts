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

// =============================================================================
// ESTIMACIÓN AUTOMÁTICA DEL TOTAL FÍSICO A PARTIR DE LA EXISTENCIA DE 3C
// -----------------------------------------------------------------------------
// HALLAZGO VERIFICADO contra los Excel reales de 3C (Existencias por depósito,
// 2026-10): las unidades ALQUILADAS no aparecen como una cantidad positiva
// propia. 3C las registra como NEGATIVO en el depósito principal (1) y POSITIVO
// en el depósito de alquileres (3), de modo que al SUMAR todos los depósitos
// (lo que ya hace parser.ts) la existencia queda NETA de alquileres.
//   Ejemplos reales tomados del export:
//     28501 ANDAMIOS PASILLEROS  → dep1 −20 + dep3 +20 = 0
//     28601 ANDAMIOS 1,3 X 3     → dep1 −41 + dep3 +41 = 0
//     a03/a04 Juego de andamio   → dep1 25          = 25 (sin alquilar)
// Por lo tanto:
//   existencia3C (= stockTotal/stockAvailable) = físico en depósito = DISPONIBLE
//   TOTAL FÍSICO PROPIO = existencia3C + alquilados3C
// Esto permite AUTOCARGAR el total físico: ya no hace falta contar a mano.
// =============================================================================

export interface ScaffoldStockLike {
  /** Código 3C del artículo (columna ARTICULO del Excel de existencias). */
  codigo?: string
  /** Descripción del artículo. */
  name: string
  /** Existencia neta (ya descuenta alquileres). Si falta, se usa stockTotal. */
  stockAvailable?: number
  stockTotal?: number
}

// Códigos 3C usados por la clasificación (mismos que scaffoldRentals.ts).
const MODULE_CODES = ["A03", "A04", "A07", "28601"]
const PASILLERO_CODES = ["28501"]
const PLANK_CODES = ["TA02", "TA03", "28901", "29001", "29101", "29201"]
const WHEEL_SET_CODES = ["29601"]
const WHEEL_BRAKE_CODES = ["29501"]
const WHEEL_NOBRAKE_CODES = ["N7-1", "N71"]

const PUNTAL_BY_CODE: Record<string, ScaffoldRowKey> = {
  "28510": "puntalBarovo",
  "28318": "puntalMarron",
  "28511": "puntalNaranja",
  "28512": "puntalLargo380",
  PH305: "puntalMmq",
}

/** Clasifica un artículo de 3C en una fila de andamios (o null si no aplica). */
function classifyStockRow(codigo: string, name: string): ScaffoldRowKey | null {
  const c = (codigo ?? "").trim().toUpperCase()
  const d = (name ?? "").toUpperCase()
  const has = (list: string[]) => list.includes(c)

  // Puntales (por código).
  if (PUNTAL_BY_CODE[c]) return PUNTAL_BY_CODE[c]

  // Ruedas.
  if (has(WHEEL_SET_CODES)) return "juegosRuedas"
  if (has(WHEEL_BRAKE_CODES) || d.includes("C/FRENO") || d.includes("CON FRENO")) return "ruedasConFreno"
  if (has(WHEEL_NOBRAKE_CODES) || (d.includes("RUEDA") && !d.includes("FRENO"))) return "ruedasSinFreno"

  // Tablones.
  if (has(PLANK_CODES) || d.includes("TABLON")) return "tablones"

  // Riendas.
  if (c === "R02" || c === "R04") return "riendasLargas"
  if (c === "R01" || c === "R03") return "riendasCortas"

  // Paños (módulos) comunes y pasilleros.
  if (has(PASILLERO_CODES) || d.includes("PASILLERO") || d.includes("PASILLO")) return "pasilleros"
  if (has(MODULE_CODES) || d.includes("ANDAMIO")) return "modulos"

  return null
}

/**
 * Suma la existencia de 3C por fila de andamios. La existencia ya viene neta de
 * alquileres (ver nota de arriba), por lo que representa el DISPONIBLE.
 */
export function estimateScaffoldExistenciaFromStock(
  items: ScaffoldStockLike[] | null | undefined,
): Partial<Record<ScaffoldRowKey, number>> {
  const out: Partial<Record<ScaffoldRowKey, number>> = {}
  for (const item of items ?? []) {
    if (!item) continue
    const key = classifyStockRow(item.codigo ?? "", item.name ?? "")
    if (!key) continue
    const qty = num(item.stockAvailable ?? item.stockTotal ?? 0)
    out[key] = (out[key] ?? 0) + qty
  }
  return out
}

/**
 * Estima el TOTAL FÍSICO propio por fila usando la existencia de 3C como base.
 * Como la existencia de 3C ya descuenta los alquilados, se les vuelve a sumar:
 *   totalFisico = existencia3C + alquilados3C
 * Así el disponible calculado (max(0, total − alquilados)) coincide con la
 * existencia real que informa 3C.
 */
export function estimateScaffoldTotalFromStock(
  items: ScaffoldStockLike[] | null | undefined,
  alquilados?: Partial<Record<ScaffoldRowKey, number>> | null,
): Partial<Record<ScaffoldRowKey, number>> {
  const out: Partial<Record<ScaffoldRowKey, number>> = { ...estimateScaffoldExistenciaFromStock(items) }
  for (const key of Object.keys(SCAFFOLD_ROW_LABELS) as ScaffoldRowKey[]) {
    const a = num(alquilados?.[key])
    if (a > 0) out[key] = (out[key] ?? 0) + a
  }
  return out
}