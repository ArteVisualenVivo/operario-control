import { NextResponse } from "next/server"
import { collection, getDocs, orderBy, query } from "firebase/firestore"
import { db } from "@/lib/firebase"

export const runtime = "nodejs"

export async function GET() {
  try {
    const q = query(
      collection(db, "repairs"),
      orderBy("createdAt", "desc")
    )

    const snapshot = await getDocs(q)

    const repairs = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))

    return NextResponse.json(repairs)

  } catch (error) {
    console.error("[API /local/repairs] Error:", error)

    return NextResponse.json(
      {
        error: "No se pudieron cargar las reparaciones",
        details:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    )
  }
}