# AUDITORÍA PRE-LIMPIEZA SYNC-3C

**Fecha:** 2026-07-16  
**Tipo:** Auditoría de impacto pre-limpieza  
**Objetivo:** Analizar impacto antes de eliminar Redis queue y código muerto

---

## 1. ARCHIVOS QUE DEBEN MODIFICARSE PARA ELIMINAR REDIS QUEUE

### 1.1 Archivo principal: `src/app/api/sync-3c/route.ts`

**Línea 52:**
```typescript
await redis.lpush("sync-3c:queue", commandId)
```

**Impacto de eliminar:**
- El `lpush` escribe comandos a la cola `sync-3c:queue`
- El agente on-demand NO consume esta cola (recibe `commandId` como argumento)
- **Esta línea puede eliminarse sin romper nada**

**Código a modificar:**
```diff
-       await redis.lpush("sync-3c:queue", commandId)
+       // ELIMINADO: sync-3c:queue no se usa en modo on-demand
```

### 1.2 Archivo secundario: `sync-agent/agent.ts`

**No requiere modificación** - El agente ya no tiene `rpop` ni `brpop` de la cola.

---

## 2. ARCHIVOS QUE PUEDEN ELIMINARSE SIN ROMPER COMPILACIÓN

### 2.1 Scripts de limpieza de lock

| Archivo | Uso actual | Puede eliminarse |
|---------|------------|------------------|
| `sync-agent/cleanup-lock.cjs` | Limpia lock colgado | **SÍ** - El agente tiene cleanup integrado |
| `sync-agent/remove-lock.mjs` | Elimina lock directamente | **SÍ** - Funcionalidad duplicada |
| `sync-agent/cleanup-stale-lock.bat` | Elimina lock vía batch | **SÍ** - Funcionalidad duplicada |

### 2.2 Archivo de documentación

| Archivo | Uso actual | Puede eliminarse |
|---------|------------|------------------|
| `agent-diff.txt` | Diff de migración | **SÍ** - Solo documentación histórica |

---

## 3. IMPORTS QUE QUEDARÍAN ROTOS

### 3.1 Imports en `sync-agent/agent.ts`

**Líneas 23-25 (variables de cache):**
```typescript
const STOCK_CACHE_FILE = path.join(CACHE_DIR, "stock-cache.json")
const MACHINES_CACHE_FILE = path.join(CACHE_DIR, "machines-cache.json")
const SPARE_PARTS_CACHE_FILE = path.join(CACHE_DIR, "spare-parts-cache.json")
```

**Uso en líneas 421-426:**
```typescript
if (module === "stock") {
    safeWriteJson(STOCK_CACHE_FILE, items)
    safeWriteJson(MACHINES_CACHE_FILE, buildMachineSeedFromStock(items))
    safeWriteJson(SPARE_PARTS_CACHE_FILE, buildSparePartsSeedFromStock(items))
    console.log("[AGENT] Local stock cache actualizado")
}
```

**Conclusión:** Estas variables **SÍ se usan** - NO pueden eliminarse sin romper compilación.

### 3.2 Imports en `sync-agent/agent.ts`

**Líneas 240-247 (función safeWriteJson):**
```typescript
function safeWriteJson(filePath, data) {
    try {
        ensureCacheDir()
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    } catch (err) {
        console.warn(`[AGENT] No se pudo escribir cache ${path.basename(filePath)}:`, err?.message)
    }
}
```

**Uso:** Se llama en líneas 422-424. **NO puede eliminarse sin romper compilación.**

### 3.3 Imports en `sync-agent/agent.ts`

**Líneas 249-277 (buildMachineSeedFromStock):**
```typescript
function buildMachineSeedFromStock(items) {
    // ... código
}
```

**Uso:** Se llama en línea 423. **NO puede eliminarse sin romper compilación.**

### 3.4 Imports en `sync-agent/agent.ts`

**Líneas 279-302 (buildSparePartsSeedFromStock):**
```typescript
function buildSparePartsSeedFromStock(items) {
    // ... código
}
```

**Uso:** Se llama en línea 424. **NO puede eliminarse sin romper compilación.**

---

## 4. FUNCIONES QUE TIENEN USO REAL

### 4.1 Funciones con uso real en `agent.ts`

| Función | Líneas | Uso | Puede eliminarse |
|---------|--------|-----|------------------|
| `safeWriteJson()` | 240-247 | Líneas 422-424 | **NO** |
| `buildMachineSeedFromStock()` | 249-277 | Línea 423 | **NO** |
| `buildSparePartsSeedFromStock()` | 279-302 | Línea 424 | **NO** |
| `STOCK_CACHE_FILE` | 23 | Línea 422 | **NO** |
| `MACHINES_CACHE_FILE` | 24 | Línea 423 | **NO** |
| `SPARE_PARTS_CACHE_FILE` | 25 | Línea 424 | **NO** |

### 4.2 Funciones sin uso (código muerto)

| Función | Líneas | Uso | Puede eliminarse |
|---------|--------|-----|------------------|
| `ensureCacheDir()` | 234-238 | Solo llamada desde `safeWriteJson()` | **DEPENDE** - Si se elimina `safeWriteJson()`, sí |

---

## 5. CAMBIOS MÍNIMOS NECESARIOS

### 5.1 Cambio 1: Eliminar `lpush` a la cola

**Archivo:** `src/app/api/sync-3c/route.ts`  
**Línea:** 52  
**Acción:** Eliminar la línea `await redis.lpush("sync-3c:queue", commandId)`  
**Riesgo:** **BAJO** - El agente no consume la cola

### 5.2 Cambio 2: Eliminar scripts de cleanup duplicados

**Archivos:**
- `sync-agent/cleanup-lock.cjs`
- `sync-agent/remove-lock.mjs`
- `sync-agent/cleanup-stale-lock.bat`

**Riesgo:** **BAJO** - El agente tiene cleanup integrado en `acquireSingletonLock()`

### 5.3 Cambio 3: NO eliminar código de cache

**Archivos:** `sync-agent/agent.ts`  
**Líneas:** 23-25, 234-247, 249-302  
**Acción:** **NO ELIMINAR** - Se usan en el módulo stock

---

## 6. RESUMEN DE IMPACTO

### 6.1 Qué SÍ se puede eliminar

| Elemento | Archivo | Riesgo |
|----------|---------|--------|
| `lpush("sync-3c:queue", ...)` | `route.ts:52` | **BAJO** - No se consume |
| `cleanup-lock.cjs` | `sync-agent/` | **BAJO** - Duplicado |
| `remove-lock.mjs` | `sync-agent/` | **BAJO** - Duplicado |
| `cleanup-stale-lock.bat` | `sync-agent/` | **BAJO** - Duplicado |
| `agent-diff.txt` | raíz | **BAJO** - Documentación |

### 6.2 Qué NO se puede eliminar

| Elemento | Archivo | Riesgo |
|----------|---------|--------|
| `safeWriteJson()` | `agent.ts:240-247` | **ALTO** - Se usa en módulo stock |
| `buildMachineSeedFromStock()` | `agent.ts:249-277` | **ALTO** - Se usa en módulo stock |
| `buildSparePartsSeedFromStock()` | `agent.ts:279-302` | **ALTO** - Se usa en módulo stock |
| `STOCK_CACHE_FILE` | `agent.ts:23` | **ALTO** - Se usa en módulo stock |
| `MACHINES_CACHE_FILE` | `agent.ts:24` | **ALTO** - Se usa en módulo stock |
| `SPARE_PARTS_CACHE_FILE` | `agent.ts:25` | **ALTO** - Se usa en módulo stock |

---

## 7. FLUJO ACTUAL VS FLUJO ESPERADO

### 7.1 Flujo actual (con inconsistencia)

```
WEB (Sync3CButton)
    ↓
POST /api/sync-3c (crea comando + lpush a queue)
    ↓
POST /api/sync-3c/start-agent (inicia agente con commandId)
    ↓
Agente procesa commandId (NO usa queue)
    ↓
Redis: sync-3c:queue crece sin consumirse
```

### 7.2 Flujo esperado (post-limpieza)

```
WEB (Sync3CButton)
    ↓
POST /api/sync-3c (crea comando SIN queue)
    ↓
POST /api/sync-3c/start-agent (inicia agente con commandId)
    ↓
Agente procesa commandId
    ↓
Redis: sync-3c:queue eliminada, sin memory leak
```

---

## 8. RECOMENDACIÓN FINAL

### 8.1 Acciones seguras (sin riesgo)

1. **Eliminar `lpush` en `route.ts:52`** - No afecta funcionalidad
2. **Eliminar scripts de cleanup** - El agente ya los integra
3. **Eliminar `agent-diff.txt`** - Solo documentación histórica

### 8.2 Acciones con riesgo

1. **NO eliminar código de cache** - Se usa activamente en módulo stock
2. **NO eliminar `sync-3c:result:{id}`** - Se usa para resultados
3. **NO eliminar `sync-3c:command:{id}`** - Se usa para estado

---

**Fin del informe**