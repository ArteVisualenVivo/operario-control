/**
 * Búsqueda tolerante a variantes de escritura (lib PURO, sin firebase/fs).
 *
 * "martillo 15k" tiene que encontrar "MARTILLO 15 KG", "Martillo 15kg" o
 * "MARTILLO-15K". "motosierr" tiene que encontrar "motosierra".
 */

/** Minúsculas, sin acentos ni formato. */
export function normalizeBase(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** Separadores → un espacio ("MARTILLO-15K" → "martillo 15k"). */
export function normalizeSpaced(value: unknown): string {
  return normalizeBase(value)
    .replace(/[^a-z0-9ñ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Como normalizeSpaced pero sin espacios ("Martillo 15kg" → "martillo15kg"). */
export function normalizeFlat(value: unknown): string {
  return normalizeSpaced(value).replace(/\s+/g, "")
}

/** Tokens de búsqueda ya normalizados. */
export function queryTokens(query: string): string[] {
  return normalizeSpaced(query).split(" ").filter(Boolean)
}

/** "15k"/"15kgs"/"15kilo(s)" → "15kg" (solo cuando van pegados al número). */
function canonUnitFlat(token: string): string {
  return token.replace(/^(\d+(?:[.,]\d+)?)(k|kgs|kilo|kilos)$/, "$1kg")
}

function singularVariants(token: string): string[] {
  const out = [token]
  if (token.length >= 5 && /[a-zñ]$/.test(token)) {
    if (token.endsWith("es")) out.push(token.slice(0, -2))
    else if (token.endsWith("s")) out.push(token.slice(0, -1))
  }
  return out
}

function wordMatches(qTok: string, word: string): boolean {
  if (!qTok || !word) return false
  if (word === qTok) return true
  for (const q of singularVariants(qTok)) {
    for (const w of singularVariants(word)) {
      if (w === q) return true
      // Prefijo: "motosierr" → "motosierra", "carbon" → "carbones".
      if (q.length >= 4 && w.startsWith(q)) return true
      if (w.length >= 4 && q.startsWith(w)) return true
    }
  }
  return false
}

/**
 * ¿El haystack contiene TODOS los tokens (AND)? Cada token vale si:
 *  1. aparece literal en el texto normalizado, o
 *  2. aparece (con unidad canonizada) en el texto sin espacios
 *     ("15k" ↔ "15 kg" ↔ "15kg" ↔ "15-k"), o
 *  3. es prefijo / singular de alguna palabra del texto.
 */
export function matchesLoose(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const spaced = normalizeSpaced(haystack)
  if (!spaced) return false
  const flat = spaced.replace(/\s+/g, "")
  const words = spaced.split(" ").filter(Boolean)
  return tokens.every((raw) => {
    const t = raw.toLowerCase()
    if (!t) return true
    if (spaced.includes(t)) return true
    const tFlat = canonUnitFlat(t.replace(/\s+/g, ""))
    if (tFlat.length >= 2 && flat.includes(tFlat)) return true
    return words.some((w) => wordMatches(t, w))
  })
}
