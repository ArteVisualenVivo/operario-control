"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  debounce?: number
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  debounce = 0
}: SearchInputProps) {
  const [internalValue, setInternalValue] = useState(value)

  useEffect(() => {
    setInternalValue(value)
  }, [value])

  useEffect(() => {
    if (debounce > 0) {
      const timer = setTimeout(() => {
        onChange(internalValue)
      }, debounce)
      return () => clearTimeout(timer)
    } else {
      onChange(internalValue)
    }
  }, [internalValue, debounce, onChange])

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder={placeholder ?? "Buscar por orden, cliente o maquina"}
        value={internalValue}
        onChange={(e) => setInternalValue(e.target.value)}
        className={cn("pl-9 pr-9", className ?? "max-w-sm")}
      />
      {value && (
        <button
          type="button"
          onClick={() => { setInternalValue(""); onChange("") }}
          className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
