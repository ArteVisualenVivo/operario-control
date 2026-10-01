/**
 * Verifica la fórmula de la vista Andamios:
 *   disponible = max(0, total físico − alquilados)
 * con las riendas derivadas de los paños (1 larga + 1 corta por módulo/pasillero)
 * y la alerta `faltante` cuando lo alquilado supera el total físico cargado.
 *
 * Correr: npx tsx scripts/verify-andamios-total.ts
 */
import { computeScaffoldTotals } from "../src/lib/scaffoldTotals"

let failures = 0

function check(label: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  console.log(`${ok ? "OK " : "XX "} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (esperado ${JSON.stringify(expected)})`}`)
  if (!ok) failures++
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = (rows: any[], key: string) => rows.find((r) => r.key === key)

// Caso 1: disponible = total − alquilados, y riendas derivadas de los módulos.
{
  const { rows } = computeScaffoldTotals(
    { modulos: 4 },
    { modulos: 10, riendasLargas: 10, riendasCortas: 10 },
  )
  check("módulos alquilados", row(rows, "modulos").alquilados, 4)
  check("módulos disponible", row(rows, "modulos").disponibles, 6)
  check("riendas largas alquiladas (derivadas de módulos)", row(rows, "riendasLargas").alquilados, 4)
  check("riendas largas disponible", row(rows, "riendasLargas").disponibles, 6)
  check("riendas cortas disponible", row(rows, "riendasCortas").disponibles, 6)
}

// Caso 2: alquilados > total → disponible 0 y faltante true.
{
  const { rows } = computeScaffoldTotals({ modulos: 12 }, { modulos: 10 })
  check("módulos disponible (clamp a 0)", row(rows, "modulos").disponibles, 0)
  check("módulos faltante", row(rows, "modulos").faltante, true)
}

// Caso 3: pasilleros también suman a las riendas derivadas.
{
  const { rows } = computeScaffoldTotals(
    { modulos: 2, pasilleros: 3 },
    { riendasLargas: 20, riendasCortas: 20 },
  )
  check("riendas derivadas = módulos + pasilleros", row(rows, "riendasLargas").alquilados, 5)
  check("riendas largas disponible", row(rows, "riendasLargas").disponibles, 15)
}

// Caso 4: puntales por tipo, descuento directo del remito.
{
  const { rows } = computeScaffoldTotals({ puntalBarovo: 3 }, { puntalBarovo: 8 })
  check("puntal Barovo alquilados", row(rows, "puntalBarovo").alquilados, 3)
  check("puntal Barovo disponible", row(rows, "puntalBarovo").disponibles, 5)
}

// Caso 5: ruedas/tablones solo descuentan lo del remito (no tocan otras familias).
{
  const { rows } = computeScaffoldTotals(
    { tablones: 4, juegosRuedas: 2 },
    { tablones: 30, juegosRuedas: 10, ruedasSinFreno: 100 },
  )
  check("tablones disponible", row(rows, "tablones").disponibles, 26)
  check("juegos de ruedas disponible", row(rows, "juegosRuedas").disponibles, 8)
  check("ruedas sin freno (sin alquiler) → todo disponible", row(rows, "ruedasSinFreno").disponibles, 100)
}

// Caso 6: juegos completos = min(módulos/2, riendas/2, riendas/2).
{
  const { juegos } = computeScaffoldTotals(
    { modulos: 4 },
    { modulos: 10, riendasLargas: 10, riendasCortas: 10 },
  )
  check("juegos comunes disponibles", juegos.comunes, 3)
}

console.log(failures === 0 ? "\nTODO OK" : `\n${failures} fallo(s)`)
process.exit(failures === 0 ? 0 : 1)
