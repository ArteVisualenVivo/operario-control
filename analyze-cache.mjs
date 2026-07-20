import fs from "fs"
import path from "path"

const CACHE_DIR = path.resolve(process.cwd(), "automation-watcher", "cache")
const STOCK_CACHE_FILE = path.join(CACHE_DIR, "stock-cache.json")
const MACHINES_CACHE_FILE = path.join(CACHE_DIR, "machines-cache.json")
const SPARE_PARTS_CACHE_FILE = path.join(CACHE_DIR, "spare-parts-cache.json")

function loadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const content = fs.readFileSync(filePath, "utf-8")
    return JSON.parse(content)
  } catch (err) {
    console.error(`Error loading ${filePath}:`, err.message)
    return null
  }
}

function extractCodes(items, codeField = "codigo") {
  if (!Array.isArray(items)) return new Set()
  return new Set(items.map(item => item[codeField]).filter(Boolean))
}

// Cargar caches
const stockData = loadJson(STOCK_CACHE_FILE)
const machinesData = loadJson(MACHINES_CACHE_FILE)
const sparePartsData = loadJson(SPARE_PARTS_CACHE_FILE)

console.log("=== ANÁLISIS DE CACHE LOCAL ===\n")

// Stock
if (stockData) {
  const stockCodes = extractCodes(stockData)
  console.log(`Stock: ${stockCodes.size} códigos únicos`)
  console.log(`  Total items en cache: ${stockData.length}`)
} else {
  console.log("Stock: No hay cache local")
}

// Máquinas (derivado de stock)
if (machinesData) {
  const machineCodes = extractCodes(machinesData, "model")
  console.log(`\nMáquinas (derivado de stock): ${machineCodes.size} códigos únicos`)
  console.log(`  Total máquinas en cache: ${machinesData.length}`)
} else {
  console.log("\nMáquinas: No hay cache local")
}

// Repuestos (derivado de stock)
if (sparePartsData) {
  const partCodes = extractCodes(sparePartsData, "partCode")
  console.log(`\nRepuestos (derivado de stock): ${partCodes.size} códigos únicos`)
  console.log(`  Total repuestos en cache: ${sparePartsData.length}`)
} else {
  console.log("\nRepuestos: No hay cache local")
}

// Buscar otros archivos de cache
const allCacheFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"))
console.log(`\n=== ARCHIVOS DE CACHE DISPONIBLES ===`)
allCacheFiles.forEach(file => {
  const filePath = path.join(CACHE_DIR, file)
  const stats = fs.statSync(filePath)
  const sizeKB = (stats.size / 1024).toFixed(2)
  console.log(`  ${file} (${sizeKB} KB, modificado: ${stats.mtime.toLocaleString()})`)
})

// Análisis de intersección y unión si hay datos
if (stockData && machinesData && sparePartsData) {
  const stockCodes = extractCodes(stockData)
  const machineCodes = extractCodes(machinesData, "model")
  const partCodes = extractCodes(sparePartsData, "partCode")

  const intersection = new Set([...stockCodes].filter(c => machineCodes.has(c) || partCodes.has(c)))
  const union = new Set([...stockCodes, ...machineCodes, ...partCodes])

  console.log(`\n=== ANÁLISIS DE CONJUNTOS ===`)
  console.log(`Stock: ${stockCodes.size} códigos`)
  console.log(`Máquinas: ${machineCodes.size} códigos`)
  console.log(`Repuestos: ${partCodes.size} códigos`)
  console.log(`Intersección (códigos compartidos): ${intersection.size}`)
  console.log(`Unión total: ${union.size} códigos`)
}