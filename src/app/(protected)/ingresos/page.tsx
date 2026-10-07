"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { extractTextFromFile } from "@/lib/invoices/extractClient"
import { uploadBlueprintToCloudinary } from "@/lib/cloudinary"
import { fmtARS, fmtDate, fmtDateTime } from "@/lib/invoices/format"
import type { InvoiceRecord, InvoiceStatus } from "@/types/invoice"

const STATUS_STYLE: Record<
  InvoiceStatus,
  { label: string; variant: "warning" | "success" | "critical" }
> = {
  review: { label: "A revisar", variant: "warning" },
  confirmed: { label: "Confirmada", variant: "success" },
  error: { label: "Error", variant: "critical" },
}

interface Progress {
  fileName: string
  message: string
  progress: number
}

export default function IngresosPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const fetchInvoices = useCallback(async (): Promise<InvoiceRecord[]> => {
    try {
      const res = await fetch("/api/invoices")
      const data = await res.json()
      return data.success && Array.isArray(data.invoices) ? data.invoices : []
    } catch (err) {
      console.error("[ingresos] load:", err)
      return []
    }
  }, [])

  useEffect(() => {
    let alive = true
    fetchInvoices().then((list) => {
      if (!alive) return
      setInvoices(list)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [fetchInvoices])

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (arr.length === 0) return
    setBusy(true)
    let firstId: string | null = null
    for (const file of arr) {
      setProgress({ fileName: file.name, message: "Extrayendo texto…", progress: 0 })
      try {
        const [extractRes, uploadRes] = await Promise.allSettled([
          extractTextFromFile(file, (_stage, message, p) =>
            setProgress({ fileName: file.name, message, progress: p }),
          ),
          uploadBlueprintToCloudinary(file),
        ])
        if (extractRes.status === "rejected") {
          throw extractRes.reason instanceof Error
            ? extractRes.reason
            : new Error("No se pudo leer el archivo")
        }
        const extract = extractRes.value
        if (extract.text.replace(/\s/g, "").length < 20) {
          throw new Error("No se pudo leer texto (revisá que la foto esté nítida)")
        }
        const fileUrl = uploadRes.status === "fulfilled" ? uploadRes.value.secureUrl : null
        if (uploadRes.status === "rejected") {
          console.warn("[ingresos] Cloudinary falló (se guarda sin archivo):", uploadRes.reason)
        }
        setProgress({ fileName: file.name, message: "Guardando factura…", progress: 1 })
        const res = await fetch("/api/invoices/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            fileUrl,
            source: "web",
            method: extract.method,
            ocrConfidence: extract.confidence,
            text: extract.text,
          }),
        })
        const data = (await res.json()) as {
          success?: boolean
          error?: string
          invoice?: InvoiceRecord
        }
        if (!res.ok || !data.success || !data.invoice) {
          throw new Error(data.error ?? "Error al guardar la factura")
        }
        if (!firstId) firstId = data.invoice.id
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : "error desconocido"}`)
      }
    }
    setProgress(null)
    setBusy(false)
    setInvoices(await fetchInvoices())
    if (firstId) router.push(`/ingresos/${firstId}`)
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Ingresos de Mercadería</h1>
        <p className="text-sm text-muted-foreground">
          Subí la factura del proveedor (PDF, foto o escaneo): se lee el texto, se extraen los
          renglones y los revisás antes de ingresar al stock. Todo gratis: el OCR corre en tu
          navegador.
        </p>
      </div>

      {!busy ? (
        <div
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border"
          }`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            void handleFiles(e.dataTransfer.files)
          }}
        >
          <p className="text-sm font-medium">
            Arrastrá la factura acá o seleccionala desde tu equipo o celular
          </p>
          <Button onClick={() => inputRef.current?.click()}>Elegir PDF / imagen</Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files)
              e.target.value = ""
            }}
          />
          <p className="text-xs text-muted-foreground">
            PDF con texto: casi instantáneo · PDF escaneado o foto: OCR de 10 a 60 segundos por
            página
          </p>
        </div>
      ) : (
        <div className="rounded-xl border p-6">
          <p className="text-sm font-medium">
            {progress?.fileName ?? ""} — {progress?.message ?? "Procesando…"}
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            No cierres esta pestaña hasta que termine.
          </p>
        </div>
      )}

      {/* Listado */}
      <div className="rounded-xl border">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Facturas ingresadas</h2>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
        ) : invoices.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Todavía no hay facturas. Cargá la primera arriba.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>N°</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-center">Renglones</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Ingresada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => {
                const st = STATUS_STYLE[inv.status] ?? STATUS_STYLE.review
                return (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/ingresos/${inv.id}`)}
                  >
                    <TableCell>{fmtDate(inv.invoiceDate)}</TableCell>
                    <TableCell className="max-w-56 truncate">{inv.provider ?? "—"}</TableCell>
                    <TableCell>{inv.invoiceNumber ?? "—"}</TableCell>
                    <TableCell className="text-right">${fmtARS(inv.total)}</TableCell>
                    <TableCell className="text-center">{inv.lines.length}</TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDateTime(inv.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        ¿Llegaron facturas por correo o WhatsApp? Copialas a la carpeta{" "}
        <code className="rounded bg-muted px-1">automation-watcher/inbox/facturas</code> de la PC
        y el despertador (cada minuto) las ingresa solo. Los escaneos sin texto se mueven a{" "}
        <code className="rounded bg-muted px-1">inbox/needs-ocr</code> y hay que subirlos por acá.
      </p>

    </div>
  )
}

