"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
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

const SEVERITY_CONFIG = {
  critical: {
    label: "Críticas",
    border: "border-red-400",
    bg: "bg-red-50",
    badge: "bg-red-200 text-red-800",
    icon: "🔴",
  },
  preventive: {
    label: "Preventivas",
    border: "border-amber-400",
    bg: "bg-amber-50",
    badge: "bg-amber-200 text-amber-800",
    icon: "🟡",
  },
  recommendation: {
    label: "Recomendaciones",
    border: "border-blue-400",
    bg: "bg-blue-50",
    badge: "bg-blue-200 text-blue-800",
    icon: "🔵",
  },
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

function AlertSection({
  severity,
  alerts,
}: {
  severity: "critical" | "preventive" | "recommendation"
  alerts: SmartAlert[]
}) {
  const router = useRouter()
  const config = SEVERITY_CONFIG[severity]

  if (alerts.length === 0) return null

  const navigate = (alert: SmartAlert) => {
    if (alert.href) { router.push(alert.href); return }
    if (alert.repairId) { router.push(`/repairs/${alert.repairId}`); return }
    if (alert.machineId) { router.push(`/machines/${alert.machineId}`); return }
  }

  return (
    <Card className={`border-t-4 ${config.border}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {config.icon} {config.label} ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="flex items-center justify-between rounded-lg border p-3 text-sm cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => navigate(alert)}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{alert.title}</p>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${config.badge}`}>
                    {alert.entityType === "MATERIAL" ? "Stock" :
                     alert.entityType === "SPARE_PART" ? "Repuesto" :
                     config.label.slice(0, -1)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{alert.description}</p>
                {alert.machineName && (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Máquina: </span>
                    {alert.machineName}
                    {alert.machineModel ? ` (${alert.machineModel})` : ""}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs shrink-0"
                onClick={(e) => { e.stopPropagation(); navigate(alert) }}
              >
                Ver
              </Button>
            </div>
          ))}
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

  const total =
    alerts.critical.length + alerts.preventive.length + alerts.recommendations.length

  if (loading || stockLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Alertas inteligentes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Analizando reparaciones y stock...</p>
        </CardContent>
      </Card>
    )
  }

  if (total === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Alertas inteligentes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sin alertas detectadas. Todas las máquinas y stock dentro de parámetros normales.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">Alertas inteligentes y recomendaciones</h2>
      <p className="text-xs text-muted-foreground -mt-3">
        Detectadas desde reparaciones y análisis de stock.
      </p>

      <AlertSection severity="critical" alerts={alerts.critical} />
      <AlertSection severity="preventive" alerts={alerts.preventive} />
      <AlertSection severity="recommendation" alerts={alerts.recommendations} />

      {intelligence && alerts.stockCount > 0 && (
        <>
          <Separator className="my-2" />
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">📦 Stock Intelligence</p>
                <p className="text-xs text-muted-foreground">
                  Health Score: <strong>{intelligence.healthScore.overall}/100</strong>
                  {intelligence.healthScore.overall >= 70 ? " 🟢" : intelligence.healthScore.overall >= 40 ? " 🟡" : " 🔴"}
                  {" · "}
                  Tendencia: {intelligence.trend === "up" ? "↑" : intelligence.trend === "down" ? "↓" : "→"}
                  {" · "}
                  {intelligence.criticalItems.length} críticos
                </p>
              </div>
              <div className="flex gap-1 text-xs">
                <span className="text-green-600">M: {intelligence.healthScore.materials}%</span>
                <span className="text-muted-foreground">|</span>
                <span className="text-amber-600">R: {intelligence.healthScore.spareParts}%</span>
                <span className="text-muted-foreground">|</span>
                <span className="text-blue-600">Mq: {intelligence.healthScore.machines}%</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
