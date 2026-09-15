const { readFileSync, writeFileSync } = require('node:fs');

const src = readFileSync('src/services/sparePartOrders.ts', 'utf8');

const pStart = src.indexOf('export function parseSparePartsFromMotivo');
const sStart = src.indexOf('export function splitAndParse', pStart);
if (pStart === -1 || sStart === -1) {
  console.log('markers missing', pStart, sStart);
  process.exit(1);
}

// El comentario /** que precede a splitAndParse marca el fin de la función anterior.
const commentStart = src.lastIndexOf('\n/**', sStart);
if (commentStart === -1) {
  console.log('comment start missing');
  process.exit(1);
}

// El último `}\n` antes de ese comentario cierra la función parseSparePartsFromMotivo
const funcEnd = src.lastIndexOf('}\n', commentStart);
if (funcEnd === -1) {
  console.log('funcEnd missing');
  process.exit(1);
}

const pre = src.slice(0, pStart);
const post = src.slice(funcEnd + 2); // deja el \n antes del comentario

const newFunc = [
  'export function parseSparePartsFromMotivo(motivo: string): { code: string | null; description: string }[] {',
  '  if (!motivo || isAdminText(motivo) || isLaborText(motivo)) return [];',
  '',
  '  const rawLines = cleanLine(motivo);',
  '  if (rawLines.length === 0) return [];',
  '',
  '  const parts: { code: string | null; description: string }[] = [];',
  '',
  '  for (const line of rawLines) {',
  '    if (!line) continue;',
  '    if (line.includes(".")) {',
  '      const sentences = line.split(/\\.\\s*/);',
  '      for (const sentence of sentences) {',
  '        const trimmed = sentence.trim();',
  '        if (!trimmed) continue;',
  '        if (isAdminText(trimmed) || isLaborText(trimmed)) continue;',
  '        const spare = parseSparePartLine(trimmed);',
  '        parts.push(...spare);',
  '      }',
  '      continue;',
  '    }',
  '    const spare = parseSparePartLine(line);',
  '    parts.push(...spare);',
  '  }',
  '',
  '  const seen = new Set<string>();',
  '  return parts',
  '    .filter((p) => p.description && p.description.trim())',
  '    .map((p) => ({',
  '      code: p.code && !isInternalCode(p.code) ? p.code.toUpperCase() : null,',
  '      description: p.description.trim(),',
  '    }))',
  '    .filter((p) => strictValidation(p.description) || (p.code && looksLikeCode(p.code)))',
  '    .filter((p) => {',
  '      const key = `${p.code || ""}|${p.description.toUpperCase().replace(/\\s+/g, " ")}`;',
  '      if (seen.has(key)) return false;',
  '      seen.add(key);',
  '      return true;',
  '    });',
  '}',
  '',
  '/**',
  ' * Validación estricta: solo acepte como repuesto si no es falla/diagnóstico/observación/instrucción/MO/admin.',
  ' * Requiere código propio o descripción de pieza clara.',
  ' */',
  'function strictValidation(text: string): boolean {',
  '  const t = text.trim();',
  '  if (!t) return false;',
  '  if (isDiagnosis(t) || isAdminText(t) || isLaborText(t)) return false;',
  '  const cleaned = cleanDescription(t);',
  '  if (!cleaned) return false;',
  '  if (isDiagnosis(cleaned) || isAdminText(cleaned) || isLaborText(cleaned)) return false;',
  '  return containsSparePart(cleaned) || looksLikeCode(cleaned);',
  '}',
  '',
  '/**',
  ' * Extrae un repuesto de una línea individual aplicando validación estricta:',
  ' * - Separa código propio si existe (formato código real de 3C)',
  ' * - Limpia prefijos verbales',
  ' * - Solo acepta si es repuesto concreto (no falla/diagnóstico/observación/instrucción/MO)',
  ' */',
  'function parseSparePartLine(line: string): { code: string | null; description: string }[] {',
  '  const t = line.trim();',
  '  if (!t) return [];',
  '',
  '  if (isLaborText(t) || isDiagnosis(t) || isAdminText(t)) return [];',
  '',
  '  let code: string | null = null;',
  '  let description: string = t;',
  '',
  '  const byDash = t.match(/^\\s*([^—–-]+?)\\s*[—–-]\\s*(.+)$/);',
  '  if (byDash) {',
  '    const maybeCode = byDash[1].trim();',
  '    const maybeDesc = byDash[2].trim();',
  '    if (looksLikeCode(maybeCode) && !isInternalCode(maybeCode)) {',
  '      code = maybeCode.toUpperCase();',
  '      description = maybeDesc;',
  '    } else {',
  '      const byDashRev = t.match(/^(.+)\\s*[—–-]\\s*([A-Z0-9][A-Z0-9\\s\\-.]+)$/);',
  '      if (byDashRev) {',
  '        const maybeDesc = byDashRev[1].trim();',
  '        const maybeCode = byDashRev[2].trim();',
  '        if (looksLikeCode(maybeCode) && !isInternalCode(maybeCode)) {',
  '          code = maybeCode.toUpperCase();',
  '          description = maybeDesc;',
  '        }',
  '      }',
  '    }',
  '  }',
  '',
  '  if (!code) {',
  '    const inline = t.match(/^(.+?)\\s+([A-Z0-9][A-Z0-9\\s\\-.]{3,})$/);',
  '    if (inline) {',
  '      const candidateCode = inline[2].replace(/\\s+/g, " ").trim();',
  '      if (looksLikeCode(candidateCode) && !isInternalCode(candidateCode)) {',
  '        const candidateDesc = cleanDescription(inline[1].trim());',
  '        if (candidateDesc && (containsSparePart(candidateDesc) || looksLikeCode(candidateDesc))) {',
  '          code = candidateCode.toUpperCase();',
  '          description = candidateDesc;',
  '        }',
  '      }',
  '    }',
  '  }',
  '',
  '  if (!code) {',
  '    description = cleanDescription(t);',
  '    if (!description || isDiagnosis(description) || isAdminText(description) || isLaborText(description)) return [];',
  '    if (!containsSparePart(description) && !looksLikeCode(description)) return [];',
  '  }',
  '',
  '  if (isDiagnosis(description) || isAdminText(description) || isLaborText(description)) return [];',
  '',
  '  return [{ code, description }];',
  '}',
  '',
].join('\n') + '\n';

const newSrc = pre + newFunc + post;
writeFileSync('src/services/sparePartOrders.ts', newSrc, 'utf8');
console.log('Reemplazo completado.');
console.log('Nuevo largo:', newSrc.length);
