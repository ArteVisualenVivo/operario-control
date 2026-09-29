// Centraliza la decision "esto es del rubro andamios?" para que el Dashboard
// y Andamios compartan el mismo criterio (una sola fuente de verdad).
// Detecta: andamios, puntales, panos/modulos, riendas, tablones, ruedas,
// plataformas, diagonales, caballetes + codigos 3C del catalogo
// (A03/A04/A07/28501/28601, R01-R04, TA02/TA03, N7-1, 29501/29601...).
export function isScaffoldSearch(rawQuery: string): boolean {
  const text = (rawQuery ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ")
  if (!text.trim()) return false
  const has = (...words: string[]) => words.some((w) => text.includes(w))
  const byWord =
    has(
      "andamio",
      "andamios",
      "and.",
      "pasillero",
      "pasilleros",
      "jgo and",
      "puntal",
      "puntales",
      "pano",
      "panos",
      "modulo",
      "modulos",
      "rienda",
      "riendas",
      "tablon",
      "tablones",
      "plataforma",
      "plataformas",
      "diagonal",
      "diagonales",
      "caballet",
      "caballetes",
      "rueda",
      "ruedas",
      "barovo",
      "marron",
      "naranja",
      "mmq",
    )
  if (byWord) return true
  // Codigos 3C de andamios/puntales (con o sin espacio): A03, R02, TA02...
  if (/\ba\s?0?[347]\b/.test(text)) return true
  if (/\br\s?0?[1234]\b/.test(text)) return true
  if (/\bta\s?0?[23]\b/.test(text)) return true
  if (/\bn7\s?-?\s?1\b/.test(text)) return true
  if (/\b(28318|28502|28505|28506|28510|28511|28512|28901|29001|29101|29201|29501|29601|ph\s?305|base\s?600|nnqbasp|gancho|aph\s?305|pph\s?305|rph\s?305)\b/.test(text)) return true
  return false
}
