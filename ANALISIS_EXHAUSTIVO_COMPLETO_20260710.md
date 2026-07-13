# ANÁLISIS EXHAUSTIVO DEL PROYECTO OPERARIO-CONTROL

**Fecha:** 10 de Julio de 2026  
**Versión:** 2.0 Completa  
**Scope:** Arquitectura de sincronización 3C → Redis → Firebase

---

## TABLA DE CONTENIDOS

1. [Arquitectura de Sincronización - Flujo Completo](#1-arquitectura-de-sincronizacion)
2. [APIS REST (src/app/api/)](#2-apis-rest)
3. [Sistema de Polling del Agente (agent.mjs)](#3-sistema-de-polling-del-agente)
4. [Scripts AutoHotkey](#4-scripts-autohotkey)
5. [Firebase/Firestore](#5-firebasefirestore)
6. [Redis (Upstash)](#6-redis-upstash)
7. [Código Muerto / No Usado](#7-codigo-muerto)
8. [Issues y Recomendaciones](#8-issues-y-recomendaciones)

---

## 1. ARQUITECTURA DE SINCRONIZACIÓN

### 1.1 Flujo Completo (Step-by-Step)

```
┌─ USUARIO EN UI (Vercel) ─────────────────────────────────────────┐
│                                                                    │
│ 1. Click "Sincronizar Stock"  (module = "stock")                  │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
         ↓ POST /api/sync-3c { module: "stock" }
         
┌─ API ENDPOINT (Vercel Node.js Runtime) ──────────────────────────┐
│ Archivo: src/app/api/sync-3c/route.ts                             │
│                                                                    │
│ 2. Generar UUID commandId                                         │
│ 3. HSET sync-3c:command:{commandId} {                             │
│      module: "stock"                                              │
│      status: "pending"                                            │
│      createdAt: 1689XXX                                           │
│      startedAt: ""                                                │
│      completedAt: ""                                              │
│      agent: ""                                                    │
│      result: ""                                                   │
│      error: ""                                                    │
│    }                                                              │
│                                                                    │
│ 4. LPUSH sync-3c:queue {commandId}                                │
│                                                                    │
│ 5. AutoEnqueue: si module="stock" → también encolar "alquileres" │
│                                                                    │
│ 6. Return { commandId, autoEnqueued: ["alquileres"] }             │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
         ↓ UI polling: GET /api/sync-3c/status?commandId={id}
         
┌─ AGENT LOCAL (sync-agent/agent.mjs) ─────────────────────────────┐
│ Ejecuta continuamente:                                             │
│                                                                    │
│ 7. pollQueue() loop cada 5s                                       │
│    RPOP sync-3c:queue → obtiene commandId                         │
│                                                                    │
│ 8. HGETALL sync-3c:command:{commandId}                            │
│    Validar status == "pending"                                    │
│                                                                    │
│ 9. HSET sync-3c:command:{commandId} {                             │
│      status: "running"                                            │
│      startedAt: Date.now()                                        │
│      agent: "COMPUTERNAME"                                       │
│    }                                                              │
│                                                                    │
│ 10. SET sync-3c:agent:production {                                │
│       status: "running"                                           │
│       lastHeartbeat: Date.now()                                   │
│       machineName: "COMPUTERNAME"                                │
│     } EX 120 (segundos)                                           │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
         ↓ spawn AutoHotkey
         
┌─ AUTOHOTKEY SCRIPT (automation/sync_3c.ahk) ──────────────────────┐
│                                                                    │
│ 11. NavigateStock(): 8 clicks en 3C                               │
│     1. Almacenes (888, 189)                                       │
│     2. Informes (921, 370)                                        │
│     3. Existencias (1105, 401)                                    │
│     4. Depósitos (704, 476)                                       │
│     5. Seleccionar Todos (962, 858)                               │
│     6. Consulta (440, 341)                                        │
│     7. Aceptar (1196, 902)                                        │
│     8. Excel (940, 575)                                           │
│                                                                    │
│ 12. WaitForExcel(): espera hasta 30s por ventana XLMAIN           │
│                                                                    │
│ 13. WatchAndCopy(): monitorea TEMP\tresc\                         │
│     - Busca tresc*.xls (timeout 60s)                              │
│     - Copia a automation-watcher/3c_exports/                      │
│     - Borra original                                              │
│                                                                    │
│ 14. Cerrar Excel                                                  │
│ 15. Click "Salir"                                                 │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
         ↓ Excel copiado → agent.mjs retoma
         
┌─ AGENT LOCAL - PROCESAMIENTO (agent.mjs:processCommand) ──────────┐
│                                                                    │
│ 16. findLatestExport() → encuentra el archivo más reciente        │
│                                                                    │
│ 17. parseExcel(buffer) → extrae items del Excel                   │
│     Formato esperado: código, nombre, stockTotal, deposito, etc. │
│                                                                    │
│ 18. syncItems(items) → Firebase batch operations                  │
│     Archivo: src/lib/sync-3c/engine.ts                            │
│                                                                    │
│     a) SCAN inventory_stock collection (Admin SDK)                │
│     b) Para cada item:                                            │
│        - Buscar por código (codeMap)                              │
│        - Buscar por nombre normalizado (stockMap)                 │
│        - Si existe → MERGE update (merge: true)                   │
│        - Si no existe → CREATE add()                              │
│     c) Batch commit (máx 500 docs)                                │
│                                                                    │
│ 19. Si módulo="stock" → guardar cache local:                      │
│     - stock-cache.json                                            │
│     - machines-cache.json (scaffold filter)                       │
│     - spare-parts-cache.json (scaffold + 50 items)                │
│                                                                    │
│ 20. HSET sync-3c:result:{commandId} {                             │
│       status: "completed"                                         │
│       module: "stock"                                             │
│       result: JSON.stringify({                                    │
│         success: true                                             │
│         created: N                                                │
│         updated: M                                                │
│         skipped: K                                                │
│         warnings: [...]                                           │
│       })                                                          │
│       updatedAt: Date.now()                                       │
│     }                                                             │
│                                                                    │
│ 21. HSET sync-3c:command:{commandId} {                            │
│       status: "completed"                                         │
│       completedAt: Date.now()                                     │
│       result: JSON.stringify(...)                                 │
│     }                                                             │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
         ↓ UI polling obtiene resultado
         
┌─ UI (Vercel) ─────────────────────────────────────────────────────┐
│                                                                    │
│ 22. GET /api/sync-3c/status?commandId={id}                        │
│     Retorna: { status: "completed", result: {...} }               │
│                                                                    │
│ 23. Mostrar resultado: "455 items actualizados, 12 creados"       │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Timing del Sistema

| Componente | Interval | Propósito |
|---|---|---|
| POLL_INTERVAL_MS | 5,000 ms | Agent polling Redis queue |
| HEARTBEAT_INTERVAL_MS | 30,000 ms | Agent heartbeat (Redis: sync-3c:agent:production) |
| AHK_TIMEOUT_MS | 120,000 ms | Timeout para script AutoHotkey |
| STALE_THRESHOLD_MINUTES | 10 min | Recuperar commands en status "running" > 10 min |
| EXPORT_RETRIES | 10 | Intentos de buscar archivo Excel |
| EXPORT_RETRY_DELAY_MS | 1,000 ms | Delay entre intentos |
| Excel timeout | 30 s | Esperar ventana Excel (sync_common.ahk) |
| AHK afterClick | 500 ms | Delay después de cada click |
| AHK afterExcel | 5,000 ms | Delay después de click Excel |

---

## 2. APIS REST

### 2.1 POST /api/sync-3c

**Archivo:** `src/app/api/sync-3c/route.ts`

**Método:** POST  
**Runtime:** nodejs  
**MaxDuration:** 120s (hard limit Vercel)

**Request Body:**
```json
{
  "module": "stock" | "reparaciones" | "articulos" | "alquileres"
}
```

**Response Success:**
```json
{
  "commandId": "550e8400-e29b-41d4-a716-446655440000",
  "autoEnqueued": ["alquileres"]
}
```

**Response Error:**
```json
{
  "success": false,
  "error": "Módulo inválido. Usar: stock, reparaciones, articulos, alquileres"
}
```

**Lógica Detallada:**

1. **Validación de módulo:** Solo acepta ["stock", "reparaciones", "articulos", "alquileres"]
2. **Auto-enqueue logic:**
   - Si `module === "stock"` → auto-encolar "alquileres"
   - Si `module === "articulos"` → auto-encolar "alquileres"
   - Propósito: mantener Dashboard actualizado con rentales

3. **Redis Operations:**
   - HSET `sync-3c:command:{commandId}` (7 campos)
   - LPUSH `sync-3c:queue` `commandId`
   - Si autoEnqueue > 0 → repetir para cada modulo

4. **Errores Posibles:**
   - **400:** Módulo inválido
   - **500:** Redis no disponible, env vars faltantes

**ISSUE IDENTIFICADO:**
```
❌ SIN VALIDACIÓN DE INPUT

- No valida tipos de datos en body
- No valida longitud de strings
- No valida si Redis connection falla
  → Retorna error genérico sin detalles

SOLUCIÓN PROPUESTA:
1. Agregar try/catch específico para getRedis()
2. Retornar { success: false, error: "Redis no disponible" }
3. Agregar timeout wrapper si API tarda > 30s
```

---

### 2.2 GET /api/sync-3c/status

**Archivo:** `src/app/api/sync-3c/status/route.ts`

**Método:** GET  
**Parámetros:** `?commandId={uuid}`

**Response Success:**
```json
{
  "status": "completed",
  "module": "stock",
  "result": {
    "success": true,
    "created": 12,
    "updated": 455,
    "skipped": 0,
    "warnings": []
  },
  "startedAt": "1689255600000",
  "completedAt": "1689255700000",
  "agent": "OPERARIO-PC"
}
```

**Response Pending:**
```json
{
  "status": "pending",
  "module": "stock",
  "startedAt": "",
  "completedAt": "",
  "agent": ""
}
```

**Response Running:**
```json
{
  "status": "running",
  "module": "stock",
  "startedAt": "1689255610000",
  "completedAt": "",
  "agent": "OPERARIO-PC"
}
```

**Response Not Found:**
```json
{
  "error": "Comando no encontrado",
  "status": "not_found"
}
```

**Lógica Detallada:**

1. **Extrae commandId de query params**
2. **HGETALL `sync-3c:command:{commandId}`**
3. **Parsing:**
   - Si `result` es string JSON → parse()
   - Si parse falla → mantener como string

4. **Errores Posibles:**
   - **400:** commandId faltante
   - **404:** Comando no encontrado
   - **500:** Redis error

**ISSUE IDENTIFICADO:**
```
⚠️ RACE CONDITION POSIBLE

Escenario:
1. Agente comienza a procesar (status = "running")
2. UI hace polling GET /api/sync-3c/status
3. Agente actualiza result simultáneamente
4. La respuesta podría retornar result parcial/corrupto

MITIGACIÓN ACTUAL: Mínima
- Redis HSET es atómico, pero el parsing de JSON en el response
  puede ser inconsistente si result se actualiza durante lectura

SOLUCIÓN PROPUESTA:
1. Agregar versionado de result: result_v1, result_v2
2. O usar Redis WATCH para detección optimista
```

---

### 2.3 GET /api/sync-3c/agent-status

**Archivo:** `src/app/api/sync-3c/agent-status/route.ts`

**Método:** GET  
**Parámetros:** Ninguno

**Response Online:**
```json
{
  "online": true,
  "status": "running",
  "machineName": "OPERARIO-PC",
  "lastHeartbeat": "2026-07-10T14:35:20.000Z"
}
```

**Response Offline:**
```json
{
  "online": false,
  "status": "unknown",
  "machineName": null,
  "lastHeartbeat": null
}
```

**Lógica Detallada:**

1. **GET `sync-3c:agent:production`** (key Redis con TTL 120s)
2. **Calcular online:**
   - `online = (Date.now() - lastHeartbeat) < 90_000`
   - Si > 90s sin heartbeat → considerarse offline
   - 90s permite margen sobre TTL 120s

3. **Return status actual del agente:**
   - `running` → procesando comando
   - `idle` → esperando en queue

**ISSUE IDENTIFICADO:**
```
✅ Bien implementado, pero:

⚠️ TIMEOUT MAGIC NUMBER
- Hardcoded 90_000 ms
- Debería ser constante configurable
- Debería sincronizar con HEARTBEAT_INTERVAL_MS (30s)

PROPUESTA:
const HEARTBEAT_TIMEOUT_MS = 90_000  // 3x interval
const HEARTBEAT_INTERVAL_MS = 30_000
Validar: HEARTBEAT_TIMEOUT_MS >= 3 * HEARTBEAT_INTERVAL_MS
```

---

### 2.4 GET /api/local/repairs

**Archivo:** `src/app/api/local/repairs/route.ts`

**Método:** GET  
**Parámetros:** Ninguno

**Response:**
```json
[
  {
    "id": "maintenance:X0123-4567",
    "machineId": "X0123-4567",
    "machineName": "Andamio Tubular",
    "entryDate": "2026-07-01T10:30:00Z",
    "clientName": "Construcciones XYZ",
    ...
  }
]
```

**Implementación:** Wrapper simple
```typescript
const repairs = await loadLocalRepairs()
return NextResponse.json(repairs)
```

**Llama a:** `src/lib/local-sync.ts:loadLocalRepairs()`

---

### 2.5 GET /api/local/maintenance

**Archivo:** `src/app/api/local/maintenance/route.ts`

**Método:** GET  
**Parámetros:** Ninguno

**Response:** Array de MaintenanceRecord

**Implementación:** Wrapper simple
```typescript
const records = await getMaintenanceRecords()
return NextResponse.json(records)
```

**Llama a:** `src/services/maintenance.ts:getMaintenanceRecords()`

---

### 2.6 POST /api/cloudinary/delete

**Archivo:** `src/app/api/cloudinary/delete/route.ts`

**Método:** POST  
**Request Body:**
```json
{
  "publicId": "machines/blueprint_123",
  "resourceType": "image" | "raw"
}
```

**Response Success:**
```json
{
  "success": true,
  "result": "ok"
}
```

**Response Error:**
```json
{
  "error": "Error al eliminar de Cloudinary",
  "detail": { ... }
}
```

**Lógica Detallada:**

1. **Validación:** publicId requerido y string
2. **Credenciales:** Obtiene apiKey y apiSecret desde env
3. **Auth:** Base64 encode `${apiKey}:${apiSecret}`
4. **Request:** POST a `https://api.cloudinary.com/v1_1/{cloudName}/image/destroy`
5. **Validación respuesta:** `result !== "ok"` → error

**ISSUE IDENTIFICADO:**
```
⚠️ CREDENTIALS EN MEMORY

- CLOUDINARY_API_SECRET nunca debe estar en HTTP requests
- Actualmente: almacenado en process.env (memoria del servidor)
- ✅ Bien: no se expone al cliente
- ✅ Bien: usa auth headers

❌ PERO:
- Si resourceType es "raw" → permite eliminar cualquier asset
- Sin validación de prefijo (ej: solo machines/*)

PROPUESTA:
1. Limitar a resourceType="image" solamente
2. Validar publicId contra whitelist (machines/blueprint_*)
3. Agregar rate limiting
```

---

## 2.7 API Issues Summary

| Ruta | Severidad | Problema | Solución |
|---|---|---|---|
| POST /api/sync-3c | 🟡 Media | Sin validación de input, Redis error sin detalles | Agregar try/catch específico, input validation |
| GET /api/sync-3c/status | 🟡 Media | Race condition en concurrent reads | Versionado de result o WATCH Redis |
| GET /api/sync-3c/agent-status | 🟢 Baja | Magic number 90_000 no configurable | Crear constante HEARTBEAT_TIMEOUT_MS |
| POST /api/cloudinary/delete | 🟡 Media | Sin validación de resourceType, permite eliminar cualquier asset | Limitar a resourceType="image", validar publicId |

---

## 3. SISTEMA DE POLLING DEL AGENTE

### 3.1 Arquitectura de agent.mjs

**Archivo:** `sync-agent/agent.mjs`

**Lenguaje:** JavaScript (ESM)  
**Entrypoint:** `npm run sync-agent` → `npx tsx sync-agent/agent.mjs`

**Dependencias:**
- @upstash/redis
- child_process (spawn AutoHotkey)
- fs (read Excel files)
- parseExcel (src/lib/sync-3c/parser.js)
- syncItems, syncRepairsToMaintenance (src/lib/sync-3c/engine.js)

### 3.2 Inicialización del Agente

```javascript
const MACHINE_NAME = process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown-pc"

// Timings
const POLL_INTERVAL_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 30_000
const AHK_TIMEOUT_MS = 120_000
const STALE_THRESHOLD_MINUTES = 10

// Module mapping
const MODULE_SCRIPTS = {
  stock: "sync_3c.ahk",
  reparaciones: "sync_reparaciones.ahk",
  articulos: "sync_articulos.ahk",
}

// Redis connection
function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    console.error("[AGENT] Env vars requeridos")
    process.exit(1)
  }
  return new Redis({ url, token })
}
```

**ISSUE: Sin reintentos de conexión Redis**
```
❌ Si Redis no está disponible al startup:
   - process.exit(1)
   - Agente muere
   - Ningún reintentos

✅ PROPUESTA:
function getRedisWithRetry(maxAttempts = 5) {
  let attempt = 0
  while (attempt < maxAttempts) {
    try {
      return new Redis({ url, token })
    } catch (err) {
      attempt++
      if (attempt < maxAttempts) {
        console.log(`Retry ${attempt}/${maxAttempts} en 5s...`)
        sleep(5000)
      }
    }
  }
  console.error("Redis no disponible tras 5 intentos")
  process.exit(1)
}
```

### 3.3 Loop de Polling

```javascript
async function pollQueue(redis) {
  console.log("[AGENT] Redis polling started (5s)")

  while (true) {
    try {
      if (isProcessing) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      // 1. Pop command from queue
      const commandId = await redis.rpop("sync-3c:queue")
      if (!commandId) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      // 2. Validate command status
      const raw = await redis.hgetall(`sync-3c:command:${commandId}`)
      if (!raw || raw.status !== "pending") {
        console.log(`[AGENT] Command ${commandId} skipped (not pending)`)
        continue
      }

      // 3. Process
      const module = raw.module || "stock"
      await processCommand(redis, commandId, module)
    } catch (err) {
      console.error("[AGENT] Polling error:", err.message)
    }

    await sleep(POLL_INTERVAL_MS)
  }
}
```

**ISSUE: Sin límite de reintentos tras error**
```
❌ Si processCommand() falla:
   - El error se loguea
   - El loop continúa
   - El command se queda en "running" forever

❌ Race condition si Redis falla durante RPOP:
   - commandId se pierde
   - staleCommandRecovery puede no detectarlo

✅ PROPUESTA:
1. MAX_CONSECUTIVE_ERRORS = 10
2. Si errores consecutivos > MAX → exit(1)
3. Reset contador solo si procesamiento exitoso
```

### 3.4 Recuperación de Commands Stale

```javascript
async function recoverStaleCommands(redis) {
  console.log("[AGENT] Checking for stale running commands...")
  let cursor = 0
  let recovered = 0
  const cutoff = Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000

  try {
    do {
      const result = await redis.scan(cursor, { match: "sync-3c:command:*" })
      const nextCursor = result[0]
      const keys = result[1]
      cursor = parseInt(nextCursor, 10)

      for (const key of keys) {
        const data = await redis.hgetall(key)
        if (data?.status !== "running") continue

        const startedAt = parseInt(data.startedAt ?? "0", 10)
        if (startedAt > 0 && startedAt >= cutoff) continue

        const id = key.replace("sync-3c:command:", "")
        await redis.hset(key, { status: "pending", startedAt: "", agent: "" })
        await redis.lpush("sync-3c:queue", id)
        recovered++
        console.log(`[AGENT] Recovered stale command ${id}`)
      }
    } while (cursor !== 0)
  } catch (err) {
    console.error("[AGENT] Recovery scan error:", err.message)
  }

  if (recovered > 0) console.log(`[AGENT] Recovered ${recovered} stale command(s)`)
}
```

**ISSUE: SCAN puede ser lento en Redis grande**
```
❌ SCAN sin filtro inicial causa:
   - Iteración de TODAS las keys
   - Latencia alta si muchos commands en history
   - Posible timeout si SCAN tarda > 30s

✅ PROPUESTA:
1. Limitar SCAN a últimas 24h de keys
2. Usar TTL en sync-3c:command:* (ej: 48h)
3. Agregar índice separado: sync-3c:running-commands (set)
   - SADD cuando status → running
   - SREM cuando status → completed
   - Recoverery itera sobre set, no SCAN

// Pseudocode
HSET sync-3c:command:{id} { ... }
SADD sync-3c:running-commands {id}
EXPIRE sync-3c:command:{id} 172800  // 48h

// Recovery
members = SMEMBERS sync-3c:running-commands
for each member:
  if stale: reset + re-enqueue
  else: remove from set (recovered)
```

### 3.5 Heartbeat Mechanism

```javascript
function startHeartbeat(redis) {
  const beat = async () => {
    try {
      await redis.set("sync-3c:agent:production", JSON.stringify({
        status: isProcessing ? "running" : "idle",
        lastHeartbeat: Date.now(),
        machineName: MACHINE_NAME,
      }))
    } catch (err) {
      console.error("[AGENT] Heartbeat error:", err.message)
    }
  }

  beat()
  setInterval(beat, HEARTBEAT_INTERVAL_MS)
  console.log("[AGENT] Heartbeat started (Redis)")
}
```

**ISSUE: Sin TTL explícito en primera llamada**
```
❌ Primera beat() NO establece TTL
   - Solo la llamada con `ex: 120` lo tiene (en processCommand)
   - Si agente muere antes de procesar 1er command:
     → heartbeat persiste indefinidamente

✅ PROPUESTA:
await redis.set(
  "sync-3c:agent:production",
  JSON.stringify(...),
  { ex: HEARTBEAT_INTERVAL_MS * 3 }  // TTL = 90s
)
```

### 3.6 AutoHotkey Execution

```javascript
function runAhk(scriptPath) {
  return new Promise((resolve, reject) => {
    const exe = findAhkExe()
    if (!exe) {
      reject(new Error("AutoHotkey no encontrado..."))
      return
    }

    const child = spawn(exe, [scriptPath], {
      cwd: AHK_DIR,
      windowsHide: true,
      shell: false,
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error("AHK timeout después de 120s..."))
    }, AHK_TIMEOUT_MS)

    child.stdout?.on("data", (d) => process.stdout.write(`[AHK] ${d}`))
    child.stderr?.on("data", (d) => process.stderr.write(`[AHK:err] ${d}`))

    child.on("close", (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(`AHK terminó con código ${code}`))
    })

    child.on("error", (err) => {
      clearTimeout(timeout)
      reject(new Error(`Error al ejecutar AHK: ${err.message}`))
    })
  })
}
```

**ISSUE: findAhkExe() puede fallar**
```
❌ Busca en PATH y rutas hardcoded
   - Si AutoHotkey no está instalado → error
   - Error ocurre durante processCommand()
   - Command queda en "running" (no hay rollback)

❌ child.kill() no garantiza termination
   - En Windows, kill() puede no terminar proceso
   - Proceso fantasma ocupa recursos

✅ PROPUESTA:
1. Validar AutoHotkey en startup (main())
2. Usar taskkill en Windows:
   execSync(`taskkill /PID ${child.pid} /F`, { stdio: "ignore" })
3. Agregar logging de exit code para debugging
```

### 3.7 Excel Export Waiting

```javascript
async function waitForExport() {
  for (let attempt = 0; attempt < EXPORT_RETRIES; attempt++) {
    const latest = findLatestExport()
    if (latest) return latest
    await new Promise((r) => setTimeout(r, EXPORT_RETRY_DELAY_MS))
  }
  throw new Error(
    `No se encontró archivo Excel en ${EXPORTS_DIR} tras ${EXPORT_RETRIES} intentos...`
  )
}

function findLatestExport() {
  if (!fs.existsSync(EXPORTS_DIR)) return null

  const files = fs.readdirSync(EXPORTS_DIR)
    .filter((f) => f.endsWith(".xls") || f.endsWith(".xlsx"))
    .map((f) => {
      const fullPath = path.join(EXPORTS_DIR, f)
      try {
        return { name: f, mtime: fs.statSync(fullPath).mtimeMs, fullPath }
      } catch {
        return null
      }
    })
    .filter((f) => f !== null)
    .sort((a, b) => b.mtime - a.mtime)

  return files[0] ?? null
}
```

**ISSUE: Race condition con file copying**
```
❌ RACE CONDITION EN WATCHER

Escenario:
1. AHK genera Excel, inicia copy a 3c_exports/
2. findLatestExport() detecta el archivo (incompleto)
3. fs.readFileSync() intenta leer mientras copy está en progreso
4. Archivo corrupto o incompleto

✅ PROPUESTA:
1. Usar fs.access() con check de permisos
2. Agregar file locking (atomic rename):
   - Copiar a temporal: tresc_TEMP_123456.xls
   - Rename a final: tresc_20260710_143520.xls
   - findLatestExport() solo busca sin TEMP

// Pseudocode
FileCopy → tresc_TEMP_{randomId}.xls
fs.rename(TEMP_FILE, FINAL_FILE)  // atómico
```

### 3.8 Firebase Sync con Fallback

```javascript
if (module === "stock" || module === "articulos") {
  try {
    result = await syncItems(items)
  } catch (err) {
    console.error("========== FIREBASE ERROR ==========")
    console.error(err)
    
    result = {
      success: true,  // ← Controversial: success: true con error
      created: 0,
      updated: 0,
      skipped: items.length,
      warnings: [
        "Firebase temporalmente bloqueado por cuota (24h)",
        "Datos procesados pero no persistidos en inventario",
      ],
      degraded: true,  // ← Flag de degraded mode
    }
  }
}
```

**ISSUE: Respuesta confusa con success: true**
```
❌ result.success = true pero Firebase falló
   - Confunde UI/users
   - "Éxito" pero sin datos persistidos

✅ PROPUESTA:
result = {
  success: false,  // Explícito que falló
  created: 0,
  updated: 0,
  skipped: items.length,
  mode: "degraded",
  error: "Firebase quota exceeded",
  recoveryEstimate: "24 hours",
  warnings: [...]
}

// UI puede diferenciar:
if (result.success) { show success }
else if (result.mode === "degraded") { show warning + retry }
else { show error }
```

### 3.9 Repairs Processing

```javascript
if (module === "reparaciones") {
  try {
    console.log("[AGENT] MAINTENANCE SYNC START")
    const maintenanceResult = await syncRepairsToMaintenance(buffer)
    result = {
      ...result,
      maintenanceCreated: maintenanceResult.created,
      maintenanceUpdated: maintenanceResult.updated,
      maintenanceSkipped: maintenanceResult.skipped,
      maintenanceWarnings: maintenanceResult.warnings,
    }
  } catch (maintErr) {
    result = {
      ...result,
      maintenanceError: maintErr instanceof Error ? maintErr.message : String(maintErr),
    }
  }
}
```

**Bien implementado:** Try/catch separado para repairs, error handling explícito

---

## 4. SCRIPTS AUTOHOTKEY

### 4.1 sync_common.ahk - Motor Compartido

**Archivo:** `automation/sync_common.ahk`

**Lenguaje:** AutoHotkey v2.0

**Propósito:** Compartir funciones comunes entre todos los módulos de sincronización

**Configuración Cargada:**
```ini
[Window]
Title=3C

[Coords]
Almacenes=888,189
Informes=921,370
...etc (23 coordenadas en total)

[Timing]
InitDelay=1000
AfterClick=500
AfterSubmenu=500
AfterQuery=300
AfterAccept=2000
AfterExcel=5000
ResyncDelay=300

[Excel]
Timeout=30

[Logging]
Enabled=true
MaxSizeKB=1024
```

**Funciones Principales:**

1. **ClickAt(name)** - Ejecuta click en coordenada
```ahk
ClickAt(name) {
    c := coords[name]
    if !c {
        Log("ERROR: Coordenada '" name "' no definida")
        throw Error("Coordenada no encontrada: " name)
    }
    Log("Click en " name " (" c[1] "," c[2] ")")
    Click(c[1], c[2])
}
```

2. **WaitForExcel()** - Espera ventana Excel hasta 30s
```ahk
WaitForExcel() {
    Loop excelTimeout {
        if WinExist("ahk_class XLMAIN") {
            Log("Excel detectado correctamente")
            return true
        }
        Sleep(1000)
    }
    Log("WARNING: Excel no detectado tras " excelTimeout "s")
    return false
}
```

3. **WatchAndCopy()** - Monitorea TEMP\tresc\ y copia a exports/
```ahk
WatchAndCopy() {
    downloadDir := EnvGet("LOCALAPPDATA") "\Temp\tresc"
    exportsDir := A_ScriptDir "\..\automation-watcher\3c_exports"

    if !DirExist(downloadDir) {
        Log("[WATCHER ERROR] No existe carpeta tresc en Temp")
        return ""
    }

    Loop 60 {
        Sleep(1000)
        Loop Files downloadDir "\tresc*.xls" {
            Log("[WATCHER] ARCHIVO DETECTADO:")
            Log("[WATCHER] Ruta: " A_LoopFileFullPath)
            Log("[WATCHER] Tamaño: " A_LoopFileSizeKB " KB")

            targetFile := exportsDir "\" A_LoopFileName
            if FileCopy(A_LoopFileFullPath, targetFile, 1) {
                Log("[OK] Archivo copiado a exports: " targetFile)
                try {
                    FileDelete(A_LoopFileFullPath)
                    Log("[OK] Archivo original eliminado: " A_LoopFileFullPath)
                } catch {
                    Log("[WARN] No se pudo eliminar el original: " A_LoopFileFullPath)
                }
            }

            return A_LoopFileName
        }
    }

    Log("[WATCHER] TIMEOUT — no se detectaron archivos tresc*.xls")
    return ""
}
```

4. **ValidarFoco()** - Verifica que 3C tenga foco
```ahk
ValidarFoco() {
    if !WinActive(windowTitle) {
        Log("ERROR: Ventana '" windowTitle "' perdió el foco")
        SaveStatus("fallo", "foco_perdido", "")
        ExitApp()
    }
}
```

5. **Check3CRunning()** - Verifica que 3C esté abierto
```ahk
Check3CRunning() {
    if !WinExist(windowTitle) {
        Log("ERROR: '" windowTitle "' no encontrada")
        SaveStatus("fallo", "check_running", "0s")
        ExitApp()
    }
    WinActivate(windowTitle)
    WinWaitActive(windowTitle)
    Log("Ventana '" windowTitle "' detectada y activada")
}
```

6. **FocusFix()** - Minimiza Chrome/Edge para evitar interferencias
```ahk
FocusFix() {
    if WinExist("ahk_exe chrome.exe")
        WinMinimize("ahk_exe chrome.exe")
    if WinExist("ahk_exe msedge.exe")
        WinMinimize("ahk_exe msedge.exe")
}
```

**ISSUE IDENTIFICADO:**

```
❌ COORDENADAS HARDCODED PARA RESOLUCIÓN ESPECÍFICA

El config.ini tiene coordenadas absolutas de pantalla:
  Almacenes=888,189   (coordenada X,Y en pixels)

Problemas:
1. Si usuario tiene monitor diferente (1920x1080 vs 2560x1440)
   → Clics en posición incorrecta
2. Si 3C está minimizado/movido
   → Clics fuera de la ventana
3. Si usuario cambió tema/escalado Windows
   → Coordenadas inválidas

RIESGOS:
- Script falla silenciosamente (click en lugar equivocado)
- Usuario no se da cuenta hasta que revisión manual de datos
- Corrupción parcial de inventario

✅ PROPUESTA:
1. Usar OCR/Image Recognition:
   ImageSearch para encontrar botones por imagen
2. O usar coordinates relativas a ventana:
   ControlClick("3C ahk_class...") con offset relativo
3. O usar UIA (UI Automation) para acceder programáticamente
4. Fallback a modo interactivo si OCR falla

Ejemplo con ControlClick:
ControlClick 888, 189, windowTitle  ; Click en ventana específica
```

```
❌ SIN VALIDACIÓN DE RESPUESTA

ClickAt(name) ejecuta Click() pero:
- No verifica si el click fue exitoso
- No detecta si la ventana cambió
- No verifica si el menú se abrió

Ejemplo:
ClickAt("Almacenes")  ; Click esperado
Sleep(500)            ; Esperar (ciego)
ClickAt("Informes")   ; ¿Almacenes se abrió?

Si Almacenes no se abrió:
- ClickAt("Informes") intenta clickear en posición incorrecta
- Script falla, pero error no es claro

✅ PROPUESTA:
Agregar validación post-click:
function ClickAtAndValidate(name, expectedWindow) {
    ClickAt(name)
    Sleep(500)
    if not WinActive(expectedWindow) {
        throw Error("Validación falló: se esperaba " expectedWindow)
    }
}
```

```
❌ LOGGING A ARCHIVO SIN ROTACIÓN CLARA

LogFile crece indefinidamente:
- maxLogSizeKB=1024 (1MB)
- FileMove si > 1MB → ${logFile}.bak
- Pero .bak se sobrescribe siempre

Resultado:
- Si muchas ejecuciones → solo últimas 2MB en disk
- Historial se pierde
- Debugging difícil para issues antiguos

✅ PROPUESTA:
Timestamped rollover:
- sync_20260710.log
- sync_20260711.log
- Guardar 7 días de logs
- Gzip logs > 1 día
```

---

### 4.2 sync_3c.ahk - Módulo STOCK

**Archivo:** `automation/sync_3c.ahk`

**Flujo Exacto (8 clicks):**

```
NavigateStock() {
    1. SendInput("^Home")      // Resync to menu
    2. ClickAt("Almacenes")    // Warehouse menu
    3. ClickAt("Informes")     // Reports
    4. ClickAt("Existencias")  // Stock/Inventory
    5. ClickAt("Depositos")    // Deposits/Warehouses
    6. ClickAt("SeleccionarTodos")  // Select All
    7. ClickAt("Consulta")     // Query/Search
    8. ClickAt("Aceptar")      // Accept
    9. ClickAt("Excel")        // Export to Excel
}

Post-Export:
    - WaitForExcel()           // Hasta 30s
    - WatchAndCopy()           // Monitorea TEMP\tresc
    - Cerrar Excel
    - ClickAt("Salir")         // Exit to menu
```

**ISSUE: Timing entre clicks**

```
❌ PROBLEMA DE SINCRONIZACIÓN

Después de cada click → Sleep(timing)

Problema:
- Network latency de aplicación 3C es variable
- UI puede tardar 100ms o 2s en responder
- Sleep(500) es ESTIMADO

Escenario de fallo:
1. ClickAt("Almacenes") + Sleep(500)
2. Aplicación todavía está rendering
3. ClickAt("Informes") → click en lugar equivocado
4. Interfaz de usuario entra en estado inválido

✅ PROPUESTA: Usar WinWaitActive o ImageSearch
En lugar de:
    ClickAt("Almacenes")
    Sleep(500)

Hacer:
    ClickAt("Almacenes")
    if not WinWaitActive("Almacenes ahk_class") {
        throw Error("Almacenes no se abrió tras timeout")
    }
```

---

### 4.3 sync_reparaciones.ahk - Módulo REPAIRS

**Archivo:** `automation/sync_reparaciones.ahk`

**Flujo Exacto (7 clicks + fecha):**

```
NavigateReparaciones() {
    1. SendInput("^Home")              // Resync
    2. ClickAt("Ventas")               // Sales menu (acceso a reparaciones)
    3. MouseMove 448, 346 + Sleep(2000) // DEBUG: verificar posición
    4. ClickAt("Reparaciones")         // Repairs submenu
    5. Click(959, 395)                 // Abrir selector de fecha
       SendInput("^a")                 // Select all
       SendText("01/01/2025")          // Escribir fecha inicial
    6. ClickAt("PrintAll")             // Print all
    7. ClickAt("Imprimir")             // Print
    8. ClickAt("ExcelFormat")          // Excel format
}

Post-Export:
    - WaitForExcel()
    - WatchAndCopy()
    - ClickAt("SalirRep")              // Exit repairs menu
```

**ISSUE: Debug MouseMove sin remover**

```
❌ CÓDIGO DE DEBUG NO REMOVIDO

MouseMove 448, 346
Sleep(2000)

Propósito original: verificar que el mouse estuviera
en la posición correcta.

Problema:
- 2s de delay innecesario en cada sync de reparaciones
- Usuario puede ver mouse moviéndose (extraño)
- Si usuario mueve mouse durante este delay → interfiere

✅ PROPUESTA:
1. Remover completamente
2. O convertir a logging:
   Log("DEBUG: Ventas position validated")
3. O crear modo debug con env var:
   if (DebugMode) MouseMove ...
```

```
❌ HARDCODED DATE "01/01/2025"

SendText("01/01/2025")

Problema:
- Reparaciones desde inicio de año solo
- Si ejecutas en Julio → data de 7 meses, puede ser muy grande
- Si año cambió a 2027 → date es inválida

✅ PROPUESTA:
dateStart := Format(DateAdd(A_Now, -365), "dd/MM/yyyy")  // 1 año atrás
SendText(dateStart)
```

---

### 4.4 sync_articulos.ahk - Módulo ARTICLES

**Archivo:** `automation/sync_articulos.ahk`

**Flujo Exacto (8 clicks):**

```
NavigateArticulos() {
    1. SendInput("^Home")              // Resync
    2. ClickAt("ServiciosArt")         // Services (articles submenu)
    3. ClickAt("ArticulosMenu")        // Articles menu
    4. ClickAt("ArticulosLista")       // Articles list
    5. ClickAt("ImprimirArt")          // Print articles
    6. ClickAt("Generar")              // Generate
    7. ClickAt("ExcelArt")             // Excel format
}

Post-Export:
    - WaitForExcel()
    - WatchAndCopy()
    - ClickAt("SalirArt2")             // Exit print dialog
    - ClickAt("SalirArt")              // Exit articles menu
```

**Bien implementado** - sin issues aparentes

---

### 4.5 AutoHotkey Issues Summary

| Script | Severidad | Problema | Solución |
|---|---|---|---|
| sync_common.ahk | 🔴 Alta | Coordenadas hardcoded, vulnerable a cambios de resolución | Usar OCR/ImageSearch o UI Automation |
| sync_common.ahk | 🟡 Media | Sin validación post-click | Agregar WinWaitActive o ImageSearch |
| sync_reparaciones.ahk | 🟡 Media | Debug MouseMove + Sleep(2000) sin remover | Remover código de debug |
| sync_reparaciones.ahk | 🟡 Media | Hardcoded date "01/01/2025" | Usar DateAdd(A_Now, -365) |

---

## 5. FIREBASE/FIRESTORE

### 5.1 Colecciones en Firestore

**IMPORTANTE:** El proyecto usa **Admin SDK** (backend) y **Client SDK** (frontend)

**Admin SDK:** `firebase-admin` en:
- src/lib/sync-3c/engine.ts
- scripts/*.ts

**Client SDK:** `firebase` en:
- src/lib/firebase.ts
- src/services/*.ts

---

### 5.2 Colecciones Identificadas

| Colección | Origen | Propósito | Típico # Docs | Esquema |
|---|---|---|---|---|
| machines | Manual UI + sync | Máquinas alquilables | 50-500 | { name, model, category, status, rental, location } |
| inventory_stock | sync_3c.ahk | Stock de items 3C | 500-5000 | { codigo, name, stockTotal, stockAvailable, categoria } |
| repairs | Manual UI | Reparaciones taller | 1000-10000 | { machineId, clientName, entryDate, exitDate, status } |
| maintenance | sync_reparaciones.ahk | Órdenes de mantenimiento | 1000-5000 | { orderNumber, clientName, entryDate, status, originalData } |
| rentals | Manual UI | Alquileres vigentes | 50-500 | { machineId, clientName, startDate, expectedEndDate } |
| spare_parts | Manual UI | Repuestos para máquinas | 200-2000 | { machineId, partName, stockTotal, stockUsed } |
| machine_blueprints | Manual upload | Blueprints de máquinas (Cloudinary refs) | 100-1000 | { machineId, blueprintUrl, uploadedAt } |
| blueprint_drafts | Manual UI | Drafts antes de confirmar | 10-100 | { machineId, fileName, draftUrl, createdAt } |
| audit_logs | Automático | Log de cambios | 10000+ | { entity, action, before, after, timestamp, userId } |
| dashboard_stats | Sync automático | Stats agregadas (ej: scaffold rentals) | <10 | { scaffold_rentals: {...}, updatedAt } |
| stock_movements | Manual | Movimientos de stock | 100-1000 | { partId, type, quantity, date } |
| inventory_movements | Manual | Movimientos de inventario general | 100-1000 | { materialId, type, quantity, date } |

---

### 5.3 Esquema Detallado - Colecciones Críticas

#### 5.3.1 machines

```typescript
{
  id: string                           // Auto-generated
  name: string                         // "Andamio Tubular ACME"
  model: string                        // "AT-2024"
  category: "scaffold" | "equipment" | "tools"
  status: "available" | "rented" | "maintenance" | "disabled"
  locationType: "deposito" | "client" | "project"
  location: {                          // Ubicación actual
    client?: {
      name: string
      address: string
    }
    project?: {
      name: string
      address: string
    }
  } | null
  rental: {                            // Info alquiler si status="rented"
    clientName: string
    clientAddress: string
    projectName: string
    projectAddress: string
    startDate: Timestamp
    expectedEndDate: Timestamp | null
    isOpenEnded: boolean               // true si sin fecha fin
  } | null
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**Índices Recomendados:**
```
Composite:
- (status, updatedAt)  // para listar máquinas disponibles + ordenar
- (category, status)   // para filtrar por tipo
```

---

#### 5.3.2 inventory_stock

```typescript
{
  id: string                     // Auto-generated
  codigo: string                 // "001023" - from 3C
  name: string                   // "Tablón Andamio 4.5m"
  category: "estructural" | "consumibles" | ...
  subtype?: string               // "madera" | "metal" | ...
  stockTotal: number             // Cantidad total en 3C
  stockAvailable: number         // Disponible (no alquilado)
  stockRented: number            // En alquiler
  unit: string                   // "unidad" | "metro" | ...
  deposito: string               // "Principal" | "Sucursal B"
  source: "3c" | "manual"
  stockWarning?: boolean         // true si stock negativo
  lastSync: Timestamp
  updatedAt: Timestamp
}
```

**ISSUE CRÍTICO:**
```
❌ SIN ÍNDICES PARA BÚSQUEDA RÁPIDA

Búsquedas comunes:
- getStockItems() → orderBy("name")
  → Sin índice = full collection scan

PROPUESTA:
Crear índices compuestos:
1. (source, category, updatedAt DESC)
2. (codigo) - sparse index
3. (name) - para búsqueda de texto
```

---

#### 5.3.3 maintenance

```typescript
{
  id: string                     // orderNumber from 3C (ej: "X0123-4567")
  orderNumber: string            // UNIQUE, PRIMARY KEY
  entryDate: Timestamp
  returnDate?: Timestamp | null
  repairDate?: Timestamp | null
  clientName: string
  clientCode?: string
  machineName: string            // Nombre del equipo
  status: string                 // "Recepción" | "En reparación" | "Completado"
  docId?: string
  itemId?: number | null
  articleId?: string
  quantity?: number | null
  unitPrice?: number | null
  totalPrice?: number | null
  taxed?: number | null
  notTaxed?: number | null
  exempt?: number | null
  capitalGood?: number | null
  useGood?: number | null
  equivalentCoefficient?: number | null
  netPrice?: number | null
  originalData?: Record<string, unknown>  // ⚠️ DENORMALIZED
  sourceRow?: number
  updatedAt: Timestamp
}
```

**ISSUE CRÍTICO:**
```
❌ originalData ES DOCUMENTO LIBRE

originalData contiene TODAS las columnas del Excel:
{
  "tipo": "PRESUPUESTO",
  "numero": "X0123-4567",
  "fecha": "01/07/2026",
  "cliente": "Construcciones XYZ",
  "maquina": "Andamio Tubular",
  ...hasta 50+ campos
}

Problemas:
1. Tamaño variable de documento (50-500 bytes)
2. Si Excel tiene columnas extras → documento crece
3. Sin schema validation
4. Búsquedas en originalData no indexadas

PROPUESTA:
1. Limitar a campos esenciales solamente
2. O mover a subcollection si documento > 100KB
3. Agregar schema validation en engine.ts:syncRepairsToMaintenance()
```

---

#### 5.3.4 repairs

```typescript
{
  id: string                          // Auto-generated
  machineId: string                   // FK: machines.id
  machineName: string                 // DENORMALIZED
  machineModel: string | undefined
  internalNumber?: string
  clientId?: string
  clientName: string
  clientNumber?: string
  reportedIssue: string               // "No prende el motor"
  diagnosis?: string
  repairPerformed: string
  technician: string
  entryDate: Timestamp
  exitDate: Timestamp
  hoursUsed?: number
  warrantyDays: number
  warrantyUntil: Timestamp
  oilChangeDueDate?: Timestamp
  bearingChangeDueDate?: Timestamp
  maintenanceDueDate?: Timestamp
  notes?: string
  partsUsed: Array<{
    partId: string
    partName: string
    quantity: number
    unitPrice: number
  }>
  source: "manual" | "maintenance" | "sync"
  externalId?: string                 // Link a maintenance.id si source="sync"
  status: "EN_TALLER" | "FINALIZADO"
  issue?: string                      // Deprecated?
  estimatedReturn?: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**ISSUE: Desnormalización excesiva**
```
❌ DUPLICATE DATA: machineName + machineModel

repairs.machineName duplica:
- machines.name
- maintenance.machineName

Problemas:
1. Si máquina se renombra en machines → inconsistencia
2. Queries más lentas (no indexadas)
3. Actualizaciones complejas (update repairs + machines)

PROPUESTA:
1. Mantener solo machineId
2. Usar joins/subcollections para machineName
3. O crear cached view en Redis:
   SET repair:cache:{repairId} { machineName: ... }
```

---

### 5.4 Firebase Services Analysis

**Archivo:** `src/services/machines.ts`

**Patrón de lectura:**
```typescript
export async function getMachines(): Promise<Machine[]> {
  const q = query(collection(db, "machines"), orderBy("name"))
  const snapshot = await getDocs(q)
  getMachinesCalls++
  console.log(`[SYNC] getMachines() Call #${getMachinesCalls} docs=${snapshot.size}...`)
  return snapshot.docs.map(docToMachine)
}
```

**ISSUE: Contador de llamadas sin límite**
```
❌ getMachinesCalls es contador global
   - Incrementa cada vez que se llama
   - Nunca se reinicia
   - Después de 1 semana → número gigante

✅ PROPUESTA:
// Resumen cada 1h
let callCount = 0
let lastReset = Date.now()

if (Date.now() - lastReset > 3600000) {
  console.log(`[STATS] getMachines() ${callCount} calls en 1h`)
  callCount = 0
  lastReset = Date.now()
}
callCount++
```

---

### 5.5 Firebase Read/Write Patterns

**Read Operations:**
```typescript
// Tipo: Query (múltiples docs)
const q = query(collection(db, "machines"), orderBy("name"))
const snapshot = await getDocs(q)

// Costo: 1 read por documento + 1 query
// Para 100 machines: 101 reads

// Tipo: Get individual (1 doc)
const snap = await getDoc(ref)

// Costo: 1 read por documento
```

**Write Operations:**
```typescript
// Tipo: Add (nuevo doc)
const docRef = await addDoc(collection(db, "machines"), docData)

// Costo: 1 write

// Tipo: Update (merge)
await updateDoc(ref, updates)

// Costo: 1 write

// Tipo: Batch (múltiples docs)
const batch = writeBatch(db)
for (let i = 0; i < 500; i++) {
  batch.set(docRef, docData, { merge: true })
}
await batch.commit()

// Costo: 500 writes
```

**ISSUE: Quota Firebase**
```
❌ PLAN SPARK (Free)
- 50K reads/día
- 20K writes/día
- 1GB almacenamiento

❌ PLAN BLAZE (Pay-as-you-go)
- Ilimitado pero caro
- 1 million reads = $0.30

Auditoría 2026-06-28 mostró:
- 66K reads en 7 días (excedió 50K/día Spark)
- Causa: getMachines() se ejecuta múltiples veces
- Solución temporal: Fallback degradado

PROPUESTA:
1. Implementar caché local (Redis o memoria)
2. Invalidación por TTL (ej: 5 min)
3. Limitar reads con rate limiting
```

---

### 5.6 Firebase Issues Summary

| Colección | Severidad | Problema | Solución |
|---|---|---|---|
| inventory_stock | 🟡 Media | Sin índices para búsqueda por código | Crear índice (codigo) |
| maintenance | 🔴 Alta | originalData crece sin límite | Limitar campos o mover a subcollection |
| repairs | 🟡 Media | Desnormalización de machineName | Mantener solo FK machineId |
| Todas | 🔴 Alta | Lectura sin caché → quota exceeded | Implementar Redis cache con TTL |

---

## 6. REDIS (UPSTASH)

### 6.1 Keys Utilizadas

| Key | Tipo | TTL | Propósito | Típico Tamaño |
|---|---|---|---|---|
| sync-3c:queue | List | ∞ | FIFO queue de commands | <1KB |
| sync-3c:command:{id} | Hash | Ninguno | Estado del command | <1KB |
| sync-3c:result:{id} | Hash | Ninguno | Resultado del sync | 1-10KB |
| sync-3c:agent:production | String | 120s | Heartbeat del agente | <1KB |
| sync-3c:running-commands | Set | Ninguno | Set de commands en "running" | <1KB |

---

### 6.2 Patrón FIFO de Cola

```
POST /api/sync-3c
  → LPUSH sync-3c:queue "cmd-uuid-1"
  → LPUSH sync-3c:queue "cmd-uuid-2"

// Redis internal state:
// sync-3c:queue = [cmd-uuid-2, cmd-uuid-1]

Agent polling:
  → RPOP sync-3c:queue
  → Returns "cmd-uuid-1"
  → Procesa
  → RPOP sync-3c:queue
  → Returns "cmd-uuid-2"
```

**ISSUE: Sin límite de queue**
```
❌ LPUSH sin verificación de tamaño

Si UI está enviando comandos rápido:
- 1000 commands en queue
- Agent procesa 1 cada 5-10 min
- Queue crece indefinidamente

❌ Posible DDOS:
POST /api/sync-3c x 1000
→ 1000 commands en queue
→ Agente nunca alcanza

✅ PROPUESTA:
1. Limitar queue: LLEN sync-3c:queue < 100
2. Si > 100 → retornar 429 Too Many Requests
3. Agregar rate limiting por IP:
   SET sync-3c:ratelimit:{ip} count+1 EX 60
   if count > 10 → reject
```

---

### 6.3 Race Conditions en Redis

**Scenario 1: Lectura simultánea de result**

```
1. Agent: HSET sync-3c:result:{id} { result: JSON... }
2. UI: GET /api/sync-3c/status
   → HGETALL sync-3c:command:{id}
   → parse JSON result
3. Agent: HSET sync-3c:result:{id} { status: "completed" }
4. UI recibe respuesta parcial/inconsistente
```

**ISSUE:**
```
❌ Race condition sin mitigación

HSET es atómico, pero cliente lee múltiples campos
entre writes.

✅ PROPUESTA:
1. Usar versioning:
   result_v1, result_v2, ... result_vN
   Client lee versión más alta

2. O usar Transactions:
   WATCH sync-3c:command:{id}
   MULTI
   HSET ...
   EXEC

3. O serializar todo en 1 campo:
   HSET sync-3c:command:{id} {
     status_data: JSON.stringify({ status, result, ... })
   }
```

---

### 6.4 Heartbeat Mechanism Issues

**Current Implementation:**
```javascript
// Agent sets every 30s
SET sync-3c:agent:production { lastHeartbeat: Date.now() } EX 120

// UI reads
GET sync-3c:agent:production
online = (Date.now() - lastHeartbeat) < 90_000
```

**ISSUE:**
```
❌ TTL SIN SINCRONIZACIÓN

Si Agent muere:
1. Última heartbeat: 2026-07-10 14:35:00
2. TTL 120s expira en 14:36:20
3. Pero UI considera offline en 14:36:30 (90s después)

Worst case:
- Agent muere
- Última heartbeat persiste en Redis (TTL no expirado)
- UI piensa que Agent está "online" 30s más

✅ PROPUESTA:
// En Agent
SET sync-3c:agent:production 
  JSON_stringify({ lastHeartbeat, expireAt: Date.now() + 90000 })
  EX 120

// En UI
GET sync-3c:agent:production
now = Date.now()
online = (now < expireAt)
```

---

### 6.5 Stale Command Recovery

**Current:**
```javascript
async function recoverStaleCommands(redis) {
  // SCAN sync-3c:command:* match
  // Filter status="running"
  // If startedAt > 10 min ago
  // → Reset to pending + LPUSH queue
}
```

**ISSUE:**
```
❌ SCAN SIN ÍNDICE ESPECÍFICO

SCAN itera todas las keys matching pattern:
- sync-3c:command:abc123
- sync-3c:command:def456
- sync-3c:command:ghi789
- ... 1000 commands

Problema:
1. Si 10000 commands históricos → SCAN lento
2. Timeout > 30s posible
3. Recovery puede no completarse

✅ PROPUESTA:
Usar set separado para tracking:

// En agent.mjs
HSET sync-3c:command:{id} { ... }
SADD sync-3c:running-commands {id}  // ← Set de commands corriendo

// En recovery
SMEMBERS sync-3c:running-commands  // ← Solo commands activos
for id in members:
  data = HGETALL sync-3c:command:{id}
  if stale: reset to pending + SREM

SREM es O(1) vs SCAN O(N)
```

---

## 7. CÓDIGO MUERTO

### 7.1 Archivos Potencialmente Muertos

**Scripts:** `scripts/` directory

```
scripts/audit.ts              ✅ Usado (npm run audit)
scripts/export-logs.ts        ❓ No referenciado en codebase
scripts/fix-rented-machines.ts ❓ No referenciado (manual fix)
scripts/seed-machines.ts      ✅ Usado (npm run seed)
```

**Análisis:**

1. **export-logs.ts**
```typescript
// Exporta audit_logs a JSON local
// NO está referenciado en servicios
// Posible uso manual: npx tsx scripts/export-logs.ts

VERDICT: Probablemente muerto, pero podría ser
         herramienta de backup manual
```

2. **fix-rented-machines.ts**
```typescript
// Script para corregir máquinas con status "rented"
// Usado solo si hay data corruption

VERDICT: Muerto en producción, pero herramienta útil
         para mantenimiento
```

---

### 7.2 Servicios No Referenciados

**Búsqueda de importaciones:**

```
src/services/audit.ts                  ← usado en machines.ts (createAuditLog)
src/services/auth.ts                   ← usado en AuthContext.tsx
src/services/blueprintDrafts.ts         ← usado en componentes UI
src/services/inventoryMovements.ts      ← usado en pages/inventory-movements
src/services/inventoryStock.ts          ← usado en múltiples páginas
src/services/machineBlueprints.ts       ← usado en máquinas/blueprints
src/services/machines.ts                ← usado en múltiples servicios + páginas
src/services/maintenance.ts             ← usado en engine.ts + API
src/services/maintenanceSettings.ts     ← usado en hooks/useMaintenanceSettings
src/services/pdfPartsExtractor.ts       ❓ importado en? (VERIFICAR)
src/services/recommendationAudit.ts     ← usado en recommendation engine
src/services/recommendationEngine.ts    ← usado en pages (busca de máquinas)
src/services/rentals.ts                 ← simple re-export de machines.ts
src/services/repairs.ts                 ← usado en múltiples lugares
src/services/scaffoldRental.ts          ← usado en machines.ts
src/services/spareParts.ts              ← usado en múltiples servicios
src/services/stockIntelligence.ts       ← usado en dashboard
src/services/stockMovements.ts          ← usado en pages/stock-movements
```

**pdfPartsExtractor.ts:**
```typescript
export async function extractPartsFromPdf(fileUrl: string): Promise<ExtractedPart[]> {
  // Usa pdfjs-dist para parsear PDFs
  // Extrae lista de partes
}

BÚSQUEDA: grep -r "extractPartsFromPdf" src/
RESULTADO: 0 coincidencias

VERDICT: PROBABLEMENTE MUERTO
```

---

### 7.3 Componentes No Referenciados

**dashboard/:**
- GlobalSearchResults.tsx ← usado en dashboard
- SmartAlertsPanel.tsx ← usado en dashboard
- WorkshopSummary.tsx ← usado en dashboard

**machines/:**
- BlueprintImportPanel.tsx ← usado en machines/[id]/blueprints
- BlueprintUploader.tsx ← usado en BlueprintImportPanel
- ImportInventory.tsx ❓ (VERIFICAR)
- MachineCard.tsx ← usado en machines list
- MaintenanceTimeline.tsx ← usado en machines/[id]
- SeedInventory.tsx ← usado en dashboard (seed UI)
- SparePartCard.tsx ← usado en machines/[id]/parts

**repair/, maintenance/, sync/, ui/**
- Todos referenciados en páginas correspondientes

---

### 7.4 Hooks Posiblemente Duplicados

**Hooks en src/hooks/:**

```
useAuth.ts                    ← Auth state
useBlueprintDrafts.ts         ← Blueprint drafts
useInventoryStock.ts          ← Stock items
useMachineBlueprints.ts       ← Blueprints for machine
useMachines.ts                ← Machines list
useMaintenanceSettings.ts     ← Maintenance settings
useRentals.ts                 ← DEPRECATED (simple re-export)
useRepairs.ts                 ← Repairs list
useSpareParts.ts              ← Spare parts for machine
useSparePartsCache.ts         ← Cached spare parts
useStockIntelligence.ts       ← Stock analysis
```

**useRentals.ts:**
```typescript
export { rentMachine, returnMachine } from "./machines"

VERDICT: HOOK VACÍO - solo re-export de funciones
         debería ser eliminado
```

---

### 7.5 Types / Interfaces Posiblemente Muertos

**Búsqueda de tipos nunca usados:**

```typescript
// En src/types/index.ts
interface MachineBlueprint { ... }     ✅ usado
interface ScaffoldComponent { ... }    ❓ (verificar)
interface MaintenanceRecord { ... }    ✅ usado
// ... etc
```

---

## 8. ISSUES Y RECOMENDACIONES

### 8.1 Issues Críticos (🔴 Rojo)

| # | Area | Problema | Impacto | Solución |
|---|---|---|---|---|
| 1 | AutoHotkey | Coordenadas hardcoded para resolución fija | Script falla si usuario cambia pantalla | Usar OCR/ImageSearch |
| 2 | Firebase | Quota exceeded sin fallback permanente | Sincronización bloqueada 24h | Implementar caché Redis/Postgres |
| 3 | Maintenance | originalData crece sin límite | Documentos > 1MB | Limitar a campos esenciales |
| 4 | Redis | Sin límite de queue size | DDOS posible | Agregar rate limiting |

---

### 8.2 Issues Medianos (🟡 Amarillo)

| # | Area | Problema | Impacto | Solución |
|---|---|---|---|---|
| 1 | API | Sin validación de input body | Requests malformados aceptados | Agregar schema validation |
| 2 | API | Race condition en concurrent reads | result parcial | Usar versioning o WATCH |
| 3 | Agent | Sin reintentos de conexión Redis | Agente muere si Redis offline | Agregar retry logic |
| 4 | Agent | Log sin rotación clara | Logs crecen indefinidamente | Timestamped rollover |
| 5 | AHK | Sin validación post-click | Clicks pueden fallar silenciosamente | Agregar WinWaitActive |
| 6 | AHK | Debug MouseMove sin remover | Delay innecesario en reparaciones | Remover código de debug |

---

### 8.3 Recomendaciones Arquitectónicas

#### 8.3.1 Mejorar Resiliencia del Agente

```javascript
// Antes
async function main() {
  const redis = getRedis()  // Muere si falla
  await pollQueue(redis)
}

// Después
async function main() {
  let consecutiveErrors = 0
  while (true) {
    try {
      const redis = await getRedisWithRetry(5)
      await pollQueue(redis)
      consecutiveErrors = 0
    } catch (err) {
      consecutiveErrors++
      console.error(`[FATAL] Error #${consecutiveErrors}: ${err.message}`)
      if (consecutiveErrors > 10) {
        console.error("[FATAL] Max retries exceeded, exiting")
        process.exit(1)
      }
      await sleep(5000)  // Backoff
    }
  }
}
```

---

#### 8.3.2 Implementar Caché de Firestore

```javascript
// Redis cache con TTL
const CACHE_TTL_S = 300  // 5 minutos

async function getMachinesWithCache(redis) {
  // 1. Intentar leer de caché
  const cached = await redis.get("cache:machines")
  if (cached) {
    console.log("[CACHE HIT] machines")
    return JSON.parse(cached)
  }

  // 2. Fallback a Firestore
  const machines = await getMachinesFromFirestore()
  
  // 3. Guardar en caché
  await redis.set("cache:machines", JSON.stringify(machines), {
    ex: CACHE_TTL_S
  })
  
  return machines
}
```

---

#### 8.3.3 Agregar Monitoring de Sincronización

```javascript
// Redis stats sobre sync performance
async function trackSyncMetrics(redis, commandId, duration, status) {
  const day = new Date().toISOString().split('T')[0]
  const key = `stats:sync:${day}`
  
  await redis.hincrby(key, `${status}:count`, 1)
  await redis.hincrby(key, `${status}:totalMs`, duration)
  await redis.expire(key, 86400 * 7)  // 7 días de historial
}

// Dashboard puede consultar:
// HGETALL stats:sync:2026-07-10
// → { "completed:count": "45", "completed:totalMs": "180000", ... }
```

---

#### 8.3.4 Implementar Circuit Breaker para Firebase

```javascript
class CircuitBreaker {
  constructor(maxFailures = 5, resetTimeout = 300000) {
    this.failures = 0
    this.maxFailures = maxFailures
    this.resetTimeout = resetTimeout
    this.state = "CLOSED"  // CLOSED | OPEN | HALF_OPEN
  }

  async execute(fn) {
    if (this.state === "OPEN") {
      throw new Error("Circuit is OPEN - Firebase unavailable")
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (err) {
      this.onFailure()
      throw err
    }
  }

  onSuccess() {
    this.failures = 0
    this.state = "CLOSED"
  }

  onFailure() {
    this.failures++
    if (this.failures >= this.maxFailures) {
      this.state = "OPEN"
      console.warn("[CIRCUIT BREAKER] Opening circuit after", this.failures, "failures")
      setTimeout(() => {
        this.state = "HALF_OPEN"
      }, this.resetTimeout)
    }
  }
}

// Uso
const fbCircuit = new CircuitBreaker()

try {
  result = await fbCircuit.execute(() => syncItems(items))
} catch (err) {
  // Fallback degraded mode
  result = { success: false, mode: "degraded", error: err.message }
}
```

---

### 8.4 Plan de Acción Recomendado

#### Phase 1: Correcciones Rápidas (1-2 días)

- [ ] Remover código de debug MouseMove en sync_reparaciones.ahk
- [ ] Cambiar hardcoded date a DateAdd en sync_reparaciones.ahk
- [ ] Agregar validación de input en POST /api/sync-3c
- [ ] Crear constante HEARTBEAT_TIMEOUT_MS configurable
- [ ] Limitar campos de originalData en maintenance

#### Phase 2: Resiliencia (3-5 días)

- [ ] Implementar Redis caché para getMachines()
- [ ] Agregar rate limiting a POST /api/sync-3c
- [ ] Implementar Circuit Breaker para Firebase
- [ ] Agregar retry logic en agent.mjs startup

#### Phase 3: Arquitectura (1-2 semanas)

- [ ] Reemplazar coordenadas hardcoded en AHK con OCR/ImageSearch
- [ ] Implementar índices en Firestore
- [ ] Migrar originalData a subcollection
- [ ] Agregar tracking de metricas en Redis

#### Phase 4: Limpieza (1 semana)

- [ ] Remover servicios muertos (pdfPartsExtractor, etc)
- [ ] Eliminar hook useRentals vacío
- [ ] Documentar scripts en scripts/
- [ ] Eliminar código de debug

---

## CONCLUSIÓN

El proyecto operario-control tiene una **arquitectura sólida de sincronización**, pero presenta:

✅ **Fortalezas:**
- Polling bien implementado (FIFO queue con Redis)
- Fallback degradado cuando Firebase no disponible
- Logging centralizado en agent.mjs
- Scripts AutoHotkey modulares

❌ **Debilidades:**
- Vulnerabilidades de coordinación (hardcoded coords, timing)
- Sin caché de lectura en Firestore → quota exceeded
- Sin límites en Redis queue → DDOS posible
- Código de debug no removido

**Recomendación:** Implementar Phase 1-2 del plan para mejorar resiliencia inmediatamente, luego Phase 3 para arquitectura a largo plazo.

---

**Documento generado:** 2026-07-10 15:47:00 UTC  
**Análisis exhaustivo completado**
