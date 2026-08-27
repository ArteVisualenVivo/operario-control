"use client"

import type { SearchResult, SearchResultType } from "@/lib/search"

const META: Record<SearchResultType, { icon: string; label: string }> = {
    orden: { icon: "🔧", label: "Orden de mantenimiento" },
    maquina: { icon: "⚙️", label: "Máquina" },
    inventario: { icon: "📦", label: "Inventario" },
    stock: { icon: "📊", label: "Stock" },
    alquiler: { icon: "📋", label: "Alquiler" },
    andamio: { icon: "🏗️", label: "Andamios" },
    puntal: { icon: "🟤", label: "Puntales" },
    pedido: { icon: "🛒", label: "Pedido de repuesto" },
}

interface Props {
    results: SearchResult[]
    onSelect: (result: SearchResult) => void
}

export function GlobalSearchResults({ results, onSelect }: Props) {
    if (results.length === 0) {
        return (
            <p className="text-muted-foreground text-sm py-4">
                No se encontraron resultados.
            </p>
        )
    }

    return (
        <div className="space-y-2">
            {results.map((r, i) => {
                const meta = META[r.type]
                return (
                    <button
                        key={`${r.type}-${r.id}-${i}`}
                        type="button"
                        onClick={() => onSelect(r)}
                        className="w-full text-left rounded-lg border bg-card p-3 hover:bg-muted/40 transition-colors flex items-start gap-3"
                    >
                        <span className="text-xl leading-none mt-0.5">{meta.icon}</span>
                        <span className="flex-1 min-w-0">
                            <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                                {meta.label}
                            </span>
                            <span className="block font-semibold truncate">{r.title}</span>
                            <span className="block text-sm text-muted-foreground truncate">
                                {r.subtitle}
                            </span>
                        </span>
                    </button>
                )
            })}
        </div>
    )
}