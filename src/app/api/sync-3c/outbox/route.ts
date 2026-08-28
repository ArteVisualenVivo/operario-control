import { NextResponse } from "next/server"
import {
  getRedis,
  listOutboxPending,
  readOutboxItem,
  countOutboxPending,
} from "@/lib/sync-3c/redisPrimary"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const redis = getRedis()
    const pendingIds = await listOutboxPending(redis)
    const pending = []
    for (const id of pendingIds) {
      const item = await readOutboxItem(redis, id)
      if (item) {
        pending.push({
          syncId: item.syncId,
          module: item.module,
          target: item.target,
          attempts: item.attempts,
          lastAttemptAt: new Date(item.lastAttemptAt).toISOString(),
          nextRetryAt: new Date(item.nextRetryAt).toISOString(),
          lastError: item.lastError,
          hasPayloadReference: Boolean(item.dataKey) || Boolean(item.bufferBase64),
        })
      }
    }
    return NextResponse.json({
      pendingCount: await countOutboxPending(redis),
      pending,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
