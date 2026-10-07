"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtARS, fmtDateTime } from "@/lib/invoices/format"
import { parseNumAR, round2 } from "@/lib/invoices/parseInvoice"
import type {
  InvoiceLine,
  InvoiceLineAction,
  InvoiceLineCandidate,
  InvoiceRecord,
} from "@/types/invoice"

const METHOD_LABEL: Record<string, string> = {
  pdf_text: "texto del PDF",
  ocr: "OCR (escaneo/foto)",
  mixed: "PDF + OCR",
  text: "texto",
}

const ACTION_BADGE: Record<
  Exclude<InvoiceLineAction, undefined>,
  { label: string; variant: "success" | "warning" | "outline" }
> = {
  stock: { label: "EXISTE", variant: "success" },
  alta_stock: { label: "NUEVO", variant: "warning" },
  sin_catalogo: { label: "SIN CATÁLOGO", variant: "outline" },
}

interface LineDraft {
  key: string
  id?: string
  raw?: string
  description: string
  quantity: string
  unitPrice: string
  total: number | null
  code: string
  matchCode: string | null
  matchName: string | null
  matchScore: number | null
  action?: InvoiceLineAction
  candidates: InvoiceLineCandidate[]
  matchManual: boolean
}

interface HeaderDraft {
  provider: string
  providerCuit: string
  invoiceNumber: string
  invoiceDate: string
  subtotal: string
  iva: string
  total: string
}

function lineToDraft(l: InvoiceLine, i: number): LineDraft {
  return {
    key: l.id || `k${i}`,
    id: l.id,
    raw: l.raw,
    description: l.description ?? "",
    quantity: l.quantity !== undefined && l.quantity !== null ? String(l.quantity) : "1",
    unitPrice: l.unitPrice !== undefined && l.unitPrice !== null ? String(l.unitPrice) : "",
    total: l.total ?? null,
    code: l.code ?? "",
    matchCode: l.matchCode ?? null,
    matchName: l.matchName ?? null,
    matchScore: l.matchScore ?? null,
    action: l.action,
    candidates: l.candidates ?? [],
    matchManual: l.matchManual === true,
  }
}

function invoiceToState(inv: InvoiceRecord): { header: HeaderDraft; lines: LineDraft[] } {
  return {
    header: {
      provider: inv.provider ?? "",
      providerCuit: inv.providerCuit ?? "",
      invoiceNumber: inv.invoiceNumber ?? "",
      invoiceDate: inv.invoiceDate ?? "",
      subtotal: inv.subtotal !== null && inv.subtotal !== undefined ? String(inv.subtotal) : "",
      iva: inv.iva !== null && inv.iva !== undefined ? String(inv.iva) : "",
      total: inv.total !== null && inv.total !== undefined ? String(inv.total) : "",
    },
    lines: inv.lines.map((l, i) => lineToDraft(l, i)),
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function normDateInput(s: string): string | null {
  const v = s.trim()
  if (!v) return null
  const m = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) {
    let y = +m[3]
    if (y < 100) y += 2000
    return `${y}-${pad2(+m[2])}-${pad2(+m[1])}`
  }
  return v
}

export default function IngresoDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null)
  const [header, setHeader] = useState<HeaderDraft | null>(null)
  const [lines, setLines] = useState<LineDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const applyInvoice = useCallback((inv: InvoiceRecord) => {
    const s = invoiceToState(inv)
    setInvoice(inv)
    setHeader(s.header)
    setLines(s.lines)
    setDirty(false)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/invoices/${params.id}`)
        const data = await res.json()
        if (!alive) return
        if (!res.ok || !data.success || !data.invoice) {
          toast.error(data.error ?? "Factura no encontrada")
          router.push("/ingresos")
          return
        }
        applyInvoice(data.invoice as InvoiceRecord)
      } catch (err) {
        console.error("[ingresos/[id]] load:", err)
        toast.error("No se pudo cargar la factura")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [params.id, router, applyInvoice])

  const setHeaderField = (k: keyof HeaderDraft, v: string) => {
    setHeader((h) => (h ? { ...h, [k]: v } : h))
    setDirty(true)
  }

  const setLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    setDirty(true)
  }

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        description: "",
        quantity: "1",
        unitPrice: "",
        total: null,
        code: "",
        matchCode: null,
        matchName: null,
        matchScore: null,
        action: "alta_stock",
        candidates: [],
        matchManual: true,
      },
    ])
    setDirty(true)
  }

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key))
    setDirty(true)
  }

  const save = async (extra?: { status?: "confirmed" }): Promise<InvoiceRecord | null> => {
    if (!invoice || !header) return null
    setSaving(true)
    try {
      const payloadLines = lines
        .filter((l) => l.description.trim())
        .map((l) => {
          const qty = parseNumAR(l.quantity) ?? 1
          const pu = parseNumAR(l.unitPrice)
          return {
            id: l.id,
            raw: l.raw,
            description: l.description.trim(),
            quantity: qty,
            unitPrice: pu,
            total: pu !== null ? round2(qty * pu) : null,
            code: l.code.trim() || null,
            matchCode: l.matchCode,
            matchName: l.matchName,
            matchScore: l.matchScore,
            action: l.action,
            candidates: l.candidates,
            matchManual: l.matchManual,
          }
        })
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: header.provider.trim() || null,
          providerCuit: header.providerCuit.trim() || null,
          invoiceNumber: header.invoiceNumber.trim() || null,
          invoiceDate: normDateInput(header.invoiceDate),
          invoiceDateRaw: header.invoiceDate.trim() || null,
          subtotal: parseNumAR(header.subtotal),
          iva: parseNumAR(header.iva),
          total: parseNumAR(header.total),
          lines: payloadLines,
          ...(extra?.status ? { status: extra.status } : {}),
        }),
      })
      const data = (await res.json()) as {
        success?: boolean
        error?: string
        invoice?: InvoiceRecord
      }
      if (!res.ok || !data.success || !data.invoice) {
        throw new Error(data.error ?? "No se pudo guardar")
      }
      applyInvoice(data.invoice)
      return data.invoice
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar")
      return null
    } finally {
      setSaving(false)
    }
  }

  const confirmInvoice = async () => {
    const invalid = lines.filter(
      (l) => l.description.trim() && (parseNumAR(l.quantity) ?? 0) <= 0,
    )
    if (invalid.length > 0) {
      toast.error("Hay renglones con cantidad inválida")
      return
    }
    const saved = await save({ status: "confirmed" })
    if (saved) {
      toast.success("Factura confirmada ✓")
      router.push("/ingresos")
    }
  }

  const discard = async () => {
    if (!invoice) return
    if (!window.confirm("¿Descartar esta factura? No se puede deshacer.")) return
    setSaving(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error ?? "No se pudo descartar")
      toast.success("Factura descartada")
      router.push("/ingresos")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo descartar")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando factura…</p>
  }
  if (!invoice || !header) {
    return <p className="text-sm text-muted-foreground">Factura no encontrada.</p>
  }

  const sumLines = lines.reduce((acc, l) => {
    const qty = parseNumAR(l.quantity) ?? 0
    const pu = parseNumAR(l.unitPrice) ?? 0
    return acc + qty * pu
  }, 0)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {/* Título + acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-primary"
            onClick={() => router.push("/ingresos")}
          >
            ← Volver a Ingresos
          </button>
          <h1 className="text-xl font-bold">
            {invoice.provider ?? "Proveedor sin detectar"}
            {invoice.invoiceNumber ? ` — ${invoice.invoiceNumber}` : ""}
          </h1>
          <p className="text-xs text-muted-foreground">
            {invoice.fileName} · extracción: {METHOD_LABEL[invoice.extractMethod] ?? invoice.extractMethod}
            {invoice.ocrConfidence !== null && invoice.ocrConfidence !== undefined
              ? ` (confianza ${invoice.ocrConfidence}%)`
              : ""}{" "}
            · ingresada {fmtDateTime(invoice.createdAt)}
            {invoice.fileUrl ? (
              <>
                {" · "}
                <a
                  href={invoice.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-primary"
                >
                  ver archivo original
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
          <Button
            disabled={saving}
            onClick={() => void confirmInvoice()}
            title="Aprueba la factura y queda registrada como ingresada"
          >
            Confirmar ingreso ✓
          </Button>
          <Button variant="destructive" disabled={saving} onClick={() => void discard()}>
            Descartar
          </Button>
        </div>
      </div>

      {/* Avisos del parser */}
      {invoice.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="mb-1 font-semibold">Revisar:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {invoice.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Encabezado editable */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border p-4 md:grid-cols-4">
        <div className="col-span-2">
          <Label htmlFor="provider">Proveedor</Label>
          <Input
            id="provider"
            value={header.provider}
            onChange={(e) => setHeaderField("provider", e.target.value)}
            placeholder="Nombre del proveedor"
          />
        </div>
        <div>
          <Label htmlFor="cuit">CUIT</Label>
          <Input
            id="cuit"
            value={header.providerCuit}
            onChange={(e) => setHeaderField("providerCuit", e.target.value)}
            placeholder="30-12345678-9"
          />
        </div>
        <div>
          <Label htmlFor="fnum">N° comprobante</Label>
          <Input
            id="fnum"
            value={header.invoiceNumber}
            onChange={(e) => setHeaderField("invoiceNumber", e.target.value)}
            placeholder="A 0001-00012345"
          />
        </div>
        <div>
          <Label htmlFor="fdate">Fecha</Label>
          <Input
            id="fdate"
            value={header.invoiceDate}
            onChange={(e) => setHeaderField("invoiceDate", e.target.value)}
            placeholder="15/06/2026"
          />
        </div>
        <div>
          <Label htmlFor="subtotal">Subtotal</Label>
          <Input
            id="subtotal"
            value={header.subtotal}
            onChange={(e) => setHeaderField("subtotal", e.target.value)}
            placeholder="0,00"
          />
        </div>
        <div>
          <Label htmlFor="iva">IVA</Label>
          <Input
            id="iva"
            value={header.iva}
            onChange={(e) => setHeaderField("iva", e.target.value)}
            placeholder="0,00"
          />
        </div>
        <div>
          <Label htmlFor="total">Total</Label>
          <Input
            id="total"
            value={header.total}
            onChange={(e) => setHeaderField("total", e.target.value)}
            placeholder="0,00"
          />
        </div>
      </div>

      {/* Renglones */}
      <div className="rounded-xl border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Renglones ({lines.length})</h2>
          <Button variant="outline" size="sm" onClick={addLine}>
            + Agregar renglón
          </Button>
        </div>
        {lines.some((l) => l.action === "sin_catalogo") && (
          <p className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
            El catálogo de artículos no está cargado en Redis (corré la sincronización «Artículos»
            de 3C). Mientras tanto los renglones quedan en «sin catálogo».
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-20">Cant.</TableHead>
              <TableHead className="w-32">P. Unit.</TableHead>
              <TableHead className="w-32 text-right">Importe</TableHead>
              <TableHead className="w-56">Artículo 3C</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const qty = parseNumAR(l.quantity) ?? 0
              const pu = parseNumAR(l.unitPrice) ?? 0
              const badge = ACTION_BADGE[l.action ?? "alta_stock"]
              const opts: InvoiceLineCandidate[] = [...l.candidates]
              if (l.matchCode && !opts.some((c) => c.code === l.matchCode)) {
                opts.unshift({ code: l.matchCode, name: l.matchName ?? "", score: 1 })
              }
              return (
                <TableRow key={l.key}>
                  <TableCell>
                    <Input
                      value={l.code}
                      onChange={(e) => setLine(l.key, { code: e.target.value })}
                      placeholder="—"
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={l.description}
                      onChange={(e) => setLine(l.key, { description: e.target.value })}
                      placeholder="Descripción del artículo"
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={l.quantity}
                      onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                      inputMode="decimal"
                      className="h-8 text-right"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={l.unitPrice}
                      onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="h-8 text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtARS(qty * pu)}</TableCell>

                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant={badge.variant} className="w-fit">
                        {badge.label}
                      </Badge>
                      {l.action !== "sin_catalogo" && (
                        <select
                          value={l.action === "stock" && l.matchCode ? l.matchCode : "__new__"}
                          onChange={(e) => {
                            const v = e.target.value
                            if (v === "__new__") {
                              setLine(l.key, {
                                matchCode: null,
                                matchName: null,
                                matchScore: null,
                                action: "alta_stock",
                                matchManual: true,
                              })
                            } else {
                              const c = opts.find((x) => x.code === v)
                              if (c) {
                                setLine(l.key, {
                                  matchCode: c.code,
                                  matchName: c.name,
                                  matchScore: c.score,
                                  action: "stock",
                                  matchManual: true,
                                })
                              }
                            }
                          }}
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                        >
                          <option value="__new__">Nuevo artículo (alta + stock)</option>
                          {opts.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code ? `${c.code} — ` : ""}
                              {c.name || "(sin nombre)"}
                              {c.score < 1 ? ` (${Math.round(c.score * 100)}%)` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      title="Quitar renglón"
                      onClick={() => removeLine(l.key)}
                    >
                      ×
                    </button>
                  </TableCell>
                </TableRow>
              )
            })}
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Sin renglones: agregá los artículos a mano con «+ Agregar renglón».
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4}>Suma de renglones</TableCell>
              <TableCell className="text-right tabular-nums">${fmtARS(sumLines)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {/* Texto extraído (depuración) */}
      {invoice.rawText && (
        <details className="rounded-xl border px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            Texto extraído (depuración)
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
            {invoice.rawText}
          </pre>
        </details>
      )}


    </div>
  )

}

