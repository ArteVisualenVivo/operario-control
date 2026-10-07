// extractClient.ts — Extracción de texto de PDFs/IMÁGENES EN EL NAVEGADOR.
//
// 100% gratis y sin límites de serverless:
//   · PDF con capa de texto  → pdfjs getTextContent (filas por coordenada Y).
//   · PDF escaneado / foto   → pdfjs renderiza a canvas y tesseract.js (OCR
//     en el cliente, idioma spa+eng, datos desde CDN de Tessdata).
// El texto resultante se manda a POST /api/invoices/ingest.
import { groupItemsIntoRows } from "./pdfRows"

export type ExtractMethod = "pdf_text" | "ocr" | "mixed" | "text"

export interface ExtractResult {
  text: string
  method: ExtractMethod
  /** Confianza media del OCR (0-100) o null si no hubo OCR. */
  confidence: number | null
  pages: number
}

export type ExtractProgress = (stage: "pdf" | "ocr", message: string, progress: number) => void

const WORKER_SRC = "//cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs"
const MIN_CHARS_PER_PAGE = 60
const MAX_PAGES = 12
const MAX_FILE_BYTES = 20 * 1024 * 1024
const OCR_LANGS = "spa+eng"

function statusLabel(status: string): string {
  if (status.includes("recogn")) return "Reconociendo texto (OCR)…"
  if (status.includes("language") || status.includes("traineddata")) return "Cargando idioma OCR…"
  if (status.includes("core")) return "Cargando motor OCR…"
  if (status.includes("api")) return "Preparando OCR…"
  return "Procesando OCR…"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createOcrWorker(onTick?: (msg: string, p: number) => void): Promise<any> {
  const { createWorker } = await import("tesseract.js")
  return createWorker(OCR_LANGS, 1, {
    logger: (m: { status: string; progress: number }) => {
      onTick?.(statusLabel(m.status), typeof m.progress === "number" ? m.progress : 0)
    },
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("No se pudo leer la imagen (usá JPG, PNG o PDF)"))
    img.src = url
  })
}

/** Re-encode a JPEG con lado máximo (mejora OCR y baja el peso). */
function toJpeg(img: HTMLImageElement, maxSide: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Sin canvas 2D en este navegador")
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.92)
}

async function extractImage(file: File, onProgress?: ExtractProgress): Promise<ExtractResult> {
  onProgress?.("ocr", "Preparando imagen…", 0.05)
  const worker = await createOcrWorker((msg, p) => onProgress?.("ocr", msg, 0.1 + p * 0.9))
  try {
    const objectUrl = URL.createObjectURL(file)
    let dataUrl: string
    try {
      const img = await loadImage(objectUrl)
      dataUrl = toJpeg(img, 2200)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
    onProgress?.("ocr", "Reconociendo texto (OCR)…", 0.2)
    const { data } = await worker.recognize(dataUrl)
    onProgress?.("ocr", "Listo", 1)
    return {
      text: data.text ?? "",
      method: "ocr",
      confidence: typeof data.confidence === "number" ? data.confidence : null,
      pages: 1,
    }
  } finally {
    await worker.terminate().catch(() => undefined)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPageJpeg(page: any, onProgress?: ExtractProgress): Promise<string> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2.4, Math.max(1, 1800 / base.width))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement("canvas")
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Sin canvas 2D en este navegador")
  onProgress?.("ocr", "Renderizando página para OCR…", 0.1)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas.toDataURL("image/jpeg", 0.92)
}

async function extractPdf(file: File, onProgress?: ExtractProgress): Promise<ExtractResult> {
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC

  const buf = await file.arrayBuffer()
  const task = pdfjs.getDocument({ data: buf })
  const doc = await task.promise
  const pageCount = Math.min(doc.numPages, MAX_PAGES)

  let text = ""
  let anyTextLayer = false
  let anyOcr = false
  let confSum = 0
  let confN = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let worker: any = null

  try {
    for (let p = 1; p <= pageCount; p++) {
      onProgress?.("pdf", `Leyendo página ${p}/${pageCount}…`, (p - 1) / pageCount)
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = content.items.flatMap((it: any) => {
        if (typeof it.str !== "string" || !Array.isArray(it.transform)) return []
        return [
          {
            str: it.str,
            x: it.transform[4] as number,
            y: viewport.height - (it.transform[5] as number),
          },
        ]
      })
      const rows = groupItemsIntoRows(items)
      const pageText = rows.join("\n")
      const chars = pageText.replace(/\s/g, "").length

      if (chars >= MIN_CHARS_PER_PAGE) {
        anyTextLayer = true
        text += (text ? "\n" : "") + pageText
      } else {
        // Página escaneada: OCR solo de esta página.
        if (!worker) {
          worker = await createOcrWorker((msg, pr) =>
            onProgress?.(
              "ocr",
              `${msg} (página ${p}/${pageCount})`,
              Math.min(0.99, (p - 1) / pageCount + pr / pageCount),
            ),
          )
        }
        const jpeg = await renderPageJpeg(page, onProgress)
        const { data } = await worker.recognize(jpeg)
        if (typeof data.confidence === "number") {
          confSum += data.confidence
          confN++
        }
        anyOcr = true
        text += (text ? "\n" : "") + (data.text ?? "")
      }
      page.cleanup?.()
    }
  } finally {
    if (worker) await worker.terminate().catch(() => undefined)
    await task.destroy().catch(() => undefined)
  }

  onProgress?.(anyOcr ? "ocr" : "pdf", "Listo", 1)
  return {
    text,
    method: anyOcr ? (anyTextLayer ? "mixed" : "ocr") : "pdf_text",
    confidence: confN > 0 ? Math.round(confSum / confN) : null,
    pages: pageCount,
  }
}

/** Punto de entrada: PDF o imagen → texto. Lanza Error con mensaje amigable. */
export async function extractTextFromFile(
  file: File,
  onProgress?: ExtractProgress,
): Promise<ExtractResult> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`El archivo supera 20 MB (${Math.round(file.size / 1024 / 1024)} MB)`)
  }
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name)
  if (isPdf) return extractPdf(file, onProgress)
  if (file.type.startsWith("image/")) return extractImage(file, onProgress)
  throw new Error("Formato no soportado: usá PDF, JPG o PNG")
}

