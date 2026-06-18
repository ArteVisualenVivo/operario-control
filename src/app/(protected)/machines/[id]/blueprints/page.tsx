"use client"

import { useParams, useRouter } from "next/navigation"
import { useMachineBlueprints } from "@/hooks/useMachineBlueprints"
import { deleteBlueprint } from "@/services/machineBlueprints"
import BlueprintUploader from "@/components/machines/BlueprintUploader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

export default function MachineBlueprintsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { blueprints, loading, uploadBlueprint, reload } = useMachineBlueprints(id)

  const handleDelete = async (blueprintId: string, fileName: string) => {
    if (!confirm(`¿Eliminar "${fileName}"?`)) return
    try {
      await deleteBlueprint(blueprintId)
      await reload()
      toast.success("Despiece eliminado")
    } catch {
      toast.error("Error al eliminar")
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => router.push(`/machines/${id}`)}>
          ← Volver máquina
        </Button>
      </div>

      <h1 className="text-xl font-bold">Despieces técnicos</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subir nuevo despiece</CardTitle>
        </CardHeader>
        <CardContent>
          <BlueprintUploader onUpload={uploadBlueprint} />
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          {loading ? "Cargando..." : `${blueprints.length} despiece(s)`}
        </h2>

        {blueprints.map((bp) => (
          <Card key={bp.id}>
            <CardContent className="flex items-start justify-between gap-4 pt-4">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium truncate">{bp.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {bp.fileType === "pdf" ? "PDF" : "Imagen"} — {bp.createdAt.toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <a
                  href={bp.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" size="sm">Ver</Button>
                </a>
                <Button
                  variant="destructive" size="sm"
                  onClick={() => handleDelete(bp.id, bp.fileName)}
                >
                  Eliminar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {!loading && blueprints.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay despieces subidos para esta máquina.</p>
        )}
      </div>
    </div>
  )
}
