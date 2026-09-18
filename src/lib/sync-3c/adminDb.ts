/**
 * adminDb.ts — Admin SDK de Firestore para ejecución en NODE.
 *
 * Por qué existe: en el navegador el client SDK usa la sesión del usuario, pero
 * en NODE (agente local, API routes, scripts) NO hay sesión y el client SDK
 * responde "Missing or insufficient permissions" (además de contar contra las
 * reglas de seguridad). El Admin SDK usa la service account y no depende de
 * reglas.
 *
 * Es el MISMO mecanismo que ya usan engine.ts / firestoreSync.ts /
 * sparePartOrders.ts con `sync-agent/service-account.json`. No es un backend
 * nuevo: es el camino server-side que ya existe en el proyecto.
 *
 * En el navegador devuelve null (el llamador debe usar el client SDK).
 */

export interface AdminFirestoreLike {
  collection: (name: string) => {
    get: () => Promise<{ docs: { id: string; data: () => Record<string, unknown> }[] }>
  }
}

let cached: AdminFirestoreLike | null = null
let resolved = false

/** Admin SDK de Firestore cuando corremos en Node; null en el navegador. */
export async function getAdminFirestore(): Promise<AdminFirestoreLike | null> {
  if (typeof window !== "undefined") return null
  if (resolved) return cached
  resolved = true
  try {
    const fs = await import("fs")
    const path = await import("path")
    const { initializeApp, cert, getApps } = await import("firebase-admin/app")
    const { getFirestore } = await import("firebase-admin/firestore")
    const candidates = [
      path.resolve(process.cwd(), "sync-agent", "service-account.json"),
      path.resolve(process.cwd(), "..", "sync-agent", "service-account.json"),
    ]
    const saPath = candidates.find((candidate) => fs.existsSync(candidate))
    if (!saPath) throw new Error(`No se encontró service-account.json en: ${candidates.join(", ")}`)
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"))
    const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) })
    cached = getFirestore(app) as unknown as AdminFirestoreLike
    return cached
  } catch (err) {
    console.error(
      "[adminDb] Admin SDK no disponible (se usa el client SDK):",
      err instanceof Error ? err.message : err,
    )
    cached = null
    return null
  }
}
