import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"

GlobalWorkerOptions.workerSrc =
  "//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.mjs"

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

const BOSCH_REF = /\b(\d\s+\d{3}\s+[A-Z0-9]+\s+\d+[A-Z0-9]*)\b/

export async function extractPartsFromPdf(fileUrl: string): Promise<ExtractedPart[]> {
  const response = await fetch(fileUrl)
  const arrayBuffer = await response.arrayBuffer()

  const pdf = await getDocument({ data: arrayBuffer }).promise
  const lines: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items.map((item) => ("str" in item ? (item as { str: string }).str : "")).join(" ")
    lines.push(text)
  }

  const parts: ExtractedPart[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const match = line.match(BOSCH_REF)
    if (!match) continue

    const ref = normalizeRef(match[1])
    if (seen.has(ref)) continue
    seen.add(ref)

    const afterRef = line.substring(match.index! + match[0].length).trim()
    const descMatch = afterRef.match(/^([A-Za-zÀ-ÿ0-9\s\/\-\.\,\(\)]+?)(?:\s+\d+[\d,\.\s]*[€$€]|$)/)
    const partName = descMatch
      ? normalizeName(descMatch[1])
      : normalizeName(afterRef.split(/\s{2,}/)[0] || afterRef)

    if (partName && partName.length > 1) {
      parts.push({ partCode: ref, partName })
    }
  }

  return parts
}
