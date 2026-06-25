"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getWorkshopStats } from "@/services/repairs"

export default function WorkshopSummary() {
  const router = useRouter()
  const [stats, setStats] = useState({
    inTaller: 0,
    finishedToday: 0,
    overdue: 0,
    upcoming: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getWorkshopStats().then((data) => {
      setStats(data)
      setLoading(false)
    })
  }, [])

  const items = [
    {
      label: "En taller",
      value: stats.inTaller,
      color: "text-blue-600",
      href: "/repairs?status=EN_TALLER",
    },
    {
      label: "Finalizados hoy",
      value: stats.finishedToday,
      color: "text-green-600",
      href: "/repairs",
    },
    {
      label: "Mant. vencidos",
      value: stats.overdue,
      color: "text-red-600",
      href: "/maintenance",
    },
    {
      label: "Próximos 7d",
      value: stats.upcoming,
      color: "text-amber-600",
      href: "/maintenance",
    },
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {items.map((item) => (
          <Card key={item.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-muted-foreground">—</p>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map((item) => (
        <Card
          key={item.label}
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => router.push(item.href)}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {item.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${item.color}`}>{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
