// Tipos del módulo de Ingresos: facturas de compra (PDF/escaneo/foto) que
// alimentan el stock. Todo el ciclo vive en Redis (sin Firestore, sin cuota):
//   extracción (navegador) → parseo → revisión → confirmación.

export type InvoiceStatus = "review" | "confirmed" | "error"

export type InvoiceSource = "web" | "inbox" | "email"

/** Cómo se obtuvo el texto de la factura. */
export type InvoiceExtractMethod = "pdf_text" | "ocr" | "mixed" | "text"

/**
 * Qué hacer con el renglón respecto del catálogo de artículos (3C):
 *  - stock:       artículo existente → solo sumar stock
 *  - alta_stock:  artículo nuevo → dar de alta en 3C + sumar stock
 *  - sin_catalogo: no se pudo decidir (catálogo vacío en Redis)
 */
export type InvoiceLineAction = "stock" | "alta_stock" | "sin_catalogo"

/** Candidato del catálogo 3C sugerido para un renglón (para elegir a mano). */
export interface InvoiceLineCandidate {
  code: string
  name: string
  score: number
}

export interface InvoiceLine {
  id: string
  /** Fila original tal cual se extrajo (para depurar). */
  raw: string
  description: string
  quantity: number
  unitPrice?: number | null
  total?: number | null
  /** Código propio de la factura (si el renglón lo traía). */
  code?: string | null
  // —— Match contra catálogo 3C (se recalcula en cada PATCH) ——
  matchCode?: string | null
  matchName?: string | null
  matchScore?: number | null
  action?: InvoiceLineAction
  candidates?: InvoiceLineCandidate[]
  /** true si el usuario eligió/tipeó el match a mano (no se re-auto-matchea). */
  matchManual?: boolean
}

export interface InvoiceRecord {
  id: string
  source: InvoiceSource
  fileName: string
  /** URL en Cloudinary del archivo original (archivo de respaldo). */
  fileUrl?: string | null
  extractMethod: InvoiceExtractMethod
  /** Confianza media del OCR (0-100), null si hubo capa de texto. */
  ocrConfidence?: number | null
  status: InvoiceStatus
  provider?: string | null
  providerCuit?: string | null
  invoiceNumber?: string | null
  /** Fecha ISO (yyyy-mm-dd) si se pudo inferir. */
  invoiceDate?: string | null
  invoiceDateRaw?: string | null
  subtotal?: number | null
  iva?: number | null
  total?: number | null
  currency?: string
  lines: InvoiceLine[]
  warnings: string[]
  /** Texto crudo usado para parsear (depuración, truncado). */
  rawText?: string | null
  createdAt: string
  updatedAt: string
  confirmedAt?: string | null
}

/** Resultado del parser antes de guardarlo (lo arma parseInvoice.ts). */
export interface InvoiceDraft {
  provider: string | null
  providerCuit: string | null
  invoiceNumber: string | null
  /** ISO yyyy-mm-dd o null. */
  invoiceDate: string | null
  invoiceDateRaw: string | null
  subtotal: number | null
  iva: number | null
  total: number | null
  lines: InvoiceLine[]
  warnings: string[]
  parser: "heuristica" | "gemini"
}
