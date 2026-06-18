import { FirebaseError } from "firebase/app"
import type { AppError } from "@/types/errors"

export function parseFirebaseError(e: unknown, collection?: string): AppError {
  if (e instanceof FirebaseError) {
    if (e.code === "FAILED_PRECONDITION") {
      return {
        type: "INDEX_MISSING",
        message: "Configuración pendiente del sistema (índice Firestore requerido)",
        collection: collection ?? "unknown",
      }
    }
    if (e.code === "permission-denied") {
      return {
        type: "PERMISSION_DENIED",
        message: "Sin permisos para acceder a los datos",
      }
    }
  }
  return {
    type: "GENERIC",
    message: e instanceof Error ? e.message : "Error desconocido",
  }
}
