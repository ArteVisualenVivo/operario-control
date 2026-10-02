/**
 * Verifica la fórmula de la vista Andamios:
 *   disponible = max(0, total físico − alquilados)
 * con las riendas derivadas de los paños (1 larga + 1 corta por módulo/pasillero)
 * y la alerta `faltante` cuando lo alquilado supera el total físico cargado.
 *
 * Correr: npx tsx scripts/verify-andamios-total.ts
 */
import {
  computeScaffoldTotals,
  estimateScaffoldTotalFromStock,
} from "../src/lib/scaffoldTotals"

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

// Caso 7: AUTOCARGA del físico desde la existencia de 3C. La existencia ya viene
// NETA de alquileres (los alquilados se registran como negativo en el depósito
// principal), por eso: totalFisico = existencia + alquilados. Al recalcular el
// disponible debe volver a dar exactamente la existencia real de 3C.
{
  const stock = [
    { codigo: "28501", name: "ANDAMIOS PASILLEROS 0,9 X 2 MTS(4 RIENDA", stockTotal: 0 },
    { codigo: "28601", name: "ANDAMIOS 1,3 X 3 MTS (4 RIENDA", stockTotal: 0 },
    { codigo: "a03", name: "JUEGO DE ANDAMIO 1,0 M", stockTotal: 25 },
    { codigo: "a04", name: "JUEGO DE ANDAMIO 1,5 M", stockTotal: 25 },
    { codigo: "R02", name: "RIENDA 2,5 M", stockTotal: 40 },
    { codigo: "R01", name: "RIENDA 1,0 M", stockTotal: 40 },
  ]
  const alq = { pasilleros: 20, modulos: 41, riendasLargas: 61, riendasCortas: 61 }
  const est = estimateScaffoldTotalFromStock(stock, alq)
  check("físico pasilleros (0 existencia + 20 alq)", est.pasilleros, 20)
  check("físico módulos (50 existencia + 41 alq)", est.modulos, 91)
  check("físico riendas largas (40 existencia + 61 alq)", est.riendasLargas, 101)
  check("físico riendas cortas (40 existencia + 61 alq)", est.riendasCortas, 101)

  const { rows } = computeScaffoldTotals(alq, est)
  check("disponible pasilleros = existencia 3C", row(rows, "pasilleros").disponibles, 0)
  check("disponible módulos = existencia 3C", row(rows, "modulos").disponibles, 50)
  check("disponible riendas largas = existencia 3C", row(rows, "riendasLargas").disponibles, 40)
}

// Caso 8: clasificación por descripción (fallback cuando el stock viene de
// Firestore sin código, o cuando el código no coincide con ninguno conocido).
{
  const stock = [
    { codigo: "", name: "RUEDA P/ANDAMIO C/FRENO", stockAvailable: 8 },
    { codigo: "", name: "RUEDA P/ANDAMIO", stockAvailable: 30 },
    { codigo: "", name: "TABLON 2,50 M", stockAvailable: 12 },
    { codigo: "28510", name: "PUNTAL BAROVO 3,05 M", stockAvailable: 50 },
    { codigo: "29601", name: "JUEGO RUEDAS SET X4", stockAvailable: 10 },
  ]
  const est = estimateScaffoldTotalFromStock(stock, null)
  check("ruedas con freno", est.ruedasConFreno, 8)
  check("ruedas sin freno", est.ruedasSinFreno, 30)
  check("tablones", est.tablones, 12)
  check("puntal Barovo", est.puntalBarovo, 50)
  check("juegos de ruedas (set x4)", est.juegosRuedas, 10)
}

// Caso 9: existencia neta negativa (sobre-alquilado) se clampa a 0 y no genera
// físico negativo.
{
  const stock = [{ codigo: "28501", name: "ANDAMIOS PASILLEROS", stockTotal: -5 }]
  const est = estimateScaffoldTotalFromStock(stock, { pasilleros: 3 })
  check("físico pasilleros con existencia negativa", est.pasilleros, 3)
}

console.log(failures === 0 ? "\nTODO OK" : `\n${failures} fallo(s)`)
process.exit(failures === 0 ? 0 : 1)
