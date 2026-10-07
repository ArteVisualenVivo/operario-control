// parseInvoice.ts — De texto cruto (capa de texto del PDF u OCR) a un
// InvoiceDraft listo para la pantalla de revisión.
//
// Estrategia (100% gratuita):
//   1. Si existe GEMINI_API_KEY (free tier de Google, OPCIONAL) → intenta
//      extraer con el LLM y valida el resultado.
//   2. Siempre hay fallback heurístico local sin costo: números en formato
//      argentino (1.234,56), encabezado (proveedor / CUIT / fecha / nro),
//      renglones (cantidad · descripción · precio unitario · total) y totales.
//
// El parser PROPONE: la pantalla de revisión es la que corrige y confirma.
import type { InvoiceDraft, InvoiceLine } from "@/types/invoice"

// ---------------------------------------------------------------------------
// Números (formato AR "1.234,56", también acepta "1,234.56" de OCR)
// ---------------------------------------------------------------------------

export function parseNumAR(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (raw === null || raw === undefined) return null
  let s = String(raw).replace(/[^\d.,-]/g, "").trim()
  if (!s || s === "-" || s === ",") return null

  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")
  if (lastComma >= 0 && lastDot >= 0) {
    // Los dos separadores: el último es el decimal, el otro es de miles.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(/,/g, ".")
    else s = s.replace(/,/g, "")
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1
    const commas = (s.match(/,/g) || []).length
    if (commas > 1 || decimals === 3) s = s.replace(/,/g, "") // miles: 1,234 / 1,234,567
    else s = s.replace(/,/g, ".") // decimal: 45,00
  } else if (lastDot >= 0) {
    const decimals = s.length - lastDot - 1
    const dots = (s.match(/\./g) || []).length
    if (dots > 1 || decimals === 3) s = s.replace(/\./g, "") // miles: 1.234.567 / 1.234
    // 1 punto con 1-2 decimales → decimal (45.50), con 3 → miles (45.000)
  }

  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

const MONTHS_ES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function buildIso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100) return null
  if (m > 12 && d <= 12) [m, d] = [d, m] // OCR confundió orden (estilo US)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** "15/06/2026", "15-6-26", "2026-06-15", "15 de junio de 2026" → ISO. */
export function normalizeDateValue(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ")
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return buildIso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) {
    let y = +m[3]
    if (y < 100) y += 2000
    return buildIso(y, +m[2], +m[1]) // d/m/a (formato AR)
  }
  m = s.match(/^(\d{1,2})\s+de\s+([a-záéíóúüñ]+)(?:\s+de)?\s+(\d{4})$/i)
  if (m) {
    const month = MONTHS_ES[m[2].toLowerCase()]
    if (month) return buildIso(+m[3], month, +m[1])
  }
  return null
}

// ---------------------------------------------------------------------------
// Tokens numéricos de un renglón
// ---------------------------------------------------------------------------

interface NumTok {
  raw: string
  start: number
  end: number
  v: number
  /** Pegado a una letra ("HM1812"): pertenece a la descripción, no al bloque. */
  attached: boolean
}

function findNumTokens(line: string): NumTok[] {
  const out: NumTok[] = []
  const re = /\d[\d.,]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const start = m.index
    const end = start + m[0].length
    const prevChar = start > 0 ? line[start - 1] : ""
    const nextChar = end < line.length ? line[end] : ""
    // "pegado" = tocado por una letra de cualquier lado ("HM1812", "20L"):
    // esos números son parte de la descripción, no del bloque de dinero.
    const attached = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(prevChar) || /[A-Za-z]/.test(nextChar)
    const v = parseNumAR(m[0])
    if (v === null) continue
    out.push({ raw: m[0], start, end, v, attached })
  }
  return out
}

// ---------------------------------------------------------------------------
// Filtros de filas que NO son renglones de mercadería
// ---------------------------------------------------------------------------

const NOT_ITEM =
  /\b(subtotal|gran total|total|iva|impuesto|cae|vencimien|condic|discrimin|bonificaci|remito|forma de pago|cuit|cuil|domicilio|raz[óo]n social|factura|nota de|pedido n|orden de compra|percepci|intereses|responsable|monotributo|neto gravado|no gravado|exento|cant(?:idad)?\.?|descripci[óo]n|precio\s+unit|importe|contado|cr[ée]dito|transferencia|observacion|p[áa]gina|fecha|hora)\b/i

const LETTER_RE = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/
const QTY_MAX = 999

/** Palabras de unidad que siguen a la cantidad ("2 UNIDADES …"). */
const UNIT_AFTER_QTY =
  /^\s*(?:u|un|unid\.?|und\.?|unidades?|pza|pzas|kg|g|l|ml|m|mt|par|jgo|cjta|rollo|metros?)\b/i

const isSmallQty = (t: NumTok): boolean =>
  !t.attached &&
  Number.isInteger(t.v) &&
  t.v >= 1 &&
  t.v <= QTY_MAX &&
  t.raw.length <= 4 &&
  !/[.,]/.test(t.raw)

function trimDesc(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+\d{1,2}\/?\d{0,2}$/, "") // restos de fracciones ("8x1 1/")
    .replace(/^[\/\-\s]+|[\/\-\s]+$/g, "")
    .trim()
}

/**
 * Construye un renglón de factura a partir de UNA línea de texto, o null si
 * la línea no tiene forma de renglón (encabezados, totales, ruido de OCR).
 *
 * Formatos aceptados (los tres habituales en facturas AR):
 *   L1  "24 TORNILLO AUTOPERFORANTE 8x1 85,50 2.052,00"
 *   L2  "PISON CANGURO MACROMAQ 2 45.000,00 90.000,00"
 *   L3  "22004 PISON CANGURO 2 45.000,00 90.000,00"   (con código)
 */
export function extractItemLine(line: string, id: string): InvoiceLine | null {
  if (!line || line.length < 5 || line.length > 300) return null
  if (NOT_ITEM.test(line)) return null

  const tokens = findNumTokens(line)
  if (tokens.length < 2) return null

  // —— Bloque de dinero: sufijo numérico con gaps sin letras (desde el fin) ——
  const suffix: NumTok[] = []
  for (let i = tokens.length - 1; i >= 0 && suffix.length < 5; i--) {
    const tok = tokens[i]
    if (suffix.length > 0) {
      const next = suffix[0]
      const gap = line.slice(tok.end, next.start)
      if (tok.attached || /[A-Za-z]/.test(gap)) break
    } else if (tok.attached) {
      break
    }
    suffix.unshift(tok)
  }
  if (suffix.length === 0) return null

  const consumed: Array<[number, number]> = suffix.map((t) => [t.start, t.end])
  let code: string | null = null
  let quantity: number | null = null
  let qtyTok: NumTok | null = null

  // 1) Cantidad al inicio (L1): el renglón empieza con la cantidad.
  const firstPlain = tokens.find((t) => !t.attached)
  if (firstPlain && isSmallQty(firstPlain)) {
    const onlySpaceBefore = line.slice(0, firstPlain.start).trim() === ""
    const afterQty = line.slice(firstPlain.end).replace(/^\s+/, "")
    if (onlySpaceBefore && LETTER_RE.test(afterQty[0] || "")) {
      quantity = firstPlain.v
      qtyTok = firstPlain
      consumed.push([firstPlain.start, firstPlain.end])
    }
  }

  // 2) Código al frente (solo si la primera "palabra" tiene dígitos).
  const head = line.slice(0, suffix[0].start)
  const wm = head.match(/^\s*([A-Za-z0-9][\w./-]{0,23})\s+/)
  if (wm && /\d/.test(wm[1]) && !/^\d{1,3}$/.test(wm[1])) {
    const after = line.slice(wm[0].length)
    if (LETTER_RE.test(after)) {
      code = wm[1]
      consumed.push([0, wm[0].length])
    }
  }

  // 3) Cantidad desde el frente del bloque de dinero (L2/L3): entero chico.
  if (quantity === null && suffix.length >= 2 && isSmallQty(suffix[0])) {
    const t = suffix.shift()
    if (t) {
      quantity = t.v
      qtyTok = t
    }
  }

  // 4) Cantidad con palabra de unidad detrás ("2 UNIDADES …").
  if (quantity === null) {
    const moneyStart = suffix.length > 0 ? suffix[0].start : line.length
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i]
      if (t.end > moneyStart || t.attached || !isSmallQty(t)) continue
      const rest = line.slice(t.end, moneyStart)
      if (UNIT_AFTER_QTY.test(rest)) {
        quantity = t.v
        qtyTok = t
        consumed.push([t.start, t.end])
        break
      }
    }
  }

  // 5) Cantidad implícita (1).
  if (quantity === null) quantity = 1

  // —— Dinero: penúltimo = precio unitario, último = total ——
  let unitPrice: number | null = null
  let total: number | null = null
  if (suffix.length === 1) {
    // Un solo número: solo sirve si la cantidad es clara.
    if (qtyTok === null) return null
    unitPrice = suffix[0].v
    total = round2(quantity * unitPrice)
  } else if (suffix.length >= 2) {
    unitPrice = suffix[suffix.length - 2].v
    total = suffix[suffix.length - 1].v
    if (unitPrice === 0) return null
    // Reparación: total ÷ pu da una cantidad entera distinta → manda el total
    // (evita confundir fracciones del "8x1 1/2" con la cantidad).
    if (total > 0 && unitPrice > 0 && quantity > 0) {
      const implied = total / unitPrice
      if (
        Math.abs(implied - quantity) / Math.max(quantity, 1) > 0.02 &&
        Math.abs(implied - Math.round(implied)) < 0.02 &&
        implied >= 1 &&
        implied <= 100000
      ) {
        quantity = Math.round(implied)
      }
    }
  } else {
    return null // sin dinero no hay renglón
  }

  // —— Descripción: la línea con los rangos consumidos en blanco ——
  const ranges = [...consumed].sort((a, b) => a[0] - b[0])
  let desc = ""
  let pos = 0
  for (const [s, e] of ranges) {
    if (s < pos) continue
    desc += line.slice(pos, s) + " "
    pos = e
  }
  desc += line.slice(pos)
  desc = trimDesc(desc)

  // Código colgado al frente de la descripción.
  if (!code) {
    const wm2 = desc.match(/^([A-Za-z0-9][\w./-]{0,23})\s+(.+)$/)
    if (wm2 && /\d/.test(wm2[1]) && !/^\d{1,3}$/.test(wm2[1]) && LETTER_RE.test(wm2[2])) {
      code = wm2[1]
      desc = trimDesc(wm2[2])
    }
  }

  if (!desc || desc.length < 3 || !LETTER_RE.test(desc)) return null
  if (NOT_ITEM.test(desc)) return null
  if (/:\s*$/.test(desc)) return null // etiqueta de campo ("Fecha de emisión:")
  if (quantity <= 0 || (unitPrice !== null && unitPrice < 0)) return null

  return {
    id,
    raw: line,
    description: desc.slice(0, 200),
    quantity,
    unitPrice,
    total,
    code,
  }
}

// ---------------------------------------------------------------------------
// Encabezado: proveedor, CUIT, fecha y número de factura
// ---------------------------------------------------------------------------

const CUIT_RE = /\b\d{2}[-.\s]?\d{8}[-.\s]?\d\b/
const PKEY =
  /(s\.?\s?r\.?\s?l|s\.?a\.?\b|s\.?a\.?s|e\.?\s?i\.?\s?r\.?\s?l|l\.?t\.?d\.?a|c\.?i\.?a\b|s\.?c\.?s|limitada|an[óo]nima|sociedad|cooperativa)/i
const BKEY =
  /(repuesto|herramient|distribu|suministr|ferre|maquin|construcc|alquiler|equipo|industrial|comercial|import|export|rodamient|seller|pintura|metal|mader|plastic|el[eé]ctric|neum|soldad|taller|industrias|proyectos|servicios|abastec|automat|hidraul|pneum|tecnolog|papel|grafit|seguridad)/i

function formatCuit(digits: string): string {
  if (digits.length !== 11) return digits
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
}

interface InvoiceHeader {
  provider: string | null
  providerCuit: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  invoiceDateRaw: string | null
}

function parseHeader(lines: string[]): InvoiceHeader {
  const headEnd = Math.min(lines.length, Math.max(8, Math.ceil(lines.length * 0.4)))
  const head = lines.slice(0, headEnd)
  const headText = head.join("\n")

  // —— CUIT ——
  let providerCuit: string | null = null
  let cuitIdx = -1
  for (let i = 0; i < head.length; i++) {
    const m = head[i].match(CUIT_RE)
    if (m) {
      const digits = m[0].replace(/\D/g, "")
      if (digits.length === 11) {
        providerCuit = formatCuit(digits)
        cuitIdx = i
        break
      }
    }
  }

  // —— Proveedor: palabra clave + cercanía al CUIT + MAYÚSCULAS ——
  let provider: string | null = null
  let bestScore = -1
  head.forEach((line, i) => {
    const t = line.trim()
    if (t.length < 4 || t.length > 95) return
    if (NOT_ITEM.test(t)) return
    const digits = (t.match(/\d/g) || []).length
    if (digits > t.length * 0.25) return
    let score = 0
    if (PKEY.test(t)) score += 4
    if (BKEY.test(t)) score += 2
    if (cuitIdx >= 0 && Math.abs(i - cuitIdx) <= 2) score += 2
    const letters = t.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "")
    if (letters.length >= 5 && letters === letters.toUpperCase()) score += 1
    if (score > bestScore) {
      bestScore = score
      provider = t
    }
  })
  if (bestScore < 2) {
    const near = cuitIdx >= 0 ? lines.slice(Math.max(0, cuitIdx - 2), cuitIdx + 3) : head
    provider =
      near.find((l) => {
        const t = l.trim()
        return (
          t.length >= 4 &&
          t.length <= 95 &&
          !NOT_ITEM.test(t) &&
          /\s/.test(t) &&
          (t.match(/\d/g) || []).length === 0
        )
      })?.trim() ?? null
  }

  // —— Fecha: etiqueta, luego forma larga, luego cualquier dd/mm/aa ——
  let invoiceDateRaw: string | null = null
  const LBL_DATE =
    /(?:fecha(?:\s+de\s+emisi[óo]n)?|emisi[óo]n|f\.?\s?emis(?:i[óo]n)?)\s*[:\-]?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i
  for (const l of head) {
    const m = l.match(LBL_DATE)
    if (m) {
      invoiceDateRaw = m[1]
      break
    }
  }
  if (!invoiceDateRaw) {
    const LONG_DATE = /(\d{1,2})\s+de\s+([a-záéíóúüñ]+)(?:\s+de)?\s+(\d{4})/i
    for (const l of head) {
      const m = l.match(LONG_DATE)
      if (m) {
        invoiceDateRaw = `${m[1]} de ${m[2]} de ${m[3]}`
        break
      }
    }
  }
  if (!invoiceDateRaw) {
    const ANY_DATE = /\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b/
    for (const l of head) {
      const rest = l.replace(CUIT_RE, "")
      const m = rest.match(ANY_DATE)
      if (m && normalizeDateValue(m[1])) {
        invoiceDateRaw = m[1]
        break
      }
    }
  }
  const invoiceDate = invoiceDateRaw ? normalizeDateValue(invoiceDateRaw) : null

  // —— Número de comprobante ——
  let invoiceNumber: string | null = null
  let m = headText.match(
    /\b(?:factura|f\.?c\.?a\.?|fca|nota de cr[ée]dito|remito|pedido|orden de compra|comprobante)\b[^\nA-Z0-9]{0,25}?([A-F])\s*(\d{3,4}\s*[-–]\s*\d{6,8})/i,
  )
  if (m) invoiceNumber = `${m[1].toUpperCase()} ${m[2].replace(/\s+/g, "")}`
  if (!invoiceNumber) {
    m = headText.match(/(?:^|[\s])([A-F])\s(\d{4}\s*[-–]\s*\d{7,8})\b/)
    if (m) invoiceNumber = `${m[1]} ${m[2].replace(/\s+/g, "")}`
  }
  if (!invoiceNumber) {
    m = headText.match(/\b(\d{4}\s*[-–]\s*\d{7,8})\b/)
    if (m) invoiceNumber = m[1].replace(/\s+/g, "")
  }

  return { provider, providerCuit, invoiceNumber, invoiceDate, invoiceDateRaw }
}

// ---------------------------------------------------------------------------
// Totales
// ---------------------------------------------------------------------------

interface InvoiceTotals {
  subtotal: number | null
  iva: number | null
  total: number | null
}

function parseTotals(text: string): InvoiceTotals {
  const find = (source: string, re: RegExp): number | null => {
    const m = source.match(re)
    return m ? parseNumAR(m[1]) : null
  }

  const subtotal = find(text, /SUBTOTAL[^\d$-]{0,30}\$?\s*(-?\d[\d.,]*)/i)

  let iva: number | null = null
  const withRate = text.match(
    /\bIVA\b\s*\(?\s*\d{1,3}(?:[.,]\d{1,2})?\s*%\s*\)?\s*[:\-]?\s*\$?\s*(-?\d[\d.,]*)/i,
  )
  if (withRate) iva = parseNumAR(withRate[1])
  if (iva === null) {
    const alt = text.match(/\bIVA\b[^\d$]{0,20}\$?\s*(-?\d[\d.,]*)/i)
    if (alt) {
      const v = parseNumAR(alt[1])
      // "IVA 21" sin monto:21 es la tasa, no el impuesto.
      iva = v !== null && v <= 40 && !/[.,]/.test(alt[1]) ? null : v
    }
  }

  // Proteger SUBTOTAL para que no lo capture el buscador de "TOTAL".
  const protectedText = text.replace(/SUB\s*TOTAL/gi, "*****")
  const total =
    find(protectedText, /TOTAL\s+A\s+PAGAR[^\d$]{0,25}\$?\s*(-?\d[\d.,]*)/i) ??
    find(protectedText, /(?:^|\n)\s*(?:GRAN\s+)?TOTAL\s*[:\-]?\s*\$?\s*(-?\d[\d.,]*)/im) ??
    find(protectedText, /\bTOTAL\b[^\d$]{0,25}\$?\s*(-?\d[\d.,]*)/i)

  return { subtotal, iva, total: total !== null && total > 0 ? total : null }
}

// ---------------------------------------------------------------------------
// Parser heurístico local (siempre disponible, sin costo)
// ---------------------------------------------------------------------------

function fmtMoney(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseWithHeuristics(raw: string): InvoiceDraft {
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)

  const header = parseHeader(lines)

  const linesParsed: InvoiceLine[] = []
  for (const line of lines) {
    if (linesParsed.length >= 100) break
    const parsed = extractItemLine(line, `l${linesParsed.length + 1}`)
    if (parsed) linesParsed.push(parsed)
  }

  const totals = parseTotals(raw)
  const warnings: string[] = []
  if (linesParsed.length === 0)
    warnings.push("No se detectaron renglones: cargalos a mano en la revisión.")
  if (!header.invoiceDate) warnings.push("No se detectó la fecha de la factura.")
  if (!header.provider) warnings.push("No se detectó el proveedor.")
  if (!header.invoiceNumber) warnings.push("No se detectó el número de comprobante.")

  const sum = linesParsed.reduce(
    (acc, l) => acc + (l.total ?? (l.quantity || 0) * (l.unitPrice || 0)),
    0,
  )
  let total = totals.total
  if (total === null && linesParsed.length > 0) total = round2(sum)
  // Comparar contra el neto: subtotal si existe; si no, total menos IVA
  // (si no, el IVA parecería una discrepancia de renglones).
  const ref =
    totals.subtotal !== null
      ? totals.subtotal
      : total !== null && totals.iva !== null
        ? total - totals.iva
        : total
  if (ref !== null && sum > 0 && ref > 0 && Math.abs(sum - ref) / ref > 0.15) {
    warnings.push(
      `Los renglones suman $${fmtMoney(sum)} y el neto de la factura es $${fmtMoney(ref)}: revisar.`,
    )
  }

  return {
    provider: header.provider,
    providerCuit: header.providerCuit,
    invoiceNumber: header.invoiceNumber,
    invoiceDate: header.invoiceDate,
    invoiceDateRaw: header.invoiceDateRaw,
    subtotal: totals.subtotal,
    iva: totals.iva,
    total,
    lines: linesParsed,
    warnings,
    parser: "heuristica",
  }
}

// ---------------------------------------------------------------------------
// Gemini FREE TIER (opcional: solo si hay GEMINI_API_KEY en el entorno)
// ---------------------------------------------------------------------------

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") return parseNumAR(v)
  return null
}

async function parseWithGemini(raw: string): Promise<InvoiceDraft | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash"

  const prompt = `Sos un extractor de facturas de compra argentinas. Del texto abajo, devolvé SOLO JSON válido (sin markdown, sin tres comillas), con esta forma exacta:
{"provider": string|null, "providerCuit": string|null, "invoiceNumber": string|null, "invoiceDate": "YYYY-MM-DD"|null, "subtotal": number|null, "iva": number|null, "total": number|null, "lines": [{"description": string, "quantity": number, "unitPrice": number, "code": string|null}]}
Reglas: quantity y unitPrice son números con punto decimal (ej. 45000). Solo incluí renglones reales de productos comprados. Si no hay dato usá null. No inventes.
TEXTO:
${raw.slice(0, 12000)}`

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(30000),
      },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error("sin candidatos")
    const json = JSON.parse(text) as {
      provider?: unknown
      providerCuit?: unknown
      invoiceNumber?: unknown
      invoiceDate?: unknown
      subtotal?: unknown
      iva?: unknown
      total?: unknown
      lines?: unknown
    }
    if (!Array.isArray(json.lines)) throw new Error("sin lines")
    const lines: InvoiceLine[] = []
    for (const [i, rl] of json.lines.entries()) {
      const l = rl as {
        description?: unknown
        quantity?: unknown
        unitPrice?: unknown
        code?: unknown
      }
      const description = typeof l.description === "string" ? l.description.trim() : ""
      const quantity = toNum(l.quantity)
      const unitPrice = toNum(l.unitPrice)
      if (!description || quantity === null || quantity <= 0 || unitPrice === null) continue
      lines.push({
        id: `l${i + 1}`,
        raw: description,
        description: description.slice(0, 200),
        quantity,
        unitPrice: round2(unitPrice),
        total: round2(quantity * round2(unitPrice)),
        code: typeof l.code === "string" && l.code.trim() ? l.code.trim() : null,
      })
    }
    if (lines.length === 0) throw new Error("lines vacías")
    const warnings: string[] = []
    if (!json.invoiceDate) warnings.push("No se detectó la fecha de la factura.")
    if (typeof json.provider !== "string" || !json.provider.trim())
      warnings.push("No se detectó el proveedor.")
    return {
      provider: typeof json.provider === "string" ? json.provider.trim().slice(0, 120) : null,
      providerCuit:
        typeof json.providerCuit === "string" && json.providerCuit.trim()
          ? json.providerCuit.trim()
          : null,
      invoiceNumber:
        typeof json.invoiceNumber === "string" && json.invoiceNumber.trim()
          ? json.invoiceNumber.trim()
          : null,
      invoiceDate:
        typeof json.invoiceDate === "string" && normalizeDateValue(json.invoiceDate)
          ? normalizeDateValue(json.invoiceDate)
          : null,
      invoiceDateRaw: typeof json.invoiceDate === "string" ? json.invoiceDate : null,
      subtotal: toNum(json.subtotal),
      iva: toNum(json.iva),
      total: toNum(json.total),
      lines,
      warnings,
      parser: "gemini",
    }
  } catch (err) {
    console.warn(
      "[parseInvoice] Gemini falló, sigo con heurísticas:",
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

// ---------------------------------------------------------------------------
// Orquestador público
// ---------------------------------------------------------------------------

export async function parseInvoiceText(text: string): Promise<InvoiceDraft> {
  const cleaned = text.replace(/\r\n?/g, "\n")
  const viaGemini = await parseWithGemini(cleaned)
  if (viaGemini) return viaGemini

  const draft = parseWithHeuristics(cleaned)
  if (draft.lines.length === 0 && cleaned.replace(/\s/g, "").length < 40) {
    draft.warnings.push(
      "El texto extraído está casi vacío: probá con otra foto o el PDF original.",
    )
  }
  return draft
}





