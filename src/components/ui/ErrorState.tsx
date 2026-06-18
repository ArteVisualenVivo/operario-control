"use client"

import type { AppError } from "@/types/errors"

export default function ErrorState({ error }: { error: NonNullable<AppError> }) {
  if (error.type === "INDEX_MISSING") {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm">
        <p className="font-medium text-amber-800">Configuración pendiente</p>
        <p className="text-amber-700">{error.message}</p>
      </div>
    )
  }

  if (error.type === "PERMISSION_DENIED") {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm">
        <p className="font-medium text-red-800">Sin permisos</p>
        <p className="text-red-700">{error.message}</p>
      </div>
    )
  }

  return (
    <div className="rounded border border-red-200 bg-red-50 p-4 text-sm">
      <p className="font-medium text-red-800">Error</p>
      <p className="text-red-700">{error.message}</p>
    </div>
  )
}
