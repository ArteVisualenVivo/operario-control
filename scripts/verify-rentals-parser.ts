/**
 * Verificación local del parser de alquileres (parseScaffoldRentals).
 *
 * Uso: npx tsx scripts/verify-rentals-parser.ts [ruta-al-export.xls]
 * Sin argumento: toma el export más nuevo de automation-watcher/3c_exports.
 *
 * Sirve para comprobar, ANTES de disparar un sync, qué va a quedar en Redis
 * (module "alquileres") y si los códigos de máquinas aparecen en el detalle.
 */
import fs from "fs"
import os from "os"
import path from "path"
import { parseScaffoldRentals } from "../src/lib/sync-3c/scaffoldRentals"

const EXPORTS_DIR = path.resolve(process.cwd(), "automation-watcher/3c_exports")


const providedPath = process.argv[2]
const scanResults: Record<string, unknown>[] = []

if (!providedPath) {
    // Escaneo por defecto: qué export (de los últimos 20) trae datos de alquileres.
    const files = fs
        .readdirSync(EXPORTS_DIR)
        .filter((f) => /\.xlsx?$/i.test(f))
        .map((f) => ({ f, mtime: fs.statSync(path.join(EXPORTS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 20)
    for (const { f, mtime } of files) {
        try {
            const s = parseScaffoldRentals(fs.readFileSync(path.join(EXPORTS_DIR, f)))
            console.log(`${new Date(mtime).toISOString()} | ${f} | cuerpos=${s.cuerposAlquilados} renglones=${s.detalle.length}`)
            scanResults.push({ file: f, mtime: new Date(mtime).toISOString(), cuerpos: s.cuerposAlquilados, renglones: s.detalle.length })
        } catch (e) {
            console.log(`${new Date(mtime).toISOString()} | ${f} | ERROR ${(e as Error).message.slice(0, 80)}`)
            scanResults.push({ file: f, mtime: new Date(mtime).toISOString(), error: (e as Error).message.slice(0, 120) })
        }
    }
    const out = path.join(os.tmpdir(), "rentals-scan.json")
    fs.writeFileSync(out, JSON.stringify(scanResults, null, 2))
    console.log(`scan JSON -> ${out}`)
    process.exit(0)
}

const target = path.resolve(providedPath)
console.log(`Export: ${target}`)

const buffer = fs.readFileSync(target)
const stats = parseScaffoldRentals(buffer)

const codigos = stats.detalle.map((r) => String(r.codigo ?? "").trim()).filter(Boolean)
const unicos = [...new Set(codigos)]

console.log(`cuerposAlquilados: ${stats.cuerposAlquilados}`)
console.log(`detalle (renglones): ${stats.detalle.length}`)
console.log(`codigos unicos: ${unicos.length}`)
console.log(`primeros 20 codigos: ${unicos.slice(0, 20).join(", ")}`)

const maquinas = unicos.filter((c) => !c.startsWith("28") && !c.startsWith("29"))
console.log(`codigos NO-andamio (maquinas): ${maquinas.length} -> ${maquinas.slice(0, 30).join(", ")}`)

const objs = stats.detalle.filter((r) => String(r.codigo ?? "").trim() === "32701" || String(r.codigo ?? "").trim() === "22001")
console.log(`muestras 32701/22001: ${JSON.stringify(objs.slice(0, 4), null, 2)}`)
