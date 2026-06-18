import { collection, addDoc, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import type { Intent } from "./recommendationEngine"

export async function logRecommendation(
  input: string,
  intent: Intent,
  resultMachineIds: string[],
): Promise<void> {
  try {
    await addDoc(collection(db, "audit_logs"), {
      type: "recommendation_engine",
      timestamp: serverTimestamp(),
      input,
      intent,
      resultMachineIds,
      createdAt: serverTimestamp(),
    })
  } catch {
    console.error("Error al registrar auditoría de recomendación")
  }
}
