
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

function monthKey(date: Date): string {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
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

    // ─────────────────────────────────────────────────────────────
    // Formato NUEVO (v2): snapshot con las órdenes completas.
    //   { version: 2, orderCount, lineCount, totalGeneral, orders: [...] }
    // Formato VIEJO (v1): array plano de registros de mano de obra.
    //   [{ orderNumber, operator, code, description, ... }]
    // ─────────────────────────────────────────────────────────────
    const isSnapshotV2 =
      !!data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Array.isArray((data as { orders?: unknown }).orders)

    const ordersOut: Array<{
      orderNumber: string
      date: string
      payPeriod: string
      month: string
      operator: string
      client: string
      totalFacturado: number
      lineCount: number
      status: string | null
      typeTotals: Record<string, number>
      lines: Array<{
        type: string
        code: string | null
        description: string
        quantity: number
        unitPrice: number
        totalPrice: number
        date: string
        operator: string | null
      }>
    }> = []

    let totalGeneral = 0
    let recordCount = 0

    if (isSnapshotV2) {
      const snapshot = data as {
        orders: Array<Record<string, never>>
        totalGeneral?: number
        lineCount?: number
      }
      for (const order of snapshot.orders) {
        const o = order as unknown as {
          orderNumber: string
          date?: string
          payPeriod?: string
          month?: string
          operator?: string
          client?: string
          totalFacturado?: number
          lineCount?: number
          typeTotals?: Record<string, number>
          lines?: Array<Record<string, unknown>>
        }
        const date = o.date ?? ""
        const lines = (o.lines ?? []).map((l) => ({
          type: String(l.type ?? ""),
          code: (l.code ?? null) as string | null,
          description: String(l.description ?? ""),
          quantity: Number(l.quantity ?? 1),
          unitPrice: Number(l.unitPrice ?? 0),
          totalPrice: Number(l.totalPrice ?? 0),
          date: String(l.date ?? date),
          operator: (l.operator ?? null) as string | null,
        }))
        const totalFacturado =
          typeof o.totalFacturado === "number"
            ? o.totalFacturado
            : lines.reduce((s, l) => s + l.totalPrice, 0)
        totalGeneral += totalFacturado
        recordCount += lines.length

        ordersOut.push({
          orderNumber: String(o.orderNumber ?? ""),
          date,
          payPeriod: o.payPeriod ?? payPeriodFor(date ? new Date(`${date}T00:00:00`) : new Date()),
          month: o.month ?? monthKey(date ? new Date(`${date}T00:00:00`) : new Date()),
          operator: String(o.operator ?? ""),
          client: String(o.client ?? ""),
          totalFacturado,
          lineCount: lines.length,
          status: (o as { status?: string | null }).status ?? null,
          typeTotals: o.typeTotals ?? {},
          lines,
        })
      }
    } else {
      const laborRecords: Array<{
        orderNumber: string
        operator: string
        code: string
        description: string
        quantity: number
        unitPrice: number
        totalPrice: number
        date: string | Date
      }> = Array.isArray(data) ? (data as never) : []

      // Agrupar por orden de trabajo
      const byOrder = new Map<string, typeof laborRecords>()
      for (const record of laborRecords) {
        const existing = byOrder.get(record.orderNumber) ?? []
        existing.push(record)
        byOrder.set(record.orderNumber, existing)
      }

      for (const [orderNumber, items] of byOrder.entries()) {
        const orderItems = items.map((r) => ({
          type: "mano_obra" as const,
          code: r.code,
          description: r.description,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          totalPrice: r.totalPrice,
          date: r.date,
          operator: r.operator ?? null,
        }))
        const totalFacturado = items.reduce((sum, r) => sum + r.totalPrice, 0)
        totalGeneral += totalFacturado
        recordCount += items.length

        const firstDate = items[0]?.date ? new Date(items[0].date) : new Date()
        ordersOut.push({
          orderNumber,
          date: firstDate.toISOString().slice(0, 10),
          payPeriod: payPeriodFor(firstDate),
          month: monthKey(firstDate),
          operator: items[0]?.operator ?? "",
          client: "",
          totalFacturado,
          lineCount: orderItems.length,
          status: null,
          typeTotals: { mano_obra: totalFacturado },
          lines: orderItems as never,
        })
      }
    }

    // Ordenar por número de orden descendente
    ordersOut.sort((a, b) => b.orderNumber.localeCompare(a.orderNumber))

    const orders = ordersOut

    // Enriquecer órdenes con el estado de mantenimiento (3C), si existe en Redis.
    // Clave: sync-3c:data:maintenance:meta + chunk:i (mismo formato que cesar).
    let orderStatusMap = new Map<string, string>()
    try {
      const mMetaRaw = await redis.get(`sync-3c:data:maintenance:meta`)
      if (mMetaRaw) {
        const mMeta =
          typeof mMetaRaw === "string" ? JSON.parse(mMetaRaw) : mMetaRaw
        const mChunkCount =
          typeof mMeta.chunkCount === "number" ? mMeta.chunkCount : 1
        const mChunks: string[] = []
        for (let i = 1; i <= mChunkCount; i++) {
          const chunk = await redis.get(
            `sync-3c:data:maintenance:chunk:${i}`
          )
          if (chunk)
            mChunks.push(
              typeof chunk === "string" ? chunk : JSON.stringify(chunk)
            )
        }
        if (mChunks.length === mChunkCount) {
          const mData = JSON.parse(mChunks.join(""))
          const records = Array.isArray(mData)
            ? mData
            : (mData.records ?? mData.data ?? [])
          for (const rec of records) {
            if (rec?.orderNumber && rec.status) {
              orderStatusMap.set(
                String(rec.orderNumber),
                String(rec.status)
              )
            }
          }
        }
      }
    } catch {
      // Si no hay maintenance en Redis, las órdenes quedan sin status.
    }
    for (const o of orders) {
      o.status = orderStatusMap.get(o.orderNumber) ?? null
    }

    // Conteo de estados únicos (para poblar el select de filtro).
    const statusCountMap = new Map<string, number>()
    for (const o of orders) {
      const s = o.status ?? "(sin estado)"
      statusCountMap.set(s, (statusCountMap.get(s) ?? 0) + 1)
    }
    const statuses = Array.from(statusCountMap.entries()).map(
      ([value, count]) => ({ value, label: value, count })
    )

    // Agrupar jerárquicamente: mes → quincena → órdenes
    const monthNames = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ]

    const byMonthMap = new Map<string, {
      month: string
      monthLabel: string
      total: number
      quincenas: Map<string, {
        payPeriod: string
        payPeriodLabel: string
        total: number
        orders: typeof orders
      }>
    }>()

    for (const order of orders) {
      const [year, monthStr] = order.month.split("-")
      const monthIdx = parseInt(monthStr, 10) - 1
      const monthLabel = `${monthNames[monthIdx] ?? order.month} ${year}`

      let monthEntry = byMonthMap.get(order.month)
      if (!monthEntry) {
        monthEntry = {
          month: order.month,
          monthLabel,
          total: 0,
          quincenas: new Map(),
        }
        byMonthMap.set(order.month, monthEntry)
      }

      let quincenaEntry = monthEntry.quincenas.get(order.payPeriod)
      if (!quincenaEntry) {
        const isFirstHalf = order.payPeriod.includes("-01 al ")
        quincenaEntry = {
          payPeriod: order.payPeriod,
          payPeriodLabel: isFirstHalf ? "1ª Quincena" : "2ª Quincena",
          total: 0,
          orders: [],
        }
        monthEntry.quincenas.set(order.payPeriod, quincenaEntry)
      }

      quincenaEntry.orders.push(order)
      quincenaEntry.total += order.totalFacturado
      monthEntry.total += order.totalFacturado
    }

    const groups = Array.from(byMonthMap.values()).map((m) => ({
      ...m,
      quincenas: Array.from(m.quincenas.values()).sort((a, b) =>
        a.payPeriod.localeCompare(b.payPeriod)
      ),
    }))

    return NextResponse.json({
      success: true,
      orders: orders.map((o) => ({ ...o, items: o.lines })),
      groups: groups.map((m) => ({
        ...m,
        quincenas: m.quincenas.map((q) => ({
          ...q,
          orders: q.orders.map((o) => ({ ...o, items: o.lines })),
        })),
      })),
      totalGeneral,
      source: "redis",
      recordCount,
      orderCount: orders.length,
      statuses,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}