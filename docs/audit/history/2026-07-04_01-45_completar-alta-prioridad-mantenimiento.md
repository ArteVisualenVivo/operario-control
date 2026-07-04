# Registro de Auditoría: Completar 3 Problemas de ALTA Prioridad en Mantenimiento

**Fecha:** 2026-07-04
**Hora:** 01:45 (America/Whitehorse, UTC-7:00)

---

## Objetivo
Resolver los 3 problemas de ALTA prioridad listados en PROJECT_STATUS.md (sección "Prioridades" líneas 283-287):
1. Extender MaintenanceRecord para incluir campos de 3C como propiedades de nivel superior
2. Actualizar motor de sincronización (syncRepairsToMaintenance) para guardar estos campos directamente en Firestore
3. Agregar visualización de motivo en el badge de "No reparado" y completar integración de reparaciones en MaintenanceTable

---

## Archivos Modificados

| Archivo | Tipo de Cambio |
|---------|----------------|
| `src/services/maintenance.ts` | Agregados 8 campos a `MaintenanceRecord` y `MaintenanceInput` + lectura en `getMaintenanceRecords` |
| `src/lib/sync-3c/engine.ts` | Agregados 8 campos al payload de `syncRepairsToMaintenance` |
| `src/components/maintenance/MaintenanceTable.tsx` | Agregado `useEffect` para fetch de reparaciones + mostrar motivo en badge "No reparado" + mostrar campos en diálogo detalle |

---

## Cambios Realizados

### 1. `src/services/maintenance.ts`
- **Interfaces `MaintenanceRecord` y `MaintenanceInput`**: Agregados 8 campos opcionales:
  - `tipDoc`, `expediente`, `observaciones`, `garantia`, `presupuesto`, `vendedor`, `costo`, `reason`
- **Función `getMaintenanceRecords`**: Mapeo de los 8 campos desde Firestore (`data.tipDoc`, `data.expediente`, etc.)

### 2. `src/lib/sync-3c/engine.ts` (función `syncRepairsToMaintenance`)
- **Payload de escritura en Firestore**: Agregados 8 campos extraídos de `sourceData`:
  - `tipDoc: sourceData.tipdoc ?? sourceData.tipo`
  - `expediente: sourceData.expediente`
  - `observaciones: sourceData.observaciones ?? sourceData.observ`
  - `garantia: sourceData.garantia ?? sourceData.garant`
  - `presupuesto: sourceData.presupuesto ?? sourceData.presup`
  - `vendedor: sourceData.vendedor`
  - `costo: sourceData.costo`
  - `reason: sourceData.observaciones ?? sourceData.observ` (para motivo "No reparado")

### 3. `src/components/maintenance/MaintenanceTable.tsx`
- **Import**: Agregado `useEffect` a imports de React
- **Fetch de reparaciones**: `useEffect` que importa dinámicamente `@/services/repairs` y llama a `getRepairs()` al montar
- **Badge "No reparado"**: Si `order.status === "No reparado"`, muestra "Motivo: {reason}" donde `reason = order.reason ?? order.originalData?.observaciones ?? order.originalData?.observ ?? "—"`
- **Diálogo de detalle**: Muestra los 7 campos de 3C (`tipDoc`, `expediente`, `observaciones`, `garantia`, `presupuesto`, `vendedor`, `costo`) con fallback a `originalData` y a propiedades de nivel superior
- **Fix TypeScript**: Cambiado `{selectedOrder && (...)}` por `{selectedOrder ? (...) : null}` para evitar errores de tipo

---

## Decisiones Tomadas

1. **Reutilizar `getRepairs` existente** en lugar de crear nueva API - cumple regla #3 (no crear archivos nuevos si se puede usar estructura existente)
2. **Import dinámico** de `@/services/repairs` para evitar dependencias circulares y cargar solo cuando se necesite
3. **Fallback en cadena** para campos: propiedad de nivel superior → `originalData` → "—" - garantiza compatibilidad con datos antiguos y nuevos
4. **8 campos en lugar de 7** - agregado `reason` específicamente para el motivo "No reparado" (se mapea desde `observaciones`/`observ`)
5. **Mínimos cambios** - solo 3 archivos tocados, sin refactorizaciones innecesarias

---

## Impacto

| Área | Impacto |
|------|---------|
| **Datos** | 7 campos de 3C ahora persisten como propiedades de nivel superior en Firestore (no solo en `originalData`) |
| **UI - Tabla** | Badge "No reparado" ahora muestra motivo específico (antes mostraba solo el estado) |
| **UI - Detalle** | Diálogo muestra todos los campos de 3C extraídos, no solo los que estaban en `originalData` |
| **Integración** | `MachineRepair` ahora se vincula correctamente - `repairs` array se popula al montar el componente |
| **Sincronización** | Próximas sincronizaciones guardarán campos directamente en Firestore, no solo en `originalData` |
| **Compatibilidad** | Datos existentes siguen funcionando (fallback a `originalData`) |

---

## Próximos Pasos

1. **Probar sincronización completa** - Ejecutar sync de reparaciones desde 3C y verificar que los 8 campos se guardan en Firestore
2. **Verificar UI** - Confirmar que motivo aparece en badge "No reparado" y campos en diálogo detalle
3. **Verificar integración reparaciones** - Confirmar que botón "Ver reparaciones" funciona y muestra count correcto
4. **Tareas Media pendientes** (según PROJECT_STATUS.md):
   - Ampliar buscador global a máquinas, clientes y materiales
   - Filtros rápidos por estado en tabla de mantenimiento
   - Limpieza automática de comandos/resultados antiguos en Redis