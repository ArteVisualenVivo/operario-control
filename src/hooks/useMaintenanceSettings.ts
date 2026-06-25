"use client"

import { useEffect, useState, useCallback } from "react"
import type { MaintenanceSettings } from "@/types"
import * as maintenanceSettingsService from "@/services/maintenanceSettings"

export function useMaintenanceSettings() {
  const [settings, setSettings] = useState<MaintenanceSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await maintenanceSettingsService.getMaintenanceSettings()
    setSettings(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const update = useCallback(async (data: MaintenanceSettings) => {
    await maintenanceSettingsService.updateMaintenanceSettings(data)
    await load()
  }, [load])

  return { settings, loading, update, reload: load }
}
