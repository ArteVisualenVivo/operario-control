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
  category: "machine" | "scaffold" | "tool"
}

const INVENTORY: SeedItem[] = [
  // SCAFFOLD
  { name: "Andamio tubular", model: "estándar obra", category: "scaffold" },
  { name: "Andamio tubular", model: "reforzado pesado", category: "scaffold" },
  { name: "Andamio modular", model: "marco europeo", category: "scaffold" },
  { name: "Andamio modular", model: "heavy duty", category: "scaffold" },
  { name: "Andamio pasillero", model: "pasarela 1m", category: "scaffold" },
  { name: "Andamio pasillero", model: "pasarela 1.5m", category: "scaffold" },
  { name: "Andamio reforzado", model: "industrial 3T", category: "scaffold" },
  { name: "Caballetes", model: "metálico plegable", category: "scaffold" },
  { name: "Caballetes", model: "reforzado madera", category: "scaffold" },
  { name: "Tablón para andamios", model: "madera 3m", category: "scaffold" },
  { name: "Tablón para andamios", model: "metálico antideslizante", category: "scaffold" },
  { name: "Puntales telescópicos", model: "1.5–3m", category: "scaffold" },
  { name: "Puntales telescópicos", model: "2–4m", category: "scaffold" },
  { name: "Puntales telescópicos", model: "heavy duty", category: "scaffold" },
  // MACHINE
  { name: "Pisón canguro", model: "Honda GX160", category: "machine" },
  { name: "Pisón canguro", model: "Wacker BS50-2i", category: "machine" },
  { name: "Pisón canguro", model: "Bomag BT65", category: "machine" },
  { name: "Hormigonera", model: "130L eléctrica", category: "machine" },
  { name: "Hormigonera", model: "350L profesional", category: "machine" },
  { name: "Martillo demoledor", model: "Bosch GSH 16-28", category: "machine" },
  { name: "Martillo demoledor", model: "Makita HM1317C", category: "machine" },
  { name: "Martillo demoledor", model: "DeWalt D25980", category: "machine" },
  { name: "Vibrador de hormigón", model: "1.5HP 35mm", category: "machine" },
  { name: "Vibrador de hormigón", model: "2HP 50mm", category: "machine" },
  { name: "Grupo electrógeno", model: "5kVA diesel", category: "machine" },
  { name: "Grupo electrógeno", model: "10kVA trifásico", category: "machine" },
  { name: "Allanadora", model: "doble rotor 90cm", category: "machine" },
  { name: "Pulidora", model: "piso hormigón", category: "machine" },
  { name: "Compresor", model: "portátil 5m3", category: "machine" },
  // TOOL
  { name: "Amoladora", model: "115mm 850W", category: "tool" },
  { name: "Amoladora", model: "230mm industrial", category: "tool" },
  { name: "Taladro percutor", model: "Bosch GSB 13 RE", category: "tool" },
  { name: "Sierra circular", model: "7 1/4\"", category: "tool" },
  { name: "Sierra circular", model: "9 1/4\" industrial", category: "tool" },
  { name: "Soldadora inverter", model: "160A portátil", category: "tool" },
  { name: "Soldadora inverter", model: "200A profesional", category: "tool" },
  { name: "Máquina de pintar", model: "airless", category: "tool" },
  { name: "Escalera extensible", model: "5m", category: "tool" },
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
        status: "available",
        locationType: "deposito",
        rental: null,
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
          No hay máquinas registradas. Carga el inventario inicial con un solo click.
        </p>
        <Button onClick={handleSeed} disabled={seeding}>
          {seeding ? "Cargando..." : "Cargar inventario inicial"}
        </Button>
      </CardContent>
    </Card>
  )
}
