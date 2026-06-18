export interface ScaffoldComponent {
  name: string
  size: string
  quantity: number
}

export const SCAFFOLD_RECIPE: ScaffoldComponent[] = [
  { name: "Puntales", size: "3m", quantity: 4 },
  { name: "Riendas", size: "2m", quantity: 4 },
  { name: "Plataformas", size: "2.5m", quantity: 2 },
  { name: "Diagonales", size: "2m", quantity: 4 },
]
