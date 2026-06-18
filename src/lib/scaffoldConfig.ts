export interface ScaffoldComponent {
  name: string
  size?: string
  quantity: number
}

export const SCAFFOLD_RECIPE: ScaffoldComponent[] = [
  { name: "Puntales", quantity: 4 },
  { name: "Riendas", size: "largas", quantity: 2 },
  { name: "Riendas", size: "cortas", quantity: 2 },
  { name: "Plataformas", quantity: 2 },
  { name: "Diagonales", quantity: 4 },
]
