import { NextResponse } from "next/server"
import { loadLocalRepairs } from "@/lib/local-sync"

export const runtime = "nodejs"

export async function GET() {
  return NextResponse.json(loadLocalRepairs())
}
