"use client"

import { useState, useMemo, useRef, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useSparePartsCache } from "@/hooks/useSparePartsCache"
import type { SparePart, PartUsage } from "@/types"

interface PartsSelectorProps {
  selected: PartUsage[]
  onChange: (parts: PartUsage[]) => void
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const escaped = escapeRegex(query)
  const regex = new RegExp(`(${escaped})`, "gi")
  const parts = text.split(regex)
  return parts.map((part, i) =>
    regex.test(part) ? <strong key={i}>{part}</strong> : part
  )
}

function StockBadge({ available }: { available: number }) {
  const color =
    available <= 0 ? "bg-red-200 text-red-800" :
    available < 10 ? "bg-amber-200 text-amber-800" :
    "bg-green-200 text-green-800"
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${color} shrink-0`}>
      {available} uds.
    </span>
  )
}

export default function PartsSelector({ selected, onChange }: PartsSelectorProps) {
  const { parts, loading } = useSparePartsCache()
  const [search, setSearch] = useState("")
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filteredSorted = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = !q
      ? parts
      : parts.filter(
          (p) =>
            p.partName.toLowerCase().includes(q) ||
            p.partCode.toLowerCase().includes(q),
        )
    return [...filtered].sort((a, b) => {
      if (a.stockAvailable > 0 && b.stockAvailable <= 0) return -1
      if (a.stockAvailable <= 0 && b.stockAvailable > 0) return 1
      return a.partName.localeCompare(b.partName)
    })
  }, [parts, search])

  const alreadySelected = useCallback(
    (partId: string) => selected.some((s) => s.partId === partId),
    [selected],
  )

  const addPart = useCallback(
    (part: SparePart) => {
      if (alreadySelected(part.id) || part.stockAvailable <= 0) return
      onChange([
        ...selected,
        { partId: part.id, code: part.partCode, description: part.partName, quantity: 1 },
      ])
    },
    [selected, onChange, alreadySelected],
  )

  const removePart = useCallback(
    (partId: string) => {
      onChange(selected.filter((s) => s.partId !== partId))
    },
    [selected, onChange],
  )

  const updateQuantity = useCallback(
    (partId: string, quantity: number) => {
      onChange(
        selected.map((s) =>
          s.partId === partId ? { ...s, quantity: Math.max(1, quantity) } : s,
        ),
      )
    },
    [selected, onChange],
  )

  const handleFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current)
    setShowDropdown(true)
  }

  const handleBlur = () => {
    blurTimer.current = setTimeout(() => setShowDropdown(false), 200)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && filteredSorted.length > 0) {
      e.preventDefault()
      const first = filteredSorted[0]
      if (!alreadySelected(first.id) && first.stockAvailable > 0) {
        addPart(first)
        setSearch("")
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Input
          ref={inputRef}
          placeholder="Buscá repuestos por código o descripción..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />

        {showDropdown && !loading && (
          <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border bg-background shadow-lg">
            {filteredSorted.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {search ? "Sin resultados" : "No hay repuestos disponibles"}
              </p>
            ) : (
              filteredSorted.slice(0, 20).map((p) => {
                const isSelected = alreadySelected(p.id)
                const noStock = p.stockAvailable <= 0
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer transition-colors ${
                      isSelected || noStock
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-muted/30"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      if (!isSelected && !noStock) {
                        addPart(p)
                        setSearch("")
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="truncate">
                        {highlightMatch(p.partName, search)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.partCode}
                        {p.stockAvailable > 0 && ` · Disp: ${p.stockAvailable}`}
                      </p>
                    </div>
                    <StockBadge available={p.stockAvailable} />
                  </div>
                )
              })
            )}
            {filteredSorted.length > 20 && (
              <p className="px-3 py-2 text-xs text-muted-foreground border-t">
                +{filteredSorted.length - 20} resultados más. Seguí escribiendo para filtrar.
              </p>
            )}
          </div>
        )}

        {loading && (
          <p className="text-sm text-muted-foreground mt-1">Cargando repuestos...</p>
        )}
      </div>

      {selected.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Repuestos seleccionados ({selected.length})
          </p>
          {selected.map((p) => {
            const part = parts.find((x) => x.id === p.partId)
            return (
              <div
                key={p.partId}
                className="flex items-center justify-between rounded border bg-muted/20 p-2 text-sm"
              >
                <div className="flex-1 min-w-0 mr-2">
                  <p className="font-medium truncate">{p.code}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {p.description}
                    {part && (
                      <span
                        className={
                          part.stockAvailable < p.quantity
                            ? "ml-2 text-red-600 font-semibold"
                            : "ml-2 text-muted-foreground"
                        }
                      >
                        (stock: {part.stockAvailable})
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    type="number"
                    min="1"
                    value={p.quantity}
                    onChange={(e) => updateQuantity(p.partId, Number(e.target.value))}
                    className="w-16 h-8 text-xs"
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => removePart(p.partId)}
                  >
                    Quitar
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
