import fs from "fs"
import path from "path"

const CACHE_DIR = path.resolve(process.cwd(), "automation-watcher", "cache")
const STOCK_CACHE_FILE = path.join(CACHE_DIR, "stock-cache.json")

function loadJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    return JSON.parse(content)
  } catch (err) {
    console.error(`Error loading ${filePath}:`, err.message)
    return null
  }
}

function extractCodes(items, codeField = "codigo") {
  if (!Array.isArray(items)) return []
  return items.map(item => item[codeField]).filter(Boolean)
}

// Cargar datos de stock
const stockData = loadJson(STOCK_CACHE_FILE)
if (!stockData) {
  console.error("No se pudo cargar stock-cache.json")
  process.exit(1)
}

const stockCodes = extractCodes(stockData)
const uniqueStockCodes = [...new Set(stockCodes)]

console.log("=== ANÁLISIS DE LECTURAS FIRESTORE ===\n")
console.log(`Datos base:`)
console.log(`  Stock: ${stockData.length} items (${uniqueStockCodes.length} códigos únicos)`)

// Simular códigos de artículos y alquileres
// Como no tenemos cache de artículos/alquileres, asumimos que vendrían de 3C
// Para este análisis, usamos los mismos códigos de stock como baseline
const articulosCodes = uniqueStockCodes // Suposición: mismos códigos
const alquileresCodes = uniqueStockCodes.slice(0, Math.floor(uniqueStockCodes.length * 0.3)) // Suposición: 30% de stock

console.log(`  Artículos (simulado): ${articulosCodes.length} códigos únicos`)
console.log(`  Alquileres (simulado): ${alquileresCodes.length} códigos únicos`)

const BATCH_SIZE = 30 // Límite de Firestore para queries "in"

function calculateReads(codes) {
  const uniqueCodes = [...new Set(codes)]
  const batches = Math.ceil(uniqueCodes.length / BATCH_SIZE)
  return batches // Cada batch = 1 lectura
}

// ESCENARIO A: 3 inventoryIndex independientes
console.log(`\n=== ESCENARIO A: 3 inventoryIndex independientes ===`)

const stockReadsA = calculateReads(uniqueStockCodes)
const articulosReadsA = calculateReads(articulosCodes)
const alquileresReadsA = calculateReads(alquileresCodes)
const totalReadsA = stockReadsA + articulosReadsA + alquileresReadsA

console.log(`  Stock: ${stockReadsA} lecturas (${uniqueStockCodes.length} códigos / ${BATCH_SIZE})`)
console.log(`  Artículos: ${articulosReadsA} lecturas (${articulosCodes.length} códigos / ${BATCH_SIZE})`)
console.log(`  Alquileres: ${alquileresReadsA} lecturas (${alquileresCodes.length} códigos / ${BATCH_SIZE})`)
console.log(`  TOTAL: ${totalReadsA} lecturas a Firestore`)

// ESCENARIO B: 1 inventoryIndex compartido
console.log(`\n=== ESCENARIO B: 1 inventoryIndex compartido ===`)

// En este escenario, cargamos TODOS los códigos de todos los módulos de una vez
const allCodes = [...new Set([...uniqueStockCodes, ...articulosCodes, ...alquileresCodes])]
const totalReadsB = calculateReads(allCodes)

console.log(`  Códigos totales únicos: ${allCodes.length}`)
console.log(`  Lecturas: ${totalReadsB} (${allCodes.length} códigos / ${BATCH_SIZE})`)
console.log(`  TOTAL: ${totalReadsB} lecturas a Firestore`)

// COMPARACIÓN
console.log(`\n=== COMPARACIÓN ===`)
console.log(`  Escenario A (3 índices): ${totalReadsA} lecturas`)
console.log(`  Escenario B (1 índice): ${totalReadsB} lecturas`)
console.log(`  Diferencia: ${totalReadsA - totalReadsB} lecturas (${((totalReadsA - totalReadsB) / totalReadsA * 100).toFixed(1)}% menos en B)`)

// Análisis de intersección
const stockSet = new Set(uniqueStockCodes)
const articulosSet = new Set(articulosCodes)
const alquileresSet = new Set(alquileresCodes)

const intersectionSA = [...stockSet].filter(c => articulosSet.has(c)).length
const intersectionStockAlquileres = [...stockSet].filter(c => alquileresSet.has(c)).length
const intersectionArticulosAlquileres = [...articulosSet].filter(c => alquileresSet.has(c)).length

const union = new Set([...stockSet, ...articulosSet, ...alquileresSet])

console.log(`\n=== ANÁLISIS DE CONJUNTOS ===`)
console.log(`  Stock ∩ Artículos: ${intersectionSA} códigos compartidos`)
console.log(`  Stock ∩ Alquileres: ${intersectionStockAlquileres} códigos compartidos`)
console.log(`  Artículos ∩ Alquileres: ${intersectionArticulosAlquileres} códigos compartidos`)
console.log(`  Unión total: ${union.size} códigos únicos`)

// Recomendación
console.log(`\n=== RECOMENDACIÓN ===`)
if (totalReadsB < totalReadsA) {
  console.log(`  ✅ Escenario B (1 índice compartido) es MÁS EFICIENTE`)
  console.log(`     Ahorra ${totalReadsA - totalReadsB} lecturas (${((totalReadsA - totalReadsB) / totalReadsA * 100).toFixed(1)}%)`)
} else {
  console.log(`  ⚠️  Escenario A (3 índices) es igual o más eficiente en este caso`)
}

console.log(`\n  Nota: El escenario B evita lecturas duplicadas de códigos que aparecen en múltiples módulos.`)
console.log(`  Con ${union.size} códigos únicos totales vs ${uniqueStockCodes.length + articulosCodes.length + alquileresCodes.length} sin deduplicar.`)