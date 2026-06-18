export interface ScaffoldComponent {
  name: string
  size?: string
  quantity: number
}

export const SCAFFOLD_RECIPE: ScaffoldComponent[] = [
  { name: "Riendas", size: "largas", quantity: 2 },
  { name: "Riendas", size: "cortas", quantity: 2 },
  { name: "Tablones", size: "3m", quantity: 1 },
]
