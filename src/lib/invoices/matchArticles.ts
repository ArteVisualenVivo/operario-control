// matchArticles.ts — Match de renglones de factura contra el catálogo 3C.
//
// El catálogo vive en el módulo Redis `articulos` (informe "Artículos" de 3C).
// Si está vacío, todos los renglones quedan en "sin_catalogo" y la UI avisa
// que hay que correr la sincronización de Artículos.
import type { InvoiceLine, InvoiceLineCandidate } from "@/types/invoice"
import { getRedis, readModuleData } from "@/lib/sync-3c/redisPrimary"

export interface CatalogItem {
  code: string
  name: string
}

const CODE_KEYS = ["ARTICULO", "CODIGO", "COD", "ART", "CODIGO_ARTICULO", "COD_ART", "REFERENCIA"]
const NAME_KEYS = ["DENOMINACION", "DESCRIPCION", "DESC", "NOMBRE", "DETALLE", "ARTICULO_DESC"]

export function normText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function normCode(s: string): string {
  return s.replace(/\s+/g, "").toUpperCase()
}

/** Similitud 0-1 entre dos nombres (Dice por tokens + bonificación de contención). */
export function similarity(a: string, b: string): number {
  const na = normText(a)
  const nb = normText(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = na.split(" ").filter(Boolean)
  const tb = nb.split(" ").filter(Boolean)
  const setB = new Set(tb)
  let inter = 0
  for (const t of ta) if (setB.has(t)) inter++
  const dice = (2 * inter) / (ta.length + tb.length)
  if (Math.min(na.length, nb.length) >= 5 && (na.includes(nb) || nb.includes(na))) {
    return Math.max(dice, 0.78)
  }
  return dice
}

/** Detecta columnas código/descripción del export de Artículos de 3C. */
export function detectCatalog(rows: unknown[]): CatalogItem[] {
  const objs = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
  if (objs.length === 0) return []
  const sample = objs.slice(0, 200)

  const coverage = (key: string): number => {
    let hits = 0
    for (const r of sample) {
      const v = r[key]
      if (v !== null && v !== undefined && String(v).trim() !== "") hits++
    }
    return hits / sample.length
  }

  let codeKey: string | null = null
  let best = 0.3
  for (const k of CODE_KEYS) {
    const c = coverage(k)
    if (c > best) {
      best = c
      codeKey = k
    }
  }
  let nameKey: string | null = null
  best = 0.3
  for (const k of NAME_KEYS) {
    const c = coverage(k)
    if (c > best) {
      best = c
      nameKey = k
    }
  }
  if (!nameKey && !codeKey) return []

  const items: CatalogItem[] = []
  const seen = new Set<string>()
  for (const r of objs) {
    const code = codeKey ? String(r[codeKey] ?? "").trim() : ""
    const name = nameKey ? String(r[nameKey] ?? "").trim() : ""
    if (!code && !name) continue
    const key = normCode(code) || normText(name)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ code, name })
  }
  return items
}

export async function loadCatalog(): Promise<CatalogItem[]> {
  try {
    const env = await readModuleData("articulos", getRedis())
    const data: unknown = env?.data
    let rows: unknown[] = []
    if (Array.isArray(data)) rows = data
    else if (data && typeof data === "object") {
      const d = data as Record<string, unknown>
      if (Array.isArray(d.items)) rows = d.items
      else if (Array.isArray(d.records)) rows = d.records
      else if (Array.isArray(d.data)) rows = d.data
    }
    return detectCatalog(rows)
  } catch (err) {
    console.error("[invoices] loadCatalog falló:", err)
    return []
  }
}

export interface LineMatch {
  matchCode: string | null
  matchName: string | null
  matchScore: number | null
  action: NonNullable<InvoiceLine["action"]>
  candidates: InvoiceLineCandidate[]
}

/** Match puro (testeable sin Redis). */
export function matchLineAgainstCatalog(
  line: InvoiceLine,
  catalog: CatalogItem[],
): LineMatch {
  if (catalog.length === 0) {
    return { matchCode: null, matchName: null, matchScore: null, action: "sin_catalogo", candidates: [] }
  }

  const code = (line.code ?? "").trim()
  if (code) {
    const nc = normCode(code)
    const exact = catalog.find((c) => c.code && normCode(c.code) === nc)
    if (exact) {
      const others = catalog
        .map((c) => ({ c, s: similarity(line.description, c.name) }))
        .filter((x) => x.c.code !== exact.code && x.s >= 0.45)
        .sort((a, b) => b.s - a.s)
        .slice(0, 2)
      return {
        matchCode: exact.code,
        matchName: exact.name,
        matchScore: 1,
        action: "stock",
        candidates: [
          { code: exact.code, name: exact.name, score: 1 },
          ...others.map((x) => ({ code: x.c.code, name: x.c.name, score: Math.round(x.s * 100) / 100 })),
        ],
      }
    }
  }

  const scored = catalog
    .map((c) => ({ c, s: similarity(line.description, c.name) }))
    .sort((a, b) => b.s - a.s)
  const top = scored.filter((x) => x.s >= 0.45).slice(0, 3)
  const candidates = top.map((x) => ({
    code: x.c.code,
    name: x.c.name,
    score: Math.round(x.s * 100) / 100,
  }))
  const best = scored[0]
  if (best && best.s >= 0.62) {
    return {
      matchCode: best.c.code,
      matchName: best.c.name,
      matchScore: Math.round(best.s * 100) / 100,
      action: "stock",
      candidates,
    }
  }
  return { matchCode: null, matchName: null, matchScore: null, action: "alta_stock", candidates }
}

/** Aplica el match a un renglón (respeta la elección manual del usuario). */
export function applyMatch(line: InvoiceLine, catalog: CatalogItem[]): InvoiceLine {
  if (line.matchManual) {
    return {
      ...line,
      candidates: line.candidates ?? [],
      action: line.action ?? (line.matchCode ? "stock" : "alta_stock"),
    }
  }
  const m = matchLineAgainstCatalog(line, catalog)
  return { ...line, ...m }
}
