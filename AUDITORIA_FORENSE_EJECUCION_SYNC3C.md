# AUDITORÍA FORENSE EJECUCIÓN SYNC-3C (NIVEL MÁXIMO)

**Fecha:** 2026-07-16  
**Tipo:** Auditoría forense de ejecución  
**Objetivo:** Reconstruir el flujo REAL de ejecución paso a paso

---

## FLUJO DE EJECUCIÓN DETALLADO

### Paso 1: Sync3CButton → POST /api/sync-3c

**Archivo:** `src/components/sync/Sync3CButton.tsx`  
**Función:** `handleSync()` (línea 209)  
**Parámetros de entrada:** `module` (estado local: "stock" | "reparaciones" | "articulos" | "alquileres")  
**Parámetros de salida:** `{ commandId, autoEnqueued, pipeline }`  
**Estado modifica:** `state = "pending"` (línea 210)

### Paso 2: Creación del commandId

**Archivo:** `src/app/api/sync-3c/route.ts`  
**Función:** `POST()` (línea 19)  
**Parámetros de entrada:** `{ module }` desde request body  
**Parámetros de salida:** `commandId = randomUUID()` (línea 41)  
**Estado modifica:** Ninguno aún

### Paso 3: Escritura en Redis

**Archivo:** `src/app/api/sync-3c/route.ts`  
**Función:** `POST()` (líneas 42-52)  
**Parámetros de entrada:** `commandId`, `module`  
**Parámetros de salida:** void  
**Estado modifica:** 
- `hset("sync-3c:command:{id}", { module, status: "pending", createdAt, ... })` (línea 42)
- `lpush("sync-3c:queue", commandId)` (línea 52)

### Paso 4: POST /api/sync-3c/start-agent

**Archivo:** `src/components/sync/Sync3CButton.tsx`  
**Función:** fetch POST a `/api/sync-3c/start-agent` (línea 238)  
**Parámetros de entrada:** `{ commandId, module }`  
**Parámetros de salida:** `{ success, message, pid }`  
**Estado modifica:** Ninguno

### Paso 5: spawn()

**Archivo:** `src/app/api/sync-3c/start-agent/route.ts`  
**Función:** `spawn("npx", ["tsx", agentPath, commandId, module])` (línea 65)  
**Parámetros de entrada:** `commandId`, `module`  
**Parámetros de salida:** `child` (proceso)  
**Estado modifica:** Ninguno

### Paso 6: agent.ts

**Archivo:** `sync-agent/agent.ts`  
**Función:** `main()` (línea 459)  
**Parámetros de entrada:** `process.argv[2] = commandId`, `process.argv[3] = module`  
**Parámetros de salida:** void  
**Estado modifica:** 
- `acquireSingletonLock()` (línea 470)
- `redis.set("sync-3c:agent:production", { status: "running", ... })` (línea 479)

### Paso 7: AutoHotkey

**Archivo:** `sync-agent/agent.ts`  
**Función:** `runAhk(scriptPath)` (línea 162)  
**Parámetros de entrada:** `scriptPath` (ruta al .ahk)  
**Parámetros de salida:** `Promise<void>`  
**Estado modifica:** Ninguno

### Paso 8: Exportación Excel

**Archivo:** `automation/sync_3c.ahk` o `automation/sync_reparaciones.ahk`  
**Función:** Script AHK  
**Parámetros de entrada:** Coordenadas de pantalla  
**Parámetros de salida:** Archivo Excel en `automation-watcher/3c_exports/`  
**Estado modifica:** Ninguno

### Paso 9: Parser

**Archivo:** `sync-agent/agent.ts`  
**Función:** `parseExcel(buffer)` (línea 353)  
**Parámetros de entrada:** `buffer` (ArrayBuffer)  
**Parámetros de salida:** `{ items: Sync3CItem[] }`  
**Estado modifica:** Ninguno

### Paso 10: Firebase

**Archivo:** `sync-agent/agent.ts`  
**Función:** `syncItems(items)` o `syncRepairsToMaintenance(buffer)` (líneas 368, 398)  
**Parámetros de entrada:** `items` o `buffer`  
**Parámetros de salida:** `{ success, created, updated, skipped, warnings }`  
**Estado modifica:** Firestore (colección `inventory_stock` o `maintenance`)

### Paso 11: Actualización del estado

**Archivo:** `sync-agent/agent.ts`  
**Función:** `processCommand()` (líneas 429, 437)  
**Parámetros de entrada:** `result`  
**Parámetros de salida:** void  
**Estado modifica:** 
- `hset("sync-3c:result:{id}", { status: "completed", ... })` (línea 429)
- `hset("sync-3c:command:{id}", { status: "completed", ... })` (línea 437)

### Paso 12: Heartbeat

**Archivo:** `sync-agent/agent.ts`  
**Función:** `main()` (línea 489)  
**Parámetros de entrada:** `result`  
**Parámetros de salida:** void  
**Estado modifica:** `set("sync-3c:agent:production", { status: "idle", ... })` (línea 489)

### Paso 13: GET /api/sync-3c/status

**Archivo:** `src/components/sync/Sync3CButton.tsx`  
**Función:** `pollStatus()` (línea 137)  
**Parámetros de entrada:** `commandId`  
**Parámetros de salida:** `{ status, result, error }`  
**Estado modifica:** `state` (idle/running/completed/error)

### Paso 14: Frontend

**Archivo:** `src/components/sync/Sync3CButton.tsx`  
**Función:** `pollStatus()` (líneas 144-200)  
**Parámetros de entrada:** `data.status`  
**Parámetros de salida:** void  
**Estado modifica:** `state`, `result`, `agentStatus`

---

## RESPUESTAS A PREGUNTAS DE EVIDENCIA

### 1. ¿Dónde nace commandId?

**Evidencia:**
- **Archivo:** `src/app/api/sync-3c/route.ts`
- **Función:** `POST()` (línea 19)
- **Línea:** 41
- **Código:** `const commandId = randomUUID()`

### 2. ¿Dónde se guarda?

**Evidencia:**
- **Archivo:** `src/app/api/sync-3c/route.ts`
- **Función:** `POST()` (línea 19)
- **Línea:** 42
- **Código:** `await redis.hset(`sync-3c:command:${commandId}`, { ... })`

### 3. ¿Quién lo vuelve a leer?

**Evidencia:**
- **Archivo:** `src/app/api/sync-3c/status/route.ts`
- **Función:** `GET()` (línea 13)
- **Línea:** 26
- **Código:** `const raw = await redis.hgetall(`sync-3c:command:${commandId}`)`

### 4. ¿Quién cambia status=pending?

**Evidencia:**
- **Archivo:** `src/app/api/sync-3c/route.ts`
- **Función:** `POST()` (línea 19)
- **Línea:** 44
- **Código:** `status: "pending"` en `hset("sync-3c:command:{id}", ...)`

### 5. ¿Quién cambia status=running?

**Evidencia:**
- **Archivo:** `sync-agent/agent.ts`
- **Función:** `processCommand()` (línea 307)
- **Línea:** 309
- **Código:** `await redis.hset(`sync-3c:command:${commandId}`, { status: "running", ... })`

### 6. ¿Quién cambia status=completed?

**Evidencia:**
- **Archivo:** `sync-agent/agent.ts`
- **Función:** `processCommand()` (línea 307)
- **Línea:** 437
- **Código:** `await redis.hset(`sync-3c:command:${commandId}`, { status: "completed", ... })`

### 7. ¿Quién cambia status=error?

**Evidencia:**
- **Archivo:** `sync-agent/agent.ts`
- **Función:** `processCommand()` (línea 307)
- **Línea:** 448
- **Código:** `await redis.hset(`sync-3c:command:${commandId}`, { status: "failed", error, ... })`

### 8. ¿Quién escribe heartbeat?

**Evidencia:**
- **Archivo:** `sync-agent/agent.ts`
- **Función:** `main()` (línea 459)
- **Líneas:** 479, 489
- **Código:** 
  - `redis.set("sync-3c:agent:production", { status: "running", ... })` (línea 479)
  - `redis.set("sync-3c:agent:production", { status: "idle", ... })` (línea 489)

### 9. ¿Quién elimina heartbeat?

**Evidencia:**
- **Nadie lo elimina explícitamente**
- **Archivo:** `sync-agent/agent.ts`
- **Función:** `main()` (línea 459)
- **Línea:** 489
- **Código:** El heartbeat tiene TTL de 120 segundos (`{ ex: 120 }`)
- **El heartbeat expira automáticamente en Redis después de 120 segundos**

### 10. ¿Qué pasa si el agente termina correctamente pero nunca actualiza el estado?

**Evidencia:**
- **Archivo:** `sync-agent/agent.ts`
- **Función:** `processCommand()` (línea 307)
- **Línea:** 429-441
- **Código:** Si hay excepción después de `runAhk()` pero antes de `hset("sync-3c:command:{id}")`, el status queda en "running"
- **Resultado:** El frontend polling se queda en "running" indefinidamente

### 11. ¿Qué pasa si Firebase falla?

**Evidencia:**
- **Archivo:** `sync-agent/agent.ts`
- **Función:** `processCommand()` (línea 307)
- **Líneas:** 368-391
- **Código:** 
  ```typescript
  try {
    result = await syncItems(items)
  } catch (err) {
    // ...
    result = { success: true, created: 0, updated: 0, skipped: items.length, warnings: [...], degraded: true }
  }
  ```
- **Resultado:** El agente continúa con resultado degradado, guarda en Redis pero no en Firebase

### 12. ¿Qué pasa si AutoHotkey falla?

**Evidencia:**
- **Archivo:** `sync-agent/agent.ts`
- **Función:** `runAhk()` (línea 162)
- **Líneas:** 176-194
- **Código:** `reject(new Error("AHK timeout"))` o `reject(new Error("AHK failed"))`
- **Resultado:** `processCommand()` catch (línea 444) actualiza status a "failed"

### 13. ¿Qué pasa si el proceso Node muere?

**Evidencia:**
- **Archivo:** `sync-agent/agent.ts`
- **Función:** `main()` (línea 459)
- **Líneas:** 495-508
- **Código:** `process.on("exit")`, `process.on("SIGINT")`, `process.on("SIGTERM")`
- **Resultado:** Si el proceso muere abruptamente (kill -9), el lock no se libera y el heartbeat expira

### 14. ¿Qué pasa si Windows se reinicia durante una sincronización?

**Evidencia:**
- **Archivo:** `sync-agent/agent.ts`
- **Función:** `acquireSingletonLock()` (línea 53)
- **Líneas:** 55-77
- **Código:** Verifica si lock expiró (más de 60s) o si el proceso está muerto
- **Resultado:** Al reiniciar, el agente detecta lock colgado y lo elimina, pero el commandId queda en "running" o "pending"

### 15. ¿Qué condición exacta hace que el círculo quede rojo?

**Evidencia:**
- **Archivo:** `src/app/api/sync-3c/agent-status/route.ts`
- **Función:** `GET()` (línea 13)
- **Línea:** 29
- **Código:** `const online = heartbeat > 0 && (Date.now() - heartbeat) < 90_000`
- **Condición:** `heartbeat === 0` O `(Date.now() - heartbeat) >= 90_000` (90 segundos sin actualización)
- **Archivo:** `src/components/sync/Sync3CButton.tsx`
- **Función:** `agentIndicator()` (línea 63)
- **Línea:** 70
- **Código:** `case "offline": return { dot: "🔴", label: "Offline" }`

---

**Fin del informe**