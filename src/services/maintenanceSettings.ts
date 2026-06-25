import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createAuditLog } from "./audit"
import type { MaintenanceSettings } from "@/types"

const COLLECTION = "maintenance_settings"
const DOC_ID = "config"

const DEFAULTS: MaintenanceSettings = {
  oilChangeDays: 90,
  bearingChangeDays: 180,
  maintenanceDays: 365,
  warrantyDays: 90,
}

export async function getMaintenanceSettings(): Promise<MaintenanceSettings> {
  try {
    const ref = doc(db, COLLECTION, DOC_ID)
    const snap = await getDoc(ref)
    if (!snap.exists()) return { ...DEFAULTS }
    const data = snap.data()
    return {
      oilChangeDays: (data.oilChangeDays as number) ?? DEFAULTS.oilChangeDays,
      bearingChangeDays: (data.bearingChangeDays as number) ?? DEFAULTS.bearingChangeDays,
      maintenanceDays: (data.maintenanceDays as number) ?? DEFAULTS.maintenanceDays,
      warrantyDays: (data.warrantyDays as number) ?? DEFAULTS.warrantyDays,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function updateMaintenanceSettings(data: MaintenanceSettings): Promise<void> {
  const before = await getMaintenanceSettings()
  const ref = doc(db, COLLECTION, DOC_ID)
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
  })
  await createAuditLog("update", "maintenance_settings", DOC_ID, before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>)
}
