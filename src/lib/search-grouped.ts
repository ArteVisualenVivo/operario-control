/**
 * Búsqueda agrupada para el Dashboard: resultados por contexto con totales.
 * Trabaja sobre los datos ya cargados (Redis primario / Firestore fallback).
 * No consulta Firebase directamente ni inventa campos.
 */
import type { InventoryStock } from "@/types"
import type { Machine } from "@/types"
import type { MaintenanceRecord } from "@/services/maintenance"
import type { ScaffoldRentalStats } from "@/lib/dashboardStats"
import { SCAFFOLD_CODES, SCAFFOLD_STRUCTURE_CODES } from "@/lib/inventoryGroups"

export interface GroupedSearchData {
    orders: MaintenanceRecord[]
    machines: Machine[]
    stockItems: InventoryStock[]
    scaffoldRentals?: ScaffoldRentalStats | null
}

export interface ResumenAndamios {
    cuerposCompletos: number
    estructuras: number
    riendasLargas: number
    riendasCortas: number
    cuerposAlquilados: number
    tablones: number
    // Puntales
    puntalTotal: number
    puntalBarovo: number
    puntalMarron: number
    puntalNaranja: number
    puntalLargo380: number
    puntalMmq: number
    // Juegos calculados
    juegosComunesDisp: number
    juegosComunesAlq: number
    juegosPasillerosDisp: number
    juegosPasillerosAlq: number
    modulosAlq: number
    modulosDisp: number
    pasillerosAlq: number
    pasillerosDisp: number
}
export interface MaterialRow { codigo: string; nombre: string; familia: string; marca: string; stock: number; disponible: number }
export interface ComponenteRow { grupo: string; codigo: string; nombre: string; cantidad: number }
export interface AlquilerRow { cliente: string; remito: string; cantidad: number; fecha: string; devolucion: string }
export interface ReparacionRow { orden: string; cliente: string; maquina: string; estado: string; fecha: string; descripcion: string }
export interface MaquinaRow { codigo: string; nombre: string; familia: string; stock: number; disponible: number }

export interface GroupedResults {
    query: string
    resumenAndamios: ResumenAndamios | null
    materiales: MaterialRow[]
    componentes: ComponenteRow[]
    alquileres: AlquilerRow[]
    reparaciones: ReparacionRow[]
    maquinas: MaquinaRow[]
    totalResultados: number
}

function normalize(value: string | undefined | null): string {
    if (!value) return ""
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
}
function compact(value: string | undefined | null): string {
    return normalize(value).replace(/[\s-]/g, "")
}
function matchesTokens(compactText: string, tokens: string[]): boolean {
    return tokens.some((tk) => compactText.includes(tk))
}

// Familias de 3C que corresponden a máquinas (igual que machines/page.tsx)
const MACHINE_FAMILIAS = [
    "MAQUINAS", "GRUPO ELECTROGENO", "MOTOBOMBA", "HORMIGONERA", "PISON CANGURO",
    "PLACA VIBRADORA", "SOLDADORAS", "ALLANADORA", "PULIDORA DE PARQUET",
    "PULIDORA DE GRANITO", "AMOLADORA 230-180-110", "DESMALEZADORA", "PODADORAS",
    "ELECTROGUINCHE", "MOTOSIERRA", "REGLA VIBRADORA", "MOTOHOYADORA",
    "HIDROLAVADORA", "ASERRADORA", "MOTOGUADAÑAS",
].map(normalize)

// Términos que activan el grupo de andamios/componentes
const ANDAMIO_TERMS = new Set([
    "andamio", "andamios", "and", "estructura", "estructuras", "rienda", "riendas",
    "corta", "cortas", "larga", "largas", "tablon", "tablones", "rueda", "ruedas",
    "base", "bases", "baranda", "barandas", "caballete",
    "caballetes", "regulador", "reguladores", "extension", "extensiones", "juego",
    "juegos", "diagonal", "diagonales", "plataforma", "plataformas", "scaffold",
])
const PUNTAL_TERMS = new Set([
    "puntal", "puntales",
])
// Términos que activan el grupo de máquinas
const MAQUINA_TERMS = new Set(["maquina", "maquinas", "maquinasalquiladas", "alquiladas"])
// Términos que activan el grupo de alquileres completo
const ALQUILER_TERMS = new Set(["alquiler", "alquileres", "alquilado", "alquilados", "remito", "remitos", "alquil"])

const STRUCTURE_SET = new Set(SCAFFOLD_STRUCTURE_CODES.map(normalize))
const RIENDA_CORTA = new Set(["R01", "R03"].map(normalize))
const RIENDA_LARGA = new Set(["R02", "R04"].map(normalize))
const CODE_GRUPO: { codes: readonly string[]; label: string }[] = [
    { codes: SCAFFOLD_CODES.planks, label: "Tablones" },
    { codes: SCAFFOLD_CODES.wheels_nobrake, label: "Ruedas sin freno" },
    { codes: SCAFFOLD_CODES.wheels_brake, label: "Ruedas con freno" },
    { codes: SCAFFOLD_CODES.wheels_set, label: "Juegos de ruedas (4)" },
    { codes: SCAFFOLD_CODES.puntales, label: "Puntales" },
    { codes: SCAFFOLD_CODES.extensions, label: "Extensiones" },
    { codes: SCAFFOLD_CODES.regulators, label: "Reguladores" },
    { codes: SCAFFOLD_CODES.handrails, label: "Barandas" },
    { codes: SCAFFOLD_CODES.bases, label: "Bases" },
    { codes: SCAFFOLD_CODES.caballetes, label: "Caballetes" },
]
function grupoDeCodigo(codigo: string): string {
    const n = normalize(codigo)
    if (STRUCTURE_SET.has(n)) return "Estructura"
    if (RIENDA_CORTA.has(n)) return "Rienda corta"
    if (RIENDA_LARGA.has(n)) return "Rienda larga"
    for (const g of CODE_GRUPO) {
        if (g.codes.map(normalize).includes(n)) return g.label
    }
    return ""
}
function esComponenteAndamio(item: InventoryStock): boolean {
    return grupoDeCodigo(item.codigo ?? "") !== ""
}

export function searchGrouped(query: string, data: GroupedSearchData): GroupedResults {
  const q = query.trim()
  const empty: GroupedResults = { query, resumenAndamios: null, materiales: [], componentes: [], alquileres: [], reparaciones: [], maquinas: [], totalResultados: 0 }
  if (!q) return empty
  const tokens = compact(q).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return empty

  const scaffoldTerm = tokens.some((tk) => ANDAMIO_TERMS.has(tk))
  const puntalTerm = tokens.some((tk) => PUNTAL_TERMS.has(tk))
  const maquinaTerm = tokens.some((tk) => MAQUINA_TERMS.has(tk))
  const alquilerTerm = tokens.some((tk) => ALQUILER_TERMS.has(tk))

  // --- Materiales / componentes / máquinas desde stockItems ---
  const materiales: MaterialRow[] = []
  const componentes: ComponenteRow[] = []
  const maquinas: MaquinaRow[] = []
  const maquinaSet = new Set(MACHINE_FAMILIAS)
  const componenteVistos = new Set<string>()
  for (const item of data.stockItems) {
    const fields = [item.name, item.codigo, item.category, item.subtype, item.size, item.unit]
    const compactFields = compact(fields.join(" "))
    if (!matchesTokens(compactFields, tokens) && !scaffoldTerm && !maquinaTerm) continue
    const familia = item.category || ""
    if (esComponenteAndamio(item)) {
      const codigo = item.codigo ?? ""
      if (componenteVistos.has(codigo)) continue
      componenteVistos.add(codigo)
      componentes.push({ grupo: grupoDeCodigo(codigo), codigo, nombre: item.name, cantidad: item.stockAvailable })
    } else if (maquinaSet.has(normalize(familia))) {
      maquinas.push({ codigo: item.codigo ?? "", nombre: item.name, familia, stock: item.stockTotal, disponible: item.stockAvailable })
    } else {
      materiales.push({ codigo: item.codigo ?? "", nombre: item.name, familia, marca: "", stock: item.stockTotal, disponible: item.stockAvailable })
    }
  }

  // --- Alquileres 3C ---
  const alquileres: AlquilerRow[] = []
  const detalle = data.scaffoldRentals?.detalle ?? []
  for (const d of detalle) {
    const fields = [d.cliente, d.clienteId, d.remito, d.codigo, d.descripcion, d.fecha, d.devolucion]
    if (alquilerTerm || matchesTokens(compact(fields.join(" ")), tokens)) {
      alquileres.push({ cliente: d.cliente || d.clienteId || "—", remito: d.remito || "—", cantidad: d.cantidad, fecha: d.fecha || "—", devolucion: d.devolucion || "—" })
    }
  }

  // --- Reparaciones / mantenimiento (registro CONSOLIDADO de todos los Excel) ---
  const reparaciones: ReparacionRow[] = []
  for (const o of data.orders) {
    const fields = [
      o.orderNumber, o.clientName, o.clientCode, o.machineName, o.observations, o.observaciones,
      o.articleId, o.status, o.docId, o.type,
      o.statusDescription, o.statusUser,
      o.workItems?.join(" "), o.sourceFiles?.join(" "),
    ]
    if (matchesTokens(compact(fields.join(" ")), tokens)) {
      reparaciones.push({
        orden: o.orderNumber,
        cliente: o.clientName,
        maquina: (o.machineName || "").replace(/^reparaci[oó]n:\s*/i, ""),
        estado: (o.status || "").trim(),
        fecha: o.statusDate instanceof Date
          ? o.statusDate.toLocaleDateString("es-AR")
          : o.entryDate instanceof Date
            ? o.entryDate.toLocaleDateString("es-AR")
            : String(o.entryDate ?? ""),
        descripcion: (o.statusDescription || o.observations || o.machineName || "").slice(0, 90),
      })
    }
  }

  // --- Resumen de andamios (solo si la búsqueda es de andamios o puntales) ---
  let resumenAndamios: ResumenAndamios | null = null
  if (scaffoldTerm || puntalTerm || componentes.length > 0) {
    // Datos desde Redis (remitos 3C + depósito manual)
    const resumen = data.scaffoldRentals?.resumen
    const deposito = data.scaffoldRentals?.deposito
    
    // Módulos alquilados (comunes = total - pasilleros)
    const modulosAlq = Math.max(0, (resumen?.estructuras ?? 0) - (resumen?.pasilleros ?? 0))
    const pasillerosAlq = resumen?.pasilleros ?? 0
    
    // Módulos en depósito
    const modulosDisp = deposito?.modulos ?? 0
    const pasillerosDisp = deposito?.pasilleros ?? 0
    const riendasLargasDisp = deposito?.riendasLargas ?? 0
    const riendasCortasDisp = deposito?.riendasCortas ?? 0
    const tablonesDisp = deposito?.tablones ?? 0
    
    // Riendas alquiladas (calculadas por receta: 2 largas + 2 cortas por módulo)
    const riendasLargasAlq = modulosAlq + pasillerosAlq
    const riendasCortasAlq = modulosAlq + pasillerosAlq
    const tablonesAlq = resumen?.tablones ?? 0
    
    // Cálculo de juegos: 1 juego = 2 módulos + 2 riendas L + 2 riendas C + 1 tablón
    const calcJuegos = (m: number, rl: number, rc: number, t: number) =>
      Math.min(Math.floor(m / 2), Math.floor(rl / 2), Math.floor(rc / 2), t)
    
    const juegosComunesDisp = calcJuegos(modulosDisp, riendasLargasDisp, riendasCortasDisp, tablonesDisp)
    const juegosComunesAlq = calcJuegos(modulosAlq, riendasLargasAlq, riendasCortasAlq, tablonesAlq)
    const juegosPasillerosDisp = calcJuegos(pasillerosDisp, riendasLargasDisp, riendasCortasDisp, tablonesDisp)
    const juegosPasillerosAlq = calcJuegos(pasillerosAlq, riendasLargasAlq, riendasCortasAlq, tablonesAlq)
    
    // Puntales desde Redis
    const puntalData = resumen?.puntalEstructuras as { barovo: number; marron: number; naranja: number; largo380: number; mmq: number; total: number } | undefined
    
    resumenAndamios = {
      cuerposCompletos: juegosComunesDisp + juegosPasillerosDisp,
      estructuras: modulosDisp + pasillerosDisp,
      riendasLargas: riendasLargasDisp,
      riendasCortas: riendasCortasDisp,
      cuerposAlquilados: modulosAlq + pasillerosAlq,
      tablones: tablonesDisp + tablonesAlq,
      // Puntales
      puntalTotal: puntalData?.total ?? 0,
      puntalBarovo: puntalData?.barovo ?? 0,
      puntalMarron: puntalData?.marron ?? 0,
      puntalNaranja: puntalData?.naranja ?? 0,
      puntalLargo380: puntalData?.largo380 ?? 0,
      puntalMmq: puntalData?.mmq ?? 0,
      // Juegos calculados
      juegosComunesDisp,
      juegosComunesAlq,
      juegosPasillerosDisp,
      juegosPasillerosAlq,
      modulosAlq,
      modulosDisp,
      pasillerosAlq,
      pasillerosDisp,
    }
  }

  const totalResultados = materiales.length + componentes.length + alquileres.length + reparaciones.length + maquinas.length
  return { query, resumenAndamios, materiales, componentes, alquileres, reparaciones, maquinas, totalResultados }
}