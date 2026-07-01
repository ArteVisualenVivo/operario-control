import { NextResponse } from "next/server"
import { getMaintenanceRecords } from "@/services/maintenance"

export const runtime = "nodejs"

export async function GET() {
  const records = await getMaintenanceRecords()
  return NextResponse.json(records)
}
