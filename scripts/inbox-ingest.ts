// inbox-ingest.ts — Canal "carpeta" de facturas (pestaña Ingresos).
//
// Colocá PDFs (o fotos JPG/PNG) de facturas en:
//     automation-watcher/inbox/facturas/
// El despertador (scripts/wake-agent-if-pending.ps1, cada 1 min) lanza este
// script en oculto. Él:
//   1. toma un lock (no se pisan corridas),
//   2. PDF con capa de texto → lo ingresa directo (misma ruta que la web):
//      pdfjs legacy en Node → parseInvoiceText → match → Redis.
//   3. PDF escaneado (sin texto) → lo mueve a inbox/needs-ocr/ con aviso
//      (para OCR hay que subirlo por la web: el renderer de PDF no corre acá).
//   4. Foto JPG/PNG → OCR con tesseract.js en Node (gratis) → ingresa;
//      si el OCR falla → inbox/needs-ocr/.
//   5. mueve el archivo procesado a inbox/processed/ (o inbox/failed/).
//
// Sale siempre solo: no queda ningún proceso colgado.
import dotenv from "dotenv"
import { fileURLToPath } from "node:url"

dotenv.config({ path: fileURLToPath(new URL("../.env.local", import.meta.url)) })

import fs from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { groupItemsIntoRows } from "../src/lib/invoices/pdfRows"
import { parseInvoiceText } from "../src/lib/invoices/parseInvoice"
import { loadCatalog } from "../src/lib/invoices/matchArticles"
import { buildInvoiceRecord } from "../src/lib/invoices/build"
import { putInvoice } from "../src/lib/invoices/store"

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const INBOX = path.join(ROOT, "automation-watcher", "inbox", "facturas")
const PROCESSED = path.join(ROOT, "automation-watcher", "inbox", "processed")
const NEEDS_OCR = path.join(ROOT, "automation-watcher", "inbox", "needs-ocr")
const FAILED = path.join(ROOT, "automation-watcher", "inbox", "failed")
const LOCK = path.join(ROOT, "automation-watcher", "inbox", ".inbox-ingest.lock")

const PDF_EXTENSIONS = new Set([".pdf"])
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"])
const MIN_CHARS = 20
const MIN_CHARS_PER_PAGE = 60
const MAX_PAGES = 12

function log(msg: string): void {
  console.log(`[inbox] ${msg}`)
}

async function acquireLock(): Promise<boolean> {
  await fs.mkdir(path.dirname(LOCK), { recursive: true })
  try {
    await fs.writeFile(LOCK, String(process.pid), { flag: "wx" })
    return true
  } catch {
    // Lock existente: si tiene más de 10 min es de una corrida muerta.
    try {
      const st = await fs.stat(LOCK)
      if (Date.now() - st.mtimeMs > 10 * 60 * 1000) {
        await fs.unlink(LOCK)
        await fs.writeFile(LOCK, String(process.pid), { flag: "wx" })
        return true
      }
    } catch {
      // no existía o no se pudo leer: reintentar no sirve
    }
    return false
  }
}

async function moveFile(filePath: string, destDir: string, name: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true })
  const dest = path.join(destDir, name)
  try {
    await fs.rename(filePath, dest)
  } catch {
    // Windows con archivo bloqueado: copiar + borrar como fallback.
    await fs.copyFile(filePath, dest)
    await fs.unlink(filePath).catch(() => undefined)
  }
}

/** Texto de un PDF con capa de texto (sin canvas: solo lectura de glifos). */
async function extractPdfText(
  filePath: string,
): Promise<{ text: string; thinRatio: number }> {
  const data = new Uint8Array(await fs.readFile(filePath))
  const task = getDocument({ data, disableFontFace: true })
  const doc = await task.promise
  let text = ""
  let thin = 0
  const pages = Math.min(doc.numPages, MAX_PAGES)
  try {
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items = content.items.flatMap((it) => {
        if (typeof (it as { str?: unknown }).str !== "string") return []
        const rec = it as { str: string; transform: number[] }
        if (!Array.isArray(rec.transform)) return []
        return [{ str: rec.str, x: rec.transform[4], y: viewport.height - rec.transform[5] }]
      })
      const pageText = groupItemsIntoRows(items).join("\n")
      if (pageText.replace(/\s/g, "").length < MIN_CHARS_PER_PAGE) thin++
      text += text ? `\n${pageText}` : pageText
      page.cleanup?.()
    }
  } finally {
    await task.destroy().catch(() => undefined)
  }
  return { text, thinRatio: pages > 0 ? thin / pages : 1 }
}

/** OCR de imagen con tesseract.js en Node (gratis, 1ª vez baja el idioma). */
async function extractImageText(filePath: string): Promise<string> {
  const { createWorker } = await import("tesseract.js")
  const worker = await createWorker("spa+eng")
  try {
    const { data } = await worker.recognize(filePath)
    return data.text ?? ""
  } finally {
    await worker.terminate().catch(() => undefined)
  }
}

async function main(): Promise<void> {
  if (!(await acquireLock())) {
    log("otra corrida en curso (lock presente): salgo")
    return
  }
  try {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(INBOX, { withFileTypes: true })
    } catch {
      log("no existe la carpeta inbox: nada que hacer")
      return
    }

    const files = entries
      .filter(
        (e) =>
          e.isFile() &&
          (PDF_EXTENSIONS.has(path.extname(e.name).toLowerCase()) ||
            IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase())),
      )
      .map((e) => e.name)
      .sort()

    if (files.length === 0) return
    log(`${files.length} archivo(s) en cola`)

    const catalog = await loadCatalog()
    log(`catálogo artículos: ${catalog.length} ítems`)

    let ok = 0
    let skipped = 0
    let failed = 0

    for (const name of files) {
      const filePath = path.join(INBOX, name)
      const ext = path.extname(name).toLowerCase()
      try {
        let text = ""
        let method: "pdf_text" | "ocr" = "pdf_text"

        if (PDF_EXTENSIONS.has(ext)) {
          const res = await extractPdfText(filePath)
          text = res.text
          if (res.thinRatio > 0.5) {
            log(`${name}: PDF escaneado sin texto → a needs-ocr (subir por la web para OCR)`)
            await moveFile(filePath, NEEDS_OCR, name)
            skipped++
            continue
          }
        } else {
          method = "ocr"
          text = await extractImageText(filePath)
        }

        if (text.replace(/\s/g, "").length < MIN_CHARS) {
          log(`${name}: sin texto útil → a needs-ocr`)
          await moveFile(filePath, NEEDS_OCR, name)
          skipped++
          continue
        }

        const draft = await parseInvoiceText(text)
        const record = buildInvoiceRecord({
          draft,
          fileName: name,
          fileUrl: null,
          source: "inbox",
          method,
          ocrConfidence: null,
          rawText: text,
          catalog,
        })
        await putInvoice(record)
        await moveFile(filePath, PROCESSED, name)
        ok++
        log(
          `${name}: OK → ${record.id} (${record.lines.length} renglones, proveedor: ${
            record.provider ?? "?"
          })`,
        )
      } catch (err) {
        log(`${name}: ERROR ${err instanceof Error ? err.message : err}`)
        try {
          await moveFile(filePath, FAILED, name)
        } catch {
          // si no se pudo mover, queda en inbox y se reintentará
        }
        failed++
      }
    }

    log(`listo: ${ok} ingresada(s), ${skipped} a needs-ocr, ${failed} con error`)
  } finally {
    await fs.unlink(LOCK).catch(() => undefined)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[inbox] fatal:", err)
    process.exit(1)
  })

