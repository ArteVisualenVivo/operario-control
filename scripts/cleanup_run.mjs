import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { GoogleAuth } from "google-auth-library"

const here = dirname(fileURLToPath(import.meta.url))
const projectId = JSON.parse(readFileSync(join(here, "..", "sync-agent", "service-account.json"), "utf8")).project_id

const auth = new GoogleAuth({ keyFile: join(here, "..", "sync-agent", "service-account.json"), scopes: ["https://www.googleapis.com/auth/datastore"] })
const client = await auth.getClient()
const token = (await client.getAccessToken()).token
const BASE = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`

// Regla: SOLO borrar pedidos auto-importados inválidos.
// Inválido = código S/C/vacío Y descripción que es diagnóstico/falla/observación (no repuesto).
// Se conservan: códigos reales (ej. INDUCIDO 1619P16276) y repuestos sin código con nombre limpio (ej. CARBONES).
const DIAG_RE = /(no funciona|no percut|no trab|no enciende|no arranc|no entreg|problema|revisar|revisió|repara|cambiar|cambiars|pierde|perdida|perdió|falta |falta$|hace mucho|hace ruid|se cort|se desarm|se romp|se perd|roto|rotos|suelto|sueltos|trabado|trabada|desgast|vencid|espera|entregad|sin uso|usad|parcial|pcte|observac|nota[: ]|solicitar|urgente|presupuest)/i

function isInvalid(doc) {
  const f = doc.fields ?? {}
  const val = (n) => (f[n] && (f[n].stringValue ?? f[n].integerValue ?? "")) ?? ""
  const code = String(val("code")).trim()
  const desc = String(val("description")).trim()
  const status = String(val("status")).trim().toUpperCase()
  const received = Number(val("quantityReceived") || 0)
  const used = Number(val("quantityUsed") || 0)
  const hasRealCode = code !== "" && code.toUpperCase() !== "S/C"
  // Si ya se tocó manualmente (recibido/usado/cancelado) NO se borra.
  if (status === "RECIBIDO" || status === "UTILIZADO" || status === "CANCELADO" || received > 0 || used > 0) return false
  if (hasRealCode) return false // código real → conservar siempre
  // sin código: solo se borra si el texto es diagnóstico
  return DIAG_RE.test(desc)
}

async function listDocs() {
  const docs = []
  let pageToken
  do {
    const url = `${BASE}/spare_part_orders?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()
    if (json.error) throw new Error(json.error.message)
    docs.push(...(json.documents ?? []))
    pageToken = json.nextPageToken
  } while (pageToken)
  return docs
}

async function main() {
  const docs = await listDocs()
  console.log(`TOTAL DOCS: ${docs.length}`)

  // 1) BORRAR: diagnósticos que escaparon + mano de obra (MO CES) → no son repuestos
  const delRe = /(encian|enciende|\banda\b|no tiene|quemad|probarl|mo ces\b)/i
  // 2) CORREGIR códigos de la orden 11154 según definición del dueño
  const fixMap = [
    { match: /^vaina protectora/i, desc: "VAINA PROTECTORA", code: "16170006D3" },
    { match: /^inducido/i, desc: "INDUCIDO", code: "1619P16276" },
    { match: /^carbones/i, desc: "CARBONES", code: "" },
  ]

  let deleted = 0, fixed = 0
  for (const d of docs) {
    const f = d.fields ?? {}
    const val = (n) => (f[n] && (f[n].stringValue ?? "")) ?? ""
    const desc = String(val("description")).trim()
    const code = String(val("code")).trim()
    const status = String(val("status")).trim().toUpperCase()

    if (status !== "SOLICITADO") continue // no tocar lo tocado manualmente

    const path = d.name.split("/documents/")[1]
    const is11154 = String(val("orderNumber")).includes("00011154")

    if (delRe.test(desc)) {
      const res = await fetch(`${BASE}/${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) { deleted++; console.log(`BORRADO: ${val("orderNumber")} | ${desc.slice(0, 50)}`) }
      else console.error(`FALLO BORRAR: ${path} (${res.status})`)
      continue
    }

    if (is11154 && code === "1262") {
      const rule = fixMap.find((r) => r.match.test(desc))
      if (rule) {
        const mask = { fields: { ...f, description: { stringValue: rule.desc }, code: rule.code ? { stringValue: rule.code } : { stringValue: "S/C" } } }
        const res = await fetch(`${BASE}/${path}?updateMask.fieldPaths=description&updateMask.fieldPaths=code`, {
          method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(mask),
        })
        if (res.ok) { fixed++; console.log(`CORREGIDO: ${rule.desc} → ${rule.code || "S/C"}`) }
        else console.error(`FALLO FIX: ${path} (${res.status})`)
      }
    }
  }
  console.log(`RESUMEN: borrados=${deleted} corregidos=${fixed}`)
  process.exit(0)
}

main().catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1) })
