/**
 * VERIFICACIÓN de la retención de Excel de 3C: prueba que borrar los archivos
 * viejos NO cambia el resultado consolidado.
 *
 * Cómo lo prueba (todo local, SIN Redis ni Firebase):
 *   1. "ANTES" = consolida TODOS los Excel del disco (comportamiento de hoy).
 *   2. "DESPUÉS" = consolida SOLO los 5 que quedarían con la retención (el más
 *      nuevo de cada informe), partiendo del registro "ANTES" como memoria — que es
 *      exactamente lo que hará el agente en la corrida siguiente.
 *   3. Compara orden por orden: historia de estados, estado actual, trabajos,
 *      fechas, motivos, máquina y cliente.
 *
 * Si imprime "0 diferencias", la limpieza es segura. Si aparece alguna, NO borrar
 * y revisar: significa que ese dato vivía solo en un archivo viejo.
 *
 * Uso: npm run verify:exports-retention
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  buildConsolidatedOrders,
  consolidatedToMaintenanceRecords,
  type ConsolidatedState,
} from "../src/lib/sync-3c/consolidated"
import { EXPORT_MODULES, classifyExportFile } from "../src/lib/sync-3c/exportsRetention"
import type { MaintenanceRecord } from "../src/services/maintenance"

const EXPORTS_DIR = path.resolve(process.cwd(), "automation-watcher/3c_exports")

function normOrder(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/^X\s*/i, "").replace(/\s+/g, " ")
}

/** Firma comparable de una orden: todo lo que la retención no debe cambiar. */
function signature(rec: MaintenanceRecord): string {
  const states = (rec.states ?? []).map((s: ConsolidatedState) => `${s.status}@${s.statusDate ?? ""}`)
  const workItems = [...(rec.workItems ?? [])].map((w) => w.toLowerCase()).sort()
  const motivos = [...(rec.motivoByStatus ?? [])]
    .map((m) => `${m.status}=${m.motivo.toLowerCase()}`)
    .sort()
  const date = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d ?? ""))
  return JSON.stringify({
    estados: states,
    status: rec.status ?? "",
    statusDate: date(rec.statusDate),
    trabajos: workItems,
    motivos,
    entryDate: date(rec.entryDate),
    repairDate: date(rec.repairDate),
    returnDate: date(rec.returnDate),
    cliente: rec.clientName ?? "",
    clienteCodigo: rec.clientCode ?? "",
    maquina: rec.machineName ?? "",
    denominacion: rec.machineDenominacion ?? "",
    motivoEstadoRep: rec.motivoEstadoRep ?? "",
  })
}

async function main(): Promise<void> {
  const names = fs
    .readdirSync(EXPORTS_DIR)
    .filter((f) => /\.(xls|xlsx)$/i.test(f) && !f.startsWith("~$"))
  if (names.length === 0) {
    console.log("No hay Excel en 3c_exports: nada que verificar.")
    return
  }

  // ── 1. ANTES: todos los archivos ──────────────────────────────────────────
  const allConsolidated = await buildConsolidatedOrders(EXPORTS_DIR)
  const before = consolidatedToMaintenanceRecords(allConsolidated, [])
  console.log(`Archivos en disco: ${names.length}`)
  console.log(`ANTES   → órdenes consolidadas: ${before.length}`)
  const multiBefore = before.filter((r) => (r.states?.length ?? 0) > 1).length
  const statesBefore = before.reduce((acc, r) => acc + (r.states?.length ?? 0), 0)
  console.log(`          órdenes con más de 1 estado: ${multiBefore} · estados totales: ${statesBefore}`)

  // ── 2. Retención: el más nuevo de cada informe ────────────────────────────
  type Entry = { name: string; full: string; mtimeMs: number; module: string | null }
  const entries: Entry[] = []
  for (const name of names) {
    const full = path.join(EXPORTS_DIR, name)
    entries.push({ name, full, mtimeMs: fs.statSync(full).mtimeMs, module: await classifyExportFile(full) })
  }
  const keep = new Set<string>()
  for (const module of EXPORT_MODULES) {
    const newest = entries.filter((e) => e.module === module).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (newest) keep.add(newest.name)
  }
  const unclassified = entries.filter((e) => e.module === null)
  console.log(
    `Retención: quedarían ${keep.size} archivo(s)` +
      (unclassified.length ? ` (+${unclassified.length} sin clasificar)` : ""),
  )

  // ── 3. DESPUÉS: solo los retenidos, con el registro ANTES como memoria ────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "3c-retention-"))
  try {
    for (const name of keep) fs.copyFileSync(path.join(EXPORTS_DIR, name), path.join(tmp, name))
    const retainedConsolidated = await buildConsolidatedOrders(tmp)
    const after = consolidatedToMaintenanceRecords(retainedConsolidated, before)
    console.log(`DESPUÉS → órdenes consolidadas: ${after.length}`)
    const multiAfter = after.filter((r) => (r.states?.length ?? 0) > 1).length
    const statesAfter = after.reduce((acc, r) => acc + (r.states?.length ?? 0), 0)
    console.log(`          órdenes con más de 1 estado: ${multiAfter} · estados totales: ${statesAfter}`)

    // ── 4. Comparación orden por orden ──────────────────────────────────────
    const beforeBy = new Map(before.map((r) => [normOrder(r.orderNumber), r]))
    const afterBy = new Map(after.map((r) => [normOrder(r.orderNumber), r]))
    const diffs: string[] = []
    for (const [order, rec] of beforeBy) {
      const other = afterBy.get(order)
      if (!other) {
        diffs.push(`falta la orden ${order} después de la retención`)
        continue
      }
      if (signature(rec) !== signature(other)) diffs.push(`cambió la orden ${order}`)
    }
    for (const order of afterBy.keys()) {
      if (!beforeBy.has(order)) diffs.push(`aparece una orden nueva sin motivo: ${order}`)
    }

    console.log("")
    if (diffs.length === 0) {
      console.log("0 DIFERENCIAS: la retención NO cambia ningún dato.")
      console.log(`   (${before.length} órdenes comparadas · ${statesAfter} estados conservados)`)
    } else {
      console.log(`${diffs.length} DIFERENCIA(S) — NO borrar archivos todavía:`)
      for (const d of diffs.slice(0, 25)) console.log(`   · ${d}`)
      if (diffs.length > 25) console.log(`   ... y ${diffs.length - 25} más`)
      process.exitCode = 1
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

