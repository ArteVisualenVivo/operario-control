"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { AlertTriangle, AlertCircle, Info } from "lucide-react"
import { getRepairs } from "@/services/repairs"
import { useStockIntelligence } from "@/hooks/useStockIntelligence"
import type { MachineRepair } from "@/types"
import type { StockAlert } from "@/types"

interface SmartAlert {
  id: string
  severity: "critical" | "preventive" | "recommendation"
  title: string
  description: string
  machineId?: string
  machineName?: string
  machineModel?: string
  repairId?: string
  entityType?: string
  href?: string
}

function detectRepetitiveFailures(repairs: MachineRepair[]): SmartAlert[] {
  const grouped = new Map<string, { count: number; items: MachineRepair[] }>()
  for (const r of repairs) {
    if (!r.reportedIssue) continue
    const key = `${r.machineId}||${r.reportedIssue.trim().toLowerCase()}`
    if (!grouped.has(key)) grouped.set(key, { count: 0, items: [] })
    const entry = grouped.get(key)!
    entry.count++
    entry.items.push(r)
  }

  const alerts: SmartAlert[] = []
  for (const [, data] of grouped) {
    if (data.count >= 3) {
      const latest = data.items[0]
      alerts.push({
        id: `repetitive-${latest.machineId}-${data.count}`,
        severity: "preventive",
        title: "Posible falla recurrente",
        description: `${data.count} reparaciones registradas con: "${latest.reportedIssue}"`,
        machineId: latest.machineId,
        machineName: latest.machineName,
        machineModel: latest.machineModel,
        repairId: latest.id,
      })
    }
  }
  return alerts
}

function detectOverloadedMachines(repairs: MachineRepair[]): SmartAlert[] {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const recentByMachine = new Map<string, { totalHours: number; latest: MachineRepair }>()
  for (const r of repairs) {
    if (!r.hoursUsed || r.hoursUsed <= 0) continue
    if (r.exitDate < cutoff && r.entryDate < cutoff) continue

    if (!recentByMachine.has(r.machineId)) {
      recentByMachine.set(r.machineId, { totalHours: 0, latest: r })
    }
    const entry = recentByMachine.get(r.machineId)!
    entry.totalHours += r.hoursUsed
    if (r.entryDate > entry.latest.entryDate) entry.latest = r
  }

  const alerts: SmartAlert[] = []
  for (const [machineId, data] of recentByMachine) {
    if (data.totalHours > 100) {
      alerts.push({
        id: `overload-${machineId}`,
        severity: "preventive",
        title: "Uso intensivo detectado",
        description: `${data.totalHours}h acumuladas en los últimos 30 días`,
        machineId,
        machineName: data.latest.machineName,
        machineModel: data.latest.machineModel,
        repairId: data.latest.id,
      })
    }
  }
  return alerts
}

function detectIgnoredMaintenance(repairs: MachineRepair[]): SmartAlert[] {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const alerts: SmartAlert[] = []
  for (const r of repairs) {
    if (!r.maintenanceDueDate) continue
    if (r.maintenanceDueDate > cutoff) continue

    const daysOverdue = Math.floor(
      (now.getTime() - r.maintenanceDueDate.getTime()) / (1000 * 60 * 60 * 24),
    )
    alerts.push({
      id: `ignored-maint-${r.id}`,
      severity: "critical",
      title: "Riesgo de falla mecánica",
      description: `Mantenimiento vencido hace ${daysOverdue} días`,
      machineId: r.machineId,
      machineName: r.machineName,
      machineModel: r.machineModel,
      repairId: r.id,
    })
  }
  return alerts
}

function generateRecommendations(repairs: MachineRepair[]): SmartAlert[] {
  const now = new Date()
  const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const recs: SmartAlert[] = []

  const seenRepetitive = new Set<string>()
  const grouped = new Map<string, { count: number; items: MachineRepair[] }>()
  for (const r of repairs) {
    if (!r.reportedIssue) continue
    const key = `${r.machineId}||${r.reportedIssue.trim().toLowerCase()}`
    if (!grouped.has(key)) grouped.set(key, { count: 0, items: [] })
    const entry = grouped.get(key)!
    entry.count++
    entry.items.push(r)
    if (entry.count >= 3) seenRepetitive.add(key)
  }

  for (const [key, data] of grouped) {
    if (data.count === 2 && !seenRepetitive.has(key)) {
      const latest = data.items[0]
      recs.push({
        id: `near-repetitive-${latest.machineId}`,
        severity: "recommendation",
        title: "Falla con patrón incipiente",
        description: `${data.count} reparaciones con: "${latest.reportedIssue}". Monitorear.`,
        machineId: latest.machineId,
        machineName: latest.machineName,
        machineModel: latest.machineModel,
        repairId: latest.id,
      })
    }
  }

  for (const r of repairs) {
    if (!r.maintenanceDueDate) continue
    if (r.maintenanceDueDate > now || r.maintenanceDueDate < cutoff30) continue

    const daysOverdue = Math.floor(
      (now.getTime() - r.maintenanceDueDate.getTime()) / (1000 * 60 * 60 * 24),
    )
    const isAlreadyCritical = repairs.some(
      (other) =>
        other.id === r.id &&
        other.maintenanceDueDate &&
        other.maintenanceDueDate < cutoff30,
    )
    if (isAlreadyCritical) continue

    recs.push({
      id: `near-overdue-${r.id}`,
      severity: "recommendation",
      title: "Mantenimiento próximo a vencer",
      description: `Vencido hace ${daysOverdue} días. Programar mantenimiento.`,
      machineId: r.machineId,
      machineName: r.machineName,
      machineModel: r.machineModel,
      repairId: r.id,
    })
  }

  return recs
}

const STOCK_SEVERITY_MAP: Record<string, "critical" | "preventive" | "recommendation"> = {
  CRITICAL: "critical",
  WARNING: "preventive",
  INFO: "recommendation",
}

function stockToSmartAlert(alert: StockAlert): SmartAlert {
  let href: string
  if (alert.entityType === "MATERIAL") href = `/inventory/${alert.entityId}`
  else if (alert.entityType === "SPARE_PART") href = `/machines/${alert.entityId}/parts`
  else href = `/machines/${alert.entityId}`

  return {
    id: alert.id,
    severity: STOCK_SEVERITY_MAP[alert.type] ?? "recommendation",
    title: alert.message,
    description: alert.detail ?? "",
    entityType: alert.entityType,
    href,
  }
}

const SEVERITY_CONFIG = {
  critical: {
    label: "Críticas",
    border: "border-red-400",
    bg: "bg-red-50",
    badge: "bg-red-200 text-red-800",
    icon: <AlertTriangle className="h-5 w-5 text-red-600" />,
    textColor: "text-red-600",
    hoverBg: "hover:bg-red-50/50",
  },
  preventive: {
    label: "Preventivas",
    border: "border-amber-400",
    bg: "bg-amber-50",
    badge: "bg-amber-200 text-amber-800",
    icon: <AlertCircle className="h-5 w-5 text-amber-600" />,
    textColor: "text-amber-600",
    hoverBg: "hover:bg-amber-50/50",
  },
  recommendation: {
    label: "Recomendaciones",
    border: "border-blue-400",
    bg: "bg-blue-50",
    badge: "bg-blue-200 text-blue-800",
    icon: <Info className="h-5 w-5 text-blue-600" />,
    textColor: "text-blue-600",
    hoverBg: "hover:bg-blue-50/50",
  },
}

function AlertCountCard({
  severity,
  count,
}: {
  severity: "critical" | "preventive" | "recommendation"
  count: number
}) {
  const router = useRouter()
  const config = SEVERITY_CONFIG[severity]

  return (
    <Card
      className={`border-t-4 ${config.border} cursor-pointer transition-all hover:shadow-md ${config.hoverBg}`}
      onClick={() => router.push("/inventory")}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex-shrink-0">{config.icon}</div>
        <div className="flex-1 min-w-0">
          <p className={`text-2xl font-bold ${config.textColor}`}>{count}</p>
          <p className="text-sm text-muted-foreground">{config.label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export default function SmartAlertsPanel() {
  const [repairs, setRepairs] = useState<MachineRepair[]>([])
  const [loading, setLoading] = useState(true)
  const { intelligence, loading: stockLoading } = useStockIntelligence()

  useEffect(() => {
    getRepairs().then((data) => {
      setRepairs(data)
      setLoading(false)
    })
  }, [])

  const alerts = useMemo(() => {
    const repairCritical = detectIgnoredMaintenance(repairs)
    const repairPreventive = [...detectRepetitiveFailures(repairs), ...detectOverloadedMachines(repairs)]
    const repairRecommendations = generateRecommendations(repairs)

    const stockAlerts = (intelligence?.alerts ?? []).map(stockToSmartAlert)

    const critical = [...repairCritical, ...stockAlerts.filter((a) => a.severity === "critical")]
    const preventive = [...repairPreventive, ...stockAlerts.filter((a) => a.severity === "preventive")]
    const recommendations = [...repairRecommendations, ...stockAlerts.filter((a) => a.severity === "recommendation")]

    return { critical, preventive, recommendations, stockCount: stockAlerts.length }
  }, [repairs, intelligence])

  if (loading || stockLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(["critical", "preventive", "recommendation"] as const).map((severity) => (
          <Card key={severity} className={`border-t-4 ${SEVERITY_CONFIG[severity].border}`}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex-shrink-0">{SEVERITY_CONFIG[severity].icon}</div>
              <div className="flex-1">
                <p className="text-2xl font-bold text-muted-foreground">—</p>
                <p className="text-sm text-muted-foreground">{SEVERITY_CONFIG[severity].label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const total = alerts.critical.length + alerts.preventive.length + alerts.recommendations.length
  if (total === 0) return null

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <AlertCountCard severity="critical" count={alerts.critical.length} />
      <AlertCountCard severity="preventive" count={alerts.preventive.length} />
      <AlertCountCard severity="recommendation" count={alerts.recommendations.length} />
    </div>
  )
}