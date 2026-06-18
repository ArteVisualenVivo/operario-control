import type { MachineCategory } from "@/types/machine"

export const CATEGORY_COLORS: Record<string, string> = {
  scaffold: "bg-orange-100 text-orange-700",
  machine: "bg-slate-100 text-slate-700",
  tool: "bg-teal-100 text-teal-700",
}

export const CATEGORY_LABELS: Record<string, string> = {
  scaffold: "Andamio",
  machine: "Máquina",
  tool: "Herramienta",
}

export function getDefaultCategory(): MachineCategory {
  return "machine"
}
