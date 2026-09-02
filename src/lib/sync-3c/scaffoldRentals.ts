import * as XLSX from "xlsx"
import {
    SCAFFOLD_STRUCTURE_CODES,
    isScaffoldStructureCode,
    isScaffoldStructureDescription,
    normalizeCode,
} from "@/lib/inventoryGroups"

// =============================================================================
// scaffoldRentals.ts — Cálculo de cuerpos de andamio ALQUILADOS
// (Alquileres pendientes exportados desde 3C: Ventas → Informes → Remitos)
//
// REGLA DE NEGOCIO:
// - Un cuerpo completo de andamio = artículo cuyo código 3C sea A03, A04, A07,
//   28501 o 28601, y cuya descripción corresponda a estructuras de andamios.
// - La cantidad se obtiene SUMANDO la columna CANTIDAD (no contando filas).
// - Se recorre TODO el Excel (todas las hojas, todas las filas).
// - NO se descuenta del stock ni se altera inventory_stock.
// =============================================================================

export interface ScaffoldRentalDetail {
    codigo: string
    descripcion: string
    cantidad: number
    cliente: string
    clienteId?: string
    remito: string
    fecha: string
    devolucion?: string
}

export interface ScaffoldRentalStats {
    fechaSync: string
    cuerposAlquilados: number
    detalle: ScaffoldRentalDetail[]
    /** Agregados por familia (andamios, ruedas, tablones) para la vista de Andamios. */
    resumen?: ScaffoldRentalResumen
}

export interface ScaffoldRentalResumen {
    /** Estructuras de andamio alquiladas (módulos, incluye pasilleros). */
    estructuras: number
    /** Estructuras identificadas como andamio pasillero (por descripción). */
    pasilleros: number
    ruedasSinFreno: number
    ruedasConFreno: number
    /** Juegos de ruedas (set de 4, código 29601). */
    juegosRuedas: number
    tablones: number
}

// Códigos 3C de ruedas y tablones que se alquilan junto al andamio.
const WHEEL_CODES_NOBRAKE = ["N7-1", "N71"]
const WHEEL_CODES_BRAKE = ["29501"]
const WHEEL_CODES_SET = ["29601"]
const PLANK_CODES = ["TA02", "TA03", "28901", "29001", "29101", "29201"]

function isInCodeList(code: string, list: string[]): boolean {
    const normalized = normalizeCode(code)
    if (!normalized) return false
    return list.some((c) => normalizeCode(c) === normalized)
}

/** Convierte un valor de celda a número entero/decimal seguro. */
function toNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value
    const text = String(value ?? "").trim().replace(/\./g, "").replace(",", ".")
    if (!text) return 0
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : 0
}

/** Convierte un valor de celda a texto seguro. */
function toText(value: unknown): string {
    if (value == null) return ""
    if (value instanceof Date) return value.toISOString()
    return String(value).trim()
}

/**
 * Recorre todas las hojas del Excel y extrae los renglones que corresponden
 * a estructuras de andamio alquiladas (códigos A03/A04/A07/28501/28601 y
 * descripción de andamio). Suma la columna CANTIDAD por renglón.
 */
export function parseScaffoldRentals(buffer: ArrayBuffer | Buffer): ScaffoldRentalStats {
    const workbook = XLSX.read(buffer, { type: "buffer" })

    const detalle: ScaffoldRentalDetail[] = []
    let cuerposAlquilados = 0

    for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName]
        if (!worksheet) continue

        const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            raw: true,
            defval: null,
        })

        // Detectar fila de encabezados para mapear columnas dinámicamente.
        const headerIndex = rows.findIndex((row) =>
            Array.isArray(row) &&
            row.some((cell) => {
                const t = toText(cell).toLowerCase()
                return t.includes("codigo") || t.includes("código") || t.includes("cantidad")
            })
        )

        const headerRow = headerIndex >= 0 ? rows[headerIndex] : []
        const idx = (aliases: string[]): number => {
            for (const alias of aliases) {
                const found = headerRow.findIndex((cell) =>
                    toText(cell).toLowerCase().includes(alias)
                )
                if (found >= 0) return found
            }
            return -1
        }

        const COL_CODIGO = idx(["codigo", "código", "articulo", "art"])
        const COL_DESC = idx(["descripcion", "descrip", "detalle", "articulo", "producto"])
        const COL_CANT = idx(["cantidad", "qty", "cant"])
        // Nombre del cliente primero (CLIENTE_NOMBRE_CP); el id va aparte.
        const COL_CLIENTE = idx(["cliente_nombre", "razon", "destinatario"])
        const COL_CLIENTE_ID = idx(["cliente_id", "cliente"])
        const COL_REMITO = idx(["remito", "nro", "numero", "comprobante"])
        const COL_FECHA = idx(["fecha", "emision", "fecha"])
        const COL_DEVOLUCION = idx(["devolucion"])

        const startRow = headerIndex >= 0 ? headerIndex + 1 : 0

        for (let i = startRow; i < rows.length; i++) {
            const row = rows[i]
            if (!Array.isArray(row)) continue

            const codigoRaw = COL_CODIGO >= 0 ? toText(row[COL_CODIGO]) : ""
            const descripcion = COL_DESC >= 0 ? toText(row[COL_DESC]) : ""
            const cantidad = COL_CANT >= 0 ? toNumber(row[COL_CANT]) : 0

            if (cantidad <= 0) continue

            // Criterio: estructuras (código de estructura Y descripción de andamio),
            // o ruedas/tablones por código 3C.
            const matchCode = isScaffoldStructureCode(codigoRaw)
            const matchDesc = isScaffoldStructureDescription(descripcion)
            const isWheel =
                isInCodeList(codigoRaw, WHEEL_CODES_NOBRAKE) ||
                isInCodeList(codigoRaw, WHEEL_CODES_BRAKE) ||
                isInCodeList(codigoRaw, WHEEL_CODES_SET)
            const isPlank = isInCodeList(codigoRaw, PLANK_CODES)

            const isStructure = matchCode && matchDesc
            if (!isStructure && !isWheel && !isPlank) continue

            const normalizedCodigo = normalizeCode(codigoRaw)

            // Las ruedas sueltas a veces se alquilan en packs ("(4 RUEDAS)",
            // "(8 unid.)"): la cantidad de la fila es packs, hay que multiplicar.
            // El JUEGO de ruedas (29601) ya es un set, no se multiplica.
            let cantidadFinal = cantidad
            if (isWheel && !isInCodeList(codigoRaw, WHEEL_CODES_SET)) {
                const pack = descripcion.match(/\((\d+)\s*(?:ruedas?|unid|unidades)/i)
                if (pack) cantidadFinal = cantidad * Number(pack[1])
            }

            detalle.push({
                codigo: normalizedCodigo,
                descripcion,
                cantidad: cantidadFinal,
                cliente: COL_CLIENTE >= 0 ? toText(row[COL_CLIENTE]) : "",
                clienteId: COL_CLIENTE_ID >= 0 ? toText(row[COL_CLIENTE_ID]) : undefined,
                remito: COL_REMITO >= 0 ? toText(row[COL_REMITO]) : "",
                fecha: COL_FECHA >= 0 ? toText(row[COL_FECHA]) : "",
                devolucion: COL_DEVOLUCION >= 0 ? toText(row[COL_DEVOLUCION]) || undefined : undefined,
            })

            if (isStructure) cuerposAlquilados += cantidad
        }
    }

    // Agregados por familia para la vista de Andamios.
    const resumen: ScaffoldRentalResumen = {
        estructuras: 0,
        pasilleros: 0,
        ruedasSinFreno: 0,
        ruedasConFreno: 0,
        juegosRuedas: 0,
        tablones: 0,
    }
    for (const row of detalle) {
        const desc = row.descripcion.toLowerCase()
        if (isScaffoldStructureCode(row.codigo)) {
            resumen.estructuras += row.cantidad
            if (/pasillero|pasillo/.test(desc)) resumen.pasilleros += row.cantidad
        } else if (isInCodeList(row.codigo, WHEEL_CODES_NOBRAKE)) {
            resumen.ruedasSinFreno += row.cantidad
        } else if (isInCodeList(row.codigo, WHEEL_CODES_BRAKE)) {
            resumen.ruedasConFreno += row.cantidad
        } else if (isInCodeList(row.codigo, WHEEL_CODES_SET)) {
            resumen.juegosRuedas += row.cantidad
        } else if (isInCodeList(row.codigo, PLANK_CODES)) {
            resumen.tablones += row.cantidad
        }
    }

    return {
        fechaSync: new Date().toISOString(),
        cuerposAlquilados,
        detalle,
        resumen,
    }
}

/**
 * Persiste las estadísticas en Firestore (colección dashboard_stats /
 * documento scaffold_rentals). Usa Admin SDK igual que engine.ts.
 * Si Firebase está bloqueado, lanza para que el agente aplique fallback.
 */
export async function saveScaffoldRentalStats(stats: ScaffoldRentalStats): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const admin = require("firebase-admin")
    const fs = require("fs")
    const path = require("path")
    const serviceAccountPathHere = path.resolve(__dirname, "..", "..", "..", "sync-agent", "service-account.json")
    const serviceAccountPathCwd = path.resolve(process.cwd(), "sync-agent/service-account.json")
    const serviceAccountPath = fs.existsSync(serviceAccountPathHere) ? serviceAccountPathHere : serviceAccountPathCwd

    if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(
            "[FIREBASE] Missing sync-agent/service-account.json para guardar scaffold_rentals."
        )
    }

    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"))
    const apps = admin.getApps()
    if (apps.length > 0) {
        for (const app of apps) {
            try { app.delete() } catch { /* noop */ }
        }
    }
    admin.initializeApp({ credential: admin.cert(serviceAccount) })

    const { getFirestore } = require("firebase-admin/firestore")
    const db = getFirestore()
    await db
        .collection("dashboard_stats")
        .doc("scaffold_rentals")
        .set({ ...stats }, { merge: true })
}

export { SCAFFOLD_STRUCTURE_CODES }