const XLSX = require("xlsx")
const crypto = require("crypto")

function computeHash(filePath) {
  const buf = require("fs").readFileSync(filePath)
  return crypto.createHash("sha256").update(buf).digest("hex")
}

function parseExcel(filePath, config) {
  const workbook = XLSX.readFile(filePath)
  const sheetName = config.sheetName || workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]

  const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: "A" })
  const col = config.columns

  const items = []

  for (const row of rawRows) {
    const nameRaw = (row[col.name] || "").toString().trim()
    if (!nameRaw) continue

    const stockTotal = parseFloat(row[col.stockTotal]) || 0
    const stockAvailable = parseFloat(row[col.stockAvailable]) || 0
    const stockRented = Math.max(stockTotal - stockAvailable, 0)

    items.push({
      name: nameRaw,
      normalizedName: nameRaw.toLowerCase().trim(),
      stockTotal,
      stockAvailable,
      stockRented,
    })
  }

  return items
}

module.exports = { parseExcel, computeHash }
