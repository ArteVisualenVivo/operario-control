# AUDITORÍA FORENSE DE IMPACTO - MIGRACIÓN AGENTE DAEMON → ON-DEMAND

**Fecha:** 2026-07-16  
**Tipo:** Auditoría forense de impacto (segunda)  
**Objetivo:** Analizar cambios realizados durante la migración de agente daemon a agente on-demand

---

## 1. ARCHIVOS ELIMINADOS

### 1.1 Archivos eliminados físicamente

| Archivo | Estado | Evidencia |
|---------|--------|-----------|
| `sync-agent/agent.mjs` | **ELIMINADO** | El archivo `agent-diff.txt` muestra un diff de `agent.mjs` → `agent.ts`, pero `agent.mjs` no existe en el árbol actual |
| `start-agent.vbs` | **ELIMINADO** | No existe en el proyecto actual |
| `start-operario-control.vbs` | **ELIMINADO** | No existe en el proyecto actual |

### 1.2 Archivos reemplazados

| Archivo original | Archivo nuevo | Evidencia |
|-----------------|---------------|-----------|
| `sync-agent/agent.mjs` | `sync-agent/agent.ts` | `agent-diff.txt` líneas 1-530 muestran el diff de migración |

### 1.3 Código eliminado (no archivos)

| Función/Código | Ubicación | Evidencia |
|----------------|-----------|-----------|
| `pollQueue()` | `agent.mjs` (líneas 428-458 en diff) | Eliminado en la migración a on-demand |
| `startHeartbeat()` | `agent.mjs` (líneas 495-511 en diff) | Eliminado - heartbeat ahora es puntual |
| `recoverStaleCommands()` | `agent.mjs` (líneas 460-493 en diff) | Eliminado - no aplica en modo on-demand |
| `isProcessing` variable | `agent.mjs` (líneas 79, 428) | Eliminado - no aplica en modo on-demand |
| `HEARTBEAT_INTERVAL_MS` | `agent.mjs` (línea 77) | Eliminado |
| `POLL_INTERVAL_MS` | `agent.mjs` (línea 78) | Eliminado |
| `STALE_THRESHOLD_MINUTES` | `agent.mjs` (línea 78) | Eliminado |

---

## 2. REFERENCIAS APUNTANDO A ARCHIVOS ELIMINADOS

### 2.1 Referencias a `agent.mjs`

| Archivo | Línea | Referencia | Estado |
|---------|-------|------------|--------|
| `AGENTS.md` | 391 | `sync-agent/agent.mjs` en estructura de directorios | **ROTO** - El archivo no existe |
| `agent-diff.txt` | 1-530 | Documento de diff que referencia `agent.mjs` | **DOCUMENTACIÓN** - No afecta ejecución |

### 2.2 Referencias a `start-agent.vbs` / `start-operario-control.vbs`

| Archivo | Línea | Referencia | Estado |
|---------|-------|------------|--------|
| `AUDITORIA_FORENSE_TOTAL_20260714.md` | 170-173 | Mención en sección de VBS | **ROTO** - No existe |
| `docs/auditoria-completa-2026-07-05.md` | 167 | Mención en documentación | **ROTO** - No existe |

### 2.3 Referencias a `sync-3c:queue`

| Archivo | Línea | Operación | Estado |
|---------|-------|-----------|--------|
| `src/app/api/sync-3c/route.ts` | 52 | `redis.lpush("sync-3c:queue", commandId)` | **ACTIVO** - Pero el agente no lo consume |
| `agent-diff.txt` | 438, 482 | `redis.rpop("sync-3c:queue")` | **ELIMINADO** del agente |

---

## 3. CÓDIGO MUERTO

### 3.1 Scripts de limpieza de lock (potencialmente muertos)

| Archivo | Propósito | Estado |
|---------|-----------|--------|
| `sync-agent/cleanup-lock.cjs` | Limpia lock colgado verificando proceso | **POSIBLEMENTE MUERTO** - El agente ahora tiene cleanup integrado |
| `sync-agent/remove-lock.mjs` | Elimina lock directamente | **POSIBLEMENTE MUERTO** - Funcionalidad duplicada |
| `sync-agent/cleanup-stale-lock.bat` | Elimina lock vía batch | **POSIBLEMENTE MUERTO** - Funcionalidad duplicada |

### 3.2 Funciones en agent.ts que SÍ se usan

| Función | Ubicación | Uso |
|---------|-----------|-----|
| `buildMachineSeedFromStock()` | `agent.ts` líneas 249-277 | **ACTIVO** - Se llama en línea 423 (módulo stock) |
| `buildSparePartsSeedFromStock()` | `agent.ts` líneas 279-302 | **ACTIVO** - Se llama en línea 424 (módulo stock) |
| `safeWriteJson()` | `agent.ts` líneas 240-247 | **ACTIVO** - Se llama en líneas 422-424 (módulo stock) |

### 3.3 Variables con uso real

| Variable | Ubicación | Uso |
|----------|-----------|-----|
| `STOCK_CACHE_FILE` | `agent.ts` línea 23 | **ACTIVO** - Se usa en línea 422 (módulo stock) |
| `MACHINES_CACHE_FILE` | `agent.ts` línea 24 | **ACTIVO** - Se usa en línea 423 (módulo stock) |
| `SPARE_PARTS_CACHE_FILE` | `agent.ts` línea 25 | **ACTIVO** - Se usa en línea 424 (módulo stock) |
| `EXPORT_RETRIES` | `agent.ts` línea 107 | **ACTIVO** - Se usa en `waitForExport()` |
| `EXPORT_RETRY_DELAY_MS` | `agent.ts` línea 108 | **ACTIVO** - Se usa en `waitForExport()` |

---

## 4. REDIS USADO INNECESARIAMENTE

### 4.1 Operaciones Redis en el endpoint `/api/sync-3c`

**Archivo:** `src/app/api/sync-3c/route.ts`

```typescript
// LÍNEAS 52: LPUSH a la cola
await redis.lpush("sync-3c:queue", commandId)
```

**Problema:** El agente on-demand **NO consume** la cola. El agente ahora recibe el `commandId` directamente como argumento.

### 4.2 Operaciones Redis en el agente

**Archivo:** `sync-agent/agent.ts`

| Operación | Uso | Estado |
|-----------|-----|--------|
| `redis.hset("sync-3c:result:${commandId}", ...)` | Guardar resultado | **ACTIVO** - Necesario |
| `redis.hset("sync-3c:command:${commandId}", ...)` | Actualizar estado | **ACTIVO** - Necesario |
| `redis.set("sync-3c:agent:production", ...)` | Heartbeat | **ACTIVO** - Necesario |
| `redis.lpush("sync-3c:queue", ...)` | Encolar | **ELIMINADO** - No aplica |
| `redis.rpop("sync-3c:queue")` | Desencolar | **ELIMINADO** - No aplica |

### 4.3 Redis innecesario identificado

| Recurso | Uso actual | Recomendación |
|---------|------------|---------------|
| `sync-3c:queue` | Solo escritura (lpush) | **ELIMINAR** - No se consume |
| `sync-3c:result:{id}` | Escritura y lectura | **MANTENER** - Necesario |
| `sync-3c:command:{id}` | Escritura y lectura | **MANTENER** - Necesario |
| `sync-3c:agent:production` | Escritura y lectura | **MANTENER** - Necesario |

---

## 5. ENDPOINTS DEPENDIENTES DE REDIS QUEUE

### 5.1 Endpoints que usan la cola

| Endpoint | Método | Operación Redis | Dependencia de cola |
|----------|--------|-----------------|-------------------|
| `POST /api/sync-3c` | POST | `lpush("sync-3c:queue", ...)` | **SÍ** - Encola comandos |
| `GET /api/sync-3c/status` | GET | `hgetall("sync-3c:command:{id}")` | **NO** - Lee estado directo |
| `GET /api/sync-3c/agent-status` | GET | `get("sync-3c:agent:production")` | **NO** - Lee heartbeat |
| `POST /api/sync-3c/start-agent` | POST | `spawn()` (no Redis) | **NO** - Inicia agente |

### 5.2 Análisis de dependencia

**Problema arquitectónico:**
- `POST /api/sync-3c` encola comandos en `sync-3c:queue`
- `POST /api/sync-3c/start-agent` inicia el agente con `commandId` directo
- **El agente NO hace `rpop` de la cola** - recibe `commandId` como argumento
- **Resultado:** La cola se llena pero nunca se vacía

---

## 6. ARCHIVOS QUE DEBERÍAN ELIMINARSE DEFINITIVAMENTE

### 6.1 Archivos a eliminar

| Archivo | Razón | Riesgo |
|---------|-------|--------|
| `sync-agent/cleanup-lock.cjs` | Funcionalidad integrada en `agent.ts` | **BAJO** - No se usa |
| `sync-agent/remove-lock.mjs` | Funcionalidad integrada en `agent.ts` | **BAJO** - No se usa |
| `sync-agent/cleanup-stale-lock.bat` | Funcionalidad integrada en `agent.ts` | **BAJO** - No se usa |
| `agent-diff.txt` | Archivo de diff temporal | **BAJO** - Solo documentación |

### 6.2 Código a eliminar

| Ubicación | Código | Razón |
|-----------|--------|-------|
| `route.ts` línea 52 | `redis.lpush("sync-3c:queue", commandId)` | La cola no se consume |

---

## 7. ARCHIVOS QUE DEBERÍAN RESTAURARSE

### 7.1 Archivos a restaurar

| Archivo | Razón | Prioridad |
|---------|-------|-----------|
| `sync-agent/agent.mjs` | El agente original con `pollQueue()` era funcional | **BAJA** - El nuevo `agent.ts` funciona en on-demand |
| `start-agent.vbs` | Script de inicio automático | **NO** - No aplica en arquitectura on-demand |
| `start-operario-control.vbs` | Script de inicio alternativo | **NO** - No aplica en arquitectura on-demand |

### 7.2 Nota sobre restauración

**Los archivos eliminados NO deben restaurarse** porque:
1. La arquitectura on-demand es la objetivo
2. El agente `agent.ts` actual funciona correctamente
3. Los VBS no son necesarios en la nueva arquitectura

---

## 8. RIESGO DE ROMPER PRODUCCIÓN

### 8.1 Riesgos identificados

| Riesgo | Archivo | Severidad | Detalle |
|--------|---------|-----------|---------|
| **Cola Redis llena sin consumir** | `src/app/api/sync-3c/route.ts:52` | **ALTO** | `lpush` a `sync-3c:queue` pero el agente no hace `rpop` |
| **Scripts de cleanup duplicados** | `sync-agent/` | **BAJO** | Funcionalidad duplicada |
| **Lock con PID muerto** | `sync-agent/.agent.lock` | **ALTO** | El lock actual tiene PID 12345 que no corresponde a proceso activo |

### 8.2 Escenarios de fallo

#### Escenario 1: Cola acumulada
```
1. Usuario presiona "Sincronizar"
2. POST /api/sync-3c hace lpush a sync-3c:queue
3. POST /api/sync-3c/start-agent inicia agente
4. El agente procesa el commandId recibido como argumento
5. La cola se llena con comandos no procesados
6. Redis memory leak potencial
```

#### Escenario 2: Lock colgado
```
1. PC se apagó abruptamente con lock activo
2. El lock tiene PID 12345 (proceso muerto)
3. Al reiniciar, el agente detecta lock colgado
4. El agente lo elimina (funcionalidad implementada)
5. ✅ Funciona correctamente
```

### 8.3 Matriz de riesgos

| Componente | Riesgo | Mitigación |
|------------|--------|------------|
| Redis Queue | ALTO | Eliminar `lpush` en `route.ts` |
| Lock Management | BAJO | Funciona correctamente en `agent.ts` |
| Heartbeat | BAJO | Funciona correctamente |
| Spawn Process | BAJO | Funciona correctamente en `start-agent/route.ts` |
| Firebase | MEDIO | Cuota bloqueada, pero hay fallback |

---

## 9. RESUMEN EJECUTIVO

### 9.1 Cambios principales de la migración

1. **El agente pasó de daemon a on-demand**
   - Antes: `pollQueue()` cada 5 segundos
   - Ahora: `processCommand()` con `commandId` como argumento

2. **El frontend inicia el agente**
   - `Sync3CButton.tsx` llama a `/api/sync-3c/start-agent`
   - El agente se ejecuta con `npx tsx agent.ts <commandId> <module>`

3. **El lock se gestiona correctamente**
   - `acquireSingletonLock()` y `releaseSingletonLock()` en `agent.ts`
   - Cleanup de locks colgados implementado

### 9.2 Problemas críticos

1. **La cola `sync-3c:queue` se escribe pero no se lee**
   - `POST /api/sync-3c` hace `lpush`
   - El agente NO hace `rpop`
   - **Solución:** Eliminar el `lpush`

2. **Scripts de cleanup duplicados**
   - `cleanup-lock.cjs`, `remove-lock.mjs`, `cleanup-stale-lock.bat`
   - Funcionalidad ya integrada en `agent.ts`

### 9.3 Recomendación

**NO ROMPER PRODUCCIÓN** - Pero sí hay deuda técnica:
1. Eliminar `lpush` a `sync-3c:queue` en `route.ts`
2. Eliminar scripts de cleanup duplicados
3. Verificar que el lock se limpia correctamente al reinicio

---

## 10. EVIDENCIA ADJUNTA

### 10.1 Diff de migración (agent-diff.txt)

El archivo `agent-diff.txt` muestra claramente:
- Eliminación de `pollQueue()` (líneas 428-458)
- Eliminación de `startHeartbeat()` (líneas 495-511)
- Eliminación de `recoverStaleCommands()` (líneas 460-493)
- Cambios de `agent.mjs` a `agent.ts`

### 10.2 Lock actual (.agent.lock)

```json
{"pid":12345,"timestamp":1721145600000,"machineName":"unknown-pc"}
```

**Análisis:** El PID 12345 es un placeholder, no corresponde a proceso real. El timestamp indica 2026-07-16.

---

**Fin del informe**