// GET /api/invoices — listado de facturas ingresadas (Redis módulo `invoices`).
import { NextResponse } from "next/server"
import { listInvoices } from "@/lib/invoices/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const invoices = await listInvoices()
    return NextResponse.json({ success: true, invoices })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
