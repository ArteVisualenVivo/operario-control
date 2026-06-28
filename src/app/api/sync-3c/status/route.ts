import { NextResponse } from "next/server"

export const runtime = "nodejs"

function getFirebaseAdmin() {
  const admin = require("firebase-admin")
  if (admin.apps.length > 0) return admin

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT || null
  if (!saJson) throw new Error("FIREBASE_SERVICE_ACCOUNT no configurada")

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(saJson)),
  })
  return admin
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const commandId = searchParams.get("commandId")

    if (!commandId) {
      return NextResponse.json(
        { error: "commandId es requerido" },
        { status: 400 },
      )
    }

    const admin = getFirebaseAdmin()
    const db = admin.firestore()
    const doc = await db.collection("sync-3c-commands").doc(commandId).get()

    if (!doc.exists) {
      return NextResponse.json(
        { error: "Comando no encontrado", status: "not_found" },
        { status: 404 },
      )
    }

    return NextResponse.json(doc.data())
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
