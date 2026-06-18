import type { Machine } from "@/types"

export type Intent = "demolition" | "cutting" | "drilling" | "scaffolding" | "compaction" | "power" | "unknown"

export interface ScoredMachine {
  machine: Machine
  score: number
}

export interface RecommendationResult {
  intent: Intent
  matches: Machine[]
  primary: Machine | null
  alternatives: Machine[]
  responseText: string
}

const INTENT_KEYWORDS: Record<Exclude<Intent, "unknown">, string[]> = {
  demolition: ["romper", "demoler", "piso", "hormigon"],
  cutting: ["cortar", "asfalto"],
  drilling: ["perforar", "taladro", "agujero"],
  scaffolding: ["andamio", "altura", "metros"],
  compaction: ["tierra", "suelo", "compactar"],
  power: ["generador", "electricidad"],
}

const MACHINE_RULES: Array<{
  keywords: string[]
  nameIncludes: string[]
  categories: string[]
}> = [
  { keywords: ["romper", "demoler", "demoledor", "piso"], nameIncludes: ["martillo demoledor"], categories: ["machine"] },
  { keywords: ["cortar", "corte", "asfalto"], nameIncludes: ["amoladora", "sierra circular"], categories: ["tool"] },
  { keywords: ["perforar", "taladro", "agujero"], nameIncludes: ["taladro percutor"], categories: ["tool"] },
  { keywords: ["andamio", "altura", "andamios", "metros"], nameIncludes: ["andamio", "caballetes", "tablón", "puntales", "escalera"], categories: ["scaffold"] },
  { keywords: ["tierra", "suelo", "compactar", "pisón", "compactación"], nameIncludes: ["pisón canguro", "allanadora"], categories: ["machine"] },
  { keywords: ["hormigón", "hormigon", "mezclar", "vibrador"], nameIncludes: ["hormigonera", "vibrador de hormigón"], categories: ["machine"] },
  { keywords: ["generador", "electricidad", "energía", "energia", "luz", "corriente"], nameIncludes: ["grupo electrógeno"], categories: ["machine"] },
  { keywords: ["pintar", "pintura", "pintado"], nameIncludes: ["máquina de pintar"], categories: ["tool"] },
  { keywords: ["soldar", "soldadura", "soldador"], nameIncludes: ["soldadora inverter"], categories: ["tool"] },
  { keywords: ["comprimir", "compresor", "aire", "neumático"], nameIncludes: ["compresor"], categories: ["machine"] },
  { keywords: ["pulir", "pulido", "pulidora"], nameIncludes: ["pulidora"], categories: ["machine"] },
]

const INTENT_CATEGORY_BOOST: Partial<Record<Intent, string[]>> = {
  scaffolding: ["scaffold"],
  demolition: ["machine"],
  cutting: ["tool"],
  drilling: ["tool"],
  compaction: ["machine"],
  power: ["machine"],
}

const INTENT_EXPLANATIONS: Record<Intent, string> = {
  demolition: "trabajos de demolición y rotura",
  cutting: "trabajos de corte de materiales",
  drilling: "perforación y taladrado",
  scaffolding: "trabajos en altura y andamios",
  compaction: "compactación de suelos y terrenos",
  power: "generación de energía eléctrica en obra",
  unknown: "uso general en obra",
}

export function detectIntent(message: string): Intent {
  const lower = message.toLowerCase()
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return intent as Intent
  }
  return "unknown"
}

export function scoreMachine(machine: Machine, message: string, intent: Intent): number {
  const lower = message.toLowerCase()
  const name = (machine.name ?? "").toLowerCase()
  const category = machine.category
  let score = 0

  for (const rule of MACHINE_RULES) {
    const keywordMatch = rule.keywords.some(kw => lower.includes(kw))
    if (!keywordMatch) continue

    const nameMatch = rule.nameIncludes.some(n => name.includes(n))

    if (nameMatch) {
      score += 3
    }

    if (category && rule.categories.includes(category)) {
      score += 2
    }
  }

  const boostCategories = INTENT_CATEGORY_BOOST[intent]
  if (category && boostCategories?.includes(category)) {
    score += 2
  }

  return score
}

export function rankMachines(machines: Machine[], message: string): ScoredMachine[] {
  const intent = detectIntent(message)
  return machines
    .filter(m => m.status === "available")
    .map(m => ({ machine: m, score: scoreMachine(m, message, intent) }))
    .sort((a, b) => b.score - a.score)
}

function generateResponseText(
  intent: Intent,
  primary: Machine | null,
  alternatives: Machine[],
): string {
  const explanation = INTENT_EXPLANATIONS[intent]

  if (!primary) {
    if (alternatives.length > 0) {
      const list = alternatives.map(a => `${a.name} (${a.model})`).join(", ")
      return `Estas son las máquinas disponibles actualmente: ${list}.\n\n¿Para qué tipo de trabajo las necesitas?`
    }
    return `No encontré máquinas disponibles para ${explanation}. ¿Podrías describir mejor el trabajo que necesitas realizar?`
  }

  let text = `Te recomiendo: ${primary.name} (${primary.model})\n`
  text += `Porque es ideal para ${explanation}.\n\n`

  if (alternatives.length > 0) {
    const altList = alternatives.map(a => `${a.name} (${a.model})`).join(", ")
    text += `Alternativas: ${altList}\n\n`
  }

  text += "¿Para qué tipo de trabajo lo necesitas?"
  return text
}

export function recommendMachine(message: string, availableMachines: Machine[]): RecommendationResult {
  const intent = detectIntent(message)
  const scored = rankMachines(availableMachines, message)

  const matches = scored.filter(s => s.score > 0).map(s => s.machine)
  const primary = matches[0] ?? null
  const topAlternatives = matches.slice(1, 3)

  const fallback = scored.map(s => s.machine).slice(0, 2)
  const alternatives = topAlternatives.length > 0 ? topAlternatives : fallback

  const responseText = generateResponseText(intent, primary, alternatives)

  return { intent, matches, primary, alternatives, responseText }
}
