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
        remito: string
        fecha: string
    }[]
}

/**
 * Lee las estadísticas de alquileres de andamios desde Firestore
 * (dashboard_stats / scaffold_rentals). Devuelve null si no existe aún.
 * Solo lectura: no altera inventory_stock ni ningún otro dato.
 */
export async function loadScaffoldRentalStats(): Promise<ScaffoldRentalStats | null> {
    try {
        const ref = doc(db, "dashboard_stats", "scaffold_rentals")
        const snap = await getDoc(ref)
        if (!snap.exists()) return null
        return snap.data() as ScaffoldRentalStats
    } catch {
        return null
    }
}