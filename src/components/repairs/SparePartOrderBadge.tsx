"use client"

import type { SparePartOrderStatus } from "@/types"

const CONFIG: Record<SparePartOrderStatus, { label: string; className: string }> = {
  SOLICITADO: { label: "Solicitado", className: "bg-gray-100 text-gray-800 border border-gray-300" },
  PEDIDO: { label: "Pedido", className: "bg-blue-100 text-blue-800 border border-blue-300" },
  ENCARGADO: { label: "Encargado", className: "bg-purple-100 text-purple-800 border border-purple-300" },
  RECIBIDO: { label: "Recibido", className: "bg-amber-100 text-amber-800 border border-amber-300" },
  UTILIZADO: { label: "Utilizado", className: "bg-green-100 text-green-800 border border-green-300" },
  CANCELADO: { label: "Cancelado", className: "bg-red-100 text-red-800 border border-red-300" },
}

export function SparePartOrderBadge({ status }: { status: SparePartOrderStatus }) {
  const cfg = CONFIG[status] ?? { label: status, className: "bg-gray-100 text-gray-800 border border-gray-300" }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}