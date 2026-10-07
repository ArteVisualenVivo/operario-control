// pdfRows.ts — Agrupación de fragmentos de texto de pdfjs en renglones visuales.
// Compartido por el extractor del navegador (extractClient.ts) y por el canal
// carpeta que corre en Node (scripts/inbox-ingest.ts). Puro, sin dependencias
// de DOM ni de pdfjs: solo recibe items con coordenadas.
//
// Convención de Y: medida desde ARRIBA de la página (crece hacia abajo), así
// el orden ascendente es el orden de lectura normal.

export interface PdfTextItem {
  str: string
  /** Distancia desde el borde superior (px a escala 1). */
  y: number
  /** Distancia desde el borde izquierdo (px a escala 1). */
  x: number
}

/**
 * Convierte items de pdfjs en strings "renglón", leyendo de arriba hacia
 * abajo y de izquierda a derecha. Dos items caen en el mismo renglón si su
 * distancia vertical es ≤ yThreshold px (igual criterio que
 * pdfPartsExtractor, probado en la práctica con los PDF de Bosch).
 */
export function groupItemsIntoRows(items: PdfTextItem[], yThreshold = 3): string[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: string[] = []
  let current: PdfTextItem[] = []
  let lastY = Number.NaN

  const flush = (): void => {
    if (current.length === 0) return
    current.sort((a, b) => a.x - b.x)
    const text = current
      .map((t) => t.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    if (text) rows.push(text)
    current = []
  }

  for (const item of sorted) {
    if (current.length === 0 || Math.abs(item.y - lastY) <= yThreshold) {
      current.push(item)
    } else {
      flush()
      current.push(item)
    }
    lastY = item.y
  }
  flush()
  return rows
}
