import { NextResponse } from "next/server"
import { loadLocalMaintenanceRecords } from "@/lib/local-sync"

export const runtime = "nodejs"

export async function GET() {
  return NextResponse.json(loadLocalMaintenanceRecords())
}
