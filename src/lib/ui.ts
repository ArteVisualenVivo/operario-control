import type { MachineStatus } from "@/types"

export const statusColors: Record<MachineStatus, string> = {
  available: "bg-green-100 text-green-800 hover:bg-green-100",
  rented: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  maintenance: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
}

export const statusLabels: Record<MachineStatus, string> = {
  available: "Disponible",
  rented: "Alquilada",
  maintenance: "Mantenimiento",
}

export const locationLabels: Record<string, string> = {
  taller: "Taller",
  deposito: "Depósito",
  obra: "Obra",
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("es-ES")
}
