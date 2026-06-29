export type ScaffoldStockKind = "structure" | "piece" | "accessory" | null

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export function classifyScaffoldStock(name: unknown): {
  kind: ScaffoldStockKind
  category: "puntales" | "riendas" | "andamio_accesorios" | "consumibles"
  subtype: "puntal" | "rienda" | "plataforma" | "diagonal" | "otros" | null
} {
  const text = normalize(name)

  if (!text) {
    return { kind: null, category: "consumibles", subtype: null }
  }

  if (text.includes("rienda")) {
    return { kind: "piece", category: "riendas", subtype: "rienda" }
  }
  if (text.includes("puntal")) {
    return { kind: "piece", category: "puntales", subtype: "puntal" }
  }
  if (text.includes("plataforma")) {
    return { kind: "accessory", category: "andamio_accesorios", subtype: "plataforma" }
  }
  if (text.includes("diagonal")) {
    return { kind: "accessory", category: "andamio_accesorios", subtype: "diagonal" }
  }
  if (text.includes("tabl") || text.includes("andamio") || text.includes("caballet")) {
    return { kind: "structure", category: "andamio_accesorios", subtype: "otros" }
  }

  return { kind: null, category: "consumibles", subtype: null }
}
