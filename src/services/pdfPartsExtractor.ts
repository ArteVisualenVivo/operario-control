import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"

GlobalWorkerOptions.workerSrc =
  "//cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs"

export interface ExtractedPart {
  partCode: string
  partName: string
}

function normalizeRef(ref: string): string {
  return ref.replace(/\s+/g, " ").trim()
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim()
}

const Y_THRESHOLD = 3
const BOSCH_REF = /\b(\d\s+\d{3}\s+[A-Z0-9]+\s+\d+[A-Z0-9]*)\b/

export async function extractPartsFromPdf(fileUrl: string): Promise<ExtractedPart[]> {
  const response = await fetch(fileUrl)
  const arrayBuffer = await response.arrayBuffer()

  const pdf = await getDocument({ data: arrayBuffer }).promise
  const parts: ExtractedPart[] = []
  const seen = new Set<string>()

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()

    const rawItems: { str: string; x: number; y: number }[] = []

    for (const item of content.items) {
      const obj = item as Record<string, unknown>
      if (
        typeof obj.str === "string" &&
        Array.isArray(obj.transform) &&
        obj.transform.length >= 6
      ) {
        rawItems.push({
          str: obj.str,
          x: obj.transform[4] as number,
          y: viewport.height - (obj.transform[5] as number),
        })
      }
    }

    rawItems.sort((a, b) => b.y - a.y || a.x - b.x)

    const rows: string[] = []
    let currentRow: typeof rawItems = []
    let lastY = -Infinity

    for (const item of rawItems) {
      if (lastY === -Infinity || Math.abs(item.y - lastY) <= Y_THRESHOLD) {
        currentRow.push(item)
      } else {
        currentRow.sort((a, b) => a.x - b.x)
        rows.push(currentRow.map((t) => t.str).join(" "))
        currentRow = [item]
      }
      lastY = item.y
    }
    if (currentRow.length > 0) {
      currentRow.sort((a, b) => a.x - b.x)
      rows.push(currentRow.map((t) => t.str).join(" "))
    }

    for (const row of rows) {
      const match = row.match(BOSCH_REF)
      if (!match) continue

      const ref = normalizeRef(match[1])
      if (seen.has(ref)) continue
      seen.add(ref)

      const afterRef = row.substring(match.index! + match[0].length).trim()
      const descMatch = afterRef.match(
        /^([A-Za-zÀ-ÿ0-9\s\/\-\.\,\(\)]+?)(?:\s+\d+[\d,\.\s]*[€€$]|$)/,
      )
      const partName = descMatch
        ? normalizeName(descMatch[1])
        : normalizeName(afterRef.split(/\s{2,}/)[0] || afterRef)

      if (partName && partName.length > 1) {
        parts.push({ partCode: ref, partName })
      }
    }
  }

  return parts
}
