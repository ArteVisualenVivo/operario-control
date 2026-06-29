export interface ScaffoldComponent {
  name: string
  size?: string
  quantity: number
}

export interface ScaffoldCatalogItem {
  name: string
  category: "machine" | "puntales" | "riendas" | "andamio_accesorios"
  label: string
  kind: "estructura" | "pieza" | "accesorio"
}

export const SCAFFOLD_CATALOG: ScaffoldCatalogItem[] = [
  { name: "Andamio tubular", category: "machine", label: "Andamio tubular", kind: "estructura" },
  { name: "Andamio modular", category: "machine", label: "Andamio modular", kind: "estructura" },
  { name: "Andamio pasillero", category: "machine", label: "Andamio pasillero", kind: "estructura" },
  { name: "Andamio reforzado", category: "machine", label: "Andamio reforzado", kind: "estructura" },
  { name: "Caballetes", category: "machine", label: "Caballetes", kind: "estructura" },
  { name: "Tablón para andamios", category: "machine", label: "Tablón para andamios", kind: "estructura" },
  { name: "Puntales telescópicos", category: "machine", label: "Puntales telescópicos", kind: "estructura" },
  { name: "Riendas", category: "riendas", label: "Riendas", kind: "pieza" },
  { name: "Puntales", category: "puntales", label: "Puntales", kind: "pieza" },
  { name: "Tablones", category: "andamio_accesorios", label: "Tablones", kind: "accesorio" },
  { name: "Plataformas", category: "andamio_accesorios", label: "Plataformas", kind: "accesorio" },
  { name: "Diagonales", category: "andamio_accesorios", label: "Diagonales", kind: "accesorio" },
]

export const SCAFFOLD_RECIPE: ScaffoldComponent[] = [
  { name: "Riendas", size: "largas", quantity: 2 },
  { name: "Riendas", size: "cortas", quantity: 2 },
  { name: "Tablones", size: "3m", quantity: 1 },
]
