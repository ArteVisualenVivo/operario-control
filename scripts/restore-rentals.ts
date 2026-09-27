import "../sync-agent/env"
import fs from "fs"
import { parseScaffoldRentals, saveScaffoldRentalStats } from "../src/lib/sync-3c/scaffoldRentals"
import { saveModuleData, readModuleData } from "../src/lib/sync-3c/redisPrimary"
import { Redis } from "@upstash/redis"

async function restore() {
    const redis = Redis.fromEnv()
    const filePath = "automation-watcher/3c_exports/tresc5339843629810723698.xls"
    const buffer = fs.readFileSync(filePath)
    const stats = parseScaffoldRentals(buffer)
    console.log("Restaurando stats: cuerpos =", stats.cuerposAlquilados, ", renglones =", stats.detalle.length)

    const syncId = "alquileres-restauracion-" + Date.now()
    await saveModuleData(redis, {
        module: "alquileres",
        syncId,
        data: stats,
        recordCount: stats.detalle.length,
        degraded: false,
        firestoreStatus: "pending",
        exportInfo: { file: "tresc5339843629810723698.xls", restored: true }
    })

    try {
        await saveScaffoldRentalStats(stats)
        await saveModuleData(redis, {
            module: "alquileres",
            syncId,
            data: stats,
            recordCount: stats.detalle.length,
            degraded: false,
            firestoreStatus: "synced",
            exportInfo: { file: "tresc5339843629810723698.xls", restored: true }
        })
        console.log("Firestore actualizado exitosamente")
    } catch(e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.log("Firestore no disponible o cuota agotada (esperado si está bloqueado), pero Redis quedó 100% restaurado:", msg)
    }

    const check = await readModuleData("alquileres", redis)
    console.log("Verificación Redis -> recordCount:", check?.recordCount, "updatedAt:", check?.updatedAt)
    process.exit(0)
}

restore()
