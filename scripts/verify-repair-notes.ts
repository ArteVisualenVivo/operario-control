/**
 * Verifica el mapeo de "Falla reportada" / "Reparación realizada" de una orden de
 * Reparaciones (3C).
 *
 * Cubre el bug reportado: el detalle mostraba el NOMBRE DE LA MÁQUINA como falla
 * ("TRIPA VIBRADOR") y el ESTADO de 3C ("Recepción de Cliente") como reparación
 * realizada, porque `originalData.texto` no existe y `record.status` era el estado.
 *
 * Correr: npx tsx scripts/verify-repair-notes.ts
 */
import { extractRepairNotes, repairNotesText } from "../src/lib/repairNotes"
import type { RepairNotesSource } from "../src/lib/repairNotes"

let failures = 0

function check(label: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  console.log(`${ok ? "OK" : "XX"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (esperado ${JSON.stringify(expected)})`}`)
  if (!ok) failures++
}

/** Atajo: del registro crudo a los dos campos del detalle. */
function notes(source: RepairNotesSource) {
  return extractRepairNotes(repairNotesText(source))
}

console.log("=== 1) Regresión del bug: orden SIN observaciones ===")
// Así se veía la orden X 0001-00011300 (TRIPA VIBRADOR, estado "Recepción de Cliente"):
// la falla mostraba el nombre de la máquina y la reparación mostraba el estado.
{
  const record: RepairNotesSource & { machineName: string; status: string } = {
    machineName: "TRIPA VIBRADOR",
    status: "Recepcion de Cliente",
  }
  check("sin observaciones → falla vacía", notes(record).reportedIssue, "")
  check("sin observaciones → reparación vacía", notes(record).repairPerformed, "")
  check("texto crudo vacío", repairNotesText(record), "")
}

console.log("\n=== 2) Bloques explícitos (muestra real del cache 3C) ===")
{
  const record: RepairNotesSource = {
    originalData: {
      observ:
        "VER PROBLERMA EN INTERRUPTOR DE ENCENDIDO.\nFALLA REPORTADA:\nno enciende. llave de encendido rota. se adjunta foto. se cambia llave y enciende. pero no gira.\nREPARACIÓN REALIZADA:\nse cambia llave de encendido y selector de giro. se repara cable por falso contacto\n\n",
    },
  }
  const got = notes(record)
  check(
    "falla = bloque FALLA REPORTADA",
    got.reportedIssue,
    "no enciende. llave de encendido rota. se adjunta foto. se cambia llave y enciende. pero no gira.",
  )
  check(
    "reparación = bloque REPARACIÓN REALIZADA",
    got.repairPerformed,
    "se cambia llave de encendido y selector de giro. se repara cable por falso contacto",
  )
}

console.log("\n=== 3) Texto libre sin bloques → todo es falla, reparación vacía ===")
{
  check(
    "máquina que no arranca",
    extractRepairNotes("PRENDE PERO NO GIRA LA TRIPA"),
    { reportedIssue: "PRENDE PERO NO GIRA LA TRIPA", repairPerformed: "" },
  )
  check(
    "reclamo del cliente",
    extractRepairNotes("No anda. Andaba bien y dejo de andar de una."),
    { reportedIssue: "No anda. Andaba bien y dejo de andar de una.", repairPerformed: "" },
  )
}

console.log("\n=== 4) Encabezado con contenido en la misma línea ===")
{
  check("FALLA REPORTADA: no enciende", extractRepairNotes("FALLA REPORTADA: no enciende"), {
    reportedIssue: "no enciende",
    repairPerformed: "",
  })
}

console.log("\n=== 5) 'DESCRIPCIÓN DEL ESTADO PENDIENTE' + reparación (muestra del cache) ===")
{
  const record: RepairNotesSource = {
    observations:
      "CUANDO LA ARRANCA HACE UN RUIDO RARO EN EL MOTOR, HACE MUCHA FUERZA EL MOTOR.\nEL AGUA SALE CON MENOS PRECION.\n\nDESCRIPCIÓN DEL ESTADO PENDIENTE:\nno tiene reparacion \n\nFALLA REPORTADA:\npoca fuerza \n\nREPARACIÓN REALIZADA:\nse encontró desarmada y con componentes rotos por el desgaste del material. no conviene la reparacion",
  }
  const got = notes(record)
  check("falla = 'poca fuerza'", got.reportedIssue, "poca fuerza")
  check(
    "reparación = trabajo realizado",
    got.repairPerformed,
    "se encontró desarmada y con componentes rotos por el desgaste del material. no conviene la reparacion",
  )
}

console.log("\n=== 6) Prioridad de campos de OBSERVACIONES ===")
{
  // DETALLE: el parser escribe el MISMO texto en 3 campos → no se duplica.
  const detalle: RepairNotesSource = {
    observaciones: "Se rompió el tambor",
    observations: "Se rompió el tambor",
    statusDescription: "Se rompió el tambor",
    originalData: {
      row: [
        "O.R.", "01/10/2026", "X 0001-00011300", "Recepcion de Cliente", "",
        "EMPRACONS SRL (108086)", "Se rompió el tambor", "TRIPA VIBRADOR",
        "", "", "", "", "", "",
      ],
    },
  }
  check("DETALLE: texto crudo sin duplicar", repairNotesText(detalle), "Se rompió el tambor")

  // ÍTEMS: `observations` acumula las notas del taller.
  const items: RepairNotesSource = {
    observations: "TRIPA CORTADA | CLIENTE NO RETIRA",
    originalData: {
      row: [1, 2, 3, "EMPRACONS SRL (108086)", "", 5, 999, "A", "REPARACION: TRIPA VIBRADOR", 1, 100, 100],
    },
  }
  check("ÍTEMS: notas del taller", notes(items).reportedIssue, "TRIPA CORTADA | CLIENTE NO RETIRA")

  // Ninguna clave de texto: la fila cruda NO se usa como falla.
  check("sin campos de texto → vacío", repairNotesText({ originalData: { row: ["a", "b", "c"] } }), "")
}

console.log("\n=== 7) Vacíos y nulos ===")
{
  check("string vacío", extractRepairNotes("   "), { reportedIssue: "", repairPerformed: "" })
  check("undefined", extractRepairNotes(undefined), { reportedIssue: "", repairPerformed: "" })
  check("null", extractRepairNotes(null), { reportedIssue: "", repairPerformed: "" })
  check("sin fuente", notes({}), { reportedIssue: "", repairPerformed: "" })
}

console.log("\n=== 8) Bloques sueltos ===")
{
  check("solo FALLA", extractRepairNotes("FALLA REPORTADA:\nno enciende\n"), {
    reportedIssue: "no enciende",
    repairPerformed: "",
  })
  check("solo REPARACIÓN", extractRepairNotes("REPARACIÓN REALIZADA:\nse cambió el buje\n"), {
    reportedIssue: "",
    repairPerformed: "se cambió el buje",
  })
  check("pre + falla sin reparación", extractRepairNotes("Cliente avisa por teléfono\nFALLA REPORTADA:\nhace ruido"), {
    reportedIssue: "hace ruido",
    repairPerformed: "",
  })
}

console.log(failures === 0 ? "\nTODOS LOS CHECKS PASARON" : `\n${failures} CHECK(S) FALLARON`)
process.exit(failures === 0 ? 0 : 1)
