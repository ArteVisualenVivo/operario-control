"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { getStockIntelligence } from "@/services/stockIntelligence"
import type { StockIntelligence } from "@/types"
import type { MachineRepair } from "@/types"

export function useStockIntelligence(options?: { repairs?: MachineRepair[] }) {
  const [intelligence, setIntelligence] = useState<StockIntelligence | null>(null)
  const [loading, setLoading] = useState(true)
  const optionsRef = useRef(options)
  const lastOptionsKeyRef = useRef<string | null>(null)
  
  // Actualizar el ref con el valor actual
  optionsRef.current = options
  
  // Crear una clave estable para detectar cambios en repairs
  const optionsKey = options?.repairs ? JSON.stringify(options.repairs.map(r => r.id).sort()) : null

  const refresh = useCallback(async () => {
    setLoading(true)
    const data = await getStockIntelligence(optionsRef.current)
    setIntelligence(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    // Solo ejecutar si la clave cambió o es la primera vez
    if (lastOptionsKeyRef.current === optionsKey && lastOptionsKeyRef.current !== null) {
      return
    }
    lastOptionsKeyRef.current = optionsKey
    
    let mounted = true
    getStockIntelligence(optionsRef.current).then((data) => {
      if (mounted) {
        setIntelligence(data)
        setLoading(false)
      }
    })
    return () => { mounted = false }
  }, [optionsKey])

  return { intelligence, loading, refresh }
}