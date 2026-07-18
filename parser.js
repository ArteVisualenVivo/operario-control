import * as XLSX from "xlsx";
import { classifyScaffoldStock } from "@/lib/scaffoldMatcher";
const COLUMNS = {
    codigo: 2,
    name: 5,
    stockTotal: 20,
    deposito: 1,
    unidadRaw: 7,
};
const DATA_START_ROW = 6;
const UNIT_MAP = {
    "UN.": "unidad",
    "1000 KH": "unidad",
};
function mapUnit(raw) {
    const u = (raw ?? "").toString().trim().toUpperCase();
    return UNIT_MAP[u] || "unidad";
}
export function parseExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const items = [];
    for (let i = DATA_START_ROW; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || !Array.isArray(row))
            continue;
        const codigo = (row[COLUMNS.codigo] ?? "").toString().trim();
        const nameRaw = (row[COLUMNS.name] ?? "").toString().trim();
        if (!codigo && !nameRaw)
            continue;
        const stockTotal = parseFloat(String(row[COLUMNS.stockTotal] ?? 0)) || 0;
        const deposito = parseInt(String(row[COLUMNS.deposito] ?? 0)) || 0;
        const unidadRaw = (row[COLUMNS.unidadRaw] ?? "").toString().trim();
        const unit = mapUnit(unidadRaw);
        const scaffold = classifyScaffoldStock(nameRaw);
        items.push({
            codigo,
            name: nameRaw,
            normalizedName: nameRaw.toLowerCase().trim(),
            stockTotal,
            unit,
            deposito,
            source: "3c",
            stockWarning: stockTotal < 0,
            category: scaffold.category,
            subtype: scaffold.subtype,
            scaffoldKind: scaffold.kind,
        });
    }
    const aggregated = new Map();
    for (const item of items) {
        const key = item.codigo || item.normalizedName;
        const existing = aggregated.get(key);
        if (existing) {
            existing.stockTotal += item.stockTotal;
            existing.depositos.push(item.deposito ?? 0);
            if (item.stockWarning)
                existing.stockWarning = true;
        }
        else {
            aggregated.set(key, {
                ...item,
                depositos: [item.deposito ?? 0],
            });
        }
    }
    const result = [];
    for (const item of aggregated.values()) {
        result.push({
            codigo: item.codigo,
            name: item.name,
            normalizedName: item.normalizedName,
            stockTotal: item.stockTotal,
            unit: item.unit,
            deposito: item.depositos[0] ?? 0,
            source: "3c",
            stockWarning: item.stockWarning,
            category: item.category,
            subtype: item.subtype,
            scaffoldKind: item.scaffoldKind,
        });
    }
    return { items: result, rawCount: items.length };
}
