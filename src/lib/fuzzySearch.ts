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

/**
 * Separadores → un espacio ("MARTILLO-15K" → "martillo 15k").
 * Antes de separar, une los decimales escritos con coma o punto ("3,05" → "305",
 * "3.05" → "305") para que "puntal 3,05" no se parta en los tokens "3" y "05".
 */
export function normalizeSpaced(value: unknown): string {
  return normalizeBase(value)
    .replace(/(\d)[.,](\d)/g, "$1$2")
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
      // Prefijo hacia adelante: el usuario escribió el principio de la palabra
      // ("motosierr" → "motosierra", "carbon" → "carbones").
      if (q.length >= 4 && w.startsWith(q)) return true
      // Abreviatura del artículo, SOLO si la palabra del artículo es larga
      // ("hidrolavadora" → "HIDROLAV"). Con 6+ caracteres se evita el falso
      // positivo de palabras cortas que son prefijo de otra cosa
      // ("puntal" ≠ "punta", "motosierra" ≠ "moto", "andamio" ≠ "andar").
      if (w.length >= 6 && q.startsWith(w)) return true
      // Palabra compuesta: "guinche" → "ELECTROGUINCHE", "sierra" → "MOTOSIERRA".
      if (q.length >= 5 && w.endsWith(q)) return true
    }
  }
  return false
}

/**
 * ¿El haystack contiene TODOS los tokens (AND)? Cada token vale si:
 *  1. aparece (con unidad canonizada) en el texto sin espacios
 *     ("15k" ↔ "15 kg" ↔ "15kg" ↔ "15-k", "0010101" ↔ "00-10101"), o
 *  2. es igual, singular/plural, prefijo o abreviatura de alguna palabra del
 *     texto (ver wordMatches).
 *
 * Ojo: NO se compara el token como subcadena cruda con espacios, porque eso
 * hacía que "punta" entrara dentro de "puntal" y trajera resultados falsos.
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
    const tFlat = canonUnitFlat(t.replace(/\s+/g, ""))
    // La comparación "sin espacios" solo vale para códigos/cifras con dígitos
    // ("15k" ↔ "15 kg", "0010101" ↔ "00-10101"). Con texto alfabético genera
    // falsos positivos al cruzar palabras ("punta largo" → "puntalargo").
    if (/\d/.test(tFlat) && tFlat.length >= 3 && flat.includes(tFlat)) return true
    return words.some((w) => wordMatches(t, w))
  })
}
