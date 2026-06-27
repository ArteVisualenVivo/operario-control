const fs = require("fs")
const path = require("path")
const chokidar = require("chokidar")
const config = require("./config")
const { parseExcel, computeHash } = require("./excel-parser")
const { syncStock } = require("./firebase-sync")

// ============================================================
// STATE (anti-duplicado)
// ============================================================
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(config.stateFile, "utf-8"))
  } catch {
    return { lastFile: null, lastHash: null, lastSync: null, processedCount: 0 }
  }
}

function saveState(state) {
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2))
}

// ============================================================
// LOGGING
// ============================================================
function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19)
  console.log(`[${ts}] ${msg}`)
}

// ============================================================
// PROCESAMIENTO
// ============================================================
async function processFile(filePath) {
  const filename = path.basename(filePath)

  log(`Archivo detectado: ${filename}`)

  // Esperar a que termine la escritura
  await new Promise((r) => setTimeout(r, config.excelWaitMs))

  if (!fs.existsSync(filePath)) {
    log(`Archivo ya no existe: ${filename} (posible rename en progreso)`)
    return
  }

  const state = loadState()
  const hash = computeHash(filePath)

  if (hash === state.lastHash) {
    log(`Archivo ya procesado anteriormente: ${filename}`)
    return
  }

  log(`Parseando: ${filename}`)

  let items
  try {
    items = parseExcel(filePath, config)
  } catch (err) {
    log(`ERROR al parsear Excel: ${err.message}`)
    return
  }

  if (items.length === 0) {
    log(`Sin datos válidos en: ${filename}`)
    return
  }

  log(`${items.length} ítems encontrados. Sincronizando con Firebase...`)

  let result
  try {
    result = await syncStock(items, config)
  } catch (err) {
    log(`ERROR al sincronizar Firebase: ${err.message}`)
    return
  }

  // Actualizar estado
  saveState({
    lastFile: filename,
    lastHash: hash,
    lastSync: new Date().toISOString(),
    processedCount: state.processedCount + 1,
  })

  log(`[OK] Sincronizado: ${result.updated} actualizados, ${result.skipped} omitidos`)

  for (const w of result.warnings) {
    log(`  ⚠ ${w}`)
  }
}

// ============================================================
// WATCHER
// ============================================================
function start() {
  // Crear carpeta si no existe
  if (!fs.existsSync(config.watchDir)) {
    fs.mkdirSync(config.watchDir, { recursive: true })
    log(`Carpeta creada: ${config.watchDir}`)
  }

  log(`Iniciando watcher: ${config.watchDir}`)
  log(`Modo estricto: ${config.strictMode}`)

  const watcher = chokidar.watch(config.watchDir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: {
      stabilityThreshold: 1500,
      pollInterval: 300,
    },
  })

  watcher.on("add", (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath)

    // Ignorar temporales de Excel y no-xlsx
    if (base.startsWith("~$") || ext !== ".xlsx") return

    // Pequeño debounce extra para evitar doble trigger
    setTimeout(() => processFile(filePath), 500)
  })

  watcher.on("error", (err) => {
    log(`ERROR en watcher: ${err.message}`)
  })

  log("Watcher listo. Esperando archivos Excel...")
}

// ============================================================
// MAIN
// ============================================================
if (require.main === module) {
  start()
}

module.exports = { start }
