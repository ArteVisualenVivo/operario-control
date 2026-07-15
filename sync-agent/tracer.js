#!/usr/bin/env node

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const LOGS_DIR = path.join(__dirname, "logs")

// Asegurar que existe el directorio de logs
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true })
}

// Crear archivo de log único por ejecución
const timestamp = new Date().toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "")
    .replace("T", "_")
const LOG_FILE = path.join(LOGS_DIR, `sync-trace-${timestamp}.log`)

// Stream de escritura
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" })

// Buffer para acumular logs antes de escribir
let buffer = []
let bufferSize = 0
const MAX_BUFFER_SIZE = 1024 * 1024 // 1MB

/**
 * Escribe en el log con timestamp
 */
export function trace(category, message, data = {}) {
    const timestamp = new Date().toISOString()
    const line = {
        timestamp,
        category,
        message,
        ...data,
    }

    const lineStr = JSON.stringify(line) + "\n"
    buffer.push(lineStr)
    bufferSize += lineStr.length

    // Flush si el buffer es muy grande
    if (bufferSize >= MAX_BUFFER_SIZE) {
        flush()
    }
}

/**
 * Fuerza escritura del buffer al archivo
 */
export function flush() {
    if (buffer.length > 0) {
        logStream.write(buffer.join(""))
        buffer = []
        bufferSize = 0
    }
}

/**
 * Cierra el stream de logging
 */
export function close() {
    flush()
    logStream.end()
}

// Flush automático cada 5 segundos
setInterval(flush, 5000)

// Flush al cerrar el proceso
process.on("exit", () => {
    flush()
    logStream.end()
})

process.on("SIGINT", () => {
    flush()
    logStream.end()
    process.exit(0)
})

process.on("SIGTERM", () => {
    flush()
    logStream.end()
    process.exit(0)
})

export default {
    trace,
    flush,
    close,
}