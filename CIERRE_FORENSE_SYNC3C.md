# CIERRE FORENSE SYNC-3C - INFORME FINAL

**Fecha:** 2026-07-16  
**Tipo:** Cierre definitivo del sistema Sync3C  
**Objetivo:** Auditoría final, limpieza, arquitectura única y verificación

---

## PROBLEMAS ENCONTRADOS

### 1. Cola Redis sin consumidor

**Evidencia:**
- `src/app/api/sync-3c/route.ts:52` - `await redis.lpush("sync-3c:queue", commandId)`
- `agent-diff.txt:438,482` - El `rpop` fue eliminado en la migración
- `sync-agent/agent.ts` - NO tiene `rpop` ni `brpop` de la cola

**Impacto:** Memory leak en Redis - la cola crece sin consumirse

### 2. Lock con PID placeholder

**Evidencia:**
- `sync-agent/.agent.lock` - `{"pid":12345,"timestamp":1721145600000,"machineName":"unknown-pc"}`
- El PID 12345 no corresponde a ningún proceso real

### 3. Scripts de cleanup duplicados

**Evidencia:**
- `sync-agent/cleanup-lock.cjs` - Funcionalidad integrada en `agent.ts:acquireSingletonLock()`
- `sync-agent/remove-lock.mjs` - Funcionalidad integrada en `agent.ts:releaseSingletonLock()`
- `sync-agent/cleanup-stale-lock.bat` - Funcionalidad integrada en `agent.ts:acquireSingletonLock()`

### 4. Referencias rotas a archivos eliminados

**Evidencia:**
- `AGENTS.md:391` - Menciona `sync-agent/agent.mjs` (archivo no existe)
- `agent-diff.txt` - Documento de diff que referencia `agent.mjs`
- `AUDITORIA_FORENSE_TOTAL_20260714.md:170-173` - Menciona `start-agent.vbs` y `start-operario-control.vbs` (no existen)

### 5. Race conditions identificadas

**Evidencia:**
- `start-agent/route.ts:51-57` - `isAgentRunning()` verifica lock, pero entre verificar y spawn, otro proceso podría crear lock
- `agent.ts:55-77` - `acquireSingletonLock()` verifica lock existente, pero entre verificar y crear, otro proceso podría crear lock

---

## CORRECCIONES REALIZADAS

### Corrección 1: Migración a on-demand

**Evidencia:**
- `agent-diff.txt` líneas 1-530 muestran el diff de `agent.mjs` → `agent.ts`
- Eliminado: `pollQueue()` (líneas 428-458)
- Eliminado: `startHeartbeat()` continuo (líneas 495-511)
- Eliminado: `recoverStaleCommands()` (líneas 460-493)
- El agente ahora recibe `commandId` como argumento y termina después de procesar

### Corrección 2: Lock management integrado

**Evidencia:**
- `agent.ts:53-90` - `acquireSingletonLock()` con cleanup de locks colgados
- `agent.ts:92-100` - `releaseSingletonLock()`

---

## ARCHIVOS MODIFICADOS

| Archivo | Cambio | Evidencia |
|---------|--------|-----------|
| `sync-agent/agent.ts` | Migración de mjs a ts, modo on-demand | `agent-diff.txt` |
| `src/app/api/sync-3c/route.ts` | Crea commandId y encola | Líneas 39-54 |
| `src/app/api/sync-3c/start-agent/route.ts` | Nuevo endpoint para iniciar agente | Líneas 37-91 |
| `src/components/sync/Sync3CButton.tsx` | Llama a start-agent después de crear command | Líneas 236-251 |

---

## ARCHIVOS A ELIMINAR (EVIDENCIA)

| Archivo | Razón | Evidencia de que está duplicado |
|---------|-------|-------------------------------|
| `sync-agent/cleanup-lock.cjs` | Funcionalidad integrada en `agent.ts:53-90` | `acquireSingletonLock()` |
| `sync-agent/remove-lock.mjs` | Funcionalidad integrada en `agent.ts:92-100` | `releaseSingletonLock()` |
| `sync-agent/cleanup-stale-lock.bat` | Funcionalidad integrada en `agent.ts:53-90` | `acquireSingletonLock()` |
| `agent-diff.txt` | Documento temporal de migración | No afecta ejecución |

---

## FLUJO FINAL (ON-DEMAND)

```
Usuario
  ↓
Sync3CButton.tsx:handleSync() (línea 209)
  ↓
POST /api/sync-3c (route.ts:19)
  ↓
Redis: hset(sync-3c:command:{id}, {status: "pending"}) (línea 42)
  ↓
Redis: lpush(sync-3c:queue, commandId) [INNECESARIO - VER FASE 2]
  ↓
POST /api/sync-3c/start-agent (start-agent/route.ts:37)
  ↓
spawn("npx", ["tsx", agentPath, commandId, module]) (línea 65)
  ↓
agent.ts:main() (línea 459)
  ↓
acquireSingletonLock() (línea 470)
  ↓
Redis: set(sync-3c:agent:production, {status: "running"}) (línea 479)
  ↓
processCommand() (línea 307)
  ↓
Redis: hset(sync-3c:command:{id}, {status: "running"}) (línea 309)
  ↓
runAhk() (línea 162)
  ↓
AutoHotkey (sync_3c.ahk, sync_reparaciones.ahk)
  ↓
Excel Export (automation-watcher/3c_exports/)
  ↓
parseExcel() (línea 353)
  ↓
Parser (parser.ts:30)
  ↓
syncItems() o syncRepairsToMaintenance() (líneas 368, 398)
  ↓
Engine (engine.ts:56)
  ↓
Firebase: collection.get(), batch.set() (líneas 93, 181)
  ↓
Redis: hset(sync-3c:result:{id}) (línea 429)
  ↓
Redis: hset(sync-3c:command:{id}, {status: "completed"}) (línea 437)
  ↓
Redis: set(sync-3c:agent:production, {status: "idle"}) (línea 489)
  ↓
releaseSingletonLock() (línea 499)
  ↓
process.exit(0) (línea 500)
  ↓
GET /api/sync-3c/status (status/route.ts:13)
  ↓
Redis: hgetall(sync-3c:command:{id}) (línea 26)
  ↓
Frontend polling (Sync3CButton.tsx:137)
  ↓
Círculo VERDE
```

---

## PRUEBAS EJECUTADAS

### Limitación del entorno

**No se pueden ejecutar pruebas reales debido a:**
```
"cmd.exe" no se reconoce como un comando interno o externo, programa o archivo por lotes ejecutable.
```

**Implicancia:** No se puede verificar:
- Procesos node.exe en ejecución
- PID 12345 está vivo o muerto
- Lock es stale o válido
- El agente inicia correctamente
- El agente procesa el comando
- El agente libera el lock
- El círculo vuelve a VERDE
- No quedan procesos zombie

---

## CHECKLIST FINAL

| # | Verificación | Estado | Evidencia |
|---|--------------|--------|-----------|
| 1 | Lock colgado eliminado | ⚠️ PENDIENTE | No se puede ejecutar cleanup |
| 2 | Agente inicia correctamente | ⚠️ PENDIENTE | No se puede ejecutar spawn |
| 3 | AutoHotkey ejecuta | ⚠️ PENDIENTE | No se puede ejecutar AHK |
| 4 | Parser funciona | ✅ VERIFICADO | Código estático revisado |
| 5 | Firebase recibe datos | ⚠️ PENDIENTE | No se puede ejecutar |
| 6 | Status cambia correctamente | ✅ VERIFICADO | Código estático revisado |
| 7 | Heartbeat válido | ⚠️ PENDIENTE | No se puede verificar |
| 8 | Círculo verde | ⚠️ PENDIENTE | No se puede verificar |
| 9 | Lock eliminado al terminar | ✅ VERIFICADO | `releaseSingletonLock()` en línea 499 |
| 10 | Proceso terminado | ✅ VERIFICADO | `process.exit(0)` en línea 500 |
| 11 | Ningún zombie | ⚠️ PENDIENTE | No se puede verificar |
| 12 | Cola Redis eliminada | ⚠️ PENDIENTE | No se puede ejecutar |

---

## RESTRICCIONES TÉCNICAS

### No se pueden completar las siguientes tareas:

1. **Ejecutar cleanup del lock** - Requiere `fs.unlinkSync()` y verificación de proceso
2. **Iniciar el agente** - Requiere `spawn()` y ejecución de `npx tsx`
3. **Ejecutar AutoHotkey** - Requiere interacción con el sistema operativo
4. **Verificar Firebase** - Requiere conexión a internet y credenciales
5. **Verificar heartbeat** - Requiere ejecución del agente
6. **Verificar círculo verde** - Requiere ejecución completa del flujo

---

## RECOMENDACIÓN PARA COMPLETAR

Para completar el checklist, ejecutar en la PC local:

```bash
# 1. Limpiar lock colgado
node -e "const fs = require('fs'); fs.unlinkSync('sync-agent/.agent.lock'); console.log('Lock eliminado');"

# 2. Iniciar servidor
npm run dev

# 3. Abrir la web y presionar "Sincronizar"

# 4. Verificar procesos
tasklist /fi "imagename eq node.exe"
tasklist /fi "imagename eq AutoHotkey*"

# 5. Verificar lock
type sync-agent/.agent.lock
```

---

**Fin del informe**