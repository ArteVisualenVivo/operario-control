import { db } from "@/lib/firebase"
import { doc, getDoc } from "firebase/firestore"

export interface PuntalAlquilados {
    barovo: number
    marron: number
    naranja: number
    largo380: number
    mmq: number
    total: number
}

export interface ScaffoldRentalStats {
    fechaSync: string
    cuerposAlquilados: number
    detalle: {
        codigo: string
        descripcion: string
        cantidad: number
        cliente: string
        clienteId?: string
        remito: string
        fecha: string
        devolucion?: string
    }[]
    resumen?: {
        estructuras: number
        pasilleros: number
        ruedasSinFreno: number
        ruedasConFreno: number
        juegosRuedas: number
        tablones: number
        puntalEstructuras: PuntalAlquilados
    }
    deposito?: {
        modulos: number
        pasilleros: number
        riendasLargas: number
        riendasCortas: number
        tablones: number
        ruedasSinFreno: number
        ruedasConFreno: number
        juegosRuedas: number
        puntalEstructuras: number
    }
}

/**
 * Lee el stock manual de andamios guardado en depósito (Redis).
 */
export async function loadScaffoldDeposito(): Promise<ScaffoldRentalStats['deposito'] | null> {
    try {
        const res = await fetch('/api/andamios/deposito', { cache: 'no-store' })
        if (res.ok) {
            const body = await res.json()
            if (body?.available && body.items) {
                const i = body.items as Record<string, number>
                return {
                    modulos: i.modulos ?? 0,
                    pasilleros: i.pasilleros ?? 0,
                    riendasLargas: i.riendasLargas ?? 0,
                    riendasCortas: i.riendasCortas ?? 0,
                    tablones: i.tablones ?? 0,
                    ruedasSinFreno: i.ruedasSinFreno ?? 0,
                    ruedasConFreno: i.ruedasConFreno ?? 0,
                    juegosRuedas: i.juegosRuedas ?? 0,
                    puntalEstructuras: i.puntalEstructuras ?? 0,
                }
            }
        }
    } catch {
        // ignora
    }
    return null
}

/**
 * Lee las estadísticas de alquileres de andamios desde Redis
 * (scaffold_rentals). Devuelve null si no existe aún.
 */
export async function loadScaffoldRentalStats(): Promise<ScaffoldRentalStats | null> {
    // 1) FUENTE PRIMARIA (Redis)
    try {
        const res = await fetch('/api/sync-3c/data/alquileres', { cache: 'no-store' })
        if (res.ok) {
            const body = await res.json()
            if (body?.available && body?.data) {
                const data = body.data as ScaffoldRentalStats
                const deposito = await loadScaffoldDeposito()
                if (deposito) data.deposito = deposito
                return data
            }
        }
    } catch {
        // sigue a Firestore
    }

    // 2) FALLBACK: Firestore
    try {
        const ref = doc(db, 'dashboard_stats', 'scaffold_rentals')
        const snap = await getDoc(ref)
        if (!snap.exists()) return null
        return snap.data() as ScaffoldRentalStats
    } catch {
        return null
    }
}
