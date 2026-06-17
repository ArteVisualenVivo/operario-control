"use client"

import { useState, useRef } from "react"
import * as XLSX from "xlsx"
import { collection, addDoc, getDocs, query, where, Timestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { toast } from "sonner"

interface ParsedRow {
  name: string
  model: string
  category: string
  location: string
}

interface ImportResult {
  inserted: number
  skipped: number
  errors: number
}

function normalizeHeader(h: string): string {
  const map: Record<string, string> = {
    nombre: "name",
    name: "name",
    máquina: "name",
    maquina: "name",
    equipo: "name",
    descripción: "name",
    descripcion: "name",
    modelo: "model",
    model: "model",
    referencia: "model",
    categoría: "category",
    categoria: "category",
    category: "category",
    tipo: "category",
    ubicación: "location",
    ubicacion: "location",
    location: "location",
    ubicacionfisica: "location",
    lugar: "location",
  }
  return map[h.toLowerCase().trim()] ?? h.toLowerCase().trim()
}

function parseExcel(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: "array" })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
        const rows: ParsedRow[] = json.map((row) => {
          const mapped: Record<string, string> = {}
          for (const key of Object.keys(row)) {
            const normalKey = normalizeHeader(key)
            const val = String(row[key] ?? "").trim()
            if (!mapped[normalKey]) mapped[normalKey] = val
          }
          return {
            name: mapped.name || "",
            model: mapped.model || "",
            category: mapped.category || "",
            location: mapped.location || "",
          }
        }).filter((r) => r.name)
        resolve(rows)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error("Error al leer archivo"))
    reader.readAsArrayBuffer(file)
  })
}

export default function ImportInventory() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setResult(null)
    try {
      const rows = await parseExcel(f)
      setParsed(rows)
    } catch {
      toast.error("Error al leer el archivo. Verifica que sea un .xlsx válido.")
    }
  }

  const handleImport = async () => {
    if (parsed.length === 0) return
    setImporting(true)
    let inserted = 0
    let skipped = 0
    let errors = 0

    const colRef = collection(db, "machines")

    for (const row of parsed) {
      try {
        const dup = await getDocs(
          query(colRef, where("name", "==", row.name), where("model", "==", row.model))
        )
        if (!dup.empty) {
          skipped++
          continue
        }
        await addDoc(colRef, {
          name: row.name,
          model: row.model || "",
          category: row.category || null,
          status: "available",
          location: row.location || "deposito",
          rental: null,
          maintenance: null,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        })
        inserted++
      } catch {
        errors++
      }
    }

    setResult({ inserted, skipped, errors })
    setImporting(false)
    toast.success(`Importación completada: ${inserted} insertadas, ${skipped} omitidas`)
  }

  const handleReset = () => {
    setFile(null)
    setParsed([])
    setResult(null)
    setOpen(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Importar inventario
      </Button>

      <Dialog open={open} onOpenChange={(next) => { if (!next) handleReset(); else setOpen(true) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar inventario</DialogTitle>
            <DialogDescription>
              Sube un archivo Excel (.xlsx) con las columnas: nombre, modelo, categoría, ubicación.
              Solo <strong>nombre</strong> es obligatorio.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFile}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:bg-muted file:text-sm file:font-medium file:text-foreground hover:file:bg-accent"
            />

            {parsed.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium mb-1">
                  {parsed.length} registro{parsed.length !== 1 ? "s" : ""} detectado{parsed.length !== 1 ? "s" : ""}
                </p>
                <div className="max-h-40 overflow-y-auto space-y-1 text-muted-foreground">
                  {parsed.slice(0, 50).map((r, i) => (
                    <p key={i} className="truncate">
                      {r.name}{r.model ? ` (${r.model})` : ""}
                    </p>
                  ))}
                  {parsed.length > 50 && (
                    <p className="text-xs text-muted-foreground">... y {parsed.length - 50} más</p>
                  )}
                </div>
              </div>
            )}

            {result && (
              <div className="rounded-lg border bg-green-50 p-3 text-sm">
                <p className="font-medium text-green-900">Resultado:</p>
                <p className="text-green-700">Insertadas: {result.inserted}</p>
                <p className="text-green-700">Omitidas (ya existen): {result.skipped}</p>
                {result.errors > 0 && <p className="text-red-600">Errores: {result.errors}</p>}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleReset}>Cancelar</Button>
            <Button onClick={handleImport} disabled={parsed.length === 0 || importing}>
              {importing ? "Importando..." : `Importar ${parsed.length} registro${parsed.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
