// local-sync.server.ts — Puentes SOLO SERVIDOR (Node) de local-sync.
//
// REGLA DE ARQUITECTURA: este archivo importa fs/path/xlsx/firebase-admin
// (vía local-sync-excel y adminDb). NUNCA debe importarse desde el cliente
// (ni directa ni transitivamente): Turbopack lo incluiría en el bundle del
// navegador → "Module not found: Can't resolve 'fs'".
//
// Los componentes web leen vía fetch a /api/* (Redis) o Firestore client SDK.

import { registerLocalSyncServerStore } from "./local-sync"
import type { MaintenanceRecord } from "@/services/maintenance"

/** Lee el Excel local de 3C (solo disco del servidor/agente). */
export async function loadFromExcelServer(): Promise<MaintenanceRecord[]> {
  if (typeof window !== "undefined") return []
  const fs = await import("node:fs")
  const path = await import("node:path")
  void fs
  const exportsDir = path.resolve(process.cwd(), "automation-watcher/3c_exports")
  const cacheFile = path.join(process.cwd(), "automation-watcher/cache", "maintenance-cache.json")
  const { loadFromExcelFromDirs } = await import("./local-sync-excel")
  return loadFromExcelFromDirs(exportsDir, cacheFile)
}

/** Lee la colección maintenance con el Admin SDK (service account, sin reglas). */
export async function loadMaintenanceAdminServer(): Promise<MaintenanceRecord[] | null> {
  if (typeof window !== "undefined") return null
  try {
    const { getAdminFirestore } = await import("./sync-3c/adminDb")
    const admin = await getAdminFirestore()
    if (!admin) return null
    const snap = await admin.collection("maintenance").get()
    return snap.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        ...data,
        entryDate: data.entryDate ? new Date(data.entryDate as string) : new Date(),
        returnDate: data.returnDate ? new Date(data.returnDate as string) : undefined,
        repairDate: data.repairDate ? new Date(data.repairDate as string) : undefined,
        statusDate: data.statusDate ? new Date(data.statusDate as string) : undefined,
        createdAt: data.createdAt ? new Date(data.createdAt as string) : new Date(),
        updatedAt: data.updatedAt ? new Date(data.updatedAt as string) : new Date(),
      } as MaintenanceRecord
    })
  } catch (err) {
    console.error("[local-sync.server] Admin loadFromFirestore falló:", err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Instala el backend servidor en `local-sync.ts` (Excel local + Admin SDK).
 *
 * Igual que Pedidos Rep.: `local-sync.ts` es ISOMORFO y no puede importar este
 * archivo (Turbopack incluiría xlsx/firebase-admin en el bundle del navegador →
 * "module is not defined"). Por eso el backend se INYECTA desde Node. Solo la
 * llama el agente local al arrancar; el navegador nunca ejecuta esto.
 */
export function installLocalSyncServerStore(): void {
  registerLocalSyncServerStore({
    loadFromExcelServer,
    loadMaintenanceAdminServer,
  })
}
