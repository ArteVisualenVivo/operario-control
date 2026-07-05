"use client"

import type { AppError } from "@/types/errors"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface ErrorStateProps {
  error: NonNullable<AppError>
  retry?: () => void
  icon?: React.ReactNode
  size?: "sm" | "md" | "lg"
}

export default function ErrorState({
  error,
  retry,
  icon,
  size = "md"
}: ErrorStateProps) {
  const sizeClasses = {
    sm: "p-3 text-xs",
    md: "p-4 text-sm",
    lg: "p-6 text-base"
  }

  const getErrorConfig = () => {
    if (error.type === "INDEX_MISSING") {
      return {
        title: "Configuración pendiente",
        bgColor: "bg-amber-50",
        borderColor: "border-amber-200",
        textColor: "text-amber-800",
        textColorSecondary: "text-amber-700",
        iconColor: "text-amber-600"
      }
    }

    if (error.type === "PERMISSION_DENIED") {
      return {
        title: "Sin permisos",
        bgColor: "bg-red-50",
        borderColor: "border-red-200",
        textColor: "text-red-800",
        textColorSecondary: "text-red-700",
        iconColor: "text-red-600"
      }
    }

    return {
      title: "Error",
      bgColor: "bg-red-50",
      borderColor: "border-red-200",
      textColor: "text-red-800",
      textColorSecondary: "text-red-700",
      iconColor: "text-red-600"
    }
  }

  const config = getErrorConfig()
  const defaultIcon = <AlertTriangle className={cn("h-5 w-5", config.iconColor)} />
  const iconToShow = icon || defaultIcon

  return (
    <div className={cn(
      "rounded border",
      config.bgColor,
      config.borderColor,
      sizeClasses[size]
    )}>
      <div className="flex items-start gap-3">
        <div className={cn("shrink-0", config.iconColor)}>
          {iconToShow}
        </div>
        <div className="flex-1">
          <p className={cn("font-medium", config.textColor)}>
            {config.title}
          </p>
          <p className={config.textColorSecondary}>{error.message}</p>
          {retry && (
            <button
              onClick={retry}
              className={cn(
                "mt-2 flex items-center gap-1 font-medium hover:opacity-80",
                config.textColor
              )}
            >
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
