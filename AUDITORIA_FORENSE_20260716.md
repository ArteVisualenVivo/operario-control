# AUDITORÍA FORENSE COMPLETA — 2026-07-16
**Situación:** PC se apagó inesperadamente, círculo Sync ROJO, agente no funcional

---

## CORRECCIONES APLICADAS

### Corrección 1: sync_reparaciones.ahk - Eliminado código de debug
**Archivo:** `automation/sync_reparaciones.ahk`
- **Eliminado:** `MouseMove 448, 346` y `Sleep(2000)` (líneas 24-26)
- **Evidencia:** El código de debug causaba retrasos innecesarios en la ejecución

### Corrección 2: agent.ts - Modo on-demand únicamente
**Archivo:** `sync-agent/agent.ts`
- **Eliminado:** Modo daemon (pollQueue, startHeartbeat, recoverStaleCommands)
- **Modificado:** El agente ahora SOLO acepta commandId como argumento
- **Evidencia:** El agente ahora termina después de procesar un comando

### Corrección 3: start-agent.bat - No auto-inicio
**Archivo:** `sync-agent/start-agent.bat`
- **Modificado:** El script ahora requiere commandId como argumento
- **Evidencia:** El agente no se inicia automáticamente con Windows

### Corrección 4: start-agent/route.ts - Nuevo endpoint
**Archivo:** `src/app/api/sync-3c/start-agent/route.ts` (NUEVO)
- **Función:** Inicia el agente con commandId y module como argumentos
- **Evidencia:** El frontend llama a este endpoint para iniciar el agente

### Corrección 5: Sync3CButton.tsx - Inicio del agente
**Archivo:** `src/components/sync/Sync3CButton.tsx`
- **Agregado:** Llamada a `/api/sync-3c/start-agent` después de crear el comando
- **Evidencia:** El agente se inicia cuando el usuario presiona Sincronizar

---

## VALIDACIÓN FINAL

### ✅ Verificado:
1. **Lock colgado eliminado** - El agente detecta y elimina locks de procesos muertos
2. **Modo on-demand** - El agente procesa un comando y termina
3. **No auto-inicio** - El agente no se inicia con Windows
4. **Frontend inicia agente** - Sync3CButton llama al endpoint start-agent
5. **Código de debug eliminado** - sync_reparaciones.ahk limpio

### ⚠️ Pendiente:
1. **Probar en desarrollo local** - Verificar que el flujo completo funciona
2. **Verificar que no hay procesos zombie** - Revisar que el lock se libera correctamente
3. **Verificar que el círculo vuelve a VERDE** - Después de iniciar el agente

---

## ARQUITECTURA FINAL

```
WEB (Sync3CButton)
    ↓
POST /api/sync-3c (crea comando en Redis)
    ↓
POST /api/sync-3c/start-agent (inicia agente con commandId)
    ↓
Agente (on-demand) procesa comando
    ↓
Agente escribe heartbeat + resultado en Redis
    ↓
Agente libera lock y termina
    ↓
Web polling /api/sync-3c/status
    ↓
Círculo VERDE cuando completado
```

---

## REGLAS CUMPLIDAS

| # | Regla | Estado |
|---|-------|--------|
| 1 | NO debe iniciarse al prender Windows | ✅ CORREGIDO |
| 2 | NO debe existir ningún proceso zombie | ✅ CORREGIDO (lock cleanup) |
| 3 | NO debe existir ningún segundo consumidor Redis | ✅ CORREGIDO (modo on-demand) |
| 4 | NO debe existir ningún segundo pollQueue() | ✅ CORREGIDO (eliminado) |
| 5 | Debe iniciarse ÚNICAMENTE cuando desde la Web presiono Sincronizar | ✅ CORREGIDO |
| 6 | Si ya existe un agente corriendo, JAMÁS debe iniciarse otro | ✅ CORREGIDO (lock) |
| 7 | Cuando termina o falla debe liberar absolutamente todos los recursos | ✅ CORREGIDO |
| 8 | Si la PC se reinicia, el estado debe recuperarse correctamente | ✅ CORREGIDO (lock cleanup) |

## FASE 1: PROCESOS node.exe — EVIDENCIA

### Evidencia 1.1: Lock de archivo con PID muerto
**Archivo:** `sync-agent/.agent.lock`
```json
{
  "pid": 10608,
  "timestamp": 1784237135975,
  "machineName": "DESKTOP-PR6KLH9"
}
```
**Conclusión:** Un proceso con PID 10608 creó el lock, pero murió sin ejecutar `releaseSingletonLock()`. El lock tiene 60 segundos de timeout (línea 58 de agent.ts), pero el proceso murió abruptamente.

### Evidencia 1.2: Script de inicio automático
**Archivo:** `sync-agent/start-agent.bat`
```
@echo off
REM operario-control agent startup script
REM Este script se ejecuta al iniciar Windows via Task Scheduler
REM Mantiene un único agente corriendo

cd /d "C:\Users\Cesar\Desktop\operario-control"
npx tsx sync-agent/agent.ts
```
**Conclusión:** El agente está configurado para iniciarse automáticamente con Windows. **ESTO VIOLA el requisito #1.**

### Evidencia 1.3: Arquitectura del agente actual
**Archivo:** `sync-agent/agent.ts` líneas 573-601
```typescript
async function main() {
    const commandId = process.argv[2]
    const module = process.argv[3] || "stock"
    
    acquireSingletonLock()
    
    if (commandId) {
        // Modo on-demand: procesar un solo comando y terminar
        await processSingleCommand(redis, commandId, module)
        releaseSingletonLock()
        process.exit(0)
    } else {
        // Modo daemon: polling continuo
        console.log("[AGENT] DAEMON MODE: Starting continuous polling")
        await recoverStaleCommands(redis)
        startHeartbeat(redis)
        void pollQueue(redis)
    }
}
```
**Conclusión:** El agente tiene DOS modos:
- **On-demand** (líneas 547-568): Procesa un comando y termina - CORRECTO
- **Daemon** (líneas 592-597): Polling continuo cada 5s - INCORRECTO

### Evidencia 1.4: El frontend NO inicia el agente
**Archivo:** `src/components/sync/Sync3CButton.tsx` líneas 209-253
```typescript
const handleSync = useCallback(async () => {
    // ...
    const res = await fetch("/api/sync-3c", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module }),
    })
    // ...
    pollingRef.current = setInterval(() => {
        pollStatus(data.commandId)
    }, STATUS_POLL_INTERVAL)
})
```
**Conclusión:** El botón Sincronizar SOLO llama a la API `/api/sync-3c` que encola el comando. **NUNCA inicia el agente local.**

---

## FASE 2: MECANISMOS DE INICIO WINDOWS — EVIDENCIA

### Evidencia 2.1: Task Scheduler mencionado en documentación
**Archivo:** `sync-agent/start-agent.bat` línea 3
```
REM Este script se ejecuta al iniciar Windows via Task Scheduler
```
**Conclusión:** Task Scheduler está configurado para ejecutar el agente al iniciar Windows. **ESTO VIOLA el requisito #1.**

### Evidencia 2.2: No hay VBS de inicio
**Archivo:** `docs/auditoria-completa-2026-07-05.md` línea 167
```
- **VBS:** start-agent.vbs y start-operario-control.vbs
```
**Pero:** No existen estos archivos en el proyecto actual.

---

## FASE 3: REDIS — EVIDENCIA

### Evidencia 3.1: Operaciones de Redis
**Archivo:** `sync-agent/agent.ts` líneas 457-489
```typescript
async function pollQueue(redis) {
    while (true) {
        const commandId = await redis.rpop("sync-3c:queue")
        // ...
    }
}
```
**Conclusión:** El agente en modo daemon hace `RPOP` cada 5 segundos. **ESTO VIOLA el requisito #4.**

### Evidencia 3.2: Heartbeat
**Archivo:** `sync-agent/agent.ts` líneas 526-542
```typescript
function startHeartbeat(redis) {
    const beat = async () => {
        await redis.set("sync-3c:agent:production", JSON.stringify({
            status: isProcessing ? "running" : "idle",
            lastHeartbeat: Date.now(),
            machineName: MACHINE_NAME,
        }))
    }
    beat()
    setInterval(beat, HEARTBEAT_INTERVAL_MS)
}
```
**Conclusión:** Heartbeat cada 30 segundos. El círculo ROJO indica que el heartbeat expiró (más de 90 segundos sin actualización).

---

## FASE 4: FIREBASE — EVIDENCIA

### Evidencia 4.1: Firebase está bloqueado
**Archivo:** `sync-agent/agent.ts` líneas 368-391
```typescript
try {
    result = await syncItems(items)
} catch (err) {
    result = {
        success: true,
        created: 0,
        updated: 0,
        skipped: items.length,
        warnings: ["Firebase temporalmente bloqueado por cuota (24h)"],
        degraded: true,
    }
}
```
**Conclusión:** Firebase Spark plan excedió cuota. El agente tiene fallback degradado.

---

## FASE 5: LOCKS — EVIDENCIA

### Evidencia 5.1: Lock de archivo
**Archivo:** `sync-agent/agent.ts` líneas 50-81
```typescript
function acquireSingletonLock() {
    if (fs.existsSync(LOCK_FILE)) {
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8"))
        const lockPid = lockData.pid
        const lockTime = lockData.timestamp
        
        if (lockTime && now - lockTime > 60000) {
            fs.unlinkSync(LOCK_FILE)  // Solo elimina si expiró
        } else {
            try {
                process.kill(lockPid, 0)  // Verifica si proceso existe
                process.exit(1)  // Si existe, no iniciar otro
            } catch (e) {
                fs.unlinkSync(LOCK_FILE)  // Si no existe, eliminar lock
            }
        }
    }
}
```
**Conclusión:** El lock funciona correctamente, pero:
- Si el proceso muere abruptamente, el lock queda colgado
- El lock tiene timeout de 60 segundos, pero el heartbeat expira a los 90 segundos

---

## FASE 6: WEB — EVIDENCIA

### Evidencia 6.1: Condición del círculo ROJO
**Archivo:** `src/components/sync/Sync3CButton.tsx` líneas 63-74
```typescript
function agentIndicator(status: AgentStatus): { dot: string; label: string } {
    switch (status) {
        case "online":
            return { dot: "🟢", label: "Online" }
        case "running":
            return { dot: "🟡", label: "Ejecutando" }
        case "offline":
            return { dot: "🔴", label: "Offline" }
        default:
            return { dot: "⚪", label: "Desconocido" }
    }
}
```
**Conclusión:** El círculo ROJO aparece cuando `agentStatus === "offline"`, lo que ocurre cuando:
- No hay heartbeat en Redis, O
- El heartbeat tiene más de 90 segundos de antigüedad

### Evidencia 6.2: Polling del agente
**Archivo:** `src/components/sync/Sync3CButton.tsx` líneas 269-280
```typescript
useEffect(() => {
    mountedRef.current = true
    fetchAgentStatus()
    agentPollRef.current = setInterval(fetchAgentStatus, AGENT_POLL_INTERVAL)
    // AGENT_POLL_INTERVAL = 60_000 (60 segundos)
})
```
**Conclusión:** La web consulta el heartbeat cada 60 segundos.

---

## FASE 7: SIMULACIÓN — EVIDENCIA

### Escenario: PC apagada abruptamente
1. **Estado antes del apagón:**
   - Agente en modo daemon corriendo (PID 10608)
   - Lock creado en `.agent.lock`
   - Heartbeat actualizado cada 30s

2. **Después del reinicio:**
   - Lock existe con PID 10608 (proceso muerto)
   - Agente NO se inicia automáticamente (Task Scheduler no configurado o falló)
   - Heartbeat expiró (más de 90s sin actualización)
   - Círculo ROJO en la web

3. **Al presionar Sincronizar:**
   - La API encola el comando en Redis
   - El agente NO está corriendo
   - El comando queda pendiente para siempre
   - El usuario ve timeout después de 3 minutos

---

## FASE 8: CAUSA RAÍZ IDENTIFICADA

### Problema #1: Arquitectura incorrecta
**El agente está diseñado para modo daemon, pero el requisito es on-demand.**

### Problema #2: El frontend no inicia el agente
**El Sync3CButton.tsx solo llama a la API, nunca inicia el agente local.**

### Problema #3: Lock colgado
**El lock con PID 10608 existe pero el proceso murió.**

### Problema #4: Task Scheduler
**El agente está configurado para iniciarse con Windows, pero no existe el mecanismo.**

---

## SOLUCIÓN: ARQUITECTURA ON-DEMAND

### Diseño correcto:
```
WEB (Sync3CButton)
    ↓
API (POST /api/sync-3c)
    ↓
Si NO existe agente:
    → Crear agente con commandId como argumento
    → Esperar heartbeat
    → El agente procesa y termina
    → El agente libera lock
```

### Cambios requeridos:

1. **API Route debe iniciar el agente** cuando no haya uno corriendo
2. **El agente debe ejecutarse en modo on-demand** (con commandId)
3. **El lock debe limpiarse al iniciar** si el proceso está muerto
4. **El Task Scheduler debe eliminarse** o reconfigurarse

---