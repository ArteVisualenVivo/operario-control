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

export async function GET() {
  try {
    const admin = getFirebaseAdmin()
    const db = admin.firestore()
    const doc = await db.collection("sync-3c-agent").doc("production").get()

    if (!doc.exists) {
      return NextResponse.json({
        online: false,
        status: "unknown",
        machineName: null,
        lastHeartbeat: null,
      })
    }

    const data = doc.data()!
    const heartbeat = data.lastHeartbeat?.toMillis?.() ?? 0
    const online = heartbeat > 0 && (Date.now() - heartbeat) < 90_000

    return NextResponse.json({
      online,
      status: data.status ?? "unknown",
      machineName: data.machineName ?? null,
      lastHeartbeat: data.lastHeartbeat ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message, online: false },
      { status: 500 },
    )
  }
}
