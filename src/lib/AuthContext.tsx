"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react"
import { User } from "firebase/auth"
import { onAuthChange, login, logout } from "@/services/auth"

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => { throw new Error("AuthContext not ready") },
  logout: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      setUser(user)
      setLoading(false)
    })
    // Timeout de seguridad: si onAuthStateChanged no llama al callback en 5s, asumir no hay usuario
    const timeout = setTimeout(() => {
      setLoading(false)
    }, 5000)
    return () => {
      clearTimeout(timeout)
      unsub()
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
