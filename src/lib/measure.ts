"use client"

// Módulo de instrumentación TEMPORAL para auditoría de lecturas Firestore.
// SOLO MEDICIÓN. No afecta lógica de negocio.
// TODO: eliminar este archivo y sus referencias al finalizar la auditoría.

const callCounts: Record<string, number> = {}

export const measure = {
    syncId: "unknown",
    setSyncId(id: string) {
        this.syncId = id
    },
    getSyncId(): string {
        return this.syncId
    },
    countCall(fn: string): number {
        callCounts[fn] = (callCounts[fn] ?? 0) + 1
        return callCounts[fn]
    },
}