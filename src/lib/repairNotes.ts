/**
 * repairNotes.ts — "Falla reportada" y "Reparación realizada" de una orden de 3C.
 *
 * REGLA (por qué existe este archivo):
 * 3C NO tiene un campo propio de "falla reportada". El taller escribe todo en la
 * columna OBSERVACIONES de la orden, a veces con bloques etiquetados:
 *
 *   ...notas previas...
 *   FALLA REPORTADA:
 *   funciona, pero calienta.
 *   REPARACIÓN REALIZADA:
 *   se desarma, se controlan rodamientos...
 *
 * BUG QUE CORRIGE (verificado contra exports reales de 3C):
 *   reportedIssue   = originalData.texto ?? machineName  → `originalData.texto`
 *                     NUNCA existe (los parsers guardan `{ row: [...] }` o claves
 *                     con nombre como `observ`), así que caía siempre al nombre
 *                     de la máquina ("TRIPA VIBRADOR").
 *   repairPerformed = record.status                      → el ESTADO de la orden
 *                     ("Recepción de Cliente", "Entreg./Factur."…), no la
 *                     reparación realizada.
 *
 * REGLA FINAL: ni el nombre de la máquina ni el estado de 3C se usan jamás como
 * falla o como reparación. Si la orden no tiene OBSERVACIONES, se devuelve "" y
 * la UI muestra "—".
 *
 * Este módulo es PURO (solo `import type` de nada, sin runtime): lo importan
 * `services/repairs.ts` (client SDK) y `lib/local-sync.ts` (isomorfo).
 */

/** Registro mínimo que necesita el extractor (subconjunto de MaintenanceRecord). */
export interface RepairNotesSource {
  /** OBSERVACIONES del informe DETALLE de 3C. */
  observaciones?: string
  /** Notas del taller acumuladas (informe de ÍTEMS). */
  observations?: string
  /** Comentario asociado al estado de la orden (informe de estados de 3C). */
  statusDescription?: string
  /**
   * Datos crudos del export: `{ row: [...] }` (parsers actuales) o claves con
   * nombre (`observ`, `observaciones`) en exports viejos / cache local.
   */
  originalData?: Record<string, unknown>
}

/** Resultado: los dos campos que muestra el detalle de la reparación. */
export interface RepairNotes {
  reportedIssue: string
  repairPerformed: string
}

/** Longitud máxima del encabezado aceptado (evita tomar una oración por título). */
const MAX_LABEL_LENGTH = 42

type Section = "falla" | "reparacion" | "pendiente"

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
}

/**
 * Reconoce un encabezado de bloque. Devuelve la sección o `null` si el texto no
 * es un título (entonces es contenido del bloque actual).
 *
 * "DESCRIPCIÓN DEL ESTADO PENDIENTE" es una sección PROPIA: actúa de frontera
 * para que su texto no se mezcle con el bloque "REPARACIÓN REALIZADA" (en 3C
 * aparece antes o después y no es el trabajo realizado). Solo se usa como
 * último recurso de `repairPerformed` cuando NO hay bloque de reparación.
 */
function sectionOfHeader(head: string): Section | null {
  const label = normalizeLabel(head).replace(/:\s*$/, "")
  if (!label || label.length > MAX_LABEL_LENGTH) return null

  if (/^(FALLAS? REPORTADAS?|FALLA|PROBLEMAS? REPORTADOS?|PROBLEMA)$/.test(label)) {
    return "falla"
  }
  if (/^(REPARACION(ES)? REALIZADAS?|REPARACION|TRABAJOS? REALIZADOS?)$/.test(label)) {
    return "reparacion"
  }
  if (/^(DESCRIPCION DEL ESTADO PENDIENTE|ESTADO PENDIENTE|PENDIENTE)$/.test(label)) {
    return "pendiente"
  }
  return null
}

/**
 * Detecta el encabezado de una línea y devuelve la sección más el texto que
 * sigue a los dos puntos (admite "FALLA REPORTADA: no enciende" en una línea).
 */
function parseHeader(line: string): { section: Section; rest: string } | null {
  const colon = line.indexOf(":")
  const head = colon >= 0 ? line.slice(0, colon) : line
  const section = sectionOfHeader(head)
  if (!section) return null
  return { section, rest: colon >= 0 ? line.slice(colon + 1).trim() : "" }
}

/**
 * Texto crudo de OBSERVACIONES del registro, sin importar de qué export venga.
 * Devuelve el PRIMER campo con contenido (el parser DETALLE escribe el mismo
 * texto en `observaciones`, `observations` y `statusDescription`: no se repite).
 */
export function repairNotesText(source: RepairNotesSource | null | undefined): string {
  if (!source) return ""
  const originalData = source.originalData ?? {}
  const candidates = [
    clean(originalData.observ),
    clean(originalData.observaciones),
    clean(source.observaciones),
    clean(source.observations),
    clean(source.statusDescription),
  ]
  return candidates.find((text) => text.length > 0) ?? ""
}

/**
 * Divide el texto de OBSERVACIONES en falla reportada y reparación realizada.
 *
 * - Con bloques etiquetados: cada bloque va a su campo y el texto previo a
 *   cualquier bloque se usa como falla (es el reclamo del cliente).
 * - Sin bloques: TODO el texto es la falla reportada y la reparación queda
 *   vacía (nunca se rellena con el estado de 3C).
 */
export function extractRepairNotes(rawText: string | null | undefined): RepairNotes {
  const text = clean(rawText)
  if (!text) return { reportedIssue: "", repairPerformed: "" }

  const buckets: Record<Section | "pre", string[]> = { pre: [], falla: [], reparacion: [], pendiente: [] }
  let current: Section | "pre" = "pre"

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const header = parseHeader(line)
    if (header) {
      current = header.section
      if (header.rest) buckets[current].push(header.rest)
      continue
    }
    buckets[current].push(line)
  }

  const join = (parts: string[]): string =>
    parts
      .join("\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()

  const falla = join(buckets.falla)
  const pre = join(buckets.pre)
  const reparacion = join(buckets.reparacion)
  const pendiente = join(buckets.pendiente)

  return {
    // Si hay bloque "FALLA REPORTADA:", ese manda; si no, el texto previo (el
    // reclamo del cliente) es la única fuente real de la falla.
    reportedIssue: falla || pre,
    // NUNCA se usa el estado de 3C. Si no hay bloque de reparación, se usa la
    // "DESCRIPCIÓN DEL ESTADO PENDIENTE" (explica el motivo de no reparar) para
    // no perder la única información disponible; si tampoco hay, queda vacío.
    repairPerformed: reparacion || pendiente,
  }
}
