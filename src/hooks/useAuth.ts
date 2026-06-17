"use client"

import { useEffect, useState } from "react"
import { User } from "firebase/auth"
import { onAuthChange, login, logout } from "@/services/auth"

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      setUser(user)
      setLoading(false)
    })
    return unsub
  }, [])

  return { user, loading, login, logout }
}
