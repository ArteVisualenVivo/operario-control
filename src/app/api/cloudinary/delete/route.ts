import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const { publicId, resourceType } = await request.json()
    if (!publicId || typeof publicId !== "string") {
      return NextResponse.json({ error: "publicId requerido" }, { status: 400 })
    }

    const cloudName = "dpcdsorty"
    const apiKey = process.env.CLOUDINARY_API_KEY
    const apiSecret = process.env.CLOUDINARY_API_SECRET

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "Credenciales de Cloudinary no configuradas" },
        { status: 500 },
      )
    }

    const endpoint =
      resourceType === "image" || !resourceType ? "image" : "raw"

    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")

    const cloudinaryRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${endpoint}/destroy`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ public_id: publicId }),
      },
    )

    const result = await cloudinaryRes.json()

    if (result.result !== "ok") {
      return NextResponse.json(
        { error: "Error al eliminar de Cloudinary", detail: result },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, result: result.result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
