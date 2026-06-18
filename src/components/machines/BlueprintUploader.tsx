"use client"

import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

interface Props {
  onUpload: (file: File) => Promise<void>
  disabled?: boolean
}

export default function BlueprintUploader({ onUpload, disabled }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewType, setPreviewType] = useState<"pdf" | "image" | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase()
    const valid = ["pdf", "jpg", "jpeg", "png", "gif", "webp"]
    if (!ext || !valid.includes(ext)) {
      toast.error("Formato no válido. Usá PDF, JPG, PNG, GIF o WebP")
      return
    }

    setSelectedFile(file)
    if (ext === "pdf") {
      setPreviewType("pdf")
      setPreview(URL.createObjectURL(file))
    } else {
      setPreviewType("image")
      setPreview(URL.createObjectURL(file))
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true) }
  const handleDragLeave = () => setDragOver(false)

  const handlePicker = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    if (fileRef.current) fileRef.current.value = ""
  }

  const handleUpload = async () => {
    if (!selectedFile) { toast.error("Seleccioná un archivo"); return }
    setUploading(true)
    try {
      await onUpload(selectedFile)
      setSelectedFile(null)
      setPreview(null)
      setPreviewType(null)
      toast.success("Despiece subido")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al subir")
    } finally { setUploading(false) }
  }

  return (
    <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-sm transition-colors ${
          dragOver ? "border-blue-400 bg-blue-50" : "border-muted-foreground/30"
        }`}
      >
        {preview ? (
          <div className="w-full max-h-64 overflow-auto mb-3">
            {previewType === "pdf" ? (
              <embed src={preview} type="application/pdf" className="w-full h-64 rounded" />
            ) : (
              <img src={preview} alt="Preview" className="max-h-64 rounded object-contain mx-auto" />
            )}
          </div>
        ) : (
          <p className="text-muted-foreground mb-2">
            Arrastrá un PDF o imagen acá
          </p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
          onChange={handlePicker}
          className="hidden"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={disabled}>
          {preview ? "Cambiar archivo" : "Seleccionar archivo"}
        </Button>
      </div>

      {selectedFile && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground truncate">{selectedFile.name}</span>
          <Button size="sm" onClick={handleUpload} disabled={uploading || disabled}>
            {uploading ? "Subiendo..." : "Subir despiece"}
          </Button>
        </div>
      )}
    </div>
  )
}
