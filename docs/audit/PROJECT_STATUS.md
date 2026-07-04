# Estado actual del proyecto Operario Control

---

## Arquitectura actual

- **Stack principal**: Next.js 16.2.9 (App Router), React 19.2.4, TypeScript 5+
- **Base de datos**: Firebase Firestore + Firebase Auth
- **Caché/Colas**: Redis (Upstash)
- **Automatización**: AutoHotkey v2.0 (scripts de navegación para 3C)
- **UI/UX**: Tailwind CSS, ShadCN UI, Sonner (toasts), Lucide React (íconos)
- **Excel**: XLSX para parsear archivos exportados desde 3C

---

## Estructura de carpetas principal

```
operario-control/
├── src/
│   ├── app/
│   │   ├── (protected)/    # Rutas protegidas por autenticación
│   │   │   ├── dashboard/
│   │   │   ├── maintenance/
│   │   │   ├── repairs/
│   │   │   ├── andamios/
│   │   │   ├── machines/
│   │   │   ├── inventory/
│   │   │   ├── rentals/
│   │   │   ├── inventory-movements/
│   │   │   └── stock/
│   │   ├── api/
│   │   │   ├── sync-3c/       # API para sincronización con 3C
│   │   │   └── local/         # API para desarrollo local
│   │   ├── login/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/             # Componentes ShadCN base
│   │   ├── dashboard/
│   │   ├── machines/
│   │   ├── maintenance/
│   │   ├── repairs/
│   │   └── sync/
│   ├── hooks/
│   ├── lib/
│   │   └── sync-3c/        # Motor de sincronización 3C
│   ├── services/
│   └── types/
├── automation/             # Scripts AutoHotkey para 3C
├── automation-watcher/     # Carpeta de exports de Excel y cachés locales
├── sync-agent/             # Agente local que coordina sincronizaciones
└── docs/audit/             # Documentación de auditoría (este directorio)
```

---

## Flujo completo del sistema (Sincronización 3C)

```
┌───────────────┐     ┌─────────────────┐     ┌───────────────┐
│   Usuario en  │────▶│   Dashboard     │────▶│  API Route    │
│   Dashboard   │     │  (Sync Button)  │     │  /sync-3c     │
└───────────────┘     └─────────────────┘     └───────┬───────┘
                                                        │
                                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Redis (Upstash)                              │
│  ┌───────────────────────┐  ┌───────────────────────────────┐  │
│  │ sync-3c:queue         │──│ sync-3c:command:{id}          │  │
│  │ (LPUSH: encola sync)  │  │ (HASH: estado del comando)    │  │
│  └───────────┬───────────┘  └───────────────────────────────┘  │
│              │                                                 │
│  ┌───────────▼───────────┐  ┌───────────────────────────────┐  │
│  │ sync-3c:result:{id}   │  │ sync-3c:agent:production      │  │
│  │ (HASH: resultado sync)│  │ (STRING: heartbeat del agente) │  │
│  └───────────────────────┘  └───────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                        ▲
                        │ (RPOP polling cada 5s)
                        │
┌──────────────────────┴──────────────────────────────────────────┐
│                  sync-agent/agent.mjs                          │
│  - Lee comandos de la cola                                      │
│  - Ejecuta scripts AutoHotkey (automation/sync_*.ahk)          │
│  - Exporta Excel de 3C → automation-watcher/3c_exports/        │
│  - Parsea Excel con parseExcel()                                │
│  - Sincroniza a Firebase con syncItems() o syncRepairsToMaintenance()│
└─────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              AutoHotkey (automation/sync_*.ahk)                 │
│  - sync_3c.ahk: Stock de inventario                             │
│  - sync_reparaciones.ahk: Órdenes de mantenimiento              │
│  - sync_articulos.ahk: Artículos (no activo)                    │
│  - Navega por 3C usando coordenadas predefinidas (config.ini)  │
│  - Exporte Excel a %LOCALAPPDATA%\Temp\tresc\                  │
│  - Copia archivo a automation-watcher/3c_exports/               │
└─────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Firebase Firestore                             │
│  - maintenance: Órdenes de mantenimiento                        │
│  - inventory_stock: Materiales/inventario                       │
│  - machines: Máquinas y herramientas                            │
│  - rentals: Alquileres                                          │
│  - repairs: Reparaciones específicas                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Módulos existentes

| Módulo          | Ruta                          | Descripción                                                                 |
|-----------------|-------------------------------|-----------------------------------------------------------------------------|
| **Dashboard**   | `/(protected)/dashboard/`     | Panel principal: resumen de máquinas, stock, alertas, buscador global       |
| **Mantenimiento**| `/(protected)/maintenance/`  | Lista de órdenes de mantenimiento sincronizadas desde 3C                   |
| **Andamios**    | `/(protected)/andamios/`      | Vista unificada de estructuras de andamio y piezas (cálculo cuerpos completos)|
| **Máquinas**    | `/(protected)/machines/`      | Gestión de máquinas, herramientas, planos y repuestos                       |
| **Inventario**  | `/(protected)/inventory/`     | Control de stock de materiales                                              |
| **Alquileres**  | `/(protected)/rentals/`       | Gestión de alquileres de máquinas                                           |
| **Reparaciones**| `/(protected)/repairs/`       | Registro de reparaciones específicas de máquinas                            |
| **Sincronización**| `/(protected)/dashboard/`    | Botón para iniciar sincronización 3C (stock o reparaciones)                 |

---

## Componentes reutilizables

| Componente         | Ruta                                      | Funcionalidad                                                                 |
|--------------------|-------------------------------------------|-------------------------------------------------------------------------------|
| `MaintenanceTable` | `@/components/maintenance/MaintenanceTable.tsx` | Tabla de órdenes de mantenimiento con buscador, badges, diálogo de detalle  |
| `SearchInput`      | `@/components/ui/SearchInput.tsx`         | Campo de búsqueda genérico                                                    |
| `MachineCard`      | `@/components/machines/MachineCard.tsx`   | Tarjeta para mostrar máquinas                                                 |
| `WorkshopSummary`  | `@/components/dashboard/WorkshopSummary.tsx` | Resumen del taller en el Dashboard                                          |
| `SmartAlertsPanel` | `@/components/dashboard/SmartAlertsPanel.tsx` | Alertas de alquileres próximos a vencer                                     |
| **UI Base (ShadCN)**| `@/components/ui/*`                   | Componentes base: Button, Card, Dialog, Input, Select, Table, Badge, etc.   |

---

## Servicios

| Servicio          | Ruta                                   | Funcionalidad                                                                 |
|-------------------|----------------------------------------|-------------------------------------------------------------------------------|
| `maintenance`     | `@/services/maintenance.ts`            | Interfaz `MaintenanceRecord` y funciones para obtener/crear órdenes          |
| `machines`        | `@/services/machines.ts`               | Gestión de máquinas                                                           |
| `inventoryStock`  | `@/services/inventoryStock.ts`         | Control de inventario de materiales                                          |
| `repairs`         | `@/services/repairs.ts`                | Gestión de reparaciones                                                      |
| `rentals`         | `@/services/rentals.ts`                | Gestión de alquileres                                                        |
| `spareParts`      | `@/services/spareParts.ts`             | Repuestos de máquinas                                                        |
| `stockIntelligence`| `@/services/stockIntelligence.ts`    | Análisis de stock inteligente                                                |

---

## Automatizaciones

### Scripts AutoHotkey (automation/)

| Script               | Funcionalidad                                                                 |
|----------------------|-------------------------------------------------------------------------------|
| `sync_common.ahk`    | Motor compartido: coordenadas, logging, funciones ClickAt(), WaitForExcel(), etc.|
| `sync_3c.ahk`        | Navega 3C para exportar stock de inventario                                   |
| `sync_reparaciones.ahk` | Navega 3C para exportar órdenes de mantenimiento                             |
| `sync_articulos.ahk` | Exporta artículos (no usado actualmente)                                      |

### Agente Local (sync-agent/agent.mjs)

- **Polling Redis**: Cada 5s (RPOP de `sync-3c:queue`)
- **Heartbeat**: Cada 30s
- **Timeout AHK**: 120s
- **Recuperación**: Re-encola comandos "running" con más de 10 minutos de antigüedad
- **Cache Local**: Guarda stock, máquinas y repuestos en `automation-watcher/cache/`

### Automation Watcher (automation-watcher/)

- `3c_exports/`: Carpeta donde se copian los Excels exportados por 3C
- `cache/`: Cachés JSON locales de stock, máquinas y repuestos
- `index.js`: (antiguo watcher, reemplazado por sync-agent)

---

## Estado de cada pantalla

### ✅ Dashboard
- **Estado**: Completado y funcional
- **Características**:
  - Buscador global que muestra `MaintenanceTable` al escribir
  - Alertas de alquileres próximos a vencer
  - Resumen del taller
  - Contadores de máquinas por estado
  - Cálculo de cuerpos completos de andamio
  - Stock Intelligence
- **Pendientes**: Ampliar buscador para incluir máquinas, clientes y materiales

### ✅ Mantenimiento
- **Estado**: Completado y funcional
- **Características**:
  - Lista de órdenes sincronizadas desde 3C
  - Buscador por orden, cliente o máquina
  - Badges visuales para cada estado
  - Diálogo de detalle que muestra campos desde `originalData`
- **Pendientes**:
  - Extraer campos como `tipDoc`, `expediente`, `observaciones`, `garantia`, `presupuesto`, `vendedor`, `costo` a nivel superior de `MaintenanceRecord` (actualmente solo dentro de `originalData`)
  - Mostrar motivo en badge cuando el estado es "No reparado"
  - Terminar integración de `MachineRepair`

### ✅ Andamios
- **Estado**: Completado y funcional
- **Características**:
  - Contadores destacados: Cuerpos completos, Paños, Riendas Largas/Cortas, Tablones
  - Cálculo de cuerpos completos usando la receta: 2 Paños + 2 Riendas Largas + 2 Riendas Cortas
  - Lista de estructuras de andamio (máquinas con category="scaffold")
  - Lista de piezas y accesorios
- **Pendientes**: N/A

### 🟡 Máquinas
- **Estado**: Parcialmente implementado
- **Características**:
  - Lista de máquinas por categoría
  - Detalle de máquina
  - Gestión de planos (blueprints)
  - Gestión de repuestos
- **Pendientes**: Mejorar integración con alquileres y mantenimiento

### 🟡 Inventario
- **Estado**: Parcialmente implementado
- **Características**: Lista de materiales, detalles, creación
- **Pendientes**: Mejorar movimientos de stock

### 🟡 Alquileres
- **Estado**: Parcialmente implementado
- **Características**: Lista de alquileres
- **Pendientes**: Mejorar flujo completo

### 🟡 Reparaciones
- **Estado**: Parcialmente implementado
- **Características**: Lista de reparaciones
- **Pendientes**: Integrar completamente con órdenes de mantenimiento

---

## Funcionalidades terminadas

✅ Sincronización 3C completa (stock y reparaciones)
✅ Motor de sincronización con fallback degradado si Firebase está bloqueado por cuota
✅ Tabla de mantenimiento reusable con buscador y diálogo de detalle
✅ Badges visuales para estados de mantenimiento
✅ Cálculo automático de cuerpos completos de andamio
✅ Buscador global en Dashboard que muestra tabla de mantenimiento
✅ Recuperación de comandos stale en Redis
✅ Heartbeat del agente en Redis

---

## Funcionalidades incompletas

| Funcionalidad                          | Prioridad | Estado       |
|----------------------------------------|-----------|--------------|
| Extraer campos de mantenimiento a nivel superior (no solo `originalData`) | Alta  | ✅ Completado |
| Mostrar motivo en badge cuando estado es "No reparado" | Alta  | ✅ Completado |
| Terminar integración de `MachineRepair` en `MaintenanceTable` | Alta | ✅ Completado |
| Ampliar buscador global a máquinas, clientes y materiales | Media | Pendiente |
| Filtros rápidos por estado en la tabla de mantenimiento | Media | Pendiente |
| Limpieza automática de comandos/resultados antiguos en Redis | Media | Pendiente |
| Mejorar paginación en consultas Firestore | Baja | Pendiente |
| Caché en cliente con React Query o SWR | Baja | Pendiente |

---

## Problemas encontrados

1. **Campos de mantenimiento en solo `originalData`**: Los campos como `tipDoc`, `expediente`, `observaciones`, `garantia`, `presupuesto`, `vendedor`, `costo` se guardan en Firestore pero solo dentro del objeto `originalData`, no como propiedades de nivel superior en `MaintenanceRecord`.
2. **Mantenimiento de `MaintenanceTable` incompleto**: La lógica para vincular órdenes con reparaciones (`getRepairsForMaintenanceOrder`) está definida pero no se usa activamente.
3. **Seguridad**: El archivo `service-account.json` está dentro del proyecto (sync-agent/), lo que es un riesgo de seguridad si se sube a Git (se debe ignorar en .gitignore).
4. **Cuota Firebase**: El sistema tiene un fallback degradado, pero si Firebase se bloquea por cuota, los datos no se persisten en Firestore, solo en Redis (y localmente).

---

## Prioridades

1. **Alta**:
   - Extender `MaintenanceRecord` para incluir campos de 3C como propiedades de nivel superior
   - Actualizar motor de sincronización (`syncRepairsToMaintenance`) para guardar estos campos directamente en Firestore
   - Agregar visualización de motivo en el badge de "No reparado"
   - Completar integración de reparaciones en la tabla de mantenimiento

2. **Media**:
   - Ampliar buscador global
   - Mejorar limpieza de Redis
   - Agregar filtros rápidos en la tabla de mantenimiento

3. **Baja**:
   - Mejorar paginación
   - Agregar caché en cliente

---

## Próximos pasos recomendados

1. Primero, completar las tareas de alta prioridad relacionadas con mantenimiento y campos de 3C.
2. Mejorar la seguridad asegurándose que `service-account.json` nunca se suba al repositorio.
3. Implementar limpieza automática de datos antiguos en Redis.
4. Ampliar el buscador global para una mejor experiencia de usuario.

---

## Convenciones del proyecto

| Aspecto              | Convención                                                                 |
|----------------------|-----------------------------------------------------------------------------|
| **Nombres de archivos** | kebab-case (ej: `maintenance-table.tsx`, `scaffold-config.ts`)            |
| **Componentes**       | PascalCase (ej: `MaintenanceTable`, `DashboardClient`)                    |
| **Rutas**             | kebab-case para carpetas y rutas (ej: `app/(protected)/dashboard/`)       |
| **TypeScript**        | Definir interfaces para todos los datos estructurados                      |
| **Cambios en UI**     | No saturar tablas con demasiadas columnas; usar diálogos de detalle        |
| **Sincronización**    | Siempre mantener `originalData` como respaldo de los datos crudos de 3C    |
| **Componentes**       | Extraer funcionalidades compartidas a componentes en `@/components/`       |

---

## Archivos más importantes y para qué sirve cada uno

| Archivo                                   | Propósito                                                                 |
|-------------------------------------------|---------------------------------------------------------------------------|
| `src/lib/sync-3c/engine.ts`               | Motor de sincronización (syncItems y syncRepairsToMaintenance)          |
| `src/lib/sync-3c/parser.ts`               | Parsea Excels exportados desde 3C                                        |
| `src/services/maintenance.ts`             | Interfaz y funciones para órdenes de mantenimiento                       |
| `src/lib/scaffold-config.ts`              | Receta de andamio y catálogo                                             |
| `src/components/maintenance/MaintenanceTable.tsx` | Componente reusable de tabla de mantenimiento                       |
| `sync-agent/agent.mjs`                    | Agente local que coordina sincronizaciones                               |
| `automation/sync_common.ahk`              | Motor compartido de AutoHotkey                                           |
| `automation/sync_reparaciones.ahk`        | Script para exportar órdenes de mantenimiento desde 3C                   |
| `automation/sync_3c.ahk`                  | Script para exportar stock desde 3C                                      |
| `src/app/api/sync-3c/route.ts`            | API Route para iniciar sincronizaciones                                  |
| `src/app/(protected)/dashboard/dashboard-client.tsx` | Componente cliente del Dashboard                                |

---

## Normas Permanentes del Proyecto

### Objetivo
Establecer un flujo de trabajo basado en auditoría permanente que garantice cambios mínimos, trazabilidad completa y alineación con los requerimientos explícitos del usuario.

### Flujo de Trabajo Obligatorio
Para **cualquier** cambio en el proyecto, se debe seguir estrictamente este flujo:

1. **Leer** `docs/audit/PROJECT_STATUS.md` (fuente oficial única)
2. **Leer únicamente** los archivos directamente involucrados en el cambio
3. **Presentar plan** con: archivos a modificar, por qué, cambios concretos, riesgos, impacto
4. **Esperar aprobación explícita** del usuario
5. **Implementar** solo lo aprobado
6. **Actualizar** `docs/audit/PROJECT_STATUS.md` con el nuevo estado
7. **Crear registro** en `docs/audit/history/YYYY-MM-DD_HH-MM_descripcion.md` con:
   - objetivo
   - archivos modificados
   - cambios realizados
   - decisiones tomadas
   - impacto
   - próximos pasos

### Las 8 Reglas Permanentes

1. **Nunca implementar funcionalidades no solicitadas** — Solo lo que el usuario pida explícitamente.
2. **Nunca proponer refactorizaciones por iniciativa propia** — El código existente no se toca salvo que sea estrictamente necesario para el cambio solicitado.
3. **Nunca crear componentes, servicios o archivos nuevos si el cambio puede hacerse sobre la estructura existente** — Reutilizar antes que crear.
4. **Antes de cualquier cambio**: leer PROJECT_STATUS.md → leer archivos involucrados → mostrar plan → esperar aprobación.
5. **Después de cada implementación**: actualizar PROJECT_STATUS.md + crear archivo en docs/audit/history/.
6. **Nunca volver a auditar todo el proyecto desde cero** — PROJECT_STATUS.md es la fuente oficial; si está desactualizado, se actualiza puntualmente.
7. **Si un requerimiento puede interpretarse de varias maneras, preguntar antes de implementar** — No asumir.
8. **Siempre elegir la solución más simple con la menor cantidad posible de cambios** — Menos código, menos riesgo, menos mantenimiento.