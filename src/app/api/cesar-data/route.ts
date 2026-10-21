import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

function payPeriodFor(date: Date): string {
  const d = new Date(date)
  const day = d.getDate()
  const month = d.getMonth() + 1
  const year = d.getFullYear()
  const startDay = day <= 15 ? 1 : 16
  const endDay = day <= 15 ? 15 : new Date(year, month, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(startDay)} al ${year}-${pad(month)}-${pad(endDay)}`
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET() {
  try {
    const redis = getRedis()

    // Leer meta de CESAR desde Redis
    const metaRaw = await redis.get(`sync-3c:data:cesar:meta`)
    if (!metaRaw) {
      return NextResponse.json({
        success: true,
        orders: [],
        totalGeneral: 0,
        source: "redis-empty",
        message: "No hay datos de CESAR en Redis todavía",
      })
    }

    const meta = typeof metaRaw === "string" ? JSON.parse(metaRaw) : metaRaw
    const chunkCount = typeof meta.chunkCount === "number" ? meta.chunkCount : 1

    const chunks: string[] = []
    for (let i = 1; i <= chunkCount; i++) {
      const chunk = await redis.get(`sync-3c:data:cesar:chunk:${i}`)
      if (chunk) chunks.push(typeof chunk === "string" ? chunk : JSON.stringify(chunk))
    }

    if (chunks.length !== chunkCount) {
      return NextResponse.json(
        { success: false, error: "Datos de CESAR incompletos en Redis" },
        { status: 500 }
      )
    }

    const dataJson = chunks.join("")
    let data: unknown = null
    if (dataJson) {
      data = JSON.parse(dataJson)
    }

    const laborRecords: Array<{
      orderNumber: string
      operator: string
      code: string
      description: string
      quantity: number
      unitPrice: number
      totalPrice: number
      date: string | Date
    }> = Array.isArray(data) ? data : []

    // Agrupar por orden de trabajo
    const byOrder = new Map<string, typeof laborRecords>()
    for (const record of laborRecords) {
      const existing = byOrder.get(record.orderNumber) ?? []
      existing.push(record)
      byOrder.set(record.orderNumber, existing)
    }

    const orders: Array<{
      orderNumber: string
      totalFacturado: number
      items: Array<{
        type: "mano_obra"
        code: string | null
        description: string
        quantity: number
        unitPrice: number
        totalPrice: number
      }>
    }> = []

    let totalGeneral = 0

    for (const [orderNumber, items] of byOrder.entries()) {
      const orderItems = items.map((r) => ({
        type: "mano_obra" as const,
        code: r.code,
        description: r.description,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        totalPrice: r.totalPrice,
      }))
      const totalFacturado = items.reduce((sum, r) => sum + r.totalPrice, 0)
      totalGeneral += totalFacturado
      orders.push({ orderNumber, totalFacturado, items: orderItems })
    }

    // Ordenar por número de orden descendente
    orders.sort((a, b) => b.orderNumber.localeCompare(a.orderNumber))

    return NextResponse.json({
      success: true,
      orders,
      totalGeneral,
      source: "redis",
      recordCount: laborRecords.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}