import { db } from "@/lib/firebase"
import { doc, getDoc } from "firebase/firestore"

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
    }
}

/**
 * Lee las estadísticas de alquileres de andamios desde Firestore
 * (dashboard_stats / scaffold_rentals). Devuelve null si no existe aún.
 * Solo lectura: no altera inventory_stock ni ningún otro dato.
 */
export async function loadScaffoldRentalStats(): Promise<ScaffoldRentalStats | null> {
    // 1) FUENTE PRIMARIA (Redis): datos recién procesados por el agente.
    //    Funciona aunque Firestore esté sin cuota.
    try {
        const res = await fetch(`/api/sync-3c/data/alquileres`, { cache: "no-store" })
        if (res.ok) {
            const body = await res.json()
            if (body?.available && body?.data) {
                return body.data as ScaffoldRentalStats
            }
        }
    } catch {
        // sigue a Firestore
    }

    // 2) FALLBACK: Firestore
    try {
        const ref = doc(db, "dashboard_stats", "scaffold_rentals")
        const snap = await getDoc(ref)
        if (!snap.exists()) return null
        return snap.data() as ScaffoldRentalStats
    } catch {
        return null
    }
}