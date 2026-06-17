"use client"

import { useEffect, useState } from "react"
import { collection, getDocs, limit, query, addDoc, where, Timestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

interface SeedItem {
  name: string
  model: string
  category: "andamio" | "maquinaria" | "herramienta"
  subcategory?: string
}

const INVENTORY: SeedItem[] = [
  // ANDAMIOS
  { name: "Andamio tubular", model: "estándar obra", category: "andamio", subcategory: "base" },
  { name: "Andamio tubular", model: "reforzado pesado", category: "andamio", subcategory: "base" },
  { name: "Andamio modular", model: "marco europeo", category: "andamio", subcategory: "base" },
  { name: "Andamio modular", model: "heavy duty modular", category: "andamio", subcategory: "reforzado" },
  { name: "Andamio pasillero", model: "pasarela 1m", category: "andamio", subcategory: "pasillero" },
  { name: "Andamio pasillero", model: "pasarela 1.5m", category: "andamio", subcategory: "pasillero" },
  { name: "Andamio reforzado", model: "industrial 3T", category: "andamio", subcategory: "reforzado" },
  { name: "Andamio reforzado", model: "uso profesional pesado", category: "andamio", subcategory: "reforzado" },
  { name: "Caballetes", model: "metálico plegable", category: "andamio", subcategory: "caballetes" },
  { name: "Caballetes", model: "reforzado madera", category: "andamio", subcategory: "caballetes" },
  { name: "Tablón para andamios", model: "madera 3m", category: "andamio", subcategory: "tablón" },
  { name: "Tablón para andamios", model: "metálico antideslizante", category: "andamio", subcategory: "tablón" },
  { name: "Puntales telescópicos", model: "1.5–3m", category: "andamio", subcategory: "puntales" },
  { name: "Puntales telescópicos", model: "2–4m", category: "andamio", subcategory: "puntales" },
  { name: "Puntales telescópicos", model: "heavy duty", category: "andamio", subcategory: "puntales" },
  // MAQUINARIA
  { name: "Pisón canguro", model: "Honda GX160 BS50", category: "maquinaria" },
  { name: "Pisón canguro", model: "Wacker BS50-2i", category: "maquinaria" },
  { name: "Pisón canguro", model: "Bomag BT65", category: "maquinaria" },
  { name: "Pisón canguro", model: "Belle RTX50", category: "maquinaria" },
  { name: "Hormigonera", model: "130L eléctrica", category: "maquinaria" },
  { name: "Hormigonera", model: "350L profesional", category: "maquinaria" },
  { name: "Hormigonera", model: "400L industrial", category: "maquinaria" },
  { name: "Martillo demoledor", model: "Bosch GSH 16-28", category: "maquinaria" },
  { name: "Martillo demoledor", model: "Makita HM1317C", category: "maquinaria" },
  { name: "Martillo demoledor", model: "DeWalt D25980", category: "maquinaria" },
  { name: "Vibrador de hormigón", model: "1.5HP 35mm", category: "maquinaria" },
  { name: "Vibrador de hormigón", model: "2HP 50mm industrial", category: "maquinaria" },
  { name: "Grupo electrógeno", model: "3kVA portátil", category: "maquinaria" },
  { name: "Grupo electrógeno", model: "5kVA diesel", category: "maquinaria" },
  { name: "Grupo electrógeno", model: "10kVA trifásico", category: "maquinaria" },
  { name: "Allanadora", model: "manual", category: "maquinaria" },
  { name: "Allanadora", model: "doble rotor 90cm", category: "maquinaria" },
  { name: "Pulidora", model: "piso hormigón", category: "maquinaria" },
  { name: "Pulidora", model: "industrial diamante", category: "maquinaria" },
  { name: "Compresor", model: "portátil 5m3", category: "maquinaria" },
  { name: "Compresor", model: "industrial 10bar", category: "maquinaria" },
  // HERRAMIENTAS
  { name: "Amoladora", model: "115mm 850W", category: "herramienta" },
  { name: "Amoladora", model: "125mm 1200W", category: "herramienta" },
  { name: "Amoladora", model: "230mm industrial", category: "herramienta" },
  { name: "Taladro percutor", model: "Bosch GSB 13 RE", category: "herramienta" },
  { name: "Taladro percutor", model: "Makita HP1640", category: "herramienta" },
  { name: "Sierra circular", model: "7 1/4\"", category: "herramienta" },
  { name: "Sierra circular", model: "9 1/4\" industrial", category: "herramienta" },
  { name: "Soldadora inverter", model: "160A portátil", category: "herramienta" },
  { name: "Soldadora inverter", model: "200A profesional", category: "herramienta" },
  { name: "Máquina de pintar", model: "airless 3000 PSI", category: "herramienta" },
  { name: "Máquina de pintar", model: "eléctrica 220V", category: "herramienta" },
]

export default function SeedInventory({ onComplete }: { onComplete?: () => void }) {
  const [hasData, setHasData] = useState<boolean | null>(null)
  const [seeding, setSeeding] = useState(false)

  useEffect(() => {
    const q = query(collection(db, "machines"), limit(1))
    getDocs(q).then((snap) => setHasData(!snap.empty))
  }, [])

  const handleSeed = async () => {
    setSeeding(true)
    const colRef = collection(db, "machines")
    let inserted = 0
    let skipped = 0

    for (const item of INVENTORY) {
      const dup = await getDocs(
        query(colRef, where("name", "==", item.name), where("model", "==", item.model), limit(1))
      )
      if (!dup.empty) {
        skipped++
        continue
      }
      await addDoc(colRef, {
        name: item.name,
        model: item.model,
        category: item.category,
        subcategory: item.subcategory ?? null,
        status: "available",
        location: "deposito",
        rental: null,
        maintenance: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
      inserted++
    }

    setSeeding(false)
    setHasData(true)
    onComplete?.()
    toast.success(`Inventario cargado: ${inserted} insertados, ${skipped} omitidos`)
  }

  if (hasData === null) return null
  if (hasData) return null

  return (
    <Card className="border-dashed border-blue-300 bg-blue-50/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Inventario inicial</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          No hay máquinas registradas. Carga el inventario inicial de Cocrear con un solo click.
        </p>
        <Button onClick={handleSeed} disabled={seeding}>
          {seeding ? "Cargando..." : "Cargar inventario inicial"}
        </Button>
      </CardContent>
    </Card>
  )
}
