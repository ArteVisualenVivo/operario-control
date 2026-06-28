import { NextResponse } from "next/server"
import { parseExcel } from "@/lib/sync-3c/parser"
import { syncItems } from "@/lib/sync-3c/engine"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? ""

    let buffer: ArrayBuffer
    let autoDetect = false

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData()

      const autoFlag = formData.get("autoDetect")
      autoDetect = autoFlag === "true" || autoFlag === "1"

      const file = formData.get("file") as File | null
      if (!file) {
        return NextResponse.json(
          { error: "Archivo Excel requerido. Seleccioná el archivo exportado de 3C (.xls/.xlsx)." },
          { status: 400 },
        )
      }

      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (!["xls", "xlsx"].includes(ext)) {
        return NextResponse.json(
          { error: `Formato no soportado: .${ext}. Solo se aceptan archivos .xls o .xlsx.` },
          { status: 400 },
        )
      }

      buffer = await file.arrayBuffer()
    } else {
      const body = await request.json()
      autoDetect = body?.autoDetect === true

      if (autoDetect) {
        try {
          const fs = require("fs")
          const path = require("path")
          const dir = path.resolve(process.cwd(), "automation-watcher", "3c_exports")
          const files = fs.readdirSync(dir)
            .filter((f: string) => f.endsWith(".xls") || f.endsWith(".xlsx"))
            .sort()
            .reverse()

          if (files.length === 0) {
            return NextResponse.json(
              { error: "No se encontraron archivos Excel en 3c_exports/" },
              { status: 404 },
            )
          }

          const latestFile = path.join(dir, files[0])
          buffer = fs.readFileSync(latestFile).buffer
        } catch {
          return NextResponse.json(
            { error: "Auto-detect solo disponible en entorno local con carpeta 3c_exports/" },
            { status: 400 },
          )
        }
      } else {
        return NextResponse.json(
          { error: "Enviá el archivo Excel como multipart/form-data (campo 'file')" },
          { status: 400 },
        )
      }
    }

    const { items, rawCount } = parseExcel(buffer)

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        created: 0,
        updated: 0,
        skipped: 0,
        warnings: ["El archivo no contiene datos válidos en el formato esperado de 3C"],
      })
    }

    const result = await syncItems(items)

    return NextResponse.json({
      ...result,
      rawRows: rawCount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      {
        success: false,
        error: message,
        created: 0,
        updated: 0,
        skipped: 0,
        warnings: [message],
      },
      { status: 500 },
    )
  }
}
