// verify-invoice-parse.ts — Verifica el parser de facturas con fixtures
// sintéticos (digital + OCR ruidoso), el match contra catálogo y un
// roundtrip en Redis (crea → lista → lee → borra).   npm run verify:invoices
import dotenv from "dotenv"
import { fileURLToPath } from "node:url"

dotenv.config({ path: fileURLToPath(new URL("../.env.local", import.meta.url)) })

// Determinismo: nunca pasar por Gemini en este test.
delete process.env.GEMINI_API_KEY
delete process.env.GEMINI_MODEL

import { parseInvoiceText, parseNumAR, normalizeDateValue } from "../src/lib/invoices/parseInvoice"
import { detectCatalog, matchLineAgainstCatalog, similarity } from "../src/lib/invoices/matchArticles"
import { listInvoices, getInvoice, putInvoice, deleteInvoice } from "../src/lib/invoices/store"
import type { InvoiceRecord } from "../src/types/invoice"

let failures = 0

function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : "")
  }
}

const FIXTURE_DIGITAL = `DISTRIBUIDORA GAUCHA S.R.L.
Av. Rivadavia 1234 - CABA
CUIT: 30-70912345-8
FACTURA ELECTRÓNICA A 0001-00012345
Fecha de emisión: 15/06/2026

CANT. DESCRIPCION PRECIO UNIT. IMPORTE
2 PISON CANGURO MACROMAQ 45.000,00 90.000,00
1 MANGUERA HIDRAULICA 3/4 PULG 12.500,00 12.500,00
24 TORNILLO AUTOPERFORANTE 8x1 85,50 2.052,00

SUBTOTAL 104.552,00
IVA 21% 21.955,92
TOTAL A PAGAR $ 126.507,92`

const FIXTURE_OCR = `DISTRIBUIDORA EL TORNILLO S.A.
CUIT 30 71999888 7
Fecha: 02/06/2026
ACEITE HIDRAULICO 20L 1 89.900,00 89.900,00
2 Manguera 1/2 pulg 4500 9000
Total: $98.900,00`

async function main(): Promise<void> {
  console.log("\n== Utilidades numéricas/fecha ==")
  check("parseNumAR 1.234,56", parseNumAR("1.234,56") === 1234.56)
  check("parseNumAR 1,234.56", parseNumAR("1,234.56") === 1234.56)
  check("parseNumAR 45.000 (miles)", parseNumAR("45.000") === 45000)
  check("parseNumAR 85,50", parseNumAR("85,50") === 85.5)
  check("normalizeDate 15/06/2026", normalizeDateValue("15/06/2026") === "2026-06-15")
  check("normalizeDate 15 de junio de 2026", normalizeDateValue("15 de junio de 2026") === "2026-06-15")

  console.log("\n== Fixture digital ==")
  const a = await parseInvoiceText(FIXTURE_DIGITAL)
  check("parser heurístico", a.parser === "heuristica")
  check("proveedor", a.provider?.includes("GAUCHA S.R.L.") === true, a.provider)
  check("CUIT", a.providerCuit === "30-70912345-8", a.providerCuit)
  check("nro factura", a.invoiceNumber === "A 0001-00012345", a.invoiceNumber)
  check("fecha ISO", a.invoiceDate === "2026-06-15", a.invoiceDate)
  check("3 renglones", a.lines.length === 3, a.lines.map((l) => l.description))
  const [l1, l2, l3] = a.lines
  check("r1 qty=2", l1?.quantity === 2, l1)
  check("r1 desc", l1?.description === "PISON CANGURO MACROMAQ", l1?.description)
  check("r1 pu=45000", l1?.unitPrice === 45000, l1?.unitPrice)
  check("r1 total=90000", l1?.total === 90000, l1?.total)
  check("r2 desc conserva 3/4", l2?.description.includes("3/4") === true, l2?.description)
  check("r3 qty=24", l3?.quantity === 24, l3)
  check("r3 pu=85.5", l3?.unitPrice === 85.5, l3?.unitPrice)
  check("r3 total=2052", l3?.total === 2052, l3?.total)
  check("subtotal", a.subtotal === 104552, a.subtotal)
  check("iva", a.iva === 21955.92, a.iva)
  check("total", a.total === 126507.92, a.total)
  check("sin aviso de descuadre", !a.warnings.some((w) => w.includes("suman")), a.warnings)

  console.log("\n== Fixture OCR (texto ruidoso) ==")
  const b = await parseInvoiceText(FIXTURE_OCR)
  check("proveedor", b.provider?.includes("EL TORNILLO S.A.") === true, b.provider)
  check("CUIT con espacios", b.providerCuit === "30-71999888-7", b.providerCuit)
  check("fecha", b.invoiceDate === "2026-06-02", b.invoiceDate)
  check("2 renglones", b.lines.length === 2, b.lines.map((l) => `${l.quantity} ${l.description}`))
  const [b1, b2] = b.lines
  check("b1 desc=ACEITE HIDRAULICO 20L qty=1", b1?.description === "ACEITE HIDRAULICO 20L" && b1?.quantity === 1, b1)
  check("b1 pu=89900", b1?.unitPrice === 89900, b1?.unitPrice)
  check("b2 qty=2", b2?.quantity === 2, b2)
  check("b2 desc", b2?.description === "Manguera 1/2 pulg", b2?.description)
  check("b2 pu=4500", b2?.unitPrice === 4500, b2?.unitPrice)
  check("b2 total=9000", b2?.total === 9000, b2?.total)
  check("total OCR", b.total === 98900, b.total)

  console.log("\n== Match contra catálogo ==")
  const catalog = [
    { code: "22004", name: "PISON CANGURO MACROMAQ" },
    { code: "1150", name: "MANGUERA HIDRAULICA 3/4 PULG" },
  ]
  check("similitud idéntica = 1", similarity("PISON CANGURO", "pison canguro") === 1)
  const mA = matchLineAgainstCatalog(
    { id: "x", raw: "", description: "PISON CANGURO MACROMAQ", quantity: 1 },
    catalog,
  )
  check("match exacto por nombre → stock", mA.action === "stock" && mA.matchCode === "22004", mA)
  const mB = matchLineAgainstCatalog(
    { id: "x", raw: "", description: "TORNILLO AUTOPERFORANTE", quantity: 1 },
    catalog,
  )
  check("sin coincidencia → alta_stock", mB.action === "alta_stock", mB)
  const mC = matchLineAgainstCatalog(
    { id: "x", raw: "", description: "Cualquier cosa", quantity: 1, code: "1150" },
    catalog,
  )
  check("match por código exacto → stock", mC.action === "stock" && mC.matchScore === 1, mC)
  const mD = matchLineAgainstCatalog({ id: "x", raw: "", description: "PISON", quantity: 1 }, [])
  check("catálogo vacío → sin_catalogo", mD.action === "sin_catalogo", mD)
  check("detectCatalog columnas 3C", detectCatalog([{ ARTICULO: "22004", DENOMINACION: "PISON" }]).length === 1)

  // == Roundtrip en Redis (crea → lista → lee → borra) ==
  console.log("\n== Roundtrip Redis ==")
  const now = new Date().toISOString()
  const record: InvoiceRecord = {
    id: `inv-verify-${Date.now()}`,
    source: "inbox",
    fileName: "verify-fixture.txt",
    fileUrl: null,
    extractMethod: "text",
    ocrConfidence: null,
    status: "review",
    provider: "VERIFY S.R.L.",
    providerCuit: "30-00000000-0",
    invoiceNumber: "A 0001-00000001",
    invoiceDate: "2026-06-15",
    invoiceDateRaw: "15/06/2026",
    subtotal: 100,
    iva: 21,
    total: 121,
    currency: "ARS",
    lines: [
      {
        id: "l1",
        raw: "1 ITEM DE PRUEBA 100,00 100,00",
        description: "ITEM DE PRUEBA",
        quantity: 1,
        unitPrice: 100,
        total: 100,
        code: null,
        action: "alta_stock",
        candidates: [],
      },
    ],
    warnings: [],
    rawText: "verify",
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
  }
  try {
    await putInvoice(record)
    const afterPut = await listInvoices()
    check("putInvoice → aparece en list", afterPut.some((i) => i.id === record.id))
    const fetched = await getInvoice(record.id)
    check("getInvoice → devuelve el registro", fetched?.provider === "VERIFY S.R.L.")
    check("getInvoice → renglones", fetched?.lines.length === 1)
  } finally {
    const removed = await deleteInvoice(record.id)
    check("deleteInvoice → lo borra", removed)
    const afterDel = await listInvoices()
    check("listado sin el verify", !afterDel.some((i) => i.id === record.id))
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nTODO OK ✅" : `\n${failures} fallo(s) ❌`)
    process.exit(failures === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error("\nERROR inesperado:", err)
    process.exit(1)
  })

