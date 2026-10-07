// POST /api/invoices/ingest — crea una factura a partir del texto ya extraído
// (la extracción —pdfjs/OCR— ocurre en el navegador o en el canal carpeta;
// el servidor solo parsea, machea contra catálogo y guarda en Redis).
import { NextResponse } from "next/server"
import { parseInvoiceText } from "@/lib/invoices/parseInvoice"
import { loadCatalog } from "@/lib/invoices/matchArticles"
import { buildInvoiceRecord } from "@/lib/invoices/build"
import { putInvoice } from "@/lib/invoices/store"
import type { InvoiceExtractMethod, InvoiceSource } from "@/types/invoice"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface IngestBody {
  fileName?: string
  fileUrl?: string | null
  source?: string
  method?: string
  ocrConfidence?: number | null
  text?: string
}

const SOURCES: InvoiceSource[] = ["web", "inbox", "email"]
const METHODS: InvoiceExtractMethod[] = ["pdf_text", "ocr", "mixed", "text"]

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as IngestBody
    const text = (body.text ?? "").trim()
    if (text.replace(/\s/g, "").length < 20) {
      return NextResponse.json(
        { success: false, error: "Sin texto extraído: probá con otra foto o el PDF original." },
        { status: 400 },
      )
    }

    const draft = await parseInvoiceText(text)
    const catalog = await loadCatalog()

    const record = buildInvoiceRecord({
      draft,
      fileName: (body.fileName ?? "factura").slice(0, 160),
      fileUrl: body.fileUrl ?? null,
      source: SOURCES.includes(body.source as InvoiceSource) ? (body.source as InvoiceSource) : "web",
      method: METHODS.includes(body.method as InvoiceExtractMethod)
        ? (body.method as InvoiceExtractMethod)
        : "text",
      ocrConfidence: typeof body.ocrConfidence === "number" ? body.ocrConfidence : null,
      rawText: text,
      catalog,
    })

    await putInvoice(record)
    return NextResponse.json({ success: true, invoice: record })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    console.error("[API /api/invoices/ingest]", error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
