// store.ts — Persistencia de facturas en Redis (módulo `invoices`).
//
// Todo el listado de facturas vive en UN envelope particionado de
// redisPrimary (mismo mecanismo que spare_part_orders). Escala cómoda
// hasta miles de facturas; la reescritura es read-modify-write y el uso
// real es de una sola persona a la vez.
import type { InvoiceRecord } from "@/types/invoice"
import { getRedis, readModuleData, saveModuleData } from "@/lib/sync-3c/redisPrimary"

const MODULE = "invoices" as const

function sortDesc(list: InvoiceRecord[]): InvoiceRecord[] {
  return [...list].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
}

async function readAll(): Promise<InvoiceRecord[]> {
  const env = await readModuleData(MODULE, getRedis())
  const data = env?.data
  if (!Array.isArray(data)) return []
  return (data as InvoiceRecord[]).filter((i) => i && typeof i.id === "string")
}

async function persist(list: InvoiceRecord[]): Promise<void> {
  const sorted = sortDesc(list)
  await saveModuleData(getRedis(), {
    module: MODULE,
    syncId: `invoices-${Date.now()}`,
    data: sorted,
    recordCount: sorted.length,
    degraded: false,
    firestoreStatus: "synced",
  })
}

export async function listInvoices(): Promise<InvoiceRecord[]> {
  return sortDesc(await readAll())
}

export async function getInvoice(id: string): Promise<InvoiceRecord | null> {
  const all = await readAll()
  return all.find((i) => i.id === id) ?? null
}

/** Upsert de UNA factura (lee, reemplaza/agrega, guarda). */
export async function putInvoice(record: InvoiceRecord): Promise<InvoiceRecord> {
  const all = await readAll()
  const idx = all.findIndex((i) => i.id === record.id)
  if (idx >= 0) all[idx] = record
  else all.push(record)
  await persist(all)
  return record
}

export async function deleteInvoice(id: string): Promise<boolean> {
  const all = await readAll()
  const next = all.filter((i) => i.id !== id)
  if (next.length === all.length) return false
  await persist(next)
  return true
}
