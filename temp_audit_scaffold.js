const fs = require('fs');
const cache = JSON.parse(fs.readFileSync('automation-watcher/cache/stock-cache.json', 'utf-8'));

const lines = [];

function log(msg) {
    lines.push(msg);
    console.log(msg);
}

// ============================================================
// 1. RIENDAS
// ============================================================
log('========================================');
log('1. RIENDAS');
log('========================================');
const riendas = [];
for (const [k, v] of Object.entries(cache)) {
    const n = (v.name || '').toLowerCase();
    if (n.includes('rienda')) {
        riendas.push({ codigo: v.codigo || k, name: v.name, total: v.stockTotal, disp: v.stockAvailable, alq: v.stockRented || 0, cat: v.category, sub: v.subtype });
    }
}
riendas.sort((a, b) => a.name.localeCompare(b.name));
log('Codigo     | Nombre                                                    | Total | Disp | Alq | Categoria');
log('-----------|------------------------------------------------------------|-------|------|-----|----------');
riendas.forEach(r => log(
    (r.codigo || '').padEnd(11) + '|' +
    (r.name || '').padEnd(58) + '|' +
    String(r.total).padStart(6) + '|' +
    String(r.disp).padStart(5) + '|' +
    String(r.alq).padStart(4) + '|' +
    (r.cat || '')
));

// Separar largas y cortas
const largas = riendas.filter(r => r.name.toLowerCase().includes('larga'));
const cortas = riendas.filter(r => r.name.toLowerCase().includes('corta'));
log('\n--- Riendas LARGAS ---');
largas.forEach(r => log('  ' + r.codigo + ' | ' + r.name + ' | Disp: ' + r.disp + ' | Total: ' + r.total));
log('\n--- Riendas CORTAS ---');
cortas.forEach(r => log('  ' + r.codigo + ' | ' + r.name + ' | Disp: ' + r.disp + ' | Total: ' + r.total));

// ============================================================
// 2. TABLONES
// ============================================================
log('\n========================================');
log('2. TABLONES');
log('========================================');
const tablones = [];
for (const [k, v] of Object.entries(cache)) {
    const n = (v.name || '').toLowerCase();
    if (n.includes('tablon')) {
        tablones.push({ codigo: v.codigo || k, name: v.name, total: v.stockTotal, disp: v.stockAvailable, alq: v.stockRented || 0, cat: v.category });
    }
}
tablones.sort((a, b) => a.name.localeCompare(b.name));
tablones.forEach(r => log(r.codigo + ' | ' + r.name + ' | Total: ' + r.total + ' | Disp: ' + r.disp + ' | Cat: ' + r.cat));

// ============================================================
// 3. ESTRUCTURAS (andamios completos)
// ============================================================
log('\n========================================');
log('3. ESTRUCTURAS COMPLETAS');
log('========================================');
const estructuras = [];
for (const [k, v] of Object.entries(cache)) {
    const n = (v.name || '').toLowerCase();
    if ((n.includes('andamio') && !n.includes('rienda') && !n.includes('tablon') && !n.includes('rueda') && !n.includes('baranda') && !n.includes('regulador') && !n.includes('base') && !n.includes('extension')) ||
        n.includes('juego andamio') || n.includes('jgo and')) {
        estructuras.push({ codigo: v.codigo || k, name: v.name, total: v.stockTotal, disp: v.stockAvailable, cat: v.category });
    }
}
estructuras.sort((a, b) => a.name.localeCompare(b.name));
estructuras.forEach(r => log(r.codigo + ' | ' + r.name + ' | Total: ' + r.total + ' | Disp: ' + r.disp + ' | Cat: ' + r.cat));

// ============================================================
// 4. RUEDAS
// ============================================================
log('\n========================================');
log('4. RUEDAS');
log('========================================');
const ruedas = [];
for (const [k, v] of Object.entries(cache)) {
    const n = (v.name || '').toLowerCase();
    if (n.includes('rueda') && (n.includes('andamio') || n.includes('ruedas andamio') || n.includes('ruedas p/andamio') || n.includes('juego ruedas p/andamio'))) {
        ruedas.push({ codigo: v.codigo || k, name: v.name, total: v.stockTotal, disp: v.stockAvailable, cat: v.category });
    }
}
ruedas.sort((a, b) => a.name.localeCompare(b.name));
ruedas.forEach(r => log(r.codigo + ' | ' + r.name + ' | Total: ' + r.total + ' | Disp: ' + r.disp + ' | Cat: ' + r.cat));

// ============================================================
// 5. PUNTALES
// ============================================================
log('\n========================================');
log('5. PUNTALES');
log('========================================');
const puntales = [];
for (const [k, v] of Object.entries(cache)) {
    const n = (v.name || '').toLowerCase();
    if (n.includes('puntal')) {
        puntales.push({ codigo: v.codigo || k, name: v.name, total: v.stockTotal, disp: v.stockAvailable, cat: v.category });
    }
}
puntales.sort((a, b) => a.name.localeCompare(b.name));
puntales.forEach(r => log(r.codigo + ' | ' + r.name + ' | Total: ' + r.total + ' | Disp: ' + r.disp + ' | Cat: ' + r.cat));

// ============================================================
// 6. ACCESORIOS (barandas, bases, reguladores, extensiones)
// ============================================================
log('\n========================================');
log('6. ACCESORIOS');
log('========================================');
const acc = [];
for (const [k, v] of Object.entries(cache)) {
    const n = (v.name || '').toLowerCase();
    if (n.includes('baranda') || n.includes('base andamio') || n.includes('base reguladora') || n.includes('regulador') || n.includes('extension cuerpo')) {
        acc.push({ codigo: v.codigo || k, name: v.name, total: v.stockTotal, disp: v.stockAvailable, cat: v.category, tipo: n.includes('baranda') ? 'baranda' : n.includes('base') ? 'base' : n.includes('regulador') ? 'regulador' : n.includes('extension') ? 'extension' : 'otro' });
    }
}
acc.sort((a, b) => a.name.localeCompare(b.name));
acc.forEach(r => log(r.codigo + ' | ' + r.name + ' | Total: ' + r.total + ' | Disp: ' + r.disp + ' | Tipo: ' + r.tipo));

// ============================================================
// 7. CABALLETES
// ============================================================
log('\n========================================');
log('7. CABALLETES');
log('========================================');
const caballetes = [];
for (const [k, v] of Object.entries(cache)) {
    const n = (v.name || '').toLowerCase();
    if (n.includes('caballete')) {
        caballetes.push({ codigo: v.codigo || k, name: v.name, total: v.stockTotal, disp: v.stockAvailable });
    }
}
caballetes.sort((a, b) => a.name.localeCompare(b.name));
caballetes.forEach(r => log(r.codigo + ' | ' + r.name + ' | Total: ' + r.total + ' | Disp: ' + r.disp));

// ============================================================
// 8. GANCHOS
// ============================================================
log('\n========================================');
log('8. GANCHOS');
log('========================================');
const ganchos = [];
for (const [k, v] of Object.entries(cache)) {
    const n = (v.name || '').toLowerCase();
    if (n.includes('gancho')) {
        ganchos.push({ codigo: v.codigo || k, name: v.name, total: v.stockTotal, disp: v.stockAvailable });
    }
}
ganchos.sort((a, b) => a.name.localeCompare(b.name));
ganchos.forEach(r => log(r.codigo + ' | ' + r.name + ' | Total: ' + r.total + ' | Disp: ' + r.disp));

// ============================================================
// 9. DUPLICADOS
// ============================================================
log('\n========================================');
log('9. DUPLICADOS DETECTADOS');
log('========================================');
const nameMap = {};
const allItems = [...riendas, ...tablones, ...estructuras, ...ruedas, ...puntales, ...acc, ...caballetes, ...ganchos];
allItems.forEach(r => {
    const key = (r.name || '').toLowerCase().trim();
    if (!nameMap[key]) nameMap[key] = [];
    nameMap[key].push(r);
});
let dupCount = 0;
for (const [name, items] of Object.entries(nameMap)) {
    if (items.length > 1) {
        dupCount++;
        log('\nDUPLICADO: "' + items[0].name + '"');
        items.forEach(r => log('  Codigo: ' + r.codigo + ' | Total: ' + r.total + ' | Disp: ' + r.disp));
    }
}
if (dupCount === 0) log('No se encontraron duplicados exactos.');

// ============================================================
// 10. RESUMEN
// ============================================================
log('\n========================================');
log('10. RESUMEN POR FAMILIA');
log('========================================');
log('Riendas largas: ' + largas.reduce((s, r) => s + r.disp, 0) + ' disponibles (' + largas.length + ' articulos)');
log('Riendas cortas: ' + cortas.reduce((s, r) => s + r.disp, 0) + ' disponibles (' + cortas.length + ' articulos)');
log('Tablones: ' + tablones.reduce((s, r) => s + r.disp, 0) + ' disponibles (' + tablones.length + ' articulos)');
log('Estructuras: ' + estructuras.reduce((s, r) => s + r.disp, 0) + ' disponibles (' + estructuras.length + ' articulos)');
log('Ruedas andamio: ' + ruedas.reduce((s, r) => s + r.disp, 0) + ' disponibles (' + ruedas.length + ' articulos)');
log('Puntales: ' + puntales.reduce((s, r) => s + r.disp, 0) + ' disponibles (' + puntales.length + ' articulos)');
log('Accesorios: ' + acc.reduce((s, r) => s + r.disp, 0) + ' disponibles (' + acc.length + ' articulos)');
log('Caballetes: ' + caballetes.reduce((s, r) => s + r.disp, 0) + ' disponibles (' + caballetes.length + ' articulos)');
log('Ganchos: ' + ganchos.reduce((s, r) => s + r.disp, 0) + ' disponibles (' + ganchos.length + ' articulos)');

// Guardar a archivo
fs.writeFileSync('temp_audit_output.txt', lines.join('\n'), 'utf-8');
console.log('\n\nInforme guardado en temp_audit_output.txt');