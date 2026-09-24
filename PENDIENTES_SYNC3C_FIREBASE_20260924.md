# PENDIENTES — Auditoría de consumo Firebase del sync completo (5 módulos)

- **Fecha de la sesión:** 2026-09-24 (aprox. 09:00–09:20 local / 12:00–12:20 UTC)
- **Commit HEAD al cerrar la sesión:** `7b7293e` — `fix(sync-agent): merge incremental del inventoryIndex entre modulos (evita duplicados stock/articulos)`
- **Alcance:** auditoría **SOLO LECTURA** (logs, Redis, Firestore). **No se modificó ningún archivo de código ni de configuración.**
- **Objetivo:** verificar que el consumo de Firebase de la corrida de 5 módulos del 2026-09-24 11:53–11:56Z es razonable, y dictaminar si el patrón de escrituras es esperado o un defecto.
- **Cómo retomar:** leer §1-§2 (estado y veredicto), §3-§4 (los dos hallazgos con evidencia) y elegir ítem en §5 (plan de acción). Las evidencias y los comandos de reproducción están incluidos para no depender de la conversación original.

---

## 1. Estado verificado (todo OK)

| Chequeo | Comando / clave | Resultado |
|---|---|---|
| Cola sin reintentos ni duplicados | `LLEN sync-3c:queue` | `0` |
| Heartbeat del agente presente y fresco | `GET sync-3c:agent:production` | OK |
| Un solo agente corriendo | árboles `node.exe` | 1 (PID `1492` → `14840` → `14912`, iniciado 08:38 local) |
| Fix del autostart duplicado | `.lnk` duplicado movido a `startup-backup\` | aplicado (fuera del repo) |
| Working tree sin cambios de código | `git status --porcelain` | solo artefactos runtime del agente (logs, exports `.xls`, locks, caches) |

### Consumo real medido en la consola de Firebase (día 2026-09-24)

| Métrica | Valor | Límite (Spark) | % |
|---|---|---|---|
| Escrituras | 2,4 K | 20 K/día | **11,8 %** |
| Lecturas | 2 K | 50 K/día | **4,0 %** |
| Eliminaciones | 0 | 20 K/día | 0 % |

**Veredicto: el consumo cuadra con lo que reportó el agente y está dentro de lo esperado** (el sync completo ya no se come ~38 % de la cuota como en la auditoría anterior). El screenshot de Firebase coincide exactamente con la suma de los contadores de `sync-agent/agent.log` (+ lecturas de la UI), así que el método de medición queda validado.

---

## 2. Desglose de escrituras de la corrida 2026-09-24 (11:53–11:56Z)

Fuente: `sync-agent/agent.log` (líneas ~5516-5759). Los timestamps del log son UTC; local = UTC-3.

| Módulo / comando | Log del agente | Escrituras |
|---|---|---|
| `stock` (`77ade4f2-…`) | `7 created, 13 updated, 1408 skipped` | **20** |
| `articulos` (`d250ef1b-…`) | `1 created, 1450 updated, 353 skipped` | **~1.451** |
| `alquileres` (`26cafc74-…`) | `0 created, 0 updated, 0 skipped` | **0** |
| `reparaciones` (`9ed2e181-…`) | `maintenance: 0 updated / 1131 sin cambios` + `0 estado(s) a escribir, 1130 sin cambios` + `Spare parts from MOTIVO_ESTADO_REP: updated=41` | **41** |
| `reparaciones_facturadas` (`50cbc0cc-…`) | `867 estado(s) a escribir, 2663 sin cambios` + `Consolidado: 1131 órdenes` | **~867** |
| **Total** | — | **≈2.379** ✅ cuadra con Firebase |

Lecturas: `1.415` (una sola `collection.get()` del índice compartido para `stock` + sus `inventory_stock`) y `~355` para `articulos` (índice incremental: lee sólo los códigos faltantes) ⇒ ≈1.77K + lecturas de UI ≈ 2K. ✅

**Conclusión:** el 61 % de las escrituras (1,451) las hace el paso `articulos`, y el 36 % (867) el paso `reparaciones_facturadas`. Ninguno de los dos es "trabajo nuevo real".

---

## 3. Hallazgo A — `articulos` escribe con el motor de STOCK y pisa el stock con 0

### Qué pasa
El paso `articulos` parsea el catálogo con `parseArticulos()`, que **no trae cantidades** y por diseño devuelve `stockTotal: 0`
(`src/lib/sync-3c/parser.ts:245` → `stockTotal: 0, // el catálogo no trae stock; el stock real lo aporta el módulo STOCK`).

Pero ese resultado se persiste con el escritor genérico `syncItems()`, no con el escritor *catalog-aware*:

- `sync-agent/agent.ts:1319` → `const parsed = module === "articulos" ? parseArticulos(buffer) : parseExcel(buffer)`
- `sync-agent/agent.ts:1353` → `result = await syncItems(items, undefined, inventoryIndex)`  ← **misma ruta para stock y para articulos**
- El payload de `syncItems()` incluye los campos de existencias (`src/lib/sync-3c/engine.ts:283-296`):
  `stockTotal: item.stockTotal`, `stockAvailable: item.stockTotal`, `stockRented: 0`, `deposito: item.deposito` …
  con `{ merge: true }` sobre el doc existente (`engine.ts:324`).
- Existe ya un escritor correcto — `writeStockItemsIdempotent(items, "articulos")` en `src/lib/sync-3c/firestoreSync.ts:14-91`, que con
  `const isCatalog = module === "articulos" || …` (`firestoreSync.ts:41`) **omite** `stockTotal/stockAvailable/deposito` (`firestoreSync.ts:53-57`) —
  pero **no se usa**: sólo está importado en `sync-agent/agent.ts:16` (sin llamadas; el único uso histórico estaba en un OUTBOX ya eliminado, visible en `_agent_diff.txt:298`).

### Evidencia medida (Firestore, sólo lectura)
- Muestra de **25/25** docs escritos en la ventana exacta del paso artículos (`updatedAt` ≈ `2026-09-24T11:54:20Z`):
  **`deposito: 1`** (campo del Excel de existencias) + **`stockTotal: 0`** + `stockRented: 0`, y **`codigo` == descripción** del artículo.
- `inventory_stock` completo: **sólo 399 de 3.181 docs** tienen `stockTotal > 0`, mientras que Redis/Excel tiene 1.428 ítems (694 con stock > 0).
- Caso testigo `BALDE DP`: Redis/Excel = **829** unidades → el doc de Firestore quedó en **0** con `updatedAt 11:54:20.455Z` (justo la ventana de `articulos`).

### Impacto
1. **Cuota:** ~1.451 escrituras por corrida (7,2 % del límite diario). Con 1-2 corridas/día se lleva ~7-15 % sólo en reescribir el catálogo.
2. **Integridad:** la copia Firestore de `inventory_stock` queda con **stock en 0** y `codigo` = descripción en los docs que sí tenían existencias.
   Hoy la web **no** lo muestra porque lee primero Redis primario (`src/services/inventoryStock.ts:112-140`, `loadPrimaryStock()` → gana `stock` sobre `articulos`),
   pero el **fallback** Firestore (`inventoryStock.ts:140-145`) devolvería 0 si Redis/API no responde.
3. **Efectividad del "unchanged":** el `skip` por comparación de campos (`engine.ts:306-329`) no puede funcionar en `articulos`: el parser devuelve siempre `stockTotal=0`,
   así que cualquier doc con stock real se considera "cambiado" en **todas** las corridas (1450 updated / 353 skipped, estable).

### Fix propuesto (NO aplicado — requiere autorización)
- **Opción 1 (mínima, la preferida):** en `sync-agent/agent.ts:1353`, derivar por módulo:
  `module === "articulos" ? await writeStockItemsIdempotent(items, "articulos") : await syncItems(items, undefined, inventoryIndex)`
  y mapear su resultado a `Sync3CResult` (la función ya devuelve `void`, así que habría que devolver contadores o loguear aparte).
- **Opción 2 (más quirúrgica):** agregar una opción `{ skipStockFields: true }` a `SyncEngineOptions` y que `syncItems()` no incluya
  `stockTotal/stockAvailable/stockRented/deposito` en el payload cuando el origen es el catálogo.
- **Efecto esperado:** `articulos` pasa a escribir sólo metadatos de catálogo (familia, marca, precio, codBarra…) → de ~1.451 a ~0-20 escrituras por corrida
  y el "unchanged" empieza a funcionar de verdad. Total del sync: ≈2.379 → ≈**950 escrituras (~4,7 % de la cuota)**.
- **Precaución:** verificar antes con una corrida que Firestore conserve `stockTotal` (probar `BALDE DP` = 829 después del cambio) y que
  `deposito` no quede desactualizado para los ítems que sólo aparecen en el catálogo.
- **Ítem relacionado (opcional):** `parseArticulos()` arma el código con `cols.get("idd") ?? cols.get("articulo")` (`parser.ts:209`),
  o sea que si no detecta la columna `IDD` cae a la **descripción** → por eso los docs quedan con `codigo` = nombre y sólo matchean por nombre.
  Arreglar la detección de `IDD` haría que `articulos` matchee por código real (y permitiría fusionar catálogo + stock de forma estable).

---

## 4. Hallazgo B — `reparaciones_facturadas` reescribe 867 docs con un conjunto **idéntico** en cada corrida

### Qué pasa
El paso `reparaciones_facturadas` decide qué escribir comparando contra la línea base de estados:

- `sync-agent/agent.ts:905` → `const previousByOrder = await readStatusBaseline(redis)`
- `sync-agent/agent.ts:920` → `if (!statusDiffers(previousByOrder.get(r.orderNumber), entry)) { unchanged++; continue }`
- `sync-agent/agent.ts:927-930` → log `[AGENT] Mantenimiento: N estado(s) a escribir, M sin cambios (omitidos para no gastar cuota)`
- `sync-agent/agent.ts:932-934` → `writeMaintenanceStatusesIdempotent(changed)` (merge por doc id = N° de orden)
- Claves de línea base: `sync-3c:data:maintenance:status-baseline` (`agent.ts:786`) y `…:row-baseline` (`agent.ts:793`).

### Evidencia
- Log de **dos corridas consecutivas** con el **mismo número exacto**: `867 estado(s) a escribir, 2663 sin cambios`
  (`agent.log` 2026-09-23T20:47:34Z y 2026-09-24T11:55:55Z).
- La línea base en Redis tiene **1.130 entradas**, pero el paso compara **3.530 filas** (2663 + 867) y el consolidado final son **1.131 órdenes**.
  ⇒ Se cuenta por **fila** mientras la línea base es por **orden** (`allStatuses.set(r.orderNumber, …)`, `agent.ts:919`): varias filas por orden, "gana" la última.
  Si el orden de las filas (o el archivo que aporta el "último estado") cambia entre corridas, un subconjunto estable de filas nunca matchea la línea base
  y se reescribe siempre el mismo valor → 867 escrituras/día que no cambian nada.

### Cómo diagnosticarlo antes de tocar nada (read-only)
1. Instrumentar temporalmente el bucle de `agent.ts:910-925` para loguear la **primera** entrada que difiere (`orderNumber`, `entry` vs `previousByOrder.get(orderNumber)`),
   y el tamaño de `records` vs `allStatuses.size`. Si el diff es de filas repetidas de la misma orden → confirmado el problema de granularidad.
2. Revisar `buildConsolidatedOrders()` (`src/lib/sync-3c/consolidated.ts`) para ver si emite una fila por **renglón/evento** en vez de una por orden.
3. Alternativa de bajo riesgo sin instrumentar: comparar en Redis `…:status-baseline` (1.130) contra el `recordCount` de `sync-3c:data:maintenance` y contra
   las órdenes del último Excel de facturadas.

### Dirección del fix propuesto (NO aplicado — requiere autorización)
- Comparar y guardar la línea base **por orden con el valor final** (el "último estado" seleccionado), no por fila individual: mover el conteo de
  `changed/unchanged` a un `Map<orderNumber, entry>` único antes del bucle, o deduplicar `records` por `orderNumber` tomando la fila de estado más reciente.
- Efecto esperado: de ~867 a ~0-10 escrituras por corrida en régimen estable (sólo órdenes que realmente cambiaron de estado).
- **No tocar** `writeMaintenanceStatusesIdempotent()` ni la semántica de "se llega a la línea base sólo tras commit OK" (`agent.ts:935-937`, 948-950): ese diseño evita huecos y no debe perderse.

---

## 5. Plan de acción sugerido (orden y riesgo)

| # | Ítem | Archivos | Riesgo | Ganancia | Verificación |
|---|---|---|---|---|---|
| 1 | **Hallazgo B** (867 repetidas): deduplicar por orden la comparación de estados | `sync-agent/agent.ts` (905-937) | Bajo-medio | −867 escrituras/corrida | una corrida: log `0 estado(s) a escribir` en régimen estable |
| 2 | **Hallazgo A** (artículos pisa stock): persistir catálogo sin campos de stock | `sync-agent/agent.ts:1353` (+ `firestoreSync.ts` ya listo) | Medio | −1.400 escrituras/corrida | `BALDE DP` sigue en 829 en Firestore tras el sync |
| 3 | (Opcional) detección de columna `IDD` en el catálogo | `src/lib/sync-3c/parser.ts:209` | Medio | datos correctos (`codigo` = código real) | docs con `codigo` numérico/IDD y match por código |
| 4 | Limpieza de artefactos sin trackear (ver §6) | raíz / `sync-agent` | Nulo | orden | `git status` limpio salvo runtime |

Si se aplican 1+2: el sync completo pasaría de ≈2.379 a ≈**950 escrituras** (~11,8 % → ~4,7 % de la cuota diaria).

---

## 6. Artefactos y limpieza pendiente (no se tocó nada)

Untracked en el repo al cerrar la sesión (borrar **sólo con OK del usuario**):

- Raíz: `_agent_diff.txt`, `agent_diff_preview.txt`, `diff_agent.txt`, `diff_preview.txt`, `tsc_out.txt`
- `sync-agent/`: `agent-manual.log`, `agent-manual.err`, `agent.err`
- `startup-backup/` — carpeta creada al sacar el `.lnk` duplicado del autostart (contiene el acceso directo viejo). **Conservar** hasta confirmar que el arranque único es estable.
- Ruido normal de runtime (no borrar): `automation-watcher/3c_exports/*.xls`, `automation-watcher/cache/*.json`, `automation/logs/sync_2026*.log`, `sync-agent/agent.log`, `sync-agent/.agent.lock`, `automation/logs/last_status.ini`.

No quedan archivos `audit_tmp_*` (los temporales de sesiones anteriores ya no están).

---

## 7. Guardrails de la próxima sesión

1. **No cambiar** el flujo de cuota/fallback: `syncItems()` dentro de `try/catch` (`agent.ts:1352-1400`) y `saveModuleData()` a Redis siempre (degradado incluido).
2. **No reintroducir colas de reintento** de Firestore: se quitaron a propósito el 2026-09-23 (`cac4ea5`, `agent.ts:948-950`).
3. **Mantener** el `inventoryIndex` compartido/incremental entre módulos (`7b7293e`) — es lo que bajó las lecturas a ~2K.
4. Cualquier cambio de escritura debe validarse con: `git status`, una corrida real, y comparación de los contadores del log vs. consola de Firebase.
5. Ejecutar el agente con **un solo** proceso (verificar árbol `node.exe` antes de correr).

---

## 8. Cómo reproducir la evidencia (read-only)

**Redis (Upstash REST)** — ojo: `.env.local` tiene los valores entre comillas dobles, hay que quitarlas:

```powershell
$url=(Select-String -Path .env.local -Pattern '^UPSTASH_REDIS_REST_URL=').Line  -replace '^[^=]+=','' -replace '"',''
$tok=(Select-String -Path .env.local -Pattern '^UPSTASH_REDIS_REST_TOKEN=').Line -replace '^[^=]+=','' -replace '"',''
$payload=@('LLEN','sync-3c:queue') | ConvertTo-Json -Compress        # ó @('GET','sync-3c:agent:production')
Invoke-RestMethod -Uri $url -Method Post -Headers @{Authorization=('Bearer '+$tok)} -Body $payload
```

Contar entradas de una línea base:

```powershell
$payload=@('GET','sync-3c:data:maintenance:status-baseline') | ConvertTo-Json -Compress
$o=(Invoke-RestMethod -Uri $url -Method Post -Headers @{Authorization=('Bearer '+$tok)} -Body $payload).result
($o | ConvertFrom-Json).PSObject.Properties.Name.Count              # 2026-09-24 → 1130
```

**Firestore** — usar el Admin SDK **modular** (no `admin.initializeApp` default export) y la service account activa en `sync-agent/service-account.json`:

```js
const { initializeApp, cert, getApps } = require("firebase-admin/app")
const { getFirestore } = require("firebase-admin/firestore")
const sa = require("./sync-agent/service-account.json")
initializeApp({ credential: cert(sa) })
const db = getFirestore()
// conteo por agregación (1 lectura, no 3.181)
await db.collection("inventory_stock").where("stockTotal", ">", 0).count().get()
// caso testigo
await db.collection("inventory_stock").where("codigo", "==", "BALDE DP").limit(3).get()
```

**Log del agente** (líneas clave de la corrida auditada):

```powershell
Select-String -Path sync-agent\agent.log -Pattern 'estado\(s\) a escribir|Consolidado:|created|Skipped'
```

---

## 9. Pendientes heredados (sin cambios en esta sesión)

- Módulo **REMITOS** (nuevo script `sync_remitos.ahk`, coordenadas en `config.ini`, opción en la UI, parser y destino `rentals:active`) — ver `AGENTS.md` §6-7.
- Migrar lecturas de Firestore (client SDK) a Redis/Postgres si la cuota sigue siendo problema.
- Revisar `automation/sync_reparaciones.ahk`: quedó un `MouseMove` + `Sleep(2000)` de debug (documentado en `AGENTS.md` §5) — remover sólo si ya no hace falta.

---

## 10. Registro de esta sesión

- **Hecho:** verificación read-only del consumo (cola, heartbeat, procesos, logs, Redis, Firestore). **Sin cambios de código ni configuración.**
- **Dictamen:** consumo correcto/bajo (11,8 % escrituras, 4 % lecturas) **pero** 2.318 de las 2.379 escrituras son evitables (Hallazgos A y B de §3 y §4).
- **No aplicado (esperando autorización explícita):** fixes de §3/§4, limpieza de §6, cambios de `parser.ts:209`.
- **Próximo paso al retomar:** confirmar con el usuario cuál ítem del §5 se aplica primero (sugerido: #1 por ser el de menor riesgo y efecto inmediato en el log).


