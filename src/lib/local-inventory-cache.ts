import fs from "fs"
import path from "path"
import type { InventoryStock, Machine, SparePart } from "@/types"

const CACHE_DIR = path.resolve(process.cwd(), "automation-watcher/cache")
const STOCK_CACHE_FILE = path.join(CACHE_DIR, "stock-cache.json")
const MACHINES_CACHE_FILE = path.join(CACHE_DIR, "machines-cache.json")
const SPARE_PARTS_CACHE_FILE = path.join(CACHE_DIR, "spare-parts-cache.json")

function ensureArray<T>(value: unknown): T[] | null {
  if (!Array.isArray(value)) return null
  return value as T[]
}

function readJsonFile<T>(file: string): T[] | null {
  if (!fs.existsSync(file)) return null
  try {
    const raw = fs.readFileSync(file, "utf-8")
    const data = JSON.parse(raw)
    return ensureArray<T>(data)
  } catch {
    return null
  }
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value
  const parsed = new Date(String(value ?? ""))
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function normalizeMachine(item: Machine): Machine {
  return {
    ...item,
    createdAt: toDate((item as unknown as Record<string, unknown>).createdAt),
    updatedAt: toDate((item as unknown as Record<string, unknown>).updatedAt),
  }
}

function normalizeStock(item: InventoryStock): InventoryStock {
  return {
    ...item,
    createdAt: toDate((item as unknown as Record<string, unknown>).createdAt),
    updatedAt: toDate((item as unknown as Record<string, unknown>).updatedAt),
  }
}

function normalizeSparePart(item: SparePart): SparePart {
  return {
    ...item,
    createdAt: toDate((item as unknown as Record<string, unknown>).createdAt),
    updatedAt: toDate((item as unknown as Record<string, unknown>).updatedAt),
  }
}

export function readLocalStockCache(): InventoryStock[] | null {
  const items = readJsonFile<InventoryStock>(STOCK_CACHE_FILE)
  return items?.map(normalizeStock) ?? null
}

export function readLocalMachinesCache(): Machine[] | null {
  const items = readJsonFile<Machine>(MACHINES_CACHE_FILE)
  return items?.map(normalizeMachine) ?? null
}

export function readLocalSparePartsCache(): SparePart[] | null {
  const items = readJsonFile<SparePart>(SPARE_PARTS_CACHE_FILE)
  return items?.map(normalizeSparePart) ?? null
}

export function writeLocalStockCache(items: InventoryStock[]): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(STOCK_CACHE_FILE, JSON.stringify(items, null, 2))
  } catch {
    // best effort
  }
}

export function writeLocalMachinesCache(items: Machine[]): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(MACHINES_CACHE_FILE, JSON.stringify(items, null, 2))
  } catch {
    // best effort
  }
}

export function writeLocalSparePartsCache(items: SparePart[]): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(SPARE_PARTS_CACHE_FILE, JSON.stringify(items, null, 2))
  } catch {
    // best effort
  }
}
