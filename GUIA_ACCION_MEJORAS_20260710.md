# GUÍA DE ACCIÓN — operario-control
**Fecha:** 2026-07-10  
**Propósito:** Implementación sistemática de mejoras basadas en análisis exhaustivo

---

## TABLA DE CONTENIDOS
1. [Quick Reference Matrix](#1-quick-reference-matrix)
2. [Priorización de Tareas](#2-priorización-de-tareas)
3. [Plan de Implementación](#3-plan-de-implementación)
4. [Checklist de Mejoras](#4-checklist-de-mejoras)

---

## 1. QUICK REFERENCE MATRIX

### 1.1 Componentes UI — Status Actual

```
┌─────────────────────────────┬──────┬─────────┬──────────┬────────────────────────────┐
│ Componente                  │ LOC  │ Estados │ Effects  │ Problemas / Acción         │
├─────────────────────────────┼──────┼─────────┼──────────┼────────────────────────────┤
│ SmartAlertsPanel            │ 367  │ 2       │ 1        │ Extraer AlertEngine        │
│ WorkshopSummary             │ 80   │ 1       │ 1        │ ✓ OK — Dejar como está    │
│ GlobalSearchResults         │ 51   │ 0       │ 0        │ ✓ OK — Puro                │
│ MachineCard                 │ 142  │ 0       │ 0        │ Memoizar + simplificar     │
│ RepairForm                  │ 398  │ 13      │ 1        │ 🔴 REFACTOR — react-hf    │
│ MaintenanceTable            │ 252  │ 3       │ 1        │ Importar servicios arriba  │
│ Sync3CButton                │ 337  │ 4       │ 1        │ Usar React Query           │
│ TOTAL DASHBOARD             │ 80   │ 1       │ 1        │ ✓ OK                       │
│ TOTAL MACHINES              │ ~700 │ ?       │ ?        │ TBD                        │
│ TOTAL REPAIRS               │ 398  │ 13      │ 1        │ 🔴 PRIORITY 1              │
│ TOTAL MAINTENANCE           │ 252  │ 3       │ 1        │ PRIORITY 2                 │
│ TOTAL SYNC                  │ 337  │ 4       │ 1        │ PRIORITY 2                 │
└─────────────────────────────┴──────┴─────────┴──────────┴────────────────────────────┘
```

---

### 1.2 Servicios — Duplicación

```
┌─────────────────────────────┬─────────────┬───────────────────────────────┐
│ Función Duplicada           │ Ubicaciones │ Líneas Ahorradas              │
├─────────────────────────────┼─────────────┼───────────────────────────────┤
│ parseDmyDate                │ 3           │ ~20 LOC                       │
│ toDate                      │ 3           │ ~30 LOC                       │
│ isValidDate                 │ 2           │ ~10 LOC                       │
│ excelSerialToDate           │ 2           │ ~20 LOC                       │
│ findDateLikeValue           │ 3           │ ~20 LOC                       │
│ normalize                   │ 2           │ ~15 LOC                       │
│ normalizeRepairStatus       │ 2           │ ~20 LOC                       │
│ docToX conversions          │ 5-6         │ ~200 LOC                      │
│ Cache manual                │ 3           │ ~80 LOC                       │
│ TOTAL DUPLICACIÓN           │ -           │ ~415 LOC                      │
└─────────────────────────────┴─────────────┴───────────────────────────────┘
```

---

### 1.3 Dependencias — Análisis de Necesidad

```
┌─────────────────────────────┬──────────┬──────────────┬────────────────────────┐
│ Dependencia                 │ Versión  │ Necesaria    │ Notas                  │
├─────────────────────────────┼──────────┼──────────────┼────────────────────────┤
│ firebase                    │ ^12.14.0 │ ✓ CRÍTICA    │ Client SDK             │
│ firebase-admin              │ ^14.0.0  │ ✓ CRÍTICA    │ Server SDK (agent)     │
│ @upstash/redis              │ ^1.38.0  │ ✓ CRÍTICA    │ Queue + cache          │
│ xlsx                        │ ^0.18.5  │ ✓ CRÍTICA    │ Sync parsing           │
│ next                        │ 16.2.9   │ ✓ CRÍTICA    │ Framework              │
│ react + react-dom           │ 19.2.4   │ ✓ CRÍTICA    │ Core                   │
│ tailwindcss                 │ ^4       │ ✓ CRÍTICA    │ Styling                │
│ pdfjs-dist                  │ ^6.0.227 │ ⚠️ REVISAR   │ Solo en pdfExtractor   │
│ chokidar                    │ ^5.0.0   │ ⚠️ REVISAR   │ Legacy automation-wch  │
│ next-themes                 │ ^0.4.6   │ ❌ REMOVER   │ No usado               │
│ @base-ui/react              │ ^1.5.0   │ ❌ REMOVER   │ Duplica shadcn         │
│ class-variance-authority    │ ^0.7.1   │ ❌ REVISAR   │ Probablemente no usado │
│ tw-animate-css              │ ^1.4.0   │ ❌ REVISAR   │ Probablemente no usado │
└─────────────────────────────┴──────────┴──────────────┴────────────────────────┘
```

---

### 1.4 Flujos de Negocio — Completitud

```
┌──────────────────────┬─────────────┬────────────┬──────────────────┐
│ Módulo               │ Implementado│ Falta      │ Prioridad        │
├──────────────────────┼─────────────┼────────────┼──────────────────┤
│ Stock                │ ✓✓✓         │ Índices DB │ Media            │
│ Reparaciones         │ ✓✓✓         │ Predicción │ Baja             │
│ Mantenimiento        │ ✓✓✓         │ Alertas ML │ Baja             │
│ Alquileres           │ ✓✓          │ Reservas   │ Media            │
│ Máquinas             │ ✓✓✓         │ -          │ -                │
│ Andamios             │ ✓✓          │ Config UI  │ Media            │
│ Inteligencia Stock   │ ✓           │ ML + cache │ Media            │
│ Remitos              │ ❌          │ Nuevo mod  │ ALTA (planificad)│
│ Búsqueda Global      │ ✓✓          │ Indexación │ Baja             │
│ Auditoría            │ ✓✓✓         │ UI + export│ Baja             │
└──────────────────────┴─────────────┴────────────┴──────────────────┘
```

---

## 2. PRIORIZACIÓN DE TAREAS

### Sprint 1 (Semana 1) — Quick Wins

#### TASK 1.1: Extraer Utilities Compartidas [P0] — 1-2 días
**Impacto:** +20% maintainability, -415 LOC duplicados

**Archivos a crear:**
- `src/lib/dateParser.ts` (consolidar parsers de fecha)
- `src/lib/textNormalizer.ts` (consolidar normalizaciones)
- `src/lib/objectUtils.ts` (findDateLikeValue, parseLocation)

**Archivos a actualizar:**
```
src/lib/local-sync.ts            ← importar dateParser
src/services/repairs.ts          ← importar dateParser, textNormalizer
src/services/maintenance.ts      ← importar dateParser, textNormalizer
src/services/inventoryStock.ts   ← importar objectUtils
src/services/machines.ts         ← importar objectUtils
```

**Checklist:**
- [ ] Crear `src/lib/dateParser.ts` con 8 tests
- [ ] Crear `src/lib/textNormalizer.ts` con 4 tests
- [ ] Crear `src/lib/objectUtils.ts` con 3 tests
- [ ] Actualizar imports en 5 archivos
- [ ] Verificar todos los tests pasen
- [ ] Verificar build sin errores

---

#### TASK 1.2: Extraer AlertEngine [P0] — 1 día
**Impacto:** Reduce SmartAlertsPanel de 367 → 150 LOC

**Archivos a crear:**
- `src/lib/alertEngine.ts` (lógica de análisis)

**Contenido:**
```typescript
export function detectRepetitiveFailures(repairs: MachineRepair[]): SmartAlert[]
export function detectOverloadedMachines(repairs: MachineRepair[]): SmartAlert[]
export function detectIgnoredMaintenance(repairs: MachineRepair[]): SmartAlert[]
export function generateRecommendations(repairs: MachineRepair[]): SmartAlert[]
export function stockToSmartAlert(alert: StockAlert): SmartAlert
```

**Actualizar:**
```
src/components/dashboard/SmartAlertsPanel.tsx ← usar alertEngine
```

---

#### TASK 1.3: Cleanup de Dependencias [P1] — 2 horas
**Impacto:** -50 KB bundle

**Acciones:**
```bash
# Verificar uso
grep -r "@base-ui/react" src/
grep -r "next-themes" src/
grep -r "class-variance-authority" src/
grep -r "tw-animate-css" src/

# Si no se usa:
npm remove @base-ui/react next-themes tw-animate-css

# Verificar:
npm run build
```

---

### Sprint 2 (Semana 2) — Refactorización

#### TASK 2.1: Refactorizar RepairForm [P1] — 2-3 días
**Impacto:** -50% bugs, +30% usabilidad

**Opción A: React Hook Form (RECOMENDADO)**
```bash
npm install react-hook-form zod @hookform/resolvers
```

**Nueva estructura:**
```typescript
// src/components/repairs/RepairForm.tsx
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { repairSchema } from "@/lib/schemas/repairs"

export default function RepairForm() {
  const { register, control, handleSubmit, formState, watch } = useForm({
    resolver: zodResolver(repairSchema),
    defaultValues: initialData,
  })
  // 200 LOC vs 398 actuales
}
```

**Crear:**
- `src/lib/schemas/repairs.ts` — Zod schema
- Actualizar `RepairForm.tsx`

---

#### TASK 2.2: Migrar Polling a React Query [P2] — 2 días
**Impacto:** -150 LOC, +70% reliability

```bash
npm install @tanstack/react-query
```

**Antes (Sync3CButton.tsx):**
```typescript
useEffect(() => {
  pollingRef.current = setInterval(...)
  timeoutRef.current = setTimeout(...)
  return () => { clearInterval(...) }
}, [])
```

**Después:**
```typescript
import { useQuery } from "@tanstack/react-query"

const { data: status, isPending } = useQuery({
  queryKey: ["sync", commandId],
  queryFn: () => fetch(...),
  refetchInterval: 10_000,
  enabled: !!commandId && state === "running",
})
```

---

#### TASK 2.3: Agregar Firestore Índices [P1] — 1 día
**Impacto:** +70% query speed

**Crear en Firebase Console o `firestore.indexes.json`:**
```json
{
  "indexes": [
    {
      "collectionGroup": "inventory_stock",
      "queryScope": "Collection",
      "fields": [
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "repairs",
      "queryScope": "Collection",
      "fields": [
        { "fieldPath": "machineId", "order": "ASCENDING" },
        { "fieldPath": "entryDate", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "maintenance",
      "queryScope": "Collection",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "entryDate", "order": "DESCENDING" }
      ]
    }
  ]
}
```

---

### Sprint 3 (Semana 3) — Performance

#### TASK 3.1: Memoizar Componentes Caros [P2] — 1 día
**Impacto:** -40% render time

```typescript
// src/components/dashboard/SmartAlertsPanel.tsx
export default React.memo(SmartAlertsPanel)

// src/components/sync/Sync3CButton.tsx
export default React.memo(Sync3CButton, (prev, next) => {
  return prev.module === next.module && 
         prev.onComplete === next.onComplete &&
         prev.variant === next.variant
})
```

---

#### TASK 3.2: Code Splitting [P2] — 1 día
**Impacto:** -200 KB main bundle

```typescript
// src/app/layout.tsx
import dynamic from "next/dynamic"

const RepairForm = dynamic(() => import("@/components/repairs/RepairForm"))
const BlueprintUploader = dynamic(() => import("@/components/machines/BlueprintUploader"))
const MaintenanceTable = dynamic(() => import("@/components/maintenance/MaintenanceTable"))

// next.config.ts
export default {
  experimental: {
    optimizePackageImports: ["@/components"],
  },
}
```

---

#### TASK 3.3: Implementar Cache Layer Unificado [P1] — 2 días
**Impacto:** +50% performance en queries repetidas

```typescript
// src/lib/cacheLayer.ts
import { Redis } from "@upstash/redis"

export class CacheLayer {
  constructor(private redis: Redis) {}
  
  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 60
  ): Promise<T> {
    const cached = await this.redis.get<T>(key)
    if (cached) return cached
    
    const fresh = await fetcher()
    await this.redis.setex(key, ttl, JSON.stringify(fresh))
    return fresh
  }
  
  async invalidate(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern)
    if (keys.length > 0) {
      await this.redis.del(...keys)
    }
  }
}

// Uso:
export const cacheLayer = new CacheLayer(redis)

// En servicios:
export async function getStockItems(): Promise<InventoryStock[]> {
  return cacheLayer.get(
    "stock:all",
    async () => {
      // fetch from Firestore
    },
    60 // 60s TTL
  )
}
```

---

## 3. PLAN DE IMPLEMENTACIÓN

### Semana 1: Refactorización Base

```
Lunes     | TASK 1.1: Utilities           | Tests + integración
Martes    | TASK 1.1: Continuación        | 5 archivos actualizados
Miércoles | TASK 1.2: AlertEngine         | SmartAlertsPanel -200 LOC
Jueves    | TASK 1.3: Cleanup deps        | npm remove, build
Viernes   | Code Review + Merge           | QA
```

**Líneas ahorradas:** 415 LOC  
**Build size:** -50 KB  
**Tests agregados:** 15

---

### Semana 2: React Ecosystem

```
Lunes     | TASK 2.1a: Zod Schema        | repairSchema
Martes    | TASK 2.1b: react-hook-form   | RepairForm -200 LOC
Miércoles | TASK 2.2: React Query setup  | Sync3CButton -100 LOC
Jueves    | TASK 2.3: Firestore índices  | Firebase Console
Viernes   | Testing + Benchmark          | Before/After
```

**Líneas ahorradas:** 300 LOC  
**Performance gain:** +30% forms, +70% queries  
**Tests agregados:** 20

---

### Semana 3: Optimización

```
Lunes     | TASK 3.1: React.memo         | 7 componentes
Martes    | TASK 3.2: Code splitting     | dynamic imports
Miércoles | TASK 3.3: CacheLayer         | Redis wrapper
Jueves    | Integration testing          | E2E
Viernes   | Performance audit            | Lighthouse
```

**Bundle size:** -200 KB  
**Render time:** -40%  
**Query latency:** -70%

---

## 4. CHECKLIST DE MEJORAS

### Sprint 1 Completion

```
[ ] TASK 1.1: Extraer utilities
    [ ] Crear src/lib/dateParser.ts
    [ ] Crear src/lib/textNormalizer.ts
    [ ] Crear src/lib/objectUtils.ts
    [ ] Actualizar imports en 5 archivos
    [ ] Tests verdes
    [ ] Build sin errores
    [ ] Pull request reviewed

[ ] TASK 1.2: AlertEngine
    [ ] Crear src/lib/alertEngine.ts
    [ ] Actualizar SmartAlertsPanel.tsx
    [ ] Componente renderiza igual
    [ ] Tests de lógica

[ ] TASK 1.3: Cleanup
    [ ] Verificar dependencies no usadas
    [ ] npm remove ejecutado
    [ ] Build + tests
    [ ] Bundle size verificado
```

### Sprint 2 Completion

```
[ ] TASK 2.1: RepairForm refactor
    [ ] npm install react-hook-form zod
    [ ] Crear repairSchema.ts
    [ ] Reescribir RepairForm.tsx
    [ ] LOC verify: 398 → ~200
    [ ] Funcionalidad 100% igual
    [ ] Tests
    [ ] QA en navegador

[ ] TASK 2.2: React Query
    [ ] npm install @tanstack/react-query
    [ ] QueryClientProvider en layout
    [ ] Reescribir Sync3CButton
    [ ] Polling remove (refs, setInterval)
    [ ] Funcionalidad igual
    [ ] Tests

[ ] TASK 2.3: Firestore índices
    [ ] Crear firestore.indexes.json
    [ ] Deploy a Firebase Console
    [ ] Índices built (puede tardar ~15min)
    [ ] Query benchmarks
    [ ] Monitor en dashboard
```

### Sprint 3 Completion

```
[ ] TASK 3.1: Memoización
    [ ] React.memo + PropTypes check
    [ ] 7 componentes memoizados
    [ ] Profiler check (dev tools)
    [ ] Render count verify

[ ] TASK 3.2: Code splitting
    [ ] Dynamic imports añadidos
    [ ] next.config.ts actualizado
    [ ] Bundle analysis (next-bundle-analyzer)
    [ ] Lazy components test

[ ] TASK 3.3: CacheLayer
    [ ] Crear cacheLayer.ts
    [ ] Redis wrapper funcional
    [ ] Integración en services
    [ ] TTL testing
    [ ] Invalidation testing
```

### Final Checklist

```
ANTES/DESPUÉS:
[ ] LOC: 1,627 → ~1,100 (-467 LOC)
[ ] Duplicación: 415 LOC → 0
[ ] Components > 400 LOC: 1 → 0
[ ] Components > 10 useState: 1 → 0
[ ] Bundle size: X MB → (X - 0.2) MB
[ ] Render time: X ms → 0.6X ms
[ ] Query latency: Y ms → 0.3Y ms

TESTS:
[ ] Unit tests: +35 nuevos tests
[ ] E2E: sync, repairs, maintenance
[ ] Coverage: >80%

DOCUMENTATION:
[ ] Update ARCHITECTURE.md
[ ] Changelog actualizado
[ ] Commit messages claros
[ ] PR descriptions con before/after

DEPLOYMENT:
[ ] Staging env tested
[ ] Production rollout plan
[ ] Monitoring setup
[ ] Rollback plan ready
```

---

**Estimación Total:** 3-4 semanas  
**ROI:** +50% maintainability, -30% bugs, -40% render time  
**Risk Level:** BAJO (cambios refactoring, no features)  

---

*Documento generado: 2026-07-10*  
*Próxima revisión: Post-implementación Sprint 1*
