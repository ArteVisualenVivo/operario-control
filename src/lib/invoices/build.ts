// build.ts — Construcción del InvoiceRecord compartida por la API web
// (POST /api/invoices/ingest) y por el canal carpeta (scripts/inbox-ingest.ts),
// para que ambos caminos generen exactamente el mismo registro.
import type {
  InvoiceDraft,
  InvoiceExtractMethod,
  InvoiceRecord,
  InvoiceSource,
} from "@/types/invoice"
import { applyMatch, type CatalogItem } from "./matchArticles"

export interface BuildInvoiceInput {
  draft: InvoiceDraft
  fileName: string
  fileUrl?: string | null
  source: InvoiceSource
  method: InvoiceExtractMethod
  ocrConfidence?: number | null
  rawText: string
  catalog: CatalogItem[]
}

export function buildInvoiceRecord(input: BuildInvoiceInput): InvoiceRecord {
  const now = new Date().toISOString()
  return {
    id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: input.source,
    fileName: input.fileName,
    fileUrl: input.fileUrl ?? null,
    extractMethod: input.method,
    ocrConfidence:
      typeof input.ocrConfidence === "number" ? Math.round(input.ocrConfidence) : null,
    status: "review",
    provider: input.draft.provider,
    providerCuit: input.draft.providerCuit,
    invoiceNumber: input.draft.invoiceNumber,
    invoiceDate: input.draft.invoiceDate,
    invoiceDateRaw: input.draft.invoiceDateRaw,
    subtotal: input.draft.subtotal,
    iva: input.draft.iva,
    total: input.draft.total,
    currency: "ARS",
    lines: input.draft.lines.map((l) => applyMatch(l, input.catalog)),
    warnings: [...input.draft.warnings],
    rawText: input.rawText.slice(0, 20000),
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
  }
}
