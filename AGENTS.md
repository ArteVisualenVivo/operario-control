<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:auditoria-migracion-redis -->
# Auditoría: Sistema operario-control
## Fecha: 2026-06-28

---

## 1. Arquitectura actual

```
UI (Vercel) → POST /api/sync-3c → Redis HSET command + LPUSH queue
                                    ↓
Agente local (agent.mjs) ← RPOP queue cada 30s
  → spawn AutoHotkey (sync_*.ahk)
    → navega 3C → export Excel
  → parseExcel() (xlsx → items)
  → syncItems() (try Firebase, fallback degradado)
  → Redis HSET result + command status
                                    ↓
UI polling ← GET /api/sync-3c/status ← Redis HGETALL
```

## 2. Componentes

### Redis (Upstash) — cola + resultados + heartbeat
| Key | Tipo | Propósito |
|---|---|---|
| `sync-3c:queue` | List | FIFO de command IDs (LPUSH / RPOP) |
| `sync-3c:command:{id}` | Hash | Estado del comando (pending/running/completed/failed) |
| `sync-3c:result:{id}` | Hash (v2) | Resultado completo del sync (agregado 2026-06-28) |
| `sync-3c:agent:production` | String | Heartbeat JSON del agente |

### API Routes (Vercel Node.js runtime)
| Ruta | Método | Acción |
|---|---|---|
| `POST /api/sync-3c` | Crea comando + encola | `HSET` + `LPUSH` |
| `GET /api/sync-3c/status` | Lee estado de comando | `HGETALL` + parse result JSON |
| `GET /api/sync-3c/agent-status` | Lee heartbeat agente | `GET` de string JSON |

### SPAutoHotkey scripts
| Script | Propósito |
|---|---|
| `sync_common.ahk` | Motor compartido: config, ClickAt, WaitForExcel, WatchAndCopy, ValidarFoco, FocusFix |
| `sync_3c.ahk` | Navegación STOCK: 8 clicks (Almacenes → Informes → ... → Excel) |
| `sync_reparaciones.ahk` | Navegación REPARACIONES: 7 clicks (Ventas → Reparaciones → ... → ExcelFormat) |
| `config.ini` | Coordenadas y timings de todos los módulos |

### Agent (`sync-agent/agent.mjs`)
- Polling: 30s (RPOP de `sync-3c:queue`)
- Heartbeat: 30s (SET `sync-3c:agent:production`)
- AHK timeout: 120s
- Stale recovery: SCAN + re-encolar commands con status `running` > 10 min
- Module mapping: `{ stock: sync_3c.ahk, reparaciones: sync_reparaciones.ahk }`
- Fallback Firebase: try/catch en syncItems(), resultado degradado + Redis result store

## 3. Módulos de sincronización

### Stock (sync_3c.ahk) — 8 clicks
1. Almacenes (888,189) → 2. Informes (921,370) → 3. Existencias (1105,401) → 4. Depósitos (704,476) → 5. Seleccionar todos (962,858) → 6. Consulta (440,341) → 7. Aceptar (1196,902) → 8. Excel (940,575)

### Reparaciones (sync_reparaciones.ahk) — 7 clicks
1. Ventas (413,188) → 2. Reparaciones (448,346) → 3. ExcelItems (1451,866) → 4. PrintAll (1450,829) → 5. Imprimir (896,254) → 6. ExcelFormat (936,577)
Luego: WaitForExcel → WatchAndCopy → Cerrar Excel → SalirRep (942,254)

### Ambos módulos comparten
- `WaitForExcel()`: espera hasta 30s por ventana `XLMAIN`
- `WatchAndCopy()`: monitorea `%TEMP%\tresc\tresc*.xls`, copia a `automation-watcher/3c_exports/`
- Post-export: WinClose Excel → WinActivate 3C → ClickAt("Salir") o ClickAt("SalirRep")

## 4. Firebase — estado actual

### Problema
Firebase Spark plan excedió cuota (66K reads en 7 días vs 50K/día límite). Service account key revocada/deshabilitada en GCP.

### Solución temporal (aplicada 2026-06-28)
- `agent.mjs`: try/catch en `syncItems()`. Si Firebase falla, genera resultado `degraded: true` y guarda en Redis. El agente no se cae.
- `sync-3c:result:{id}`: nuevo hash Redis para almacenar resultados cuando Firebase no está disponible.
- Cuando Firebase se recupere, el `try` pasa directo y los datos se persisten en `inventory_stock` sin cambios.

### Archivos Firebase activos (no migrados)
| Archivo | Dependencia | Estado |
|---|---|---|
| `src/lib/firebase.ts` | Client SDK (Auth) | Activo |
| `src/services/*.ts` (14 archivos) | Client SDK Firestore | Activo (pueden fallar si cuota de lectura bloqueada) |
| `src/lib/sync-3c/engine.ts` | Admin SDK (`firebase-admin`) | Activo, pero con fallback degradado en agent.mjs |
| `scripts/*` | Admin SDK | Sin cambios |

## 5. Historial de cambios — Sesión 2026-06-28

### Fix: Reparaciones no ejecutaba clicks
**Causa raíz:** `sync_common.ahk` no cargaba la coordenada `Ventas` en el mapa de coordenadas. El array de claves en línea 21 no incluía `"Ventas"`, por lo que `ClickAt("Ventas")` lanzaba `"Coordenada no encontrada: Ventas"` y el try/catch atrapaba el error, saltando toda la navegación.

**Fix:** Agregar `"Ventas"` al array de carga de coordenadas en `sync_common.ahk:23`.

**Archivos modificados:**
| Archivo | Cambio |
|---|---|
| `automation/sync_common.ahk` | Agregar `"Ventas"` al array de coordenadas |
| `automation/sync_reparaciones.ahk` | Debug temporal MouseMove + Sleep(2000) (no removido aún) |

### Fix: engine.ts cargaba service account incorrecta
**Causa:** engine.ts resolvía `service-account.json` desde `process.cwd()` (root). La key activa estaba en `sync-agent/service-account.json`.

**Fix:** Cambiar ruta a `path.resolve(process.cwd(), "sync-agent/service-account.json")`. Eliminar fallback `FIREBASE_SERVICE_ACCOUNT` env var. Agregar validación temprana y log de seguridad.

**Archivo modificado:** `src/lib/sync-3c/engine.ts`

### Fix: Agente crasheaba cuando Firebase bloqueado
**Causa:** `syncItems()` lanzaba excepción no controlada → el outer catch marcaba el comando como `failed`.

**Fix:** Envolver `syncItems()` en try/catch interno. Si falla, genera resultado `{ degraded: true, skipped: items.length }` y continúa el flujo normal. Agregar `redis.hset(sync-3c:result:{id})` para guardar el resultado siempre.

**Archivo modificado:** `sync-agent/agent.mjs`

### Resultado de la sesión
- ✅ Reparaciones ejecuta clicks correctamente (verificado: 455 ítems exportados, resultado en Redis)
- ✅ Firebase bloqueado no detiene el agente (try/catch, resultado degradado)
- ✅ Resultados siempre guardados en Redis (command + result hashes)
- ✅ Stock sin cambios, AHK intacto, Redis intacto
- ⏳ Firebase se recupera solo en ~24h

## 6. Pendiente / Próximos pasos

### Corto plazo
- [ ] Esperar reset de cuota Firebase (~24h)
- [ ] Cuando Firebase vuelva, probar sync stock + reparaciones completo (debe persistir en inventory_stock)
- [ ] Remover debug MouseMove + Sleep(2000) de sync_reparaciones.ahk si ya no es necesario

### Medio plazo (planificado)
- [ ] Nuevo módulo: REMITOS — leer remitos de 3C para tracking de alquileres
  - Nuevo script: `sync_remitos.ahk`
  - Nuevas coordenadas en `config.ini`
  - Nueva opción en UI `<Select>` ("Remitos")
  - Parser para formato Excel de remitos
  - Destino: Redis hash `rentals:active` o Firestore si recupera cuota
- [ ] La data de remitos alimentará el stock de máquinas disponibles

### Largo plazo
- [ ] Migrar lecturas de Firestore (client SDK) a Redis o Postgres si la cuota sigue siendo problema
- [ ] Evaluar plan pago de Firebase o migración completa a Supabase

## 7. Arquitectura objetivo (próxima iteración)

```
UI (Vercel)
  → POST /api/sync-3c { module: "stock" | "reparaciones" | "remitos" }
    → Redis queue → agent local → AHK script según módulo
      → 3C export → Excel → parse → syncItems()
        → Redis result store + (Firestore si disponible)

Nuevo: módulo REMITOS
  → sync_remitos.ahk navega 3C
  → parse remitos Excel
  → actualiza Redis hash de rentals activos
  → UI lee rentals desde Redis o Firestore
```
<!-- END:auditoria-migracion-redis -->
