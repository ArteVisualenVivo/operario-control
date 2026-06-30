/**
 * Filtro de busqueda generico reutilizable para listados.
 * Busca coincidencia parcial (case-insensitive) en los campos indicados.
 */
export function filterBySearch<T>(
  items: T[],
  query: string,
  fields: Array<keyof T | ((item: T) => string)>
): T[] {
  if (!query || !query.trim()) return items
  const q = query.toLowerCase().trim()
  return items.filter((item) =>
    fields.some((field) => {
      const value = typeof field === "function" ? field(item) : item[field]
      return String(value ?? "").toLowerCase().includes(q)
    })
  )
}
