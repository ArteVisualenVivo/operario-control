import { classifyRepairExport } from "./consolidated"

// ============================================================================
// exportsRetention.ts — RETENCIÓN de los Excel exportados de 3C.
//
// PROBLEMA: cada sincronización copia el Excel que genera 3C a
// `automation-watcher/3c_exports/` con un nombre propio (tresc<números>.xls) y
// NADA los borraba: 5 informes por corrida ⇒ la carpeta crecía ~10 MB por día
// para siempre (medido: 25 archivos / 21,4 MB en dos días).
//
// REGLA: se conserva **UN archivo por informe** (máximo 5). El archivo nuevo de
// un informe REEMPLAZA al anterior, que se borra.
//
// POR QUÉ ES SEGURO (lo verifica `npm run verify:exports-retention`):
// el agente consolida todos los Excel y guarda el resultado en la base (Redis),
// que es lo que lee la web. La historia de estados y los trabajos de cada orden
// YA NO dependen de que los archivos viejos sigan en disco: se unen en el
// registro guardado (ver `mergeStatesHistory` en consolidated.ts).
//
// SIN RED: este módulo solo lee/escribe archivos locales. No toca Redis ni
// Firebase (por eso el registro vive en un JSON en `automation-watcher/cache`).
//
// El índice `informe → archivo vigente` lo escribe el agente al terminar cada
// módulo (sabe de qué informe viene el Excel). `scripts/prune-3c-exports.ts` lo
// siembra una vez, clasificando por CONTENIDO.
// ============================================================================

/** Informes que exporta 3C (mismo vocabulario que el agente). */
export const EXPORT_MODULES = [
  "stock",
  "articulos",
  "reparaciones",
  "reparaciones_facturadas",
  "alquileres",
] as const

export type ExportModule = (typeof EXPORT_MODULES)[number]

/** Índice `informe → archivo vigente`. Vive en cache/ para que el barrido no lo toque. */
export const EXPORTS_INDEX_FILE = "exports-index.json"
/** Manifiesto de la corrida en curso, que escribe el AHK. Nunca se borra. */
export const EXPORT_MANIFEST_FILE = "_last_export.json"
/** Un archivo más joven que esto NO se borra: puede estar usándose ahora. */
export const PRUNE_MIN_AGE_MS = 15 * 60 * 1000

export type ExportsIndex = Partial<Record<ExportModule, string[]>>

/**
 * Cuántos Excel se conservan por informe (el más nuevo primero). 1 = solo el último.
 *
 * Todos los informes van con 1. Si alguno necesitara ventana, se sube acá —pero
 * SOLO con la verificación en verde (`npm run verify:exports-retention`), que
 * compara las DECISIONES de la web (pedido cerrado / reabierto / fecha del pedido).
 */
export const DEFAULT_KEEP_PER_MODULE: Record<ExportModule, number> = {
  stock: 1,
  articulos: 1,
  reparaciones: 1,
  reparaciones_facturadas: 1,
  alquileres: 1,
}

export interface PruneResult {
  deleted: string[]
  kept: string[]
  /** Archivos que no se pudieron clasificar: se conservan por seguridad. */
  unknown: string[]
  /** true = no había índice, así que no se borró nada (no se sabe qué conservar). */
  skipped: boolean
}

function isExcelFile(name: string): boolean {
  return /\.(xls|xlsx)$/i.test(name) && !name.startsWith("~$")
}

function normHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
}

/**
 * Informe de 3C al que pertenece un Excel, por su CONTENIDO (nunca por el nombre:
 * 3C los nombra con números al azar).
 *
 * `null` = no se reconoce ⇒ el archivo NO se borra nunca (mejor dejar un archivo
 * de más que perder un informe que no sabemos leer).
 */
export function classifyExportModule(rows: unknown[][]): ExportModule | null {
  const headerRow = Array.isArray(rows[2]) ? rows[2] : Array.isArray(rows[1]) ? rows[1] : []
  const cols = new Set((headerRow as unknown[]).map(normHeader))
  const first = String(rows[0]?.[0] ?? "")
    .replace(/"/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

  // DOS informes distintos comparten las mismas columnas de estado y ambos deben
  // conservarse: el DETALLE de órdenes (trae MOTIVO_ESTADO_REP, lo baja el módulo
  // `reparaciones`) y el de ESTADOS "Reparaciones del ... al ..." (módulo
  // `reparaciones_facturadas`). Se distinguen por el TÍTULO del informe.
  if (/detalle de ordenes de reparacion/.test(first)) return "reparaciones"

  const kind = classifyRepairExport(rows)
  if (kind === "statuses") return "reparaciones_facturadas"
  if (kind === "items") return "reparaciones"
  if (cols.has("motivo_estado_rep") || cols.has("motivo_estado")) return "reparaciones"

  if (cols.has("idd") || cols.has("familia") || /^articulos/.test(first)) return "articulos"
  if (cols.has("deposito") || cols.has("existencia") || cols.has("stock") || /existencias/.test(first)) {
    return "stock"
  }
  if (cols.has("remito") || /alquiler/.test(first)) return "alquileres"
  return null
}

/** Clasifica un archivo del disco. `null` si no se puede leer o no se reconoce. */
export async function classifyExportFile(fullPath: string): Promise<ExportModule | null> {
  const fs = await import("fs").then((m) => m.default || m)
  const XLSX = await import("xlsx").then((m) => m.default || m)
  try {
    const wb = XLSX.readFile(fullPath)
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) return null
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][]
    return classifyExportModule(rows)
  } catch {
    return null
  }
}

export async function readExportsIndex(cacheDir: string): Promise<ExportsIndex> {
  const fs = await import("fs").then((m) => m.default || m)
  const path = await import("path").then((m) => m.default || m)
  const file = path.join(cacheDir, EXPORTS_INDEX_FILE)
  try {
    if (!fs.existsSync(file)) return {}
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>
    const out: ExportsIndex = {}
    for (const key of EXPORT_MODULES) {
      const value = raw?.[key]
      if (typeof value === "string" && value) out[key] = [value]
      else if (Array.isArray(value)) {
        const list = value.filter((v): v is string => typeof v === "string" && v.length > 0)
        if (list.length > 0) out[key] = list
      }
    }
    return out
  } catch {
    return {}
  }
}

export async function writeExportsIndex(cacheDir: string, index: ExportsIndex): Promise<void> {
  const fs = await import("fs").then((m) => m.default || m)
  const path = await import("path").then((m) => m.default || m)
  const file = path.join(cacheDir, EXPORTS_INDEX_FILE)
  try {
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(index, null, 2))
  } catch {
    // sin índice la retención no borra nada: nunca es fatal
  }
}

/**
 * Registra el Excel que acaba de bajar un informe y borra el anterior de ESE
 * mismo informe (así queda siempre 1 por informe, desde el primer momento).
 */
export async function registerExportFile(opts: {
  exportsDir: string
  cacheDir: string
  module: ExportModule | string
  fileName: string
  /** Cuántos archivos conservar de ese informe. Por defecto, DEFAULT_KEEP_PER_MODULE. */
  keep?: number
}): Promise<{ replaced: string[] }> {
  const fs = await import("fs").then((m) => m.default || m)
  const path = await import("path").then((m) => m.default || m)
  const key = EXPORT_MODULES.find((m) => m === opts.module)
  if (!key) return { replaced: [] }

  const keep = Math.max(1, opts.keep ?? DEFAULT_KEEP_PER_MODULE[key])
  const index = await readExportsIndex(opts.cacheDir)
  const current = path.basename(opts.fileName)
  const ordered = [current, ...(index[key] ?? []).filter((f) => f !== current)]
  const next = ordered.slice(0, keep)
  const dropped = ordered.slice(keep)
  index[key] = next
  await writeExportsIndex(opts.cacheDir, index)

  const replaced: string[] = []
  for (const name of dropped) {
    try {
      const old = path.join(opts.exportsDir, name)
      if (fs.existsSync(old)) {
        fs.unlinkSync(old)
        replaced.push(name)
      }
    } catch {
      // si no se puede borrar, el barrido lo reintenta en la próxima corrida
    }
  }
  return { replaced }
}

/**
 * Barrido: borra los Excel que no son el vigente de ningún informe.
 *
 * SEGURIDADES (en este orden):
 *  1. Sin índice ⇒ no borra NADA (no se sabe qué conservar).
 *  2. Nunca toca el manifiesto (`_last_export.json`) ni archivos no-Excel.
 *  3. Nunca borra un archivo más joven que `minAgeMs` (puede estar en curso).
 *  4. Nunca borra un archivo que no se pueda clasificar (se conserva y se avisa).
 */
export async function pruneExportsDir(opts: {
  exportsDir: string
  cacheDir: string
  minAgeMs?: number
  now?: number
}): Promise<PruneResult> {
  const fs = await import("fs").then((m) => m.default || m)
  const path = await import("path").then((m) => m.default || m)
  const result: PruneResult = { deleted: [], kept: [], unknown: [], skipped: false }
  if (!fs.existsSync(opts.exportsDir)) return result

  const index = await readExportsIndex(opts.cacheDir)
  const referenced = new Set<string>()
  for (const list of Object.values(index)) {
    for (const name of list ?? []) if (name) referenced.add(name)
  }
  if (referenced.size === 0) {
    result.skipped = true
    return result
  }

  const minAgeMs = opts.minAgeMs ?? PRUNE_MIN_AGE_MS
  const now = opts.now ?? Date.now()

  for (const name of fs.readdirSync(opts.exportsDir)) {
    if (!isExcelFile(name)) continue
    if (referenced.has(name)) {
      result.kept.push(name)
      continue
    }
    const full = path.join(opts.exportsDir, name)
    let mtimeMs = now
    try {
      mtimeMs = fs.statSync(full).mtimeMs
    } catch {
      continue
    }
    if (now - mtimeMs < minAgeMs) {
      result.kept.push(name)
      continue
    }
    const module = await classifyExportFile(full)
    if (module === null) {
      result.unknown.push(name)
      continue
    }
    try {
      fs.unlinkSync(full)
      result.deleted.push(name)
    } catch {
      result.kept.push(name)
    }
  }
  return result
}

