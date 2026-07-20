# AUDITORÍA COMPLETA DE CONSUMO DE UPSTASH REDIS
## Fecha: 2026-07-20

---

## 1. RESUMEN EJECUTIVO

**PROBLEMA CRÍTICO:** El agente está consumiendo 500,000 requests/mes (límite Upstash) debido a un patrón de polling agresivo con `KEYS` en cada ciclo.

**CAUSA RAÍZ:** `redis.keys("sync-3c:command:*")` se ejecuta cada 5 segundos en el listener, y además en el endpoint POST de creación de comandos.

---

## 2. TODOS LOS LUGARES DONDE SE REALIZAN LLAMADAS A REDIS

### 2.1 sync-agent/agent.ts (Agente local - Listener Service)

| Línea | Comando | Frecuencia | En cada ciclo del listener | ¿Cacheable? | ¿Eliminable? |
|-------|---------|------------|--------------------------|-------------|--------------|
| 319-323 | `hset sync-3c:command:${commandId}` | 1 por comando procesado | Sí (inicio) | No | No |
| 326-330 | `set sync-3c:agent:production` | 1 por comando + heartbeat | Sí (inicio) | No | No |
| 330 | `set sync-3c:agent:production` (heartbeat) | Cada 30s | Sí (heartbeat) | No | No |
| **535** | **`keys sync-3c:command:*`** | **Cada 5s** | **SÍ - ¡CRÍTICO!** | **No** | **SÍ - Reemplazar con SCAN** |
| 540 | `hgetall sync-3c:command:${key}` | 1 por key encontrado | Sí (dentro del loop de keys) | Parcial | No (pero optimizable) |
| 440-445 | `hset sync-3c:result:${commandId}` | 1 por comando completado | Sí (fin) | No | No |
| 448-452 | `hset sync-3c:command:${commandId}` | 1 por comando completado | Sí (fin) | No | No |
| 460-464 | `hset sync-3c:command:${commandId}` (error) | 1 por comando fallido | Sí (error) | No | No |
| 497-501 | `set sync-3c:agent:production` (shutdown) | 1 al cerrar | Sí (shutdown) | No | No |
| 521-525 | `set sync-3c:agent:production` (heartbeat) | Cada 30s | Sí (heartbeat) | No | No |

### 2.2 src/app/api/sync-3c/route.ts (Endpoint POST - Crear comandos)

| Línea | Comando | Frecuencia | En cada ciclo del listener | ¿Cacheable? | ¿Eliminable? |
|-------|---------|------------|--------------------------|-------------|--------------|
| **39** | **`keys sync-3c:command:*`** | **Cada POST** | **No** | **Sí** | **SÍ - Reemplazar con SCAN** |
| 40-41 | `hgetall sync-3c:command:${key}` | 1 por key encontrado | No | Parcial | No (pero optimizable) |
| 59-68 | `hset sync-3c:command:${commandId}` | 1 por módulo en pipeline | No | No | No |

### 2.3 src/app/api/sync-3c/status/route.ts (Endpoint GET - Consultar estado)

| Línea | Comando | Frecuencia | En cada ciclo del listener | ¿Cacheable? | ¿Eliminable? |
|-------|---------|------------|--------------------------|-------------|--------------|
| 26 | `hgetall sync-3c:command:${commandId}` | Cada poll desde UI | No | Sí (con TTL) | No |

### 2.4 src/app/api/sync-3c/agent-status/route.ts (Endpoint GET - Heartbeat agente)

| Línea | Comando | Frecuencia | En cada ciclo del listener | ¿Cacheable? | ¿Eliminable? |
|-------|---------|------------|--------------------------|-------------|--------------|
| 16 | `get sync-3c:agent:production` | Cada poll desde UI | No | Sí (con TTL) | No |

---

## 3. ANÁLISIS DETALLADO DEL CONSUMO

### 3.1 Requests actuales por ciclo del listener (5 segundos)

```
Ciclo del listener (5s):
├── 1x KEYS sync-3c:command:*         ← ¡CRÍTICO! 1 request
├── N x HGETALL sync-3c:command:*     ← N = número de comandos existentes
└── 1x SET sync-3c:agent:production   ← Heartbeat cada 30s (6 ciclos)
```

**Total por ciclo: 1 + N requests**

### 3.2 Requests por minuto

- **Ciclos por minuto:** 60 / 5 = 12 ciclos
- **KEYS por minuto:** 12 requests
- **HGETALL por minuto:** 12 × N (donde N = comandos acumulados)
- **Heartbeat por minuto:** 2 requests (cada 30s)

**Ejemplo con 100 comandos acumulados:**
- KEYS: 12 requests/min
- HGETALL: 12 × 100 = 1200 requests/min
- Heartbeat: 2 requests/min
- **Total: ~1214 requests/min**

### 3.3 Requests por hora

- **KEYS por hora:** 12 × 60 = 720 requests/h
- **HGETALL por hora:** 720 × N requests/h
- **Heartbeat por hora:** 2 × 60 = 120 requests/h

**Ejemplo con 100 comandos:**
- KEYS: 720 requests/h
- HGETALL: 72,000 requests/h
- Heartbeat: 120 requests/h
- **Total: ~72,840 requests/h**

### 3.4 Requests por día

- **Con 100 comandos:** 72,840 × 24 = ~1,748,160 requests/día
- **Límite Upstash:** 500,000 requests/mes ≈ 16,666 requests/día

**¡El consumo actual es ~100x el límite!**

---

## 4. PORCENTAJE DE CONSUMO POR OPERACIÓN

| Operación | Requests/día (estimado) | % del total |
|-----------|------------------------|-----------|
| **KEYS sync-3c:command:\*** | **720** | **0.04%** |
| **HGETALL sync-3c:command:\*** | **~1,747,440** | **99.96%** |
| SET sync-3c:agent:production | 120 | <0.01% |
| HSET (escritura) | ~10-50 | <0.01% |

**Mayor consumidor: HGETALL dentro del loop de KEYS**

---

## 5. ¿QUIÉN EJECUTA `KEYS` Y POR QUÉ?

### 5.1 Ubicaciones de `KEYS`

1. **sync-agent/agent.ts:535** - Listener mode
   - **Frecuencia:** Cada 5 segundos
   - **Propósito:** Buscar comandos pendientes
   - **Problema:** `KEYS` es O(N) y bloquea, no debe usarse en producción

2. **src/app/api/sync-3c/route.ts:39** - Endpoint POST
   - **Frecuencia:** Cada vez que se crea un comando
   - **Propósito:** Verificar si ya existe un comando pendiente
   - **Problema:** Usa KEYS en lugar de un índice más eficiente

### 5.2 ¿Por qué vuelve a pedir los mismos datos?

- El listener NO mantiene estado entre ciclos
- Cada ciclo vuelve a hacer `KEYS *` y luego `HGETALL` de TODOS los comandos
- No hay diferenciación entre comandos ya procesados y pendientes
- Los comandos completados o fallidos permanecen en Redis sin limpieza

### 5.3 ¿Existe polling innecesario?

**SÍ, hay múltiples problemas:**

1. **Polling de 5s es muy agresivo** - podría ser 30s o usar pub/sub
2. **KEYS es anti-patrón** - debe usarse SCAN
3. **HGETALL de todos los comandos** - solo debería revisar pendientes
4. **No hay limpieza de comandos completados** - acumulan indefinidamente

---

## 6. ANÁLISIS DE COMANDOS ACUMULADOS

### 6.1 ¿Se consulta el mismo command varias veces?

**SÍ.** El código actual:

```typescript
// Líneas 535-546 en agent.ts
const keys = await redis.keys("sync-3c:command:*")  // Obtiene TODOS

for (const key of keys) {
    const data = await redis.hgetall<Record<string, unknown>>(key)  // HGETALL de cada uno
    if (data && data.status === "pending") {  // Filtro DESPUÉS
        // ...
    }
}
```

**Problema:** HGETALL se ejecuta en TODOS los comandos, no solo en pendientes.

---

## 7. PROPUESTA DE SOLUCIÓN - MENOR CONSUMO POSIBLE

### 7.1 Solución inmediata (sin código aún)

#### Opción A: Usar SCAN en lugar de KEYS (recomendado)

```
Cambio: KEYS → SCAN
- KEYS: 1 request pero O(N) y bloqueante
- SCAN: 1-N requests pero no bloqueante y paginado
```

#### Opción B: Usar lista FIFO (LPUSH/RPOP) - ARQUITECTURA RECOMENDADA

**Patrón actual (problemático):**
```
POST /api/sync-3c → HSET command + KEYS para verificar duplicados
Listener → KEYS * + HGETALL * cada 5s
```

**Patrón propuesto (mínimo requests):**
```
POST /api/sync-3c → LPUSH sync-3c:queue + HSET command
Listener → RPOP sync-3c:queue (1 request cada 5s)
```

### 7.2 Tabla de comparación de arquitecturas

| Arquitectura | Requests/ciclo | Requests/hora | Requests/día |
|--------------|----------------|---------------|--------------|
| **Actual (KEYS + HGETALL)** | 1 + N | 720 + 720N | 17,280 + 17,280N |
| **SCAN + filtro** | 1-N + N | 720-N + 720N | 17,280-N + 17,280N |
| **LPUSH/RPOP (recomendado)** | **1** | **720** | **17,280** |
| **LPUSH/RPOP + heartbeat** | 1-2 | 1,440 | 34,560 |

### 7.3 Cambios que reducirían el consumo

| Cambio | Requests ahorrados/día | Impacto |
|--------|------------------------|---------|
| 1. **Reemplazar KEYS con RPOP de lista** | ~1,747,000 | **CRÍTICO** |
| 2. **Eliminar HGETALL de todos los comandos** | ~1,747,000 | **CRÍTICO** |
| 3. **Usar SCAN en lugar de KEYS** | ~700 | Moderado |
| 4. **Reducir polling de 5s a 30s** | ~57,600 | Alto |
| 5. **Limpiar comandos completados** | Variable | Moderado |
| 6. **Cache de estado en memoria** | ~1,747,000 | **CRÍTICO** |

---

## 8. RECOMENDACIÓN: ARQUITECTURA LPUSH/RPOP

### 8.1 Flujo propuesto

```
1. UI llama POST /api/sync-3c { module: "stock" }
2. API crea HSET sync-3c:command:{id} { status: "pending", module }
3. API hace LPUSH sync-3c:queue {id}
4. Listener hace RPOP sync-3c:queue (1 request cada 5s)
5. Si hay commandId, procesa y actualiza HSET
6. Si no hay commandId, espera 5s y reintenta
```

### 8.2 Ventajas

- **1 request por ciclo** en lugar de 1 + N
- **No necesita KEYS** - operación eliminada
- **No necesita HGETALL masivo** - solo del command procesado
- **Escalable** - el número de comandos no afecta el consumo
- **Patrón estándar** - cola FIFO de Redis

### 8.3 Implementación mínima

**Cambios requeridos:**

1. `src/app/api/sync-3c/route.ts`:
   - Eliminar `keys` y `hgetall` de verificación
   - Agregar `lpush sync-3c:queue`

2. `sync-agent/agent.ts`:
   - Eliminar `keys` y loop de `hgetall`
   - Reemplazar con `rpop sync-3c:queue`
   - Hacer `hgetall` solo del command obtenido

---

## 9. CONCLUSIÓN

### 9.1 Requests actuales vs límite

| Métrica | Actual | Límite Upstash | Ratio |
|---------|--------|----------------|-------|
| Requests/día | ~1,748,000 | 16,666 | **104x** |
| Requests/hora | ~72,840 | 694 | **105x** |

### 9.2 Mayor consumidor

**HGETALL masivo dentro del loop de KEYS** - 99.96% del consumo

### 9.3 Solución con menor consumo

**Arquitectura LPUSH/RPOP** - reduce de ~1,748,000 a ~17,280 requests/día (100x menos)

---

## 10. PRÓXIMOS PASOS

1. **Inmediato:** Implementar LPUSH/RPOP para eliminar KEYS
2. **Corto plazo:** Limpiar comandos completados existentes
3. **Mediano plazo:** Considerar pub/sub con Redis para eliminar polling
4. **Largo plazo:** Evaluar si el heartbeat de 30s es necesario o puede ser 60s