import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 120

function getFirebaseAdmin() {
  const admin = require("firebase-admin")
  if (admin.getApps().length > 0) return admin

  const saJson =
    process.env.FIREBASE_SERVICE_ACCOUNT || null

  if (!saJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT no configurada en Vercel")
  }

  admin.initializeApp({
    credential: admin.cert(JSON.parse(saJson)),
  })

  return admin
}

export async function POST() {
  try {
    const admin = getFirebaseAdmin()
    const { getFirestore, FieldValue } = require("firebase-admin/firestore")
    const db = getFirestore()
    const colRef = db.collection("sync-3c-commands")
    const docRef = colRef.doc()

    await docRef.set({
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      startedAt: null,
      completedAt: null,
      agent: null,
      result: null,
      error: null,
    })

    return NextResponse.json({ commandId: docRef.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
