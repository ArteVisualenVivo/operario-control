import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

console.log('=== VERIFICANDO SI HAY COMMITS QUE SUBIR A GITHUB ===\n');

try {
  const logLocal = execSync('git log --oneline -5', { encoding: 'utf8' }).trim().split('\n');
  const logRemote = execSync('git log origin/main --oneline -5', { encoding: 'utf8' }).trim().split('\n');
  
  console.log('LOCAL (HEAD):');
  logLocal.forEach(l => console.log('  ', l));
  
  console.log('\nREMOTO (origin/main):');
  logRemote.forEach(l => console.log('  ', l));
  
  // Commits que están en local pero NO en remoto
  const localSet = new Set(logLocal);
  const remoteSet = new Set(logRemote);
  const missing = logLocal.filter(l => !remoteSet.has(l));
  
  console.log('\n=== COMMITS QUE FALTAN POR SUBIR ===');
  if (missing.length === 0) {
    console.log('  ✅ Todo está actualizado. No hay commits pendientes.');
    console.log('  El último push ya fue realizado.');
  } else {
    console.log(`  ❌ Hay ${missing.length} commit(s) pendiente(s) de subir:`);
    missing.forEach(l => console.log('    ', l));
  }
  
  // Verificar el estado del archivo clave
  console.log('\n=== VERIFICANDO sparePartOrders.ts ===');
  const fs = require('fs');
  const src = fs.readFileSync('src/services/sparePartOrders.ts', 'utf8');
  console.log('Tamaño:', src.length, 'bytes');
  console.log('Tiene strictValidation:', src.includes('function strictValidation'));
  console.log('Tiene parseSparePartLine:', src.includes('function parseSparePartLine'));
  console.log('Tiene parseSparePartsFromMotivo:', src.includes('export function parseSparePartsFromMotivo'));
  
} catch (e) {
  console.error('Error:', e.message);
}

console.log('\n=== INFORMACIÓN DEL PROYECTO VERCEL ===\n');
try {
  const project = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
  console.log('Project ID:', project.projectId);
  console.log('Project Name:', project.projectName);
} catch (e) {
  console.log('No se pudo leer .vercel/project.json:', e.message);
}
