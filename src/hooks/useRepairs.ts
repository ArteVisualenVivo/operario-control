"use client"

import { useState } from "react"

export function useRepairs() {
  const [repairs] = useState<never[]>([])
  const [loading] = useState(false)
  return { repairs, loading }
}
