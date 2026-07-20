# Modo Diagnóstico - Análisis de Códigos 3C

## Propósito

Analiza las sincronizaciones de Stock, Artículos y Alquileres para determinar si conviene usar:
- **A) inventoryIndex compartido** (todos los módulos comparten el mismo índice)
- **B) inventoryIndex independiente** (cada módulo carga su propio índice optimizado)

## Criterio de Decisión

- **Overlap > 80%** → Opción A (compartido)
- **Overlap ≤ 80%** → Opción B (independiente)

El overlap se calcula como: `Intersección / Unión`

## Uso

### Prerrequisitos

1. Tener AutoHotkey instalado y en PATH
2. Tener configurado el archivo `.env.local` con:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. Tener 3C abierto y disponible para navegación automática

### Ejecución

```bash
npm run diagnostic
```

O con parámetros específicos:

```bash
npx tsx sync-agent/diagnostic-mode.ts <commandId_stock> <commandId_articulos> <commandId_alquileres>
```

### Ejemplo de Salida

```
[DIAG] ════════════════════════════════════════
[DIAG] MODO DIAGNÓSTICO
[DIAG] ════════════════════════════════════════

[DIAG] Procesando módulo: stock
[DIAG] AHK completed in 45231ms
[DIAG] Export encontrado: 3C_Stock_20260720.xls
[DIAG] stock: 1335 ítems, 1335 códigos únicos

[DIAG] Procesando módulo: articulos
[DIAG] AHK completed in 38921ms
[DIAG] Export encontrado: 3C_Articulos_20260720.xls
[DIAG] articulos: 1328 ítems, 1328 códigos únicos

[DIAG] Procesando módulo: alquileres
[DIAG] AHK completed en 28456ms
[DIAG] Export encontrado: 3C_Alquileres_20260720.xls
[DIAG] alquileres: 412 ítems, 412 códigos únicos

[DIAG] ════════════════════════════════════════
[DIAG] REPORTE DIAGNÓSTICO
[DIAG] ════════════════════════════════════════
[DIAG] Stock........1335
[DIAG] Artículos....1328
[DIAG] Alquileres...412
[DIAG] Unión........1371
[DIAG] Intersección.1298
[DIAG] ════════════════════════════════════════

[DIAG] Decisión: inventoryIndex COMPARTIDO
[DIAG] Ratio de superposición: 94.6%
[DIAG] Criterio: overlap > 80% → compartido (A), independiente (B)

[DIAG] Resultado guardado en Redis key: sync-3c:diagnostic
[DIAG] Diagnóstico completado.
```

## Interpretación de Resultados

### Métricas

- **Stock**: Cantidad de códigos únicos en el módulo Stock
- **Artículos**: Cantidad de códigos únicos en el módulo Artículos
- **Alquileres**: Cantidad de códigos únicos en el módulo Alquileres
- **Unión**: Total de códigos únicos considerando los 3 módulos
- **Intersección**: Códigos que aparecen en los 3 módulos simultáneamente

### Decisión

#### Opción A: inventoryIndex compartido
- **Cuándo**: Overlap > 80%
- **Ventaja**: Una sola lectura de Firestore para todos los módulos
- **Desventaja**: El índice crece con la unión de todos los códigos

#### Opción B: inventoryIndex independiente
- **Cuándo**: Overlap ≤ 80%
- **Ventaja**: Cada módulo carga solo sus códigos (más rápido)
- **Desventaja**: Múltiples lecturas a Firestore

## Almacenamiento de Resultados

Los resultados se guardan en Redis con la key `sync-3c:diagnostic`:

```json
{
  "stock": "1335",
  "articulos": "1328",
  "alquileres": "412",
  "union": "1371",
  "intersection": "1298",
  "overlapRatio": "0.946",
  "decision": "A",
  "timestamp": "1710000000000"
}
```

## Notas

- El modo diagnóstico **no** guarda datos en Firestore
- Solo analiza los códigos de los archivos Excel exportados
- Se puede ejecutar las veces que sea necesario
- Los comandos de Redis se marcan con `diagnostic: "true"` para identificación