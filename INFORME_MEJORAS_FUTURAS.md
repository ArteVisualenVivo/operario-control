# Informe de Mejoras Futuras - Operario Control

## Fecha: 2026-07-11

---

## 🔴 PROBLEMAS CRÍTICOS DETECTADOS

### 1. APIs sin autenticación

**Archivos afectados:**
- `src/app/api/sync-3c/route.ts` - No tiene autenticación
- `src/app/api/sync-3c/status/route.ts` - No tiene autenticación
- `src/app/api/sync-3c/agent-status/route.ts` - No tiene autenticación

**Riesgo:** Cualquier persona puede iniciar sincronizaciones 3C, consumir cuota de Redis y posiblemente de Firebase.

**Recomendación:** Agregar middleware de autenticación con Firebase Auth o API Key.

---

### 2. Redis sin manejo robusto

**Archivos afectados:**
- `sync-agent/agent.ts` - No tiene retry ni circuit breaker

**Problemas detectados:**
- Si Redis falla, el agente se cae sin reintentos
- No hay timeout en las operaciones de Redis
- No hay fallback a memoria local para comandos pendientes

**Recomendación:** Implementar:
- Retry con exponential backoff
- Circuit breaker pattern
- Queue local como fallback

---

### 3. AutoHotkey sin validación

**Archivos afectados:**
- `automation/sync_common.ahk` - No valida coordenadas
- `automation/sync_3c.ahk` - No valida existencia de ventana 3C
- `automation/sync_reparaciones.ahk` - No valida coordenadas

**Problemas detectados:**
- Si 3C no está abierto, el script falla
- Si las coordenadas cambian, el script hace clics incorrectos
- No hay verificación de foco de ventana

**Recomendación:** Agregar:
- Verificación de existencia de proceso 3C antes de ejecutar
- Validación de coordenadas con detección de pantalla
- Timeout y reintentos en cada paso

---

### 4. Parser Excel sin validación

**Archivos afectados:**
- `src/lib/sync-3c/parser.ts` - No valida estructura de archivo

**Problemas detectados:**
- Si el archivo Excel no tiene el formato esperado, puede fallar
- No hay validación de columnas requeridas
- No hay manejo de errores de parsing

**Recomendación:** Agregar:
- Validación de estructura de archivo (columnas requeridas)
- Manejo de errores con mensajes claros
- Logging de filas inválidas

---

## 🟡 OPTIMIZACIONES APLICADAS

### FASE 1: Sync Agent
- **Archivo modificado:** `package.json`
- **Cambio:** Script `sync-agent` ahora apunta a `agent.ts` en lugar de `agent.mjs`
- **Resultado:** El agente inicia correctamente usando `tsx`

### FASE 2: Sincronización stock
- **Archivo:** `src/lib/sync-3c/engine.ts`
- **Estado:** Los logs de `expectedReads` y `performedReads` ya están implementados
- **Nota:** La lógica de búsqueda por código primero, luego por nombre, es correcta

### FASE 3: Reducción de lecturas Firebase
- **Archivo modificado:** `src/components/dashboard/SmartAlertsPanel.tsx`
- **Cambio:** Usa `useRepairs()` en lugar de `getRepairs()` directo
- **Archivo modificado:** `src/services/stockIntelligence.ts`
- **Cambio:** Acepta `repairs` como parámetro opcional para evitar duplicación
- **Archivo modificado:** `src/hooks/useStockIntelligence.ts`
- **Cambio:** Acepta `repairs` como parámetro y lo pasa a `getStockIntelligence()`

---

## 📋 RECOMENDACIONES DE PRIORIDAD

### Alta Prioridad
1. Agregar autenticación a APIs de sync-3c
2. Implementar circuit breaker en Redis
3. Validar estructura de Excel antes de parsear

### Media Prioridad
1. Verificar existencia de 3C antes de ejecutar AHK
2. Agregar retry en operaciones de Redis
3. Implementar cache de códigos en Redis para syncItems

### Baja Prioridad
1. Mejorar logging de errores en AHK
2. Agregar validación de coordenadas
3. Implementar fallback a memoria local

---

## 📊 MÉTRICAS DE CONSUMO

### Estimado actual (por sync)
- `getStockItems()`: 1 lectura (carga completa)
- `getMachines()`: 1 lectura (carga completa)
- `getRepairs()`: 1 lectura (carga completa)
- `getRecentInventoryMovements(30, 200)`: 1 lectura (con limit)
- `syncItems()`: N lecturas (N = items en Excel)

### Recomendación
- Considerar paginación en `getStockItems()` y `getMachines()` si la colección crece > 1000 documentos
- Implementar cache de códigos en Redis para evitar lecturas repetidas en `syncItems()`