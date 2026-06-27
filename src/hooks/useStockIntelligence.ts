"use client"

import { useEffect, useState, useCallback } from "react"
import { getStockIntelligence } from "@/services/stockIntelligence"
import type { StockIntelligence } from "@/types"

export function useStockIntelligence() {
  const [intelligence, setIntelligence] = useState<StockIntelligence | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const data = await getStockIntelligence()
    setIntelligence(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    let mounted = true
    getStockIntelligence().then((data) => {
      if (mounted) {
        setIntelligence(data)
        setLoading(false)
      }
    })
    return () => { mounted = false }
  }, [])

  return { intelligence, loading, refresh }
}
