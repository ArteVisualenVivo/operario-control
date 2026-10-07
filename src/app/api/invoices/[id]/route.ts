// GET/PATCH/DELETE /api/invoices/[id] — lectura, edición (con re-match
// contra catálogo) y descarte de una factura en revisión.
import { NextResponse } from "next/server"
import type { InvoiceLine, InvoiceRecord, InvoiceStatus } from "@/types/invoice"
import { getInvoice, putInvoice, deleteInvoice } from "@/lib/invoices/store"
import { applyMatch, loadCatalog } from "@/lib/invoices/matchArticles"
import { parseNumAR, round2 } from "@/lib/invoices/parseInvoice"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STATUSES: InvoiceStatus[] = ["review", "confirmed", "error"]

interface PatchBody {
  provider?: string | null
  providerCuit?: string | null
  invoiceNumber?: string | null
  invoiceDate?: string | null
  invoiceDateRaw?: string | null
  subtotal?: number | null
  iva?: number | null
  total?: number | null
  status?: string
  lines?: unknown[]
}

function normalizeLine(raw: unknown, index: number): InvoiceLine | null {
  if (!raw || typeof raw !== "object") return null
  const l = raw as Record<string, unknown>
  const description = typeof l.description === "string" ? l.description.trim().slice(0, 200) : ""
  if (!description) return null
  const quantity = parseNumAR(l.quantity as string | number) ?? 1
  const unitPrice = parseNumAR(l.unitPrice as string | number)
  const explicitTotal = parseNumAR(l.total as string | number)
  const total =
    explicitTotal !== null ? explicitTotal : unitPrice !== null ? round2(quantity * unitPrice) : null
  return {
    id: typeof l.id === "string" && l.id ? l.id : `l${index + 1}`,
    raw: typeof l.raw === "string" && l.raw ? l.raw.slice(0, 300) : description,
    description,
    quantity: quantity > 0 ? quantity : 1,
    unitPrice,
    total,
    code: typeof l.code === "string" && l.code.trim() ? l.code.trim().slice(0, 40) : null,
    matchCode: typeof l.matchCode === "string" ? l.matchCode : null,
    matchName: typeof l.matchName === "string" ? l.matchName : null,
    matchScore: typeof l.matchScore === "number" ? l.matchScore : null,
    action:
      l.action === "stock" || l.action === "alta_stock" || l.action === "sin_catalogo"
        ? l.action
        : undefined,
    candidates: Array.isArray(l.candidates) ? (l.candidates as InvoiceLine["candidates"]) : [],
    matchManual: l.matchManual === true,
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const invoice = await getInvoice(id)
    if (!invoice) {
      return NextResponse.json({ success: false, error: "Factura no encontrada" }, { status: 404 })
    }
    return NextResponse.json({ success: true, invoice })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const current = await getInvoice(id)
    if (!current) {
      return NextResponse.json({ success: false, error: "Factura no encontrada" }, { status: 404 })
    }
    const body = (await request.json()) as PatchBody

    const updated: InvoiceRecord = { ...current, updatedAt: new Date().toISOString() }

    if (typeof body.provider === "string" || body.provider === null)
      updated.provider = body.provider ? body.provider.slice(0, 120) : null
    if (typeof body.providerCuit === "string" || body.providerCuit === null)
      updated.providerCuit = body.providerCuit ? body.providerCuit.slice(0, 20) : null
    if (typeof body.invoiceNumber === "string" || body.invoiceNumber === null)
      updated.invoiceNumber = body.invoiceNumber ? body.invoiceNumber.slice(0, 40) : null
    if (typeof body.invoiceDate === "string" || body.invoiceDate === null)
      updated.invoiceDate = body.invoiceDate || null
    if (typeof body.invoiceDateRaw === "string" || body.invoiceDateRaw === null)
      updated.invoiceDateRaw = body.invoiceDateRaw || null
    if (typeof body.subtotal === "number" || body.subtotal === null) updated.subtotal = body.subtotal
    if (typeof body.iva === "number" || body.iva === null) updated.iva = body.iva
    if (typeof body.total === "number" || body.total === null) updated.total = body.total

    if (Array.isArray(body.lines)) {
      const lines = body.lines
        .map((l, i) => normalizeLine(l, i))
        .filter((l): l is InvoiceLine => l !== null)
      const catalog = await loadCatalog()
      updated.lines = lines.map((l) => applyMatch(l, catalog))
      if (body.total === undefined || body.total === null) {
        const sum = updated.lines.reduce(
          (acc, l) => acc + (l.total ?? (l.quantity || 0) * (l.unitPrice || 0)),
          0,
        )
        updated.total = sum > 0 ? round2(sum) : updated.total
      }
    }

    if (typeof body.status === "string") {
      if (!STATUSES.includes(body.status as InvoiceStatus)) {
        return NextResponse.json({ success: false, error: "Estado inválido" }, { status: 400 })
      }
      updated.status = body.status as InvoiceStatus
      if (updated.status === "confirmed" && !updated.confirmedAt) {
        updated.confirmedAt = new Date().toISOString()
      }
      if (updated.status !== "confirmed") updated.confirmedAt = null
    }

    await putInvoice(updated)
    return NextResponse.json({ success: true, invoice: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    console.error("[API /api/invoices/[id] PATCH]", error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const removed = await deleteInvoice(id)
    if (!removed) {
      return NextResponse.json({ success: false, error: "Factura no encontrada" }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

