import { NextResponse } from "next/server"
import { loadLocalRepairs } from "@/lib/local-sync"

export const runtime = "nodejs"

export async function GET() {
  const repairs = await loadLocalRepairs()
  return NextResponse.json(repairs)
}
