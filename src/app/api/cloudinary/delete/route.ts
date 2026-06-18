import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const { publicId } = await request.json()
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

    const timestamp = Math.floor(Date.now() / 1000)

    const encoder = new TextEncoder()
    const data = encoder.encode(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
    const hashBuffer = await crypto.subtle.digest("SHA-1", data)
    const signature = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    const formData = new URLSearchParams()
    formData.append("public_id", publicId)
    formData.append("api_key", apiKey)
    formData.append("timestamp", String(timestamp))
    formData.append("signature", signature)

    const cloudinaryRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData,
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
