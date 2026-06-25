"use client"

import { useEffect, useState } from "react"
import { getAllSpareParts } from "@/services/spareParts"
import type { SparePart } from "@/types"

let cachedParts: SparePart[] | null = null
let loadingPromise: Promise<SparePart[]> | null = null

export function useSparePartsCache() {
  const [parts, setParts] = useState<SparePart[]>(cachedParts ?? [])
  const [loading, setLoading] = useState(!cachedParts)

  useEffect(() => {
    if (cachedParts) {
      setParts(cachedParts)
      setLoading(false)
      return
    }
    if (loadingPromise) {
      loadingPromise.then((data) => {
        cachedParts = data
        setParts(data)
        setLoading(false)
      })
      return
    }
    loadingPromise = getAllSpareParts()
    loadingPromise.then((data) => {
      cachedParts = data
      setParts(data)
      setLoading(false)
    })
  }, [])

  return { parts, loading }
}
