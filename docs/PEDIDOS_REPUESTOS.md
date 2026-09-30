# Pedidos de Repuestos por Orden de Trabajo — Operario Control

**Fecha:** 2026-08-26
**Estado:** implementado

---

## 1. Objetivo

Reemplazar el control manual (en papel) de pedidos de repuestos para órdenes de
trabajo/reparaciones. Cada pedido queda asociado a una orden y permanece como
historial durante todo su ciclo (solicitado → pedido → recibido → utilizado →
cancelado).

## 2. Modelo de datos — Firestore

Colección **top-level `spare_part_orders`** (no subcolección de reparaciones),
para permitir consultas/filtros globales (control semanal), historial
independiente y escalabilidad, coherente con el patrón del proyecto
(`machine_spare_parts`, `stock_movements`).

Documento:

```text
spare_part_orders/{autoId}
  repairId: string          // FK a repairs/{id} (o orderNumber para órdenes 3C)
  orderNumber: string       // label humano (OT-1548), denormalizado
  machineId: string
  machineName: string
  sparePartId?: string      // si referencia machine_spare_parts/{id}
  code: string              // código del repuesto (6205-2RS)
  description: string       // descripción (Rodamiento)
  unit: string              // "unidad"
  quantityRequested: number
  quantityReceived: number
  quantityUsed: number
  status: "SOLICITADO" | "PEDIDO" | "RECIBIDO" | "UTILIZADO" | "CANCELADO"
  supplier?: string
  requestedAt: Date
  receivedAt?: Date
  usedAt?: Date
  notes?: string
  createdAt: Date
  updatedAt: Date
```

Índices recomendados (console Firebase): `status` (simple), `orderNumber`
(simple), `machineId` (simple), `requestedAt` desc (simple). La query de la
pantalla general usa `orderBy("requestedAt","desc")` y la de reparación
`where("repairId","==") + orderBy("requestedAt","desc")`.

## 3. Estados

- **SOLICITADO** — pedido creado, todavía no realizado al proveedor.
- **PEDIDO** — pedido realizado al proveedor; todavía no llegó.
- **RECIBIDO** — llegó (parcial o total); pendiente de utilización.
  RECIBIDO ≠ UTILIZADO (estados distintos).
- **UTILIZADO** — colocado/utilizado en la reparación.
- **CANCELADO** — cancelado; se conserva en el historial (no se borra).

La transición RECIBIDO→UTILIZADO admite cantidades parciales: el estado queda
`RECIBIDO` mientras `quantityUsed < quantityReceived` y pasa a `UTILIZADO`
cuando `quantityUsed >= quantityReceived`.

## 4. Cantidades y validaciones

Invariantes (validados en `src/services/sparePartOrders.ts`):

```text
quantityUsed     <= quantityReceived
quantityReceived <= quantityRequested
```

- Crear requiere `repairId`, `machineId`, código, descripción y `quantity > 0`.
- `markReceived`: no permite recibir más del saldo pendiente
  (`requested - received`). No permite recibir pedidos CANCELADO/UTILIZADO.
- `markUsed`: no permite usar más del recibido sin usar (`received - used`).
  No permite usar si no hay recepción (`received <= 0`) ni pedido CANCELADO.
- `cancelOrder`: no permite cancelar un pedido UTILIZADO ni ya CANCELADO.
- Los pedidos de la misma orden con el mismo código son independientes
  (cada uno tiene su propio `id`).

## 5. Integración con Inventario / Repuestos

- **PEDIR / SOLICITAR / PEDIDO NO descuentan stock.**
- **RECIBIR** (`markReceived`): si el pedido referencia un repuesto catalogado
  (`sparePartId`), se llama `restockPart(sparePartId, cantidad)` → **entrada** de
  stock + `stock_movements` INGRESO/REPOSICION + audit del repuesto.
- **UTILIZAR** (`markUsed`): si referencia repuesto catalogado, se llama

## 8. Dashboard

**No se agregaron widgets al Dashboard** para no complicar la arquitectura ni
sumar lecturas de Firestore (prioridad operativa). El resumen semanal está en la
propia pantalla de Pedidos de Repuestos.

## 9. Búsqueda global

Se agregó el tipo `pedido` a la búsqueda global (`src/lib/search.ts` +
`GlobalSearchResults.tsx`). El campo `SearchData.sparePartOrders` es opcional y
**no se cablea por defecto en el Dashboard** (para no aumentar lecturas); si se
provee, los pedidos aparecen buscables por código, descripción, orden o máquina.

## 10. Audit log

Se extiende `AuditEntity` en `src/types/audit.ts` con `"spare_part_order"`.
Se registran con `createAuditLog` (mecanismo existente en `audit_logs`):
- `create` → pedido creado.
- `update` → marcar Pedido / Recibido / Utilizado / Cancelado / editar notas.
Cada transición guarda `before`/`after` del documento.

## 11. Archivos creados

- `src/types/sparePartOrder.ts`
- `src/services/sparePartOrders.ts`
- `src/hooks/useSparePartOrders.ts`
- `src/hooks/useAllSparePartOrders.ts`
- `src/components/repairs/SparePartOrderBadge.tsx`
- `src/components/repairs/SparePartOrderDialog.tsx`
- `src/components/repairs/SparePartOrderReceiveUseDialog.tsx`
- `src/components/repairs/SparePartOrderPanel.tsx`
- `src/app/(protected)/spare-part-orders/page.tsx`
- `src/app/(protected)/spare-part-orders/[id]/page.tsx`

## 12. Archivos modificados

- `src/types/index.ts` — export de `sparePartOrder`.
- `src/types/audit.ts` — `AuditEntity` + `spare_part_order`.
- `src/app/(protected)/layout.tsx` — ítem de navegación "Pedidos Rep.".
- `src/app/(protected)/repairs/[id]/page.tsx` — panel de repuestos integrado.
- `src/lib/search.ts` — tipo/sitio `pedido` + campo opcional.
- `src/components/dashboard/GlobalSearchResults.tsx` — ícono/label de pedidos.

## 13. Decisiones técnicas

1. **Colección top-level** en lugar de subcolección por reparación (justificado
   por consultas globales e historial independiente).
2. **Estados SOLICITADO vs PEDIDO separados** para distinguir "todavía no llegó"
   con mayor granularidad de seguimiento.
3. **Repuestos ad-hoc permitidos**: el pedido puede existir sin repuesto
   catalogado; la integración con stock solo aplica cuando existe `sparePartId`.
4. **Sin doble contabilidad**: se reutilizan `restockPart`/`usePart`/`createMovement`
   (no se creó una segunda lógica de stock). El operador debe usar el pedido como
   vía única de "utilizado" para evitar doble EGRESO si además carga `partsUsed`
   en la reparación.

## 14. Limitaciones conocidas

- Las reglas de Firestore **no están versionadas** en el repositorio; la nueva
  colección depende de las reglas existentes de la consola (misma situación que
  el resto del proyecto).
- Requiere crear los índices de la sección 2 en la consola de Firestore.
- `LOCAL_MODE` activo en `.env.local`: en modo local `getRepairs()` devuelve `[]`
  y el listado puede no mostrar pedidos de órdenes hasta desactivarlo en producción.

  `usePart(sparePartId, cantidad)` + `createMovement(EGRESO, REPARACION)` →
  **salida** de stock (mismo mecanismo que ya usa `createRepair`).
- Si el repuesto es **ad-hoc** (sin `sparePartId`, cargado manualmente), el
  pedido existe pero **no** toca stock (no hay dónde aplicar entrada/salida).

## 15. Fechas del circuito de compra (2026-09-24)

Se agregaron **3 fechas elegibles a mano** por repuesto, para seguir el circuito
real de compra semanal (antes sólo existían las de recepción/utilización):

```text
spare_part_orders/{id}
  requestedAt       (3C)  fecha real del estado "A la Espera Repuestos" — la calcula el importador
  ownerRequestedAt  NUEVO  día en que el operario le pidió el repuesto al dueño
  orderedAt                día en que el dueño pidió el repuesto en la casa de repuestos
  receivedAt               día en que el dueño trajo los repuestos
```

- Se cargan desde **4 lugares**, siempre con el mismo componente
  (`src/components/repairs/SparePartOrderDatesEditor.tsx`):
  la pantalla **Pedidos Rep.**, la **hoja de compra impresa** (`/spare-part-orders/print`),
  el panel **Repuestos** de la reparación y el **detalle** del pedido.
- Se guardan con `updateOrderDates(id, input)` (`src/services/sparePartOrders.ts`),
  que escribe **sólo las claves presentes** (`null` borra la fecha), registra el
  cambio en auditoría y **no** toca cantidades ni stock: eso sigue siendo de
  `markReceived()` / `markUsed()`.
- **Regla:** cargar `orderedAt` en un pedido `SOLICITADO`/`PEDIDO` lo pasa a
  `ENCARGADO` (mismo criterio que `markOrdered`), así el resumen, los filtros y
  el anexo "Encargados esta semana" reflejan la realidad.
- La hoja de compra muestra **3** columnas de fecha, una por cada hecho del
  circuito, y ya **no** imprime `Pedido` (fecha de 3C) ni `Entrega`: eran el
  mismo dato que `receivedAt`. Esas fechas de 3C siguen guardadas (se ven en la
  ficha del pedido, "Ver", como "Fecha de pedido (3C)"), pero la **lista** de
  Pedidos Rep. ya **no** tiene la columna "F. pedido": no se usa para decidir
  nada a mano. La fecha sí se sigue usando por dentro para el filtro
  "Atrasados" (más de 7 días sin encargar) y para el rango de fechas del
  buscador.
- Los **3 hechos son distintos** y cada uno tiene su fuente:
  1. `Le pedí al dueño` = `ownerRequestedAt` → botón **Encargar** (día en que el
     operario le encargó el repuesto al dueño).
  2. `Lo pidió en la casa` = `orderedAt` → **calendario "P. repuestero"** de la
     columna "Fechas" (día en que el dueño lo encargó en la casa de repuestos).
  3. `Me lo trajo` = `receivedAt` → botón **Recibir**.
  Antes el botón Encargar y el calendario "P. repuestero" escribían el MISMO
  campo (`orderedAt`), así que no podían ser fechas distintas; ahora el botón
  guarda en `ownerRequestedAt` y el calendario en `orderedAt`.
- Las tres fechas se ven en la pantalla de Pedidos Rep. (renglón bajo el Estado:
  `enc` / `repuestero` / `traído` / `retiro`) y en la hoja impresa.
- La columna "Fechas" de Pedidos Rep. tiene los **3 calendarios, para CORREGIR a
  mano** lo que haya salido mal al apretar un botón (no hay duplicación: cada uno
  corresponde al mismo hecho que su botón): `P. dueño` = `ownerRequestedAt` (la
  fecha del botón **Encargar**), `P. repuestero` = `orderedAt` (el día en que el
  dueño lo pidió en la casa) y `Traído` = `receivedAt` (la fecha del botón
  **Recibir**). También se pueden corregir desde el detalle del pedido
  ("Ver") y desde el panel Repuestos de la reparación.
- También se agregaron los botones **Recibir** / **Utilizar** en la pantalla
  general de Pedidos Rep. (reutilizan `SparePartOrderReceiveUseDialog`), para
  cargar cantidad + fecha sin entrar a la orden de trabajo.
- Los 3 campos nuevos se mapean en `docToOrder`, `rawToOrder` y `orderToPlain`
  (Firestore, snapshot de Redis y caché en disco): sin eso el dato se perdía al
  republicar el snapshot del agente.

## 16. Fecha del pedido: NUNCA se rejuvenece (2026-09-30)

**Bug medido:** el 30/09/2026, 45 de 47 pedidos tenían `requestedAt` = **30/09**
aunque se habían creado el 19/09, 24/09 y 25/09.

- **Causa:** 3C **no** informa la fecha del cambio de estado, así que
  `resolveWaitingStatusDate` devuelve el día en que el sync bajó el Excel con el
  estado "A la Espera Repuestos" (`observedAt`). El importador hacía
  `updates.requestedAt = waitingDate` en **cada** corrida → la fecha de TODOS los
  pedidos pendientes se corría al día del último sync.
- **Efectos colaterales:**
  - El filtro "desde/hasta" no seleccionaba nada: todo caía en "hoy".
  - **Atrasados** (>7 días sin encargar) daba siempre 0.
  - La regla de cierre de 3C (`orderClosure`) miraba estados desde "hoy", así que
    órdenes ya reparadas/entregadas seguían apareciendo (y **reimprimiéndose**).
- **Regla (misma doctrina que `collapseRepeatedStates` en `consolidated.ts`):**
  la PRIMERA vez que se observó un estado es lo más cercano al cambio real. La
  fecha de pedido **nunca se mueve hacia adelante**: entre lo guardado y lo que
  informa el sync de hoy se conserva el **día más viejo**.
- **Reparación automática:** si la fecha ya había quedado pisada (`requestedAt`
  posterior al día de `createdAt`, imposible en una primera observación), se
  devuelve al día de `createdAt`, que es el día en que el pedido apareció. Sólo
  para pedidos **auto-importados** de 3C: los cargados a mano no se tocan nunca.
- **Implementación** (`src/services/sparePartOrders.ts`):
  `requestedAtToStore(order, waitingDate)` + `canonicalLocalDay`, `orderDayKey`,
  `asValidDate`. Devuelve `null` si no hay que escribir (idempotente: sin cambio
  de día no gasta escrituras). Se usa en las **dos** ramas del importador
  (dedupe de la corrida y pedido ya existente).
- **Curación general:** `repairBumpedRequestedDates()` (llamada al final de las
  DOS importaciones) recorre todos los pedidos y devuelve al día de `createdAt`
  los auto-importados con la fecha pisada. Hace falta porque el importador sólo
  visita las órdenes que siguen "A la Espera Repuestos" en el Excel: las que 3C
  ya cerró no se tocaban nunca y seguían figurando como de hoy (por eso volvían
  a imprimirse). No escribe nada si no hay fechas que reparar.
- `isAutoImportedOrder` ahora reconoce **dos** marcas: `"Importado desde Órdenes
  de Reparación (3C)..."` y `"MOTIVO_ESTADO_REP: ..."`. La primera se pierde
  cuando el operario aprieta **Encargar** y carga la casa de repuestos (esas
  notas se reemplazan), con lo cual el pedido dejaba de reconocerse como
  importado y no se le reparaba la fecha.
- **Pantalla:** el rango de fechas del buscador tiene botón **Hoy** (y etiquetas
  "Pedido desde" / "Pedido hasta") para no tener que tipear el rango del día.
- **Fila fantasma corregida:** las altas de una misma corrida guardaban el texto
  `"pending"` como id; si el mismo repuesto volvía a aparecer, la actualización
  apuntaba a un documento inexistente y quedaba **encolada para siempre**,
  publicando además una fila **VACÍA** (sin orden ni repuesto) en la lista y en
  la hoja de compra. Ahora se guarda el **id real** del alta, `applyPendingOrderOps`
  ignora escrituras pendientes que no identifican un pedido,
  `flushPendingOrderWrites` descarta de la cola los residuos con id `"pending"` y
  `isIdentifiableOrder()` filtra esas filas al leer las fuentes locales y al
  publicar el snapshot (una fila sin nº de orden Y sin repuesto no es un pedido).
- **Prefijo `X` del nº de orden:** 3C escribe la misma orden como `X 0001-00010867`
  y `0001-00010867`. El servicio ya ignoraba ese prefijo al deduplicar, pero
  `normOrderKey()` de `orderClosure.ts` (que busca el registro de 3C para aplicar
  la regla de cierre) no lo hacía: en un pedido guardado sin la `X` la búsqueda
  fallaba y la orden **nunca** se daba por cerrada. Ahora ambas normalizan igual.
  Medido con los datos reales (2026-09-30): 47 de 48 pedidos traen la `X` y los
  1140 registros de mantenimiento también; tras el cambio los 48 pedidos
  encuentran su registro y las órdenes dadas por cerradas son las mismas 3 de
  antes (0 cambios de comportamiento hoy, se elimina el caso que quedaba afuera).
- **Residuos ya guardados:** el fantasma había quedado persistido en la cola y en
  el caché del agente (y se republicaba en cada snapshot). Se limpian con
  `npx tsx scripts/cleanup-phantom-spare-orders.ts` (`npm run fix:phantom-orders`),
  que además republica el snapshot de Redis. Para ver qué hay publicado en
  cualquier momento: `npx tsx scripts/verify-spare-orders-snapshot.ts`
  (`npm run verify:spare-orders`) → cantidad de pedidos, filas fantasma, fechas
  pisadas que el próximo sync va a curar y distribución de fechas de los
  pendientes antes/después de curar.

## 6. Integración con Reparaciones / Órdenes

- Desde `repairs/[id]` se muestra el panel **"Repuestos"** con:
  `+ Pedir repuesto`, `Marcar pedido`, `Marcar recibido`, `Marcar utilizado`,
  `Cancelar`, `Ver detalle`.
- La máquina, la orden y el código vienen asociados de la reparación (no se
  reescriben). `orderNumber` se toma de `repair.externalId ?? repair.id`.
- Para órdenes manuales sin número humano, se usa el id de la reparación como
  referencia para el pedido.

## 7. Pantalla general — "Pedidos de Repuestos"

Ruta: `/spare-part-orders` (acceso desde la barra de navegación).

- Resumen clicable: Total, **Pendientes**, **Recibidos sin usar**, **Parciales**,
  **Atrasados** (>7 días en SOLICITADO/PEDIDO), **Utilizados**.
- Filtros por estado + búsqueda por repuesto/código + búsqueda por orden/máquina
  + rango de fechas (**Pedido desde / hasta**, botón **Hoy**).
- **Ocultamiento por cierre de 3C (`src/lib/orderClosure.ts`)**: los pedidos de
  órdenes cuya línea de tiempo de 3C terminó en un estado terminal
  (Reparada / Entreg.-Factur. / Retirada / No Reparada) **después** de la fecha
  del pedido se ocultan (lista y hoja de compra), para no imprimir de nuevo lo ya
  resuelto. Se ven con el tilde **"Ver finalizadas"** y el renglón
  "N pedido(s) de órdenes ya cerradas en 3C … oculto(s)".
  **REGLA CLAVE (2026-09-30): un repuesto pedido DESPUÉS del cierre nunca se
  oculta.** Si la orden vuelve por garantía/reingreso y se pide un repuesto nuevo,
  ese pedido aparece con su fecha, aunque 3C la haya dado por entregada antes.
  Dentro del mismo día el orden de los estados se decide por la **hora de lectura**
  (`statusDate`), no por la posición en `states[]` (el array sigue el orden en que
  se procesaron los Excel del día, no el reloj): la orden 11174 tenía
  "Entreg./Factur. 19:37" antes en el array que el "A la Espera Repuestos 20:01"
  que 3C muestra como último estado, y por eso su pedido de garantía del 30/09
  quedaba oculto (el repuesto existía, con la fecha del día, pero no se veía).
- Cada fila muestra cantidades (pedido/recibido/utilizado) y estado, con acceso
  al detalle.

Detalle: `/spare-part-orders/[id]` con historial completo (fechas de pedido,
recepción y utilización, cantidades, disponible, pendiente de recibir,
observaciones, vínculo a la orden).
