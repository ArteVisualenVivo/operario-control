const XLSX = require("xlsx")
const crypto = require("crypto")

function computeHash(filePath) {
  const buf = require("fs").readFileSync(filePath)
  return crypto.createHash("sha256").update(buf).digest("hex")
}

const UNIT_MAP = {
  "UN.": "unidad",
  "1000 KH": "unidad",
}

function mapUnit(raw) {
  const u = (raw || "").toString().trim().toUpperCase()
  return UNIT_MAP[u] || "unidad"
}

function parseExcel(filePath, config) {
  const workbook = XLSX.readFile(filePath)
  const sheetName = config.sheetName || workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]

  const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

  const dataStart = config.dataStartRow ?? 6
  const col = config.columns3c

  const items = []

  for (let i = dataStart; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (!row || !Array.isArray(row)) continue

    const codigo = (row[col.codigo] || "").toString().trim()
    const nameRaw = (row[col.name] || "").toString().trim()
    if (!codigo && !nameRaw) continue

    const stockTotal = parseFloat(row[col.stockTotal]) || 0
    const stockAvailable = stockTotal
    const stockRented = 0
    const deposito = parseInt(row[col.deposito]) || 0
    const unidadRaw = (row[col.unidadRaw] || "").toString().trim()
    const unit = mapUnit(unidadRaw)

    const item = {
      codigo,
      name: nameRaw,
      normalizedName: nameRaw.toLowerCase().trim(),
      stockTotal,
      stockAvailable,
      stockRented,
      deposito,
      unidadRaw,
      unit,
      source: "3c",
      stockWarning: stockTotal < 0,
    }

    items.push(item)
  }

  return items
}

module.exports = { parseExcel, computeHash }
