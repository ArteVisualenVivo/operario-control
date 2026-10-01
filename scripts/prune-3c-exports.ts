/**
 * LIMPIEZA INICIAL de los Excel de 3C acumulados + siembra del índice de retención.
 *
 * Qué hace (por defecto NO borra nada: muestra qué haría):
 *  1. Clasifica por CONTENIDO cada Excel de `automation-watcher/3c_exports`.
 *  2. Se queda con el MÁS NUEVO de cada informe (stock, articulos, reparaciones,
 *     reparaciones_facturadas, alquileres) → máximo 5 archivos.
 *  3. Escribe el índice `informe → archivo vigente` en `automation-watcher/cache`.
 *  4. Con `--apply`, borra los demás. Los archivos que NO se reconocen se
 *     conservan siempre (mejor dejar uno de más que perder un informe).
 *
 * POR QUÉ ES SEGURO: los datos de cada Excel ya están consolidados en la base
 * (Redis) que lee la web, y desde el cambio en `consolidated.ts` la historia de
 * estados y los trabajos se conservan en el registro guardado, así que borrar los
 * archivos viejos no pierde nada. Verificación: `npm run verify:exports-retention`.
 *
 * SIN RED: solo archivos locales. No toca Redis ni Firebase.
 *
 * Uso:
 *   npx tsx scripts/prune-3c-exports.ts            (simulación: no borra)
 *   npx tsx scripts/prune-3c-exports.ts --apply    (borra de verdad)
 */
import fs from "node:fs"
import path from "node:path"
import {
  DEFAULT_KEEP_PER_MODULE,
  EXPORT_MODULES,
  readExportsIndex,
  writeExportsIndex,
  classifyExportFile,
  type ExportModule,
  type ExportsIndex,
} from "../src/lib/sync-3c/exportsRetention"

const EXPORTS_DIR = path.resolve(process.cwd(), "automation-watcher/3c_exports")
const CACHE_DIR = path.resolve(process.cwd(), "automation-watcher/cache")
const APPLY = process.argv.includes("--apply")

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(2)} MB`
}

async function main(): Promise<void> {
  if (!fs.existsSync(EXPORTS_DIR)) {
    console.log(`No existe la carpeta ${EXPORTS_DIR}`)
    return
  }
  const names = fs
    .readdirSync(EXPORTS_DIR)
    .filter((f) => /\.(xls|xlsx)$/i.test(f) && !f.startsWith("~$"))

  const index = await readExportsIndex(CACHE_DIR)
  console.log(`Carpeta: ${EXPORTS_DIR}`)
  console.log(`Archivos Excel: ${names.length}`)
  console.log(`Índice previo: ${JSON.stringify(index)}`)
  console.log("")

  type Entry = { name: string; full: string; size: number; mtimeMs: number; module: ExportModule | null }
  const entries: Entry[] = []
  for (const name of names) {
    const full = path.join(EXPORTS_DIR, name)
    const st = fs.statSync(full)
    const module = await classifyExportFile(full)
    entries.push({ name, full, size: st.size, mtimeMs: st.mtimeMs, module })
  }

  // El más nuevo de cada informe (y si el índice ya apuntaba a uno que existe, se respeta).
  const keep = new Set<string>()
  const nextIndex: ExportsIndex = { ...index }
  for (const module of EXPORT_MODULES) {
    const candidates = entries.filter((e) => e.module === module).sort((a, b) => b.mtimeMs - a.mtimeMs)
    const previousList = index[module] ?? []
    const previous = previousList.find((name) => candidates.some((c) => c.name === name))
    const chosen = (previous && candidates.find((c) => c.name === previous)) || candidates[0] || undefined
    if (chosen) {
      keep.add(chosen.name)
      nextIndex[module] = [chosen.name]
      console.log(
        `  ${module.padEnd(24)} → ${chosen.name}  (${new Date(chosen.mtimeMs).toISOString()}, ${Math.round(chosen.size / 1024)} KB)`,
      )
    } else if (previousList.length > 0) {
      console.log(`  ${module.padEnd(24)} → (índice apunta a ${previousList.join(", ")}, ya no está en disco)`)
      delete nextIndex[module]
    }
  }

  const unclassified = entries.filter((e) => e.module === null)
  const toDelete = entries.filter((e) => e.module !== null && !keep.has(e.name))
  const freed = toDelete.reduce((acc, e) => acc + e.size, 0)
  const keptBytes = entries.filter((e) => keep.has(e.name)).reduce((acc, e) => acc + e.size, 0)

  console.log("")
  console.log(`Se conservan ${keep.size} archivo(s) (${mb(keptBytes)})`)
  console.log(`Se borrarían ${toDelete.length} archivo(s) (${mb(freed)})`)
  if (unclassified.length > 0) {
    console.log(`Sin clasificar (se conservan SIEMPRE): ${unclassified.length}`)
    for (const e of unclassified) console.log(`   · ${e.name}`)
  }

  if (!APPLY) {
    console.log("")
    console.log("SIMULACIÓN: no se borró nada. Para aplicar: npx tsx scripts/prune-3c-exports.ts --apply")
    return
  }

  await writeExportsIndex(CACHE_DIR, nextIndex)
  let deleted = 0
  let errors = 0
  for (const e of toDelete) {
    try {
      fs.unlinkSync(e.full)
      deleted++
    } catch {
      errors++
      console.log(`   ! no se pudo borrar: ${e.name}`)
    }
  }
  const after = fs.readdirSync(EXPORTS_DIR).filter((f) => /\.(xls|xlsx)$/i.test(f) && !f.startsWith("~$"))
  const afterBytes = after.reduce((acc, f) => acc + fs.statSync(path.join(EXPORTS_DIR, f)).size, 0)
  console.log("")
  console.log(`APLICADO: borrados ${deleted}${errors ? ` (${errors} con error)` : ""}`)
  console.log(`Quedan ${after.length} archivo(s) · ${mb(afterBytes)}`)
  console.log(`Índice escrito: ${JSON.stringify(nextIndex)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
