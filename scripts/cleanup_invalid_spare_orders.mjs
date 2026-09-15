/**
 * Limpieza ÚNICA de registros inválidos en spare_part_orders (Firestore Admin).
 * - NO toca maintenance/Reparaciones.
 * - Conserva: códigos reales, "S/C" legítimo (repuesto sin código tipo CARBONES),
 *   y pedidos creados manualmente (source === "manual" o sin source auto).
 * - Elimina: auto-importados cuya descripción es claramente falla/diagnóstico/admin/labor.
 * Uso: node scripts/cleanup_invalid_spare_orders.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import admin from "firebase-admin";

const DRY = process.argv.includes("--dry");
const keyPath = path.resolve(process.cwd(), "sync-agent/service-account.json");
if (!fs.existsSync(keyPath)) {
  console.error("No se encontró sync-agent/service-account.json");
  process.exit(1);
}
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const DIAG = /(no funciona|no funca|no percute|no enciende|no arranca|no gira|no traba|no trae|hace (mucho )?ruido|pierde|fuga|perdió|perdio|se corto|se cortó|roto|rota|trabado|traba el|suelto|suelta|falta|a revisar|problema de|reparacion|reparación|cambiar|desarmo|desarmar)/i;
const ADMIN_TXT = /(retirad[ao]|entregad[ao]|factur|presupuesto|garantia|garantía|cliente no|sin reparar|abandona)/i;
const LABOR = /(mano de obra|service|revision|revisión|mo\b|soldadura)/i;
const VALID_PART = /(rodamiento|ruleman|carb[oó]n|carbones|inducido|estator|engranaje|pi[ñn]on|engranajes|vend[íi]|sello|ret[eé]n|junta|correa|filtro|v[aá]lvula|vaina|pist[oó]n|cigüe[ñn]al|chaveta|tope|bola|resorte|interruptor|conmutador|portaurcas|tuerca|bujes|bobina|cable|portaceramica|cuchilla|manguito|porvera|piñon entrada|colisa|cánula|canula|boquilla|difusor|capsula|c[áa]psula|espiral|platin|balero|bearing|gu[aá]ya|guaya|bomba|kit|membrana|gatillo)/i;

function isInvalidDesc(d) {
  const s = String(d || "").trim();
  if (!s) return true;
  if (DIAG.test(s) && !VALID_PART.test(s)) return true;
  if (ADMIN_TXT.test(s)) return true;
  if (LABOR.test(s) && !VALID_PART.test(s)) return true;
  // Textos muy largos tipo comentario (las fallas se escriben enteras)
  if (s.length > 60 && !VALID_PART.test(s)) return true;
  return false;
}

const snap = await db.collection("spare_part_orders").get();
let deleted = 0, kept = 0;
const batch = db.batch();
for (const doc of snap.docs) {
  const d = doc.data();
  const source = String(d.source || d.notes || "");
  const manual = source === "manual" || /manual/i.test(source);
  const code = String(d.code || d.partCode || "").trim();
  const desc = String(d.partName || d.description || d.repuesto || "").trim();
  const hasRealCode = code && code !== "S/C" && code.length >= 2;
  let bad = false;
  if (!manual) {
    if (hasRealCode) {
      bad = isInvalidDesc(desc); // con código real solo se borra si es texto de falla evidente
    } else {
      bad = isInvalidDesc(desc); // S/C: se exige que parezca repuesto
      if (!bad && !VALID_PART.test(desc)) bad = true;
    }
  }
  if (bad) { batch.delete(doc.ref); deleted++; console.log("DELETE", doc.id, "|", desc.slice(0, 60)); }
  else kept++;
}
if (!DRY && deleted > 0) await batch.commit();
console.log(`\nTotal docs: ${snap.size} | Conservados: ${kept} | ${DRY ? "[DRY] Se borrarían" : "Borrados"}: ${deleted}`);
process.exit(0);
