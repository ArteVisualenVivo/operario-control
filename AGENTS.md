<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:auditoria-migracion-redis -->
# Auditoría: Migración de cola sync-3c de Firestore a Redis (Upstash)
## Fecha: 2026-06-28

## Problema original
Firebase Spark (plan gratuito) bloqueó el proyecto con `8 RESOURCE_EXHAUSTED` por superar 50K lecturas/día en Firestore.

## Solución implementada
Reemplazar Firestore por Redis (Upstash) como backend de cola de comandos sync-3c y estado del agente. Firestore se conserva solo para frontend Auth (client SDK) y para `inventory_stock` (engine.ts).

## Cambios realizados

### Dependencias
- `npm install @upstash/redis` — SDK para Redis REST API

### API Routes (Vercel) — migradas de Firestore a Redis

| Ruta | Antes | Después |
|---|---|---|
| `POST /api/sync-3c` | `docRef.set()` en Firestore | `HSET sync-3c:command:{id}` + `LPUSH sync-3c:queue {id}` |
| `GET /api/sync-3c/status` | `doc.get()` en Firestore | `HGETALL sync-3c:command:{id}` |
| `GET /api/sync-3c/agent-status` | `doc.get()` en Firestore (`sync-3c-agent/production`) | `GET sync-3c:agent:production` (JSON string) |

### Agent (`sync-agent/agent.mjs`) — reescrito sin Firestore
- Eliminado `getDb()` (Firebase Admin init), reemplazado por `getRedis()`
- Eliminado `processNextPending()` (Firestore transaction FIFO), reemplazado por `pollQueue()` (RPOP atómico)
- Eliminado `AGENT_DOC_REF`, `COMMANDS_COLLECTION`, `STALE_THRESHOLD_MINUTES`
- `claimAndExecute()` → `processCommand()`: lee/escribe en Redis hashes
- `recoverStaleCommands()`: usa `SCAN` + `HGETALL` en vez de Firestore query
- `startHeartbeat()`: escribe en `sync-3c:agent:production` (JSON) en vez de Firestore doc
- `pollForCommands()`: polling cada 30s con `RPOP` (mantiene mismo período)
- `runAhk()`, `waitForExport()`, `findLatestExport()`, `findAhkExe()`, `parseExcel()`, `syncItems()` — sin cambios

### Estructura Redis

```
sync-3c:queue                    → List (LPUSH / RPOP) — IDs de comandos
sync-3c:command:{id}             → Hash — module, status, createdAt, startedAt, completedAt, agent, result (JSON), error
sync-3c:agent:production         → String (JSON) — status, machineName, lastHeartbeat
```

### Env vars agregadas
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### No modificados
- AHK: `sync_common.ahk`, `sync_3c.ahk`, `sync_reparaciones.ahk`, `config.ini`
- UI: `Sync3CButton.tsx` (no requiere cambios — los endpoints devuelven misma estructura)
- `parser.ts`, `engine.ts`
- Firestore `inventory_stock` (engine.ts escribe ahí — legacy, puede fallar si Firebase sigue bloqueado)

## Pendiente
- engine.ts escribe en `inventory_stock` (Firestore). Si el proyecto sigue bloqueado, la persistencia del sync falla al final. La cola y control funcionan independientemente.

## Próximos pasos documentados
1. Crear cuenta en Upstash (gratis, sin tarjeta)
2. Copiar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` al `.env.local` y Vercel
3. Hacer deploy a Vercel
4. Probar flujo completo
<!-- END:auditoria-migracion-redis -->
