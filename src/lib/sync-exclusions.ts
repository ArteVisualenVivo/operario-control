import fs from "fs"
import path from "path"

export type SyncExclusionKind = "inventory_stock" | "machine"

export interface SyncExclusionEntry {
  kind: SyncExclusionKind
  key: string
  label: string
  blockSync: boolean
  deletedAt: string
}

const CACHE_DIR = path.resolve(process.cwd(), "automation-watcher", "cache")
const EXCLUSIONS_FILE = path.join(CACHE_DIR, "sync-exclusions.json")

function ensureDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
  }
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export function loadSyncExclusions(): SyncExclusionEntry[] {
  try {
    if (!fs.existsSync(EXCLUSIONS_FILE)) return []
    const raw = fs.readFileSync(EXCLUSIONS_FILE, "utf-8")
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter((item) => item && typeof item === "object") as SyncExclusionEntry[]
  } catch {
    return []
  }
}

export function saveSyncExclusions(entries: SyncExclusionEntry[]): void {
  ensureDir()
  fs.writeFileSync(EXCLUSIONS_FILE, JSON.stringify(entries, null, 2))
}

export function upsertSyncExclusion(
  kind: SyncExclusionKind,
  key: string,
  label: string,
  blockSync: boolean,
): SyncExclusionEntry[] {
  const entries = loadSyncExclusions()
  const normalizedKey = normalizeKey(key)
  const filtered = entries.filter((entry) => !(entry.kind === kind && normalizeKey(entry.key) === normalizedKey))

  if (blockSync) {
    filtered.push({
      kind,
      key,
      label,
      blockSync: true,
      deletedAt: new Date().toISOString(),
    })
  }

  saveSyncExclusions(filtered)
  return filtered
}

export function removeSyncExclusion(kind: SyncExclusionKind, key: string): SyncExclusionEntry[] {
  const entries = loadSyncExclusions().filter(
    (entry) => !(entry.kind === kind && normalizeKey(entry.key) === normalizeKey(key)),
  )
  saveSyncExclusions(entries)
  return entries
}

export function isSyncBlocked(kind: SyncExclusionKind, key: string): boolean {
  const normalizedKey = normalizeKey(key)
  return loadSyncExclusions().some(
    (entry) => entry.kind === kind && entry.blockSync && normalizeKey(entry.key) === normalizedKey,
  )
}

export function normalizeSyncKey(value: string): string {
  return normalizeKey(value)
}
