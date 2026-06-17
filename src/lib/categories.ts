import type { MachineCategory } from "@/types/machine"

export interface SubcategoryOption {
  label: string
}

export const SUBCATEGORIES: Record<string, SubcategoryOption[]> = {
  andamio: [
    { label: "base" },
    { label: "rienda corta" },
    { label: "rienda larga" },
    { label: "pasillero" },
    { label: "reforzado" },
    { label: "caballetes" },
    { label: "tablón" },
    { label: "puntales" },
  ],
  maquinaria: [],
  herramienta: [],
}

export const CATEGORY_COLORS: Record<string, string> = {
  andamio: "bg-orange-100 text-orange-700",
  maquinaria: "bg-slate-100 text-slate-700",
  herramienta: "bg-teal-100 text-teal-700",
}

export const CATEGORY_LABELS: Record<string, string> = {
  andamio: "Andamio",
  maquinaria: "Maquinaria",
  herramienta: "Herramienta",
}

export function getDefaultCategory(): MachineCategory {
  return "maquinaria"
}

export function mapOldCategory(old: string): MachineCategory | null {
  const map: Record<string, MachineCategory> = {
    machine: "maquinaria",
    maquina: "maquinaria",
    scaffold: "andamio",
    tool: "herramienta",
  }
  return map[old] ?? null
}
