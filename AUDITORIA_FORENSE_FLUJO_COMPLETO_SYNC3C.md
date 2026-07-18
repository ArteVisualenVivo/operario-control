# AUDITORÍA FORENSE FLUJO COMPLETO SYNC-3C

**Fecha:** 2026-07-16  
**Tipo:** Auditoría forense de flujo completo  
**Objetivo:** Reconstruir el flujo de ejecución del sistema Sync3C

---

## DIAGRAMA DE FLUJO COMPLETO

```
Usuario
  ↓
Botón "Sincronizar" (Sync3CButton.tsx)
  ↓
handleSync() (línea 209)
  ↓
POST /api/sync-3c (route.ts)
  ↓
Redis: hset(sync-3c:command:{id}) (línea 42)
  ↓
Redis: lpush(sync-3c:queue, commandId) (línea 52)
  ↓
POST /api/sync-3c/start-agent (start-agent/route.ts)
  ↓
isAgentRunning() (línea 12)
  ↓
spawn("npx", ["tsx", agentPath, commandId, module]) (línea 65)
  ↓
Agente (agent.ts)
  ↓
acquireSingletonLock() (línea 53)
  ↓
getRedis() (línea 129)
  ↓
processCommand(redis, commandId, module) (línea 307)
  ↓
Redis: hset(sync-3c:command:{id}, {status: "running"}) (línea 309)
  ↓
Redis: set(sync-3c:agent:production, {status: "running"}) (línea 479)
  ↓
runAhk(scriptPath) (línea 162)
  ↓
AutoHotkey (sync_3c.ahk, sync_reparaciones.ahk, etc.)
  ↓
Excel Export (automation-watcher/3c_exports/)
  ↓
parseExcel(buffer) (línea 353)
  ↓
Parser (parser.ts:30)
  ↓
syncItems(items) o syncRepairsToMaintenance(buffer) (líneas 368, 398)
  ↓
Engine (engine.ts:56)
  ↓
Firebase: collection.get() (línea 93)
  ↓
Firebase: batch.set() (líneas 181, 185)
  ↓
Redis: hset(sync-3c:result:{id}) (línea 429)
  ↓
Redis: hset(sync-3c:command:{id}, {status: "completed"}) (línea 437)
  ↓
Redis: set(sync-3c:agent:production, {status: "idle"}) (línea 489)
  ↓
releaseSingletonLock() (línea 92)
  ↓
process.exit(0) (línea 500)
  ↓
GET /api/sync-3c/status (status/route.ts)
  ↓
Redis: hgetall(sync-3c:command:{id}) (línea 26)
  ↓
Frontend polling (Sync3CButton.tsx:137)
  ↓
Actualización UI
```

---

## FLUJO DETALLADO CON PARÁMETROS

### 1. Usuario → Botón

**Archivo:** `src/components/sync/Sync3CButton.tsx`  
**Función:** `handleSync()` (línea 209)  
**Quién llama:** Usuario hace click en botón  
**Quién recibe:** Componente React  
**Parámetros:** `module` (estado local, valores: "stock" | "reparaciones" | "articulos" | "alquileres")  
**Devuelve:** void (inicia flujo async)

### 2. Botón → API /api/sync-3c

**Archivo:** `src/components/sync/Sync3CButton.tsx`  
**Función:** fetch POST a `/api/sync-3c` (línea 219)  
**Quién llama:** `handleSync()`  
**Quién recibe:** `src/app/api/sync-3c/route.ts`  
**Parámetros:** `{ module: "stock" | "reparaciones" | "articulos" | "alquileres" }`  
**Devuelve:** `{ commandId: string, autoEnqueued: string[], pipeline: string[] }`

### 3. API /api/sync-3c → Redis

**Archivo:** `src/app/api/sync-3c/route.ts`  
**Función:** `POST()` (línea 19)  
**Quién llama:** Next.js runtime  
**Quién recibe:** Redis (Upstash)  
**Parámetros:** 
- `hset("sync-3c:command:{id}", { module, status: "pending", createdAt, startedAt, completedAt, agent, result, error })`
- `lpush("sync-3c:queue", commandId)`  
**Devuelve:** JSON con commandId

### 4. API /api/sync-3c/start-agent → Spawn

**Archivo:** `src/app/api/sync-3c/start-agent/route.ts`  
**Función:** `POST()` (línea 37)  
**Quién llama:** `handleSync()` (línea 238)  
**Quién recibe:** `spawn()` de Node.js  
**Parámetros:** `{ commandId: string, module: string }`  
**Devuelve:** `{ success: true, message: "Agente iniciado", pid: number }`

### 5. Spawn → Agente

**Archivo:** `src/app/api/sync-3c/start-agent/route.ts`  
**Función:** `spawn("npx", ["tsx", agentPath, commandId, module])` (línea 65)  
**Quién llama:** `POST()`  
**Quién recibe:** `sync-agent/agent.ts`  
**Parámetros:** `process.argv[2] = commandId`, `process.argv[3] = module`  
**Devuelve:** Proceso hijo (stdout/stderr streams)

### 6. Agente → Lock

**Archivo:** `sync-agent/agent.ts`  
**Función:** `acquireSingletonLock()` (línea 53)  
**Quién llama:** `main()` (línea 470)  
**Quién recibe:** Sistema de archivos (lock file)  
**Parámetros:** `LOCK_FILE` (ruta fija)  
**Devuelve:** void (escribe lock o exit)

### 7. Agente → Redis (heartbeat inicial)

**Archivo:** `sync-agent/agent.ts`  
**Función:** `main()` (línea 459)  
**Quién llama:** `main()`  
**Quién recibe:** Redis  
**Parámetros:** `set("sync-3c:agent:production", { status: "running", lastHeartbeat, machineName }, { ex: 120 })`  
**Devuelve:** void

### 8. Agente → processCommand

**Archivo:** `sync-agent/agent.ts`  
**Función:** `processCommand(redis, commandId, module)` (línea 307)  
**Quién llama:** `main()` (línea 486)  
**Quién recibe:** `processCommand()`  
**Parámetros:** `redis` (cliente), `commandId` (string), `module` (string)  
**Devuelve:** void (actualiza Redis)

### 9. processCommand → Redis (status running)

**Archivo:** `sync-agent/agent.ts`  
**Función:** `processCommand()` (línea 307)  
**Quién llama:** `processCommand()`  
**Quién recibe:** Redis  
**Parámetros:** `hset("sync-3c:command:{id}", { status: "running", startedAt, agent })`  
**Devuelve:** void

### 10. processCommand → runAhk

**Archivo:** `sync-agent/agent.ts`  
**Función:** `runAhk(scriptPath)` (línea 162)  
**Quién llama:** `processCommand()` (línea 332)  
**Quién recibe:** AutoHotkey  
**Parámetros:** `scriptPath` (ruta al .ahk)  
**Devuelve:** Promise<void> (resuelve cuando AHK termina)

### 11. runAhk → AutoHotkey

**Archivo:** `sync-agent/agent.ts`  
**Función:** `runAhk()` (línea 162)  
**Quién llama:** `processCommand()`  
**Quién recibe:** AutoHotkey (sync_3c.ahk, sync_reparaciones.ahk, etc.)  
**Parámetros:** `exe` (AutoHotkey64.exe), `[scriptPath]`  
**Devuelve:** void (ejecuta script)

### 12. AutoHotkey → Excel

**Archivo:** `automation/sync_3c.ahk` o `automation/sync_reparaciones.ahk`  
**Función:** Script AHK  
**Quién llama:** AutoHotkey runtime  
**Quién recibe:** ERP 3C (aplicación desktop)  
**Parámetros:** Coordenadas de pantalla, clicks  
**Devuelve:** Archivo Excel en `automation-watcher/3c_exports/`

### 13. processCommand → waitForExport

**Archivo:** `sync-agent/agent.ts`  
**Función:** `waitForExport()` (línea 200)  
**Quién llama:** `processCommand()` (línea 336)  
**Quién recibe:** Sistema de archivos  
**Parámetros:** `EXPORTS_DIR` (ruta)  
**Devuelve:** `{ full, mtime }` (archivo más reciente)

### 14. processCommand → parseExcel

**Archivo:** `sync-agent/agent.ts`  
**Función:** `parseExcel(buffer)` (línea 353)  
**Quién llama:** `processCommand()` (línea 339)  
**Quién recibe:** `src/lib/sync-3c/parser.ts:30`  
**Parámetros:** `buffer` (ArrayBuffer del Excel)  
**Devuelve:** `{ items: Sync3CItem[] }`

### 15. parseExcel → Parser

**Archivo:** `src/lib/sync-3c/parser.ts`  
**Función:** `parseExcel()` (línea 30)  
**Quién llama:** `processCommand()`  
**Quién recibe:** Función  
**Parámetros:** `buffer`  
**Devuelve:** `{ items: Sync3CItem[], rawCount: number }`

### 16. processCommand → syncItems

**Archivo:** `sync-agent/agent.ts`  
**Función:** `syncItems(items)` (línea 368)  
**Quién llama:** `processCommand()` (línea 368)  
**Quién recibe:** `src/lib/sync-3c/engine.ts:56`  
**Parámetros:** `items: Sync3CItem[]`  
**Devuelve:** `Promise<Sync3CResult>`

### 17. syncItems → Engine

**Archivo:** `src/lib/sync-3c/engine.ts`  
**Función:** `syncItems()` (línea 56)  
**Quién llama:** `processCommand()`  
**Quién recibe:** Firebase Admin SDK  
**Parámetros:** `items: Sync3CItem[]`  
**Devuelve:** `{ success, created, updated, skipped, warnings }`

### 18. Engine → Firebase

**Archivo:** `src/lib/sync-3c/engine.ts`  
**Función:** `syncItems()` (líneas 93, 181)  
**Quién llama:** `syncItems()`  
**Quién recibe:** Firestore  
**Parámetros:** `collection.get()`, `batch.set()`  
**Devuelve:** void (escribe a Firestore)

### 19. processCommand → Redis (resultado)

**Archivo:** `sync-agent/agent.ts`  
**Función:** `processCommand()` (líneas 429, 437)  
**Quién llama:** `processCommand()`  
**Quién recibe:** Redis  
**Parámetros:** 
- `hset("sync-3c:result:{id}", { status, module, result, updatedAt })`
- `hset("sync-3c:command:{id}", { status: "completed", completedAt, result })`  
**Devuelve:** void

### 20. processCommand → Redis (heartbeat final)

**Archivo:** `sync-agent/agent.ts`  
**Función:** `main()` (línea 489)  
**Quién llama:** `main()`  
**Quién recibe:** Redis  
**Parámetros:** `set("sync-3c:agent:production", { status: "idle", lastHeartbeat, machineName }, { ex: 120 })`  
**Devuelve:** void

### 21. processCommand → releaseSingletonLock

**Archivo:** `sync-agent/agent.ts`  
**Función:** `releaseSingletonLock()` (línea 92)  
**Quién llama:** `main()` (línea 499)  
**Quién recibe:** Sistema de archivos  
**Parámetros:** `LOCK_FILE`  
**Devuelve:** void

### 22. Frontend → GET /api/sync-3c/status

**Archivo:** `src/components/sync/Sync3CButton.tsx`  
**Función:** `pollStatus()` (línea 137)  
**Quién llama:** setInterval cada 10 segundos (línea 256)  
**Quién recibe:** `src/app/api/sync-3c/status/route.ts`  
**Parámetros:** `commandId` (query param)  
**Devuelve:** `{ status, result, error, startedAt, completedAt }`

### 23. Status → Redis

**Archivo:** `src/app/api/sync-3c/status/route.ts`  
**Función:** `GET()` (línea 13)  
**Quién llama:** Next.js runtime  
**Quién recibe:** Redis  
**Parámetros:** `hgetall("sync-3c:command:{id}")`  
**Devuelve:** JSON con estado del comando

---

## RESPUESTAS A PREGUNTAS DE EVIDENCIA

### 1. ¿Cuántos caminos distintos existen para iniciar una sincronización?

**RESPUESTA: 1 camino**

Evidencia:
- `Sync3CButton.tsx:209` → `handleSync()` es el único punto de entrada
- El botón llama a `POST /api/sync-3c` y luego a `POST /api/sync-3c/start-agent`
- No hay otros triggers (Task Scheduler eliminado, VBS eliminado)

### 2. ¿Puede una sincronización iniciarse dos veces?

**RESPUESTA: SÍ, puede iniciarse dos veces**

Evidencia:
- `Sync3CButton.tsx:302` → `disabled = agentStatus === "offline" || isBusy`
- Si `agentStatus === "online"` o `"running"`, el botón NO está deshabilitado
- `Sync3CButton.tsx:238-251` → El frontend llama a `/api/sync-3c/start-agent` sin verificar si ya hay una sincronización en progreso
- El lock solo previene múltiples agentes, no múltiples comandos

### 3. ¿Puede un mismo commandId ejecutarse dos veces?

**RESPUESTA: NO, un mismo commandId no ejecuta dos veces**

Evidencia:
- `agent.ts:470` → `acquireSingletonLock()` previene múltiples agentes
- El agente procesa un solo `commandId` y termina
- `agent.ts:500` → `process.exit(0)` después de procesar

### 4. ¿Puede quedar un commandId en Redis sin ejecutarse?

**RESPUESTA: SÍ, puede quedar sin ejecutarse**

Evidencia:
- `route.ts:52` → `lpush("sync-3c:queue", commandId)` escribe a la cola
- El agente NO hace `rpop` de la cola (eliminado en migración)
- El agente recibe `commandId` como argumento, no de la cola
- Si el spawn falla, el commandId queda en Redis con status "pending"
- Si el usuario cierra la pestaña, el polling se detiene pero el commandId sigue en Redis

### 5. ¿Puede ejecutarse un agente sin existir commandId?

**RESPUESTA: NO, el agente requiere commandId**

Evidencia:
- `agent.ts:464-468` → `if (!commandId) { process.exit(1) }`
- El agente se inicia con `spawn("npx", ["tsx", agentPath, commandId, module])`
- Sin commandId, el agente se cierra inmediatamente

### 6. ¿Puede terminar un agente sin actualizar el estado?

**RESPUESTA: SÍ, puede terminar sin actualizar el estado**

Evidencia:
- `agent.ts:444-453` → En el catch, solo actualiza status a "failed"
- `agent.ts:495-508` → En el finally, llama a `releaseSingletonLock()` y `process.exit(0)`
- Si hay una excepción antes de `processCommand()`, el estado no se actualiza
- Si el proceso se mata abruptamente (kill -9), no hay limpieza

### 7. ¿Puede quedar el heartbeat en rojo aunque la sincronización haya terminado?

**RESPUESTA: SÍ, puede quedar en rojo**

Evidencia:
- `agent.ts:489-493` → Heartbeat final con `ex: 120` (2 min TTL)
- `agent.ts:500` → `process.exit(0)` termina el proceso
- Si el proceso muere antes de actualizar heartbeat, el heartbeat expira
- `agent-status/route.ts:29` → `online = heartbeat > 0 && (Date.now() - heartbeat) < 90_000`
- Si pasan más de 90 segundos sin heartbeat, el círculo se pone rojo

### 8. ¿Puede el frontend quedar esperando indefinidamente?

**RESPUESTA: SÍ, puede quedar esperando indefinidamente**

Evidencia:
- `Sync3CButton.tsx:256-266` → Polling cada 10 segundos con timeout de 180 segundos
- `Sync3CButton.tsx:260-266` → Si el agente no responde en 3 minutos, muestra error
- Pero si el agente se cuelga sin actualizar estado, el frontend polling se queda en "running"
- `Sync3CButton.tsx:198-200` → Solo cambia a "completed" si `data.status === "completed"`
- Si el status nunca cambia, el frontend queda en "running" indefinidamente

### 9. ¿Existe alguna condición de carrera (Race Condition)?

**RESPUESTA: SÍ, existen múltiples condiciones de carrera**

Evidencia:
- **Race 1:** `start-agent/route.ts:51-57` → `isAgentRunning()` verifica lock, pero entre verificar y spawn, otro proceso podría crear lock
- **Race 2:** `agent.ts:55-77` → `acquireSingletonLock()` verifica lock existente, pero entre verificar y crear, otro proceso podría crear lock
- **Race 3:** `route.ts:39-54` → Crea múltiples commandIds en un loop, pero si falla a mitad, algunos quedan sin ejecutar
- **Race 4:** `Sync3CButton.tsx:233-234` → Guarda `commandIdsRef.current` y `pipeline`, pero si hay error, el estado es inconsistente

### 10. Enumerar TODOS los puntos donde una excepción deja el sistema inconsistente

**RESPUESTA:**

| Punto | Archivo | Línea | Inconsistencia |
|-------|---------|-------|----------------|
| 1 | `agent.ts:68-70` | `process.exit(1)` sin actualizar Redis | commandId queda en "pending" |
| 2 | `agent.ts:86-88` | Error en `acquireSingletonLock()` | Lock no creado, agente no inicia |
| 3 | `agent.ts:162-195` | Error en `runAhk()` | commandId queda en "running" sin completar |
| 4 | `agent.ts:200-210` | Error en `waitForExport()` | commandId queda en "running" sin completar |
| 5 | `agent.ts:368-391` | Error en `syncItems()` | commandId queda en "running" sin completar |
| 6 | `agent.ts:444-453` | Catch en `processCommand()` | Solo actualiza a "failed", no libera lock si falla antes |
| 7 | `agent.ts:495-508` | Error en heartbeat final | Heartbeat expira, círculo rojo |
| 8 | `start-agent/route.ts:65-77` | Error en `spawn()` | Frontend no recibe respuesta, agente no inicia |
| 9 | `route.ts:42-52` | Error en `hset()` o `lpush()` | commandId creado parcialmente o no |
| 10 | `Sync3CButton.tsx:219-224` | Error en `fetch("/api/sync-3c")` | Estado "pending" sin commandId |
| 11 | `Sync3CButton.tsx:238-242` | Error en `fetch("/api/sync-3c/start-agent")` | commandId creado pero agente no inicia |
| 12 | `Sync3CButton.tsx:256-266` | Timeout de 180s | Frontend muestra error pero agente podría estar trabajando |

---

**Fin del informe**