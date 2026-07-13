# 🎯 MATRIZ DE ISSUES — AUDITORÍA OPERARIO-CONTROL

**Referencia rápida de todos los problemas identificados**  
**Fecha:** 10 de Julio de 2026  
**Total Issues:** 25 (6 Críticos, 15 Mayores, 4 Medios)

---

## 🔴 CRÍTICOS (Must Fix Inmediatamente)

| ID | Área | Problema | Ubicación | Impacto | Severidad | Esfuerzo |
|----|------|----------|-----------|---------|-----------|----------|
| C1 | Hooks | Global state anti-pattern | `src/hooks/useSparePartsCache.ts` | Memory leak indefinido | 🔴 CRÍTICO | Bajo |
| C2 | Hooks | Circular dependency en load callback | `src/hooks/useMachines.ts` | Infinite render loops | 🔴 CRÍTICO | Medio |
| C3 | Hooks | No mounted check, setState warning | `src/hooks/useRepairs.ts`, `useSpareParts.ts` | Memory leak | 🔴 CRÍTICO | Bajo |
| C4 | Firebase | Cuota Spark excedida 66K vs 50K | Firestore service account | Sincronización bloqueada | 🔴 CRÍTICO | Muy bajo (upgrade) |
| C5 | Seguridad | APIs sin autenticación | `src/app/api/sync-3c/*`, `/cloudinary/*` | Acceso no autorizado | 🔴 CRÍTICO | Medio |
| C6 | AutoHotkey | Coordenadas hardcoded para resolución | `automation/sync_3c.ahk`, `sync_reparaciones.ahk` | Script falla si pantalla cambia | 🔴 CRÍTICO | Alto (OCR) |

---

## 🟡 MAYORES (Should Fix ASAP)

| ID | Área | Problema | Ubicación | Impacto | Esfuerzo |
|----|------|----------|-----------|---------|----------|
| M1 | Database | originalData sin límite en maintenance | `maintenance/{docId}.originalData` | Documentos > 1MB posible | Bajo |
| M2 | Database | 8 queries sin índices Firestore | `inventory_stock`, `repairs`, `maintenance` | -70% performance | Muy bajo (create index) |
| M3 | Components | RepairForm oversized 398 LOC + 13 useState | `src/components/repairs/RepairForm.tsx` | Unmaintainable | Medio |
| M4 | Components | SmartAlertsPanel God component 367 LOC | `src/components/dashboard/SmartAlertsPanel.tsx` | Difícil de testar | Medio |
| M5 | Architecture | Polling manual con 4 refs | `src/components/sync/Sync3CButton.tsx` | Error prone | Bajo |
| M6 | Database | getMachines() sin limit() | `src/services/machines.ts:202` | Full scan 1000+ docs | Muy bajo |
| M7 | Error Handling | inventoryMovements sin try/catch | `src/services/inventoryMovements.ts` | Crashes silenciosos | Muy bajo |
| M8 | Error Handling | stockMovements sin try/catch | `src/services/stockMovements.ts` | Crashes silenciosos | Muy bajo |
| M9 | Error Handling | audit.ts sin completo error handling | `src/services/audit.ts` | Crashes posibles | Muy bajo |
| M10 | Redis | Sin límite de queue size | `sync-3c:queue` Redis | DDOS posible | Bajo |
| M11 | API | POST /api/sync-3c sin validación de input | `src/app/api/sync-3c/route.ts` | Crash posible | Muy bajo |
| M12 | Code Quality | 415 LOC duplicados | Múltiples archivos | Maintenance overhead | Bajo |
| M13 | Agent | Sin reintentos al conectar Redis | `sync-agent/agent.mjs` | Agente muere si offline | Bajo |
| M14 | AutoHotkey | Debug MouseMove/Sleep en producción | `automation/sync_reparaciones.ahk` | Sincronización lenta | Muy bajo |
| M15 | Performance | 3 queries grandes en secuencia | `src/services/stockIntelligence.ts` | Análisis lento | Bajo |

---

## 🟡 MEDIOS (Nice to Have)

| ID | Área | Problema | Ubicación | Impacto | Esfuerzo |
|----|------|----------|-----------|---------|----------|
| MD1 | Database | SCAN para recovery stale > 10min | `sync-agent/agent.mjs` | O(n) lento con muchas keys | Bajo |
| MD2 | Performance | useStockIntelligence sin caché | `src/hooks/useStockIntelligence.ts` | Recalcula cada render | Bajo |
| MD3 | Database | Múltiples queries en getRepairs() | `src/services/repairs.ts` | N+1 problem | Bajo |
| MD4 | Parser | Excel parser sin validación de esquema | `src/lib/sync-3c/parser.ts` | Crash si formato incorrecto | Muy bajo |

---

## 📊 ANÁLISIS POR ARCHIVO

### 🔴 Problemas por Archivo (TOP 10)

| Archivo | # Issues | Severidad | Tipo |
|---------|----------|-----------|------|
| `src/hooks/useSparePartsCache.ts` | 1 | 🔴 CRÍTICO | Memory leak + anti-pattern |
| `src/hooks/useMachines.ts` | 1 | 🔴 CRÍTICO | Circular dependency |
| `src/hooks/useRepairs.ts` | 1 | 🔴 CRÍTICO | Memory leak |
| `src/components/repairs/RepairForm.tsx` | 2 | 🟡 MAYOR | Oversized + 13 useState |
| `src/components/dashboard/SmartAlertsPanel.tsx` | 2 | 🟡 MAYOR | God component + acoplado |
| `src/services/repairs.ts` | 2 | 🟡 MAYOR | Multiple queries + N+1 |
| `src/services/inventoryMovements.ts` | 1 | 🟡 MAYOR | Sin error handling |
| `automation/sync_3c.ahk` | 2 | 🔴 CRÍTICO | Hardcoded coords |
| `automation/sync_reparaciones.ahk` | 2 | 🟡 MAYOR | Debug code + hardcoded |
| `sync-agent/agent.mjs` | 2 | 🟡 MAYOR | Sin reintentos + SCAN lento |

---

## 🛠️ MATRIZ DE SOLUCIONES

### Soluciones por Issue

| ID | Issue | Solución | Líneas de Código | Complejidad |
|----|-------|----------|------------------|------------|
| C1 | useSparePartsCache global | Convertir a useState normal | 20 | Baja |
| C2 | useMachines circular dep | Envolver load en useCallback correcto | 15 | Media |
| C3 | useRepairs no mounted | Agregar mounted check | 5 por hook | Baja |
| C4 | Firebase quota | Upgrade plan Spark → Pay-as-you-go | 0 (config) | Baja |
| C5 | APIs sin auth | Verificar Firebase Auth en cada route | 30-40 | Baja |
| C6 | AutoHotkey hardcoded | Implementar OCR o ImageSearch | 200+ | Alta |
| M1 | originalData sin límite | Migrar a subcollection | 50 | Media |
| M2 | Sin índices | Crear índices en Firestore | 0 (UI) | Muy baja |
| M3 | RepairForm 398 LOC | Usar React Hook Form | 150 | Media |
| M4 | SmartAlertsPanel God | Extraer a servicio | 100 | Media |
| M5 | Polling manual 4 refs | Migrar a React Query | 80 | Baja |
| M6 | getMachines sin limit | Agregar limit(500) | 1 | Muy baja |
| M7-M9 | Sin error handling | Agregar try/catch | 20 | Muy baja |
| M10 | Redis queue sin límite | Agregar LLEN check + Redis config | 10 | Baja |
| M11 | API sin validación | Validar input con Zod | 30 | Baja |
| M12 | 415 LOC duplicados | Extraer a lib/utils.ts | 50 | Baja |
| M13 | Agent sin reintentos | Agregar retry logic + exponential backoff | 40 | Media |
| M14 | Debug code producción | Remover MouseMove/Sleep | 2 | Muy baja |
| M15 | 3 queries secuencia | Paralelizar con Promise.all | 5 | Muy baja |

---

## ✅ CHECKLIST DE FIXES

### FASE 1 (Máxima Urgencia - Semana 1)

```
🔴 CRÍTICOS - DEBEN ARREGLARSE YA
[ ] C1: Fix useSparePartsCache (useState)          → 30 min
[ ] C2: Fix useMachines circular dependency        → 1 hora
[ ] C3: Agregar mounted check a useRepairs/Parts   → 1 hora
[ ] M7-M9: Agregar try/catch a servicios sin error → 30 min
[ ] M14: Remover debug code AutoHotkey            → 10 min

Sub-total: 3-4 horas

🟡 MAYORES - AGREGAR VALIDACIÓN
[ ] M11: Validar input POST /api/sync-3c          → 1 hora
[ ] C5: Agregar autenticación a APIs             → 2 horas
[ ] M6: Agregar limit() a getMachines()           → 10 min

Sub-total: 3-4 horas más

TOTAL FASE 1: 6-8 horas
```

### FASE 2 (Performance - Semana 2)

```
[ ] M2: Crear 8 índices en Firestore              → 30 min
[ ] M10: Rate limiting en POST sync-3c            → 1 hora
[ ] M15: Paralelizar queries                      → 30 min
[ ] M5: Migrar polling a React Query              → 2 horas

Sub-total: 4 horas
```

### FASE 3 (Refactoring - Semana 3)

```
[ ] M12: Extraer helpers a lib/utils.ts           → 2 horas
[ ] M3: Refactor RepairForm con React Hook Form   → 3 horas
[ ] M4: Extraer SmartAlerts a servicio            → 2 horas

Sub-total: 7 horas
```

### FASE 4 (Transformacional - 2 semanas)

```
[ ] C4: Firebase quota (upgrade plan)             → Config
[ ] C6: AutoHotkey OCR/ImageSearch                → 20+ horas
[ ] M1: Migrar originalData a subcollection       → 2 horas
[ ] Tests básicos (smoke + happy path)            → 10+ horas

Sub-total: 30+ horas
```

---

## 📈 IMPACTO DE FIXES

### Impacto Estimado por Fix

| Fix | LOC Ahorrados | Performance | Stability | Maintainability |
|-----|---------------|-----------|-----------|-----------------|
| useSparePartsCache | -20 | +30% | +40% | +20% |
| useMachines circular | 0 | 0% | +50% | 0% |
| mounted checks | -10 | +10% | +30% | 0% |
| Error handling | +5 | 0% | +25% | +5% |
| Índices Firestore | 0 | +70% | 0% | 0% |
| limit() queries | 0 | +40% | 0% | 0% |
| RepairForm refactor | -198 | +20% | +40% | +50% |
| SmartAlerts extract | -250 | +10% | +10% | +60% |
| Remove duplicates | -415 | 0% | 0% | +40% |
| React Query | -150 | +30% | +60% | +50% |
| **TOTAL FASE 1** | **-888** | **+50%** | **+70%** | **+80%** |

---

## 🎯 PRIORIZACIÓN RECOMENDADA

### Criterios de Priorización

```
Priority = (Impact * Urgency) / Effort

🔴 MÁXIMA (P0): C1, C2, C3, C4, C5, C6
└─ Arreglar semana que viene

🟡 ALTA (P1): M1-M6
└─ Arreglar en 1-2 semanas

🟡 MEDIA (P2): M7-M15
└─ Arreglar en 1 mes

🟢 BAJA (P3): MD1-MD4
└─ Nice to have, cuando haya tiempo
```

### Recomendación de Calendario

```
SEMANA 1 (Máximo impacto, mínimo esfuerzo)
├─ Lunes: C1, C2, C3 (Memory leaks)
├─ Martes-Miércoles: M7-M9, M14 (Error handling)
└─ Jueves-Viernes: C5, M11 (Seguridad + validación)

SEMANA 2 (Performance)
├─ M2: Índices Firestore
├─ M6: limit() queries
├─ M15: Paralelizar queries
└─ M5: React Query polling

SEMANA 3 (Refactoring)
├─ M12: Extraer helpers
├─ M3: RepairForm → React Hook Form
└─ M4: SmartAlerts → servicio

SEMANA 4+ (Transformacional)
├─ C4: Firebase upgrade
├─ C6: AutoHotkey OCR
├─ M1: originalData subcollection
└─ Tests
```

---

## 📝 TRACKING

### Issues por Estado

```
❌ OPEN:                  25 issues
├─ 🔴 Críticos:          6
├─ 🟡 Mayores:          15
└─ 🟡 Medios:            4

⏳ EN PROGRESO:          0 issues

✅ RESUELTO:             0 issues
```

### Burndown Estimado

```
Semana 1: 25 → 15 issues (40% reducción)
Semana 2: 15 → 8 issues (47% reducción)
Semana 3: 8 → 2 issues (75% reducción)
Semana 4: 2 → 0 issues (100% resuelto)

Total: 4 semanas de trabajo enfocado
```

---

## 🔗 REFERENCIAS

| Documento | Contiene |
|-----------|----------|
| `RESUMEN_EJECUTIVO_20260710.md` | Resumen de 1 página |
| `AUDITORIA_EXHAUSTIVA_FINAL_20260710.md` | Análisis completo (150 KB) |
| `ANALISIS_EXHAUSTIVO_20260710.md` | Análisis de hooks/servicios |
| `ANALISIS_EXHAUSTIVO_COMPLETO_20260710.md` | Análisis de APIs/AutoHotkey/Firebase |
| `ANALISIS_FINAL_COMPLETO_20260710.md` | Análisis de componentes/módulos |
| `MATRIZ_ISSUES_20260710.md` | Este archivo (referencia rápida) |

---

## 📞 CÓMO USAR ESTE DOCUMENTO

1. **Lectura rápida:** TOP 10 Problemas (primeras 3 secciones)
2. **Planning:** Ver Checklist de Fixes + Calendario
3. **Implementación:** Copiar tabla de Soluciones + Esfuerzo
4. **Tracking:** Actualizar estado en "Issues por Estado"
5. **Detalle:** Consultar documento exhaustivo cuando necesites más info

---

**Generado:** 10 de Julio de 2026  
**Versión:** 1.0  
**Uso:** Referencia rápida para gestión de issues
