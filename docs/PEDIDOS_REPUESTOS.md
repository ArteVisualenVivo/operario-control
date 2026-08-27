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
  + rango de fechas.
- Cada fila muestra cantidades (pedido/recibido/utilizado) y estado, con acceso
  al detalle.

Detalle: `/spare-part-orders/[id]` con historial completo (fechas de pedido,
recepción y utilización, cantidades, disponible, pendiente de recibir,
observaciones, vínculo a la orden).
