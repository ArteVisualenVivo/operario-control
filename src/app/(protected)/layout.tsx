"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useAuth } from "@/lib/AuthContext"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/machines", label: "Máquinas" },
  { href: "/andamios", label: "Andamios" },
  { href: "/inventory", label: "Inventario" },
  { href: "/rentals", label: "Alquileres" },
  { href: "/repairs", label: "Reparaciones" },
  { href: "/stock-movements", label: "Mov. Stock" },
  { href: "/maintenance", label: "Mantenimiento" },
]

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login")
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          OPERARIO CONTROL
        </Link>
        <nav className="flex items-center gap-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`text-sm font-medium transition-colors hover:text-primary ${
                pathname.startsWith(item.href) ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <Separator orientation="vertical" className="h-6" />
          <span className="text-xs text-muted-foreground">{user.email}</span>
          <Button variant="outline" size="sm" onClick={logout}>
            Salir
          </Button>
        </nav>
      </header>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  )
}
