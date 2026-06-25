interface MaintenanceStatusBadgeProps {
  dueDate: Date | undefined | null
  label: string
  compact?: boolean
}

function daysUntil(date: Date | undefined | null): number | null {
  if (!date) return null
  return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default function MaintenanceStatusBadge({ dueDate, label, compact }: MaintenanceStatusBadgeProps) {
  const days = daysUntil(dueDate)

  if (days === null) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-muted text-muted-foreground">
        {label}: —
      </span>
    )
  }

  const color =
    days <= 0
      ? "bg-red-200 text-red-800"
      : days <= 7
        ? "bg-amber-200 text-amber-800"
        : "bg-green-200 text-green-800"

  const text =
    days <= 0
      ? "VENCIDO"
      : days <= 7
        ? compact ? `${days}d` : `PRÓXIMO (${days}d)`
        : compact ? `${days}d` : "VIGENTE"

  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${color}`}>
      {label && !compact ? `${label}: ${text}` : text}
    </span>
  )
}
