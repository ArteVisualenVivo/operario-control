import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

console.log('=== 1. ESTADO DE GIT ===\n');
try {
  const status = execSync('git status --short', { encoding: 'utf8', cwd: process.cwd() }).trim();
  console.log(status || '(working tree clean - nada por commitar)');
} catch (e) {
  console.log('Error al obtener estado:', e.message);
}

console.log('\n=== 2. ÚLTIMOS COMMITS ===\n');
try {
  const log = execSync('git log --oneline -3', { encoding: 'utf8', cwd: process.cwd() }).trim();
  console.log(log);
} catch (e) {
  console.log('Error al obtener log:', e.message);
}

console.log('\n=== 3. BRANCH ACTUAL ===\n');
try {
  const branch = execSync('git branch --show-current', { encoding: 'utf8', cwd: process.cwd() }).trim();
  console.log('Branch:', branch);
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n=== 4. REMOTO ===\n');
try {
  const remote = execSync('git remote -v', { encoding: 'utf8', cwd: process.cwd() }).trim();
  console.log(remote);
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n=== 5. Vercel project ===\n');
try {
  const project = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
  console.log('Project ID:', project.projectId);
  console.log('Project Name:', project.projectName);
  console.log('Org ID:', project.orgId);
} catch (e) {
  console.log('No se encontró .vercel/project.json o error:', e.message);
}
