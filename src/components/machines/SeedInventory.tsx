"use client"

import { useEffect, useState } from "react"
import { collection, getDocs, limit, query, addDoc, where, Timestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { StockCategory, SparePartCategory } from "@/types"
import { toast } from "sonner"

interface SeedItem {
  name: string
  model: string
  category: "machine" | "scaffold" | "tool"
}

interface SeedStockItem {
  name: string
  size: string
  category: StockCategory
  stockTotal: number
}

const INVENTORY: SeedItem[] = [
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

const STOCK_ITEMS: SeedStockItem[] = [
  { name: "Riendas", size: "largas", category: "riendas", stockTotal: 100 },
  { name: "Riendas", size: "cortas", category: "riendas", stockTotal: 100 },
  { name: "Puntales", size: "3m", category: "puntales", stockTotal: 100 },
  { name: "Puntales", size: "2m", category: "puntales", stockTotal: 100 },
  { name: "Tablones", size: "3m", category: "andamio_accesorios", stockTotal: 100 },
]

interface SeedSparePart {
  machineName: string
  machineModel: string
  partName: string
  partCode: string
  category: SparePartCategory
  stockTotal: number
}

const SPARE_PARTS_SEED: SeedSparePart[] = [
  { machineName: "Pisón canguro", machineModel: "Honda GX160", partName: "Bujía", partCode: "NGK-BPR6ES", category: "motor", stockTotal: 3 },
  { machineName: "Pisón canguro", machineModel: "Honda GX160", partName: "Filtro de aire", partCode: "HONDA-17211-Z0J-000", category: "filtro", stockTotal: 2 },
  { machineName: "Pisón canguro", machineModel: "Honda GX160", partName: "Aceite motor 20W50", partCode: "HONDA-08C35-A331J01", category: "consumible", stockTotal: 5 },
  { machineName: "Pisón canguro", machineModel: "Wacker BS50-2i", partName: "Bujía", partCode: "NGK-BPR6ES", category: "motor", stockTotal: 3 },
  { machineName: "Pisón canguro", machineModel: "Wacker BS50-2i", partName: "Filtro de combustible", partCode: "WACKER-510000126", category: "filtro", stockTotal: 2 },
  { machineName: "Martillo demoledor", machineModel: "Bosch GSH 16-28", partName: "Martillo neumático", partCode: "BOSCH-1619P04476", category: "motor", stockTotal: 2 },
  { machineName: "Martillo demoledor", machineModel: "Bosch GSH 16-28", partName: "Carbones", partCode: "BOSCH-1131", category: "electrico", stockTotal: 5 },
  { machineName: "Grupo electrógeno", machineModel: "5kVA diesel", partName: "Filtro de gasoil", partCode: "GEN-FF-505", category: "filtro", stockTotal: 3 },
  { machineName: "Grupo electrógeno", machineModel: "10kVA trifásico", partName: "Filtro de gasoil", partCode: "GEN-FF-1010", category: "filtro", stockTotal: 3 },
  { machineName: "Grupo electrógeno", machineModel: "10kVA trifásico", partName: "Batería 12V 100Ah", partCode: "GEN-BAT-12100", category: "electrico", stockTotal: 1 },
]

export default function SeedInventory({ onComplete }: { onComplete?: () => void }) {
  const [showCard, setShowCard] = useState<boolean | null>(null)
  const [seeding, setSeeding] = useState(false)

  useEffect(() => {
    const machinesQ = query(collection(db, "machines"), limit(1))
    const stockQ = query(collection(db, "inventory_stock"), limit(1))
    const partsQ = query(collection(db, "machine_spare_parts"), limit(1))
    Promise.all([getDocs(machinesQ), getDocs(stockQ), getDocs(partsQ)]).then(([m, s, p]) => {
      setShowCard(m.empty || s.empty || p.empty)
    })
  }, [])

  const handleSeed = async () => {
    setSeeding(true)
    let mInserted = 0
    let mSkipped = 0
    let sInserted = 0
    let sSkipped = 0
    let spInserted = 0
    let spSkipped = 0

    const machinesRef = collection(db, "machines")
    const stockRef = collection(db, "inventory_stock")
    const sparePartsRef = collection(db, "machine_spare_parts")

    for (const item of INVENTORY) {
      const dup = await getDocs(
        query(machinesRef, where("name", "==", item.name), where("model", "==", item.model), limit(1))
      )
      if (!dup.empty) { mSkipped++; continue }
      await addDoc(machinesRef, {
        name: item.name, model: item.model, category: item.category,
        status: "available", locationType: "deposito",
        rental: null, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      })
      mInserted++
    }

    for (const item of STOCK_ITEMS) {
      const dup = await getDocs(
        query(stockRef, where("name", "==", item.name), where("size", "==", item.size), limit(1))
      )
      if (!dup.empty) { sSkipped++; continue }
      await addDoc(stockRef, {
        name: item.name, category: item.category, unit: "unidad",
        stockTotal: item.stockTotal, stockAvailable: item.stockTotal,
        stockRented: 0, size: item.size, subtype: null, locationType: "deposito",
        source: "seed",
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      })
      sInserted++
    }

    for (const item of SPARE_PARTS_SEED) {
      const machineSnap = await getDocs(
        query(machinesRef, where("name", "==", item.machineName), where("model", "==", item.machineModel), limit(1))
      )
      if (machineSnap.empty) { spSkipped++; continue }
      const machineId = machineSnap.docs[0].id
      const dup = await getDocs(
        query(sparePartsRef, where("machineId", "==", machineId), where("partCode", "==", item.partCode), limit(1))
      )
      if (!dup.empty) { spSkipped++; continue }
      const d = machineSnap.docs[0].data()
      await addDoc(sparePartsRef, {
        machineId,
        machineName: d.name,
        machineModel: d.model,
        partName: item.partName,
        partCode: item.partCode,
        category: item.category,
        unit: "unidad",
        stockTotal: item.stockTotal,
        stockAvailable: item.stockTotal,
        stockUsed: 0,
        source: "manual",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
      spInserted++
    }

    setSeeding(false)
    setShowCard(false)
    onComplete?.()
    const parts: string[] = []
    if (mInserted > 0 || mSkipped > 0) parts.push(`${mInserted} máquinas insertadas, ${mSkipped} omitidas`)
    if (sInserted > 0 || sSkipped > 0) parts.push(`${sInserted} materiales insertados, ${sSkipped} omitidos`)
    if (spInserted > 0 || spSkipped > 0) parts.push(`${spInserted} repuestos insertados, ${spSkipped} omitidos`)
    toast.success(`Inventario cargado: ${parts.join(" — ")}`)
  }

  if (showCard === null) return null
  if (!showCard) return null

  return (
    <Card className="border-dashed border-blue-300 bg-blue-50/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Inventario inicial</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Carga el inventario completo de máquinas y materiales de andamio con un solo click.
        </p>
        <Button onClick={handleSeed} disabled={seeding}>
          {seeding ? "Cargando..." : "Cargar inventario inicial"}
        </Button>
      </CardContent>
    </Card>
  )
}
