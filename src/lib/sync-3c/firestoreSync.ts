import type { Sync3CItem } from "./types"
import { getFirebaseAdmin, loadInventoryIndex } from "./engine"

// ============================================================================
// firestoreSync.ts — Reescritura Firestore idempotente para el OUTBOX.
// Reproduce EXACTAMENTE la estrategia de identidad de syncItems():
//   - Carga el índice real de inventory_stock (busca por codigo y name).
//   - Si hay match → reutiliza el doc.id existente (merge). NO crea duplicados.
//   - Si no hay match → crea un doc nuevo con id auto-generado (como syncItems).
// Se omite stockRented para NO pisar alquileres gestionados manualmente (merge).
// ============================================================================

export async function writeStockItemsIdempotent(items: Sync3CItem[]): Promise<void> {
  getFirebaseAdmin() // inicializa el Admin SDK
  const { getFirestore } = require("firebase-admin/firestore")
  const db = getFirestore()
  const collection = db.collection("inventory_stock")

  // Misma estrategia que syncItems(): índice por codigo y por name → doc id.
  const inventoryIndex = await loadInventoryIndex()

  const BATCH_LIMIT = 400
  let batch = db.batch()
  let counter = 0

  for (const item of items) {
    // Buscar el doc existente por identidad lógica (codigo / name)
    let matchId: string | null = null
    if (item.codigo && inventoryIndex.has(item.codigo)) {
      matchId = inventoryIndex.get(item.codigo)!.id
    } else if (inventoryIndex.has(item.name)) {
      matchId = inventoryIndex.get(item.name)!.id
    }

    // Sin stockRented: merge conserva el valor real gestionado por CRUD now.
    const payload: Record<string, unknown> = {
      codigo: item.codigo,
      stockTotal: item.stockTotal,
      stockAvailable: item.stockTotal,
      unit: item.unit,
      deposito: item.deposito,
      source: "3c",
      stockWarning: item.stockWarning || false,
      lastSync: new Date(),
      updatedAt: new Date(),
      category: item.category ?? "consumibles",
      subtype: item.subtype ?? null,
      scaffoldKind: item.scaffoldKind ?? null,
    }

    if (matchId) {
      // Reusar el doc existente (idempotente respecto al histórico)
      batch.set(collection.doc(matchId), payload, { merge: true })
    } else {
      // Crear doc nuevo con id auto-generado (igual que syncItems en strictMode=false)
      batch.set(collection.doc(), {
        ...payload,
        name: item.name,
        category: item.category ?? "consumibles",
        locationType: "deposito",
        size: null,
        createdAt: new Date(),
      })
    }
    counter++
    if (counter >= BATCH_LIMIT) {
      await batch.commit()
      batch = db.batch()
      counter = 0
    }
  }
  if (counter > 0) await batch.commit()
}

