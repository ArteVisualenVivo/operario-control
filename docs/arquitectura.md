# Documentación Técnica — Operario Control

---

## 1. Arquitectura General

### Estructura de carpetas

```
operario-control/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout: AuthProvider + Toaster
│   │   ├── globals.css             # Tailwind v4 + CSS variables
│   │   ├── page.tsx                # / → redirect a /dashboard
│   │   ├── login/page.tsx          # Login con email/password
│   │   ├── (protected)/
│   │   │   ├── layout.tsx          # Layout autenticado con nav header
│   │   │   ├── dashboard/page.tsx  # Dashboard principal
│   │   │   ├── machines/           # CRUD máquinas
│   │   │   ├── andamios/           # Vista andamios + stock
│   │   │   ├── inventory/          # CRUD stock inventario
│   │   │   ├── rentals/            # Alquileres
│   │   │   ├── repairs/            # Órdenes de reparación
│   │   │   ├── stock/              # Stock global unificado
│   │   │   ├── stock-movements/    # Movimientos repuestos
│   │   │   ├── inventory-movements/# Movimientos materiales
│   │   │   └── maintenance/        # Alertas mantenimiento
│   │   └── api/
│   │       ├── sync-3c/route.ts         # POST crear comando sync
│   │       ├── sync-3c/status/route.ts  # GET estado comando
│   │       ├── sync-3c/agent-status/    # GET heartbeat agente
│   │       └── cloudinary/delete/route.ts # DELETE Cloudinary
│   ├── components/
│   │   ├── ui/              # shadcn primitives (Button, Card, Table, Dialog, etc.)
│   │   ├── machines/        # MachineCard, SeedInventory, ImportInventory, etc.
│   │   ├── repairs/         # RepairForm, PartsSelector, MaintenanceStatusBadge
│   │   ├── dashboard/       # WorkshopSummary, SmartAlertsPanel
│   │   └── sync/            # Sync3CButton
│   ├── hooks/               # useMachines, useRepairs, useInventoryStock, etc.
│   ├── services/            # Firestore CRUD layer (machines, repairs, spareParts, etc.)
│   ├── lib/                 # firebase.ts, AuthContext, cloudinary, sync-3c/
│   └── types/               # machine.ts, repair.ts, inventoryStock.ts, etc.
├── sync-agent/
│   ├── agent.mjs            # Agente Node.js que escucha Firestore y ejecuta AHK
│   ├── service-account.json # Credenciales Firebase para el agente
│   └── agent.log            # Log del agente
├── automation/
│   └── sync_3c.ahk          # Script AutoHotkey que automatiza 3C
├── automation-watcher/      # Archivos exportados por 3C
├── scripts/                 # CLI scripts (seed, audit, cleanup)
├── start-agent.vbs          # Inicia agente oculto en Windows
├── set-time.ps1             # Script de sincronización horaria
├── docs/                    # Documentación
└── package.json             # Dependencias y scripts
```

### Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router) |
| Frontend | React 19, Tailwind CSS v4, @base-ui/react (shadcn style) |
| Backend | Next.js API routes (serverless en Vercel) |
| Base de datos | Firestore (Google Cloud) |
| Autenticación | Firebase Auth (email/password) |
| Almacenamiento archivos | Cloudinary (planos/despieces PDF) |
| SDK Admin | firebase-admin v14 (API routes + agente) |
| SDK Cliente | firebase v11 (web) |
| Procesamiento Excel | xlsx (SheetJS) |
| Procesamiento PDF | pdfjs-dist (extracción partes Bosch) |
| Notificaciones | sonner (toasts) |
| Agente local | Node.js + tsx + AutoHotkey v2 |
| Despliegue | Vercel (serverless functions) |

### Flujo de datos completo

```
USUARIO (Web)
    │
    ├── Firebase Auth (login)
    ├── Firestore SDK (lectura/escritura directa desde el cliente)
    └── fetch() → Vercel API Routes (solo sync-3c)
                      │
                      ├── POST /api/sync-3c → crea sync-3c-commands/{id}
                      ├── GET /api/sync-3c/status?commandId=x → lee comando
                      └── GET /api/sync-3c/agent-status → lee heartbeat

SISTEMA 3C (contabilidad, local en PC)
    │
    └── sync-agent/agent.mjs (Node.js local)
            │
            ├── Polling Firestore (sync-3c-commands) cada 5s
            ├── AHK → exporta Excel desde 3C
            ├── parseExcel() → extrae items
            ├── syncItems() → upsert en inventory_stock
            └── Escribe resultado en sync-3c-commands/{id}
```

---

## 2. Firestore — Colecciones Completas

### 2.1 `machines` — Máquinas/Equipos

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | Firestore auto-ID |
| `name` | `string` | Nombre |
| `model` | `string` | Modelo |
| `category` | `"machine" \| "tool" \| "scaffold" \| null` | Categoría |
| `status` | `"available" \| "rented" \| "maintenance"` | Estado actual |
| `locationType` | `"deposito" \| "obra" \| "taller"` | Ubicación |
| `location` | `{ client: { name, address }, project: { name, address } } \| null` | Ubicación detallada |
| `rental` | `{ clientName, clientAddress, projectName, projectAddress, startDate, expectedEndDate, isOpenEnded } \| null` | Alquiler activo |
| `createdAt` | `Timestamp` | serverTimestamp |
| `updatedAt` | `Timestamp` | serverTimestamp |

**Regla de dominio:** 1 doc = 1 unidad física (no stock agregado).

### 2.2 `repairs` — Órdenes de Reparación

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | Firestore auto-ID |
| `machineId` | `string` | FK → machines.id |
| `machineName` | `string` | Desnormalizado |
| `machineModel` | `string \| undefined` | Desnormalizado |
| `internalNumber` | `string \| undefined` | Nº interno |
| `clientId` | `string \| undefined` | FK a clientes (no implementado) |
| `clientName` | `string` | Cliente |
| `clientNumber` | `string \| undefined` | Teléfono cliente |
| `reportedIssue` | `string` | Falla reportada |
| `diagnosis` | `string \| undefined` | Diagnóstico |
| `repairPerformed` | `string` | Reparación realizada |
| `technician` | `string` | Técnico |
| `entryDate` | `Timestamp` | Fecha ingreso |
| `exitDate` | `Timestamp` | Fecha egreso |
| `hoursUsed` | `number \| undefined` | Horas de uso |
| `warrantyDays` | `number` | Días de garantía |
| `warrantyUntil` | `Timestamp` | Auto-calculado |
| `oilChangeDueDate` | `Timestamp \| undefined` | Próximo cambio aceite |
| `bearingChangeDueDate` | `Timestamp \| undefined` | Próximo cambio rodamientos |
| `maintenanceDueDate` | `Timestamp \| undefined` | Próximo mantenimiento gral. |
| `notes` | `string \| undefined` | Notas |
| `partsUsed` | `PartUsage[]` | `[{ partId, code, description, quantity }]` |
| `source` | `"manual" \| "3c" \| undefined` | Origen |
| `externalId` | `string \| undefined` | ID externo (3C) |
| `status` | `"EN_TALLER" \| "FINALIZADO"` | Estado |
| `issue` | `string` | Espejo de reportedIssue |
| `estimatedReturn` | `Timestamp \| null` | Fecha estimada devolución |
| `createdAt` | `Timestamp` | serverTimestamp |
| `updatedAt` | `Timestamp` | serverTimestamp |

### 2.3 `machine_spare_parts` — Repuestos por Máquina

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | Firestore auto-ID |
| `machineId` | `string` | FK → machines.id |
| `machineName` | `string` | Desnormalizado |
| `machineModel` | `string` | Desnormalizado |
| `partName` | `string` | Nombre |
| `partCode` | `string` | Código |
| `category` | `"motor" \| "filtro" \| "electrico" \| "estructural" \| "consumible" \| "otro"` | Categoría |
| `unit` | `string` | Unidad |
| `stockTotal` | `number` | Stock total |
| `stockAvailable` | `number` | Stock disponible |
| `stockUsed` | `number` | Stock usado |
| `source` | `"manual" \| "imported" \| "blueprint"` | Origen |
| `blueprintId` | `string \| undefined` | FK → machine_blueprints.id |
| `createdAt` | `Timestamp` | serverTimestamp |
| `updatedAt` | `Timestamp` | serverTimestamp |

### 2.4 `inventory_stock` — Stock de Materiales

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | Firestore auto-ID |
| `name` | `string` | Nombre |
| `codigo` | `string \| undefined` | Código externo (3C) |
| `category` | `"puntales" \| "riendas" \| "andamio_accesorios" \| "consumibles"` | Categoría |
| `unit` | `"unidad" \| "metro" \| "kg"` | Unidad |
| `stockTotal` | `number` | Stock total |
| `stockAvailable` | `number` | Stock disponible |
| `stockRented` | `number` | Stock alquilado |
| `subtype` | `StockSubtype \| null` | Subtipo |
| `size` | `StockSize \| string \| null` | Medida |
| `locationType` | `"deposito"` | Siempre "deposito" |
| `deposito` | `number \| undefined` | Depósito 3C |
| `source` | `"manual" \| "3c" \| undefined` | Origen |
| `stockWarning` | `boolean \| undefined` | Stock negativo |
| `createdAt` | `Timestamp` | serverTimestamp |
| `updatedAt` | `Timestamp` | serverTimestamp |

**Regla de dominio:** 1 doc = stock agregado, no unidades individuales.

### 2.5 `inventory_movements` — Movimientos de Materiales

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | Firestore auto-ID |
| `materialId` | `string` | FK → inventory_stock.id |
| `date` | `Timestamp` | Fecha |
| `type` | `"ALQUILER" \| "DEVOLUCION" \| "AJUSTE"` | Tipo |
| `quantity` | `number` | Cantidad |
| `clientName` | `string \| undefined` | Cliente |
| `projectName` | `string \| undefined` | Obra |
| `reference` | `string \| undefined` | Referencia libre |
| `rentalId` | `string \| undefined` | Campo reservado (no usado) |

### 2.6 `stock_movements` — Movimientos de Repuestos

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | Firestore auto-ID |
| `partId` | `string` | FK → machine_spare_parts.id |
| `date` | `Timestamp` | Fecha |
| `type` | `"INGRESO" \| "EGRESO"` | Tipo |
| `source` | `"REPARACION" \| "REPOSICION"` | Origen |
| `referenceId` | `string` | FK a repairs.id o texto |
| `quantity` | `number` | Cantidad |

### 2.7 `machine_blueprints` — Planos/Despieces

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | Firestore auto-ID |
| `machineId` | `string` | FK → machines.id |
| `fileUrl` | `string` | URL Cloudinary |
| `publicId` | `string` | Public ID Cloudinary |
| `fileName` | `string` | Nombre original |
| `fileType` | `"pdf" \| "image"` | Tipo |
| `resourceType` | `string` | Tipo recurso Cloudinary |
| `createdAt` | `Timestamp` | Timestamp |

### 2.8 `blueprint_drafts` — Borradores de Importación

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | Firestore auto-ID |
| `machineId` | `string` | FK → machines.id |
| `blueprintId` | `string` | FK → machine_blueprints.id |
| `partName` | `string` | Nombre |
| `partCode` | `string` | Código |
| `category` | `SparePartCategory` | Categoría |
| `unit` | `string` | Unidad |
| `stockTotal` | `number` | Stock |
| `status` | `"draft" \| "confirmed"` | Estado |
| `createdAt` | `Timestamp` | Timestamp |

### 2.9 `maintenance_settings` — Configuración Singleton

Documento fijo: `maintenance_settings/config`

| Campo | Tipo | Default |
|-------|------|---------|
| `oilChangeDays` | `number` | 90 |
| `bearingChangeDays` | `number` | 180 |
| `maintenanceDays` | `number` | 365 |
| `warrantyDays` | `number` | 90 |
| `updatedAt` | `Timestamp` | serverTimestamp |

### 2.10 `audit_logs` — Log de Auditoría

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | Firestore auto-ID |
| `action` | `"create" \| "update" \| "delete"` | Acción |
| `entity` | `EntityType` | Tipo entidad |
| `entityId` | `string` | ID del documento |
| `before` | `object \| null` | Estado previo |
| `after` | `object \| null` | Estado posterior |
| `timestamp` | `Timestamp` | serverTimestamp |
| `userId` | `string` | Definido en tipo pero **no se popula** |

### 2.11 `sync-3c-commands` — Cola de Comandos Sync

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | `string` | Firestore auto-ID |
| `status` | `string` | `"pending" \| "running" \| "completed" \| "failed"` |
| `createdAt` | `Timestamp` | serverTimestamp |
| `startedAt` | `Timestamp \| null` | Inicio procesamiento |
| `completedAt` | `Timestamp \| null` | Fin procesamiento |
| `agent` | `string \| null` | Nombre del agente |
| `result` | `object \| null` | Resultado del sync |
| `error` | `string \| null` | Mensaje de error |

### 2.12 `sync-3c-agent` — Heartbeat del Agente

Documento fijo: `sync-3c-agent/production`

| Campo | Tipo | Notas |
|-------|------|-------|
| `lastHeartbeat` | `Timestamp` | Último heartbeat |
| `status` | `string` | `"idle" \| "running"` |
| `machineName` | `string \| null` | Nombre del PC |

### Relaciones entre colecciones

```
machines
  ├──< repairs.machineId                  (1:N — historial reparaciones)
  ├──< machine_spare_parts.machineId       (1:N — repuestos)
  ├──< machine_blueprints.machineId         (1:N — planos)
  └──< blueprint_drafts.machineId           (1:N — borradores importación)

machine_blueprints
  ├──< machine_spare_parts.blueprintId      (1:N — repuestos importados)
  └──< blueprint_drafts.blueprintId         (1:N — borradores)

machine_spare_parts
  └──< stock_movements.partId              (1:N — movimientos stock)

inventory_stock
  └──< inventory_movements.materialId      (1:N — movimientos)

repairs (partsUsed[].partId) → machine_spare_parts.id (consumo en reparación)
repairs.machineId → machines.id (máquina reparada)

maintenance_settings (singleton, consultado por repairs)
audit_logs (registra mutaciones de todas las entidades)
```

### Índices requeridos (no existe `firestore.indexes.json`)

| Colección | Campos | Tipo | Uso |
|-----------|--------|------|-----|
| `repairs` | `machineId` ASC + `entryDate` DESC | Compuesto | `getRepairsByMachine()` |
| `machine_spare_parts` | `machineId` ASC + `partCode` ASC | Compuesto | Duplicate check en create |
| `machine_spare_parts` | `machineId` ASC + `source` ASC | Compuesto | `deleteBlueprintSpareParts()` |
| `inventory_movements` | `materialId` ASC + `date` DESC | Compuesto | `getInventoryMovementsByMaterial()` |
| `inventory_movements` | `date` ASC (range) + `date` DESC (order) | Compuesto | `getRecentInventoryMovements()` |
| `stock_movements` | `partId` ASC + `date` DESC | Compuesto | `getMovementsByPart()` |
| `machine_blueprints` | `machineId` ASC + `createdAt` DESC | Compuesto | `getBlueprints()` |
| `blueprint_drafts` | `machineId` + `partCode` + `status` | Compuesto | Duplicate check en create |
| `inventory_stock` | `name` ASC + `size` ASC | Compuesto | Seed scripts |

---

## 3. Modelos de Datos — Interfaces TypeScript

Todas en `src/types/`:

| Archivo | Interfaces exportadas |
|---------|----------------------|
| `machine.ts` | `Machine`, `MachineStatus`, `MachineLocation`, `MachineCategory`, `MachineRental`, `ClientInfo`, `ProjectInfo`, `LocationInfo`, `CreateMachineInput`, `UpdateMachineInput` |
| `repair.ts` | `MachineRepair`, `CreateRepairInput`, `PartUsage`, `MaintenanceSettings`, `RepairImportData`, `RepairOrderStatus`, `RepairStatus`, `RepairSource` |
| `sparePart.ts` | `SparePart`, `CreateSparePartInput`, `SparePartCategory`, `SparePartSource` |
| `inventoryStock.ts` | `InventoryStock`, `CreateStockInput`, `StockCategory`, `StockUnit`, `StockSubtype`, `StockSize` |
| `inventoryMovement.ts` | `InventoryMovement`, `CreateInventoryMovementInput`, `InventoryMovementType` |
| `stockMovement.ts` | `StockMovement`, `StockMovementType`, `StockMovementSource` |
| `stockAlert.ts` | `StockAlert`, `StockAlertType`, `StockAlertEntityType`, `StockHealthScore`, `ConsumptionTrend`, `StockIntelligence` |
| `audit.ts` | `AuditLog`, `AuditAction`, `AuditEntity` |
| `errors.ts` | `AppError` (INDEX_MISSING \| PERMISSION_DENIED \| GENERIC \| null) |
| `rental.ts` | `LegacyRental` (solo tipo, no se usa — colección legacy) |
| `index.ts` | Barrel export de todos los anteriores |

---

## 4. Equipos / Máquinas

- **Colección:** `machines`
- **1 doc = 1 unidad física** (no stock agregado)
- **Campos requeridos:** `name`, `model`, `status`, `locationType`
- **Campos opcionales:** `category`, `location`, `rental`

### Estados

```
available ──→ rented   (rentMachine)
available ──→ maintenance (creación manual o futura desde 3C)
rented ──→ available  (returnMachine)
maintenance ──→ available (actualización manual)
```

### Historial asociado

El historial de una máquina se obtiene de:
- **Reparaciones:** `repairs` filtrado por `machineId`, ordenado por `entryDate DESC`
- **Alquileres:** embebido en `machines.rental` (solo el activo), más `audit_logs` para histórico
- **Planos:** `machine_blueprints` filtrado por `machineId`
- **Repuestos:** `machine_spare_parts` filtrado por `machineId`

---

## 5. Reparaciones

### Estructura actual

- **Colección:** `repairs`
- **Campos clave:** `machineId`, `clientName`, `technician`, `entryDate`, `exitDate`, `status`, `partsUsed[]`, fechas de mantenimiento auto-calculadas

### Cómo se registran

1. **Web:** formulario `RepairForm` en `/repairs/new` y `/repairs/[id]`
2. **Efectos secundarios al crear:**
   - Decrementa `stockAvailable` de cada `machine_spare_parts` usado
   - Crea entradas en `stock_movements` por cada parte usada
   - Calcula `warrantyUntil`, `oilChangeDueDate`, `bearingChangeDueDate`, `maintenanceDueDate` desde `maintenance_settings/config`
3. **Pantallas que las consumen:**
   - `/repairs` — listado completo con filtros
   - `/repairs/[id]` — detalle/edición
   - `/machines/[id]` — `MaintenanceTimeline` muestra historial
   - `/dashboard` — `WorkshopSummary` muestra estadísticas
   - `/maintenance` — alertas de mantenimiento vencido/próximo
   - `stockIntelligence.ts` — alertas de máquinas en mantenimiento

---

## 6. Operarios

**No existe como entidad separada en el modelo de datos actual.** El campo `technician` en `repairs` es un string libre, no una referencia a una colección de operarios.

No hay relación operario-máquina, operario-reparación, ni operario-usuario.

---

## 7. Dashboard

Ruta: `/dashboard`

### Métricas que muestra

| Sección | Datos | Fuente |
|---------|-------|--------|
| Cards resumen | Total equipos, Disponibles, Alquiladas, Mantenimiento | `machines` (filtro por status) |
| Cards por categoría | Maquinaria, Andamios, Herramientas | `machines` (filtro por category) |
| Alertas alquiler | Máquinas próximas a vencer, sin fecha | `machines` con rental activo |
| WorkshopSummary | En taller, Finalizados hoy, Mant. vencidos, Próximos 7d | `repairs` (cálculos in-memory) |
| SmartAlertsPanel | Fallas repetitivas, máquinas sobrecargadas, mantenimiento ignorado | `repairs` + `stockIntelligence` |
| Stock materials | Cards de materiales con stock | `inventory_stock` |
| Stock Intelligence | Health score, items críticos, top consumidos, tendencia | `stockIntelligenceService` (combina 5 colecciones) |

---

## 8. APIs

| Método | Ruta | Input | Output | Colecciones |
|--------|------|-------|--------|-------------|
| `POST` | `/api/sync-3c` | Body ignorado | `{ commandId }` | Crea en `sync-3c-commands` |
| `GET` | `/api/sync-3c/status` | Query `?commandId=` | Datos del documento | Lee `sync-3c-commands` |
| `GET` | `/api/sync-3c/agent-status` | Ninguno | `{ online, status, machineName, lastHeartbeat }` | Lee `sync-3c-agent/production` |
| `POST` | `/api/cloudinary/delete` | `{ publicId, resourceType? }` | `{ success, result }` | Ninguna (solo Cloudinary) |

**Todas las API son públicas** — no hay autenticación ni middleware. Las rutas sync-3c usan `firebase-admin` con credenciales de service account desde `FIREBASE_SERVICE_ACCOUNT` env var. La ruta Cloudinary usa Basic Auth con `CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`.

---

## 9. Componentes UI — Pantallas

### Pantallas existentes (22 rutas)

| Ruta | Función |
|------|---------|
| `/` | Redirige a /dashboard |
| `/login` | Login email/password |
| `/dashboard` | Panel principal con resúmenes y alertas |
| `/machines` | Listado de máquinas con búsqueda y filtros |
| `/machines/new` | Formulario crear máquina |
| `/machines/[id]` | Detalle/edición máquina, historial, planos, repuestos |
| `/machines/[id]/parts` | Gestión de repuestos de una máquina |
| `/machines/[id]/blueprints` | Gestión de planos/despieces |
| `/andamios` | Vista específica de andamios + stock componentes |
| `/repairs` | Listado de reparaciones con filtros |
| `/repairs/new` | Formulario crear reparación |
| `/repairs/[id]` | Detalle/edición reparación |
| `/inventory` | Listado stock materiales |
| `/inventory/new` | Formulario crear material |
| `/inventory/[id]` | Edición/eliminación material |
| `/stock` | Stock global unificado (máquinas + andamios + materiales + repuestos) |
| `/stock-movements` | Movimientos de repuestos |
| `/inventory-movements` | Movimientos de materiales |
| `/rentals` | Listado alquileres activos |
| `/rentals/new` | Formulario nuevo alquiler |
| `/rentals/[id]` | Detalle/devolución alquiler |
| `/maintenance` | Alertas de mantenimiento |

---

## 10. Sync 3C — Flujo Completo

### Código relacionado

| Archivo | Rol |
|---------|-----|
| `src/lib/sync-3c/types.ts` | Tipos compartidos (`Sync3CItem`, `Sync3CResult`, `Sync3CConfig`) |
| `src/lib/sync-3c/parser.ts` | Parsea Excel 3C → `Sync3CItem[]` |
| `src/lib/sync-3c/engine.ts` | Sincroniza items → `inventory_stock` en Firestore (admin SDK) |
| `src/app/api/sync-3c/route.ts` | Endpoint POST: crea comando en `sync-3c-commands` |
| `src/app/api/sync-3c/status/route.ts` | Endpoint GET: polling estado del comando |
| `src/app/api/sync-3c/agent-status/route.ts` | Endpoint GET: heartbeat del agente |
| `src/components/sync/Sync3CButton.tsx` | Botón UI con indicador de estado y polling |
| `sync-agent/agent.mjs` | Agente local: escucha comandos, ejecuta AHK, procesa Excel, escribe resultado |
| `automation/sync_3c.ahk` | Script AHK: automatiza exportación desde 3C |
| `start-agent.vbs` | Lanzador oculto del agente en Windows |

### Endpoints involucrados

1. **`POST /api/sync-3c`** — Crea `sync-3c-commands/{uuid}` con `status: "pending"`
2. **`GET /api/sync-3c/status?commandId=x`** — Lee el documento y devuelve su estado
3. **`GET /api/sync-3c/agent-status`** — Lee `sync-3c-agent/production` y determina online/offline (heartbeat < 90s)

### Colecciones Firestore involucradas

- `sync-3c-commands` — Cola de comandos
- `sync-3c-agent` — Heartbeat del agente
- `inventory_stock` — Destino de los datos sincronizados

### Flujo completo Vercel ↔ Agent ↔ Firestore

```
WEB (Vercel)                     AGENTE (PC Local)                FIRESTORE
    │                                   │                              │
    │  POST /api/sync-3c                 │                              │
    │────────────────────────────────────┼─────────────────────────────>│ sync-3c-commands/{id}
    │<───────────────────────────────────┼──────────────────────────────│ {commandId}
    │                                   │                              │
    │                                   │ Poll cada 5s                 │
    │                                   │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─>│ query pending
    │                                   │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│ doc found
    │                                   │                              │
    │                                   │ pending→running              │
    │                                   │──────────────────────────────>│ status:"running"
    │                                   │                              │
    │                                   │ Spawn AHK                    │
    │                                   │  → minimiza Chrome           │
    │                                   │  → activa 3C                 │
    │                                   │  → navega menús              │
    │                                   │  → exporta Excel             │
    │                                   │  → copia archivo             │
    │                                   │  → cierra Excel              │
    │                                   │                              │
    │                                   │ parse + syncItems            │
    │                                   │──────────────────────────────>│ inventory_stock
    │                                   │                              │
    │                                   │ Escribe resultado            │
    │                                   │──────────────────────────────>│ status:"completed"
    │                                   │                              │
    │  Poll cada 2s                     │                              │
    │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ GET status ──>│                              │
    │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                              │ status:"completed"
    │                                   │                              │
    │  toast + onComplete()             │                              │
```

### Columnas del Excel de 3C

| Índice | Header | Uso actual |
|--------|--------|------------|
| 1 | DEPOSITO | Número de depósito |
| 2 | ARTICULO | Código del artículo |
| 5 | DENOMINACION | Nombre del artículo |
| 7 | UNIMED_ID | Unidad |
| 20 | STOCK | Stock total |

**Columnas disponibles no parseadas:**
- Col 10: FAMILIA_ID (permite identificar si es máquina o material)
- Col 15: DENOMINACION_FAMILIA (nombre de familia)

---

## 11. Mapa 3C → Firestore

### Orden de Reparación

| Campo 3C | Colección | Campo destino | Notas |
|----------|-----------|---------------|-------|
| Nº Orden | `repairs` | `externalId` | ID único en 3C |
| Fecha ingreso | `repairs` | `entryDate` | |
| Fecha egreso | `repairs` | `exitDate` | |
| Estado (abierta/cerrada) | `repairs` | `status` | "EN_TALLER" / "FINALIZADO" |
| Falla reportada | `repairs` | `reportedIssue` + `issue` | |
| Diagnóstico | `repairs` | `diagnosis` | |
| Reparación realizada | `repairs` | `repairPerformed` | |
| Notas | `repairs` | `notes` | |
| Horas de uso | `repairs` | `hoursUsed` | |

### Cliente

| Campo 3C | Colección | Campo destino | Notas |
|----------|-----------|---------------|-------|
| Nombre | `repairs` | `clientName` | Desnormalizado |
| Teléfono | `repairs` | `clientNumber` | Desnormalizado |

**Nota:** No existe colección `clients`. El cliente se almacena como string en `repairs.clientName`.

### Máquina

| Campo 3C | Colección | Campo destino | Notas |
|----------|-----------|---------------|-------|
| Nombre | `repairs` | `machineName` | Desnormalizado |
| Modelo / código | `repairs` | `machineModel` | Desnormalizado |
| ID máquina en sistema | `repairs` | `machineId` | FK a `machines.id` |

**Problema:** Si la máquina no existe en `machines`, `machineId` no se puede asignar.

### Número de Serie

No existe como campo en ningún modelo. Opciones:
- Agregar `serialNumber` a `machines`
- Agregar `serialNumber` a `repairs`

### Técnico

| Campo 3C | Colección | Campo destino | Notas |
|----------|-----------|---------------|-------|
| Técnico | `repairs` | `technician` | String libre |

**Problema:** No hay colección `technicians`. El campo es string no referenciado.

### Mapeo de estados

| Valor 3C | `repairs.status` |
|----------|-----------------|
| Abierta / En taller | `"EN_TALLER"` |
| Finalizada / Cerrada | `"FINALIZADO"` |
| Pendiente | `"EN_TALLER"` |
| En reparación | `"EN_TALLER"` |
| Terminada | `"FINALIZADO"` |

### Pantallas que se actualizan automáticamente

| Colección modificada | Pantallas afectadas |
|----------------------|---------------------|
| `repairs` (nueva) | `/repairs`, `/repairs/[id]` |
| `repairs` (con machineId) | `/machines/[id]` (MaintenanceTimeline), `/dashboard` (WorkshopSummary) |
| `repairs` (status change) | `/maintenance`, `/dashboard` (SmartAlertsPanel) |
| `inventory_stock` | `/inventory`, `/stock`, `/dashboard`, `/andamios` |
| `machines` (creación desde 3C) | `/machines`, `/stock`, `/dashboard` |

---

## 12. Inconsistencias Detectadas

### 12.1 Campos duplicados

| Dónde | Campo | Duplicado en |
|-------|-------|-------------|
| `repairs` | `machineName` | `machines.name` |
| `repairs` | `machineModel` | `machines.model` |
| `machine_spare_parts` | `machineName` | `machines.name` |
| `machine_spare_parts` | `machineModel` | `machines.model` |
| `repairs` | `issue` | `reportedIssue` (mismo valor, se guarda en ambos) |
| `repairs` | `warrantyDays` | `maintenance_settings.warrantyDays` (se copia al crear) |

Razón: Desnormalización intencional para evitar lecturas adicionales a Firestore.

### 12.2 Colecciones redundantes

| Colección | Problema |
|-----------|----------|
| `rentals` | **No existe como colección.** Solo existe el tipo `LegacyRental` en types. El servicio `rentals.ts` solo re-exporta funciones de `machines.ts`. |

### 12.3 Modelos incompletos

| Problema | Detalle |
|----------|---------|
| Sin colección `clients` | Cliente es string libre, no reutilizable |
| Sin colección `technicians` | Técnico es string libre |
| Sin colección `users` | `audit_logs.userId` nunca se popula |
| Sin `serialNumber` en `machines` | No hay campo para Nº de serie |
| Sin `machineId` opcional en `repairs` | Si no existe la máquina, no se puede crear reparación |
| `partsUsed[].partId` sin validación | No se verifica que exista en `machine_spare_parts` |

### 12.4 Problemas para importar datos desde 3C

| Problema | Impacto |
|----------|---------|
| **Sin `serialNumber` en `machines`** | No se puede almacenar el Nº de serie de 3C |
| **Sin mapeo 3C → `machines`** | El sync actual solo escribe en `inventory_stock` |
| **Stock 3C es agregado, machines es unitario** | No se pueden crear 15 docs individuales para "15 GRUPO ELECTROGENO" sin Nº de serie |
| **Órdenes de reparación no tienen export AHK** | No existe script para navegar a reparaciones en 3C |
| **Formato del Excel de reparaciones desconocido** | No se sabe qué columnas tiene |
| **Sin deduplicación por `externalId`** | Si se importa la misma orden dos veces, no hay detección |
| **`clientId` no se popula** | Campo existe en tipo pero nunca se asigna |
| **Dependencia de `FIREBASE_SERVICE_ACCOUNT`** | API routes fallan si no está configurada en Vercel |

---

## 13. Flujo AutoHotkey — Sync 3C

### 13.1 Archivo principal

**`automation/sync_3c.ahk`**

Se ejecuta desde `sync-agent/agent.mjs:95-108` mediante:
```
spawn(exe, [AHK_SCRIPT], { cwd: AHK_DIR, windowsHide: true })
```

El agente espera hasta 120s (constante `AHK_TIMEOUT_MS`) a que AHK termine con código 0. Si AHK falla (código distinto de 0) o expira el timeout, el agente rechaza la promesa y marca el comando como `"failed"`.

El script **no recibe argumentos ni parámetros** — su comportamiento es fijo: exportar existencias y terminar.

### 13.2 Paso a paso — acciones reales (basado en logs reales)

```
Tiempo acumulado       Acción
─────────────────────────────────────────────────────
T+0s       INICIO del script
T+0s       Sleep(initDelay) = 1000ms
T+1s       WinMinimize("chrome.exe") — si existe
T+1s       WinMinimize("msedge.exe") — si existe
T+1s       WinExist("3C") — verifica que 3C esté abierta
T+1s       WinActivate("3C")
T+1s       WinWaitActive("3C")
T+1s       SendInput("^Home") — Ctrl+Home (resync al menú principal)
T+1.3s     Sleep(resyncDelay) = 300ms
T+1.3s     Click At(name) → "Almacenes" — coord (888, 189)
T+1.8s     Sleep(afterClick) = 500ms
T+1.8s     ValidarFoco() — verifica que 3C siga activa
T+1.8s     Click At(name) → "Informes" — coord (921, 370)
T+2.3s     Sleep(afterSubmenu) = 500ms
T+2.3s     ValidarFoco()
T+2.3s     Click At(name) → "Existencias" — coord (1105, 401)
T+2.8s     Sleep(afterSubmenu) = 500ms
T+2.8s     ValidarFoco()
T+2.8s     Click At(name) → "Depositos" — coord (704, 476)
T+3.3s     Sleep(afterClick) = 500ms
T+3.3s     ValidarFoco()
T+3.3s     Click At(name) → "SeleccionarTodos" — coord (962, 858)
T+3.8s     Sleep(afterClick) = 500ms
T+3.8s     ValidarFoco()
T+3.8s     Click At(name) → "Consulta" — coord (440, 341)
T+4.1s     Sleep(afterQuery) = 300ms
T+4.1s     ValidarFoco()
T+4.1s     Click At(name) → "Aceptar" — coord (1196, 902)
T+6.1s     Sleep(afterAccept) = 2000ms
T+6.1s     ValidarFoco()
T+6.1s     Click At(name) → "Excel" — coord (940, 575)
T+11.1s    Sleep(afterExcel) = 5000ms
T+11.1s    Log("Exportación completada. Esperando Excel...")
─────────────────────────────────────────────────────
           ────────── FASE DE EXPORTACIÓN ──────────
─────────────────────────────────────────────────────
T+11.1s    Loop 30 veces (excelTimeout), Sleep(1000) c/u
T+11.1s    WinExist("ahk_class XLMAIN") — espera Excel
           (en logs reales: Excel detectado a los ~2s)

           ────────── FASE WATCHER ──────────
T+13s      EnvGet("LOCALAPPDATA") → Temp\tresc
T+13s      Verifica que Temp\tresc\ exista
T+13s      exportsDir = ../automation-watcher/3c_exports/
T+13s      Loop 60 veces (60s timeout), Sleep(1000) c/u
           (en logs reales: archivo detectado a los ~2s)
T+15s      Loop Files downloadDir "\tresc*.xls" → encuentra
T+15s      FileCopy → exportsDir\ + WinClose Excel + ExitApp
```

### 13.3 Estado del Excel durante la exportación

| Pregunta | Respuesta |
|----------|-----------|
| ¿Qué ventana queda activa tras click Excel? | Excel (ahk_class XLMAIN). 3C lanza Excel automáticamente. |
| ¿El Excel se abre automáticamente? | **Sí.** 3C abre Excel con el archivo exportado. |
| ¿El archivo se descarga sin abrirse? | **No.** Se abre. Se guarda en `%LOCALAPPDATA%\Temp\tresc\tresc{N}.xls`. |
| ¿Queda un PDF o Excel abierto al finalizar? | **No.** El script cierra Excel explícitamente (`WinClose XLMAIN`). |

### 13.4 Estado final del sistema

El script **no vuelve al menú principal de 3C**. Esto es lo que sucede exactamente:

1. AHK hace clic en **"Excel"** (último click de navegación)
2. 3C genera el reporte y abre Excel
3. El watcher detecta el archivo, lo copia, cierra Excel
4. **ExitApp** — el script termina

**3C queda en la pantalla donde estaba después de hacer clic en "Excel"** — la ventana del reporte de existencias generado (con el botón de Excel ya clickeado). No se presiona Esc ni se navega de vuelta al menú principal.

### 13.5 Último paso antes de terminar

```
WinClose("ahk_class XLMAIN")    ← cierra Excel
ExitApp                          ← script termina
```

### 13.6 Ventanas abiertas al finalizar

| Elemento | Estado al finalizar |
|----------|-------------------|
| Ventana 3C | **Abierta** — en pantalla de reporte (NO menú principal) |
| Excel | **Cerrado** — WinClose explícito |
| Chrome/Edge | **Minimizados** — NO se restauran |
| AHK tray icon | **No aparece** — `#NoTrayIcon` |
| AHK proceso | **Terminado** — ExitApp |

**¿Puede romper una segunda ejecución consecutiva?** **Sí, potencialmente.**

Si se ejecuta el script dos veces seguidas sin intervención manual:
1. La segunda ejecución comienza con `Ctrl+Home` (resync)
2. 3C está en la pantalla del reporte de existencias (NO en el menú principal)
3. `Ctrl+Home` debería volver al menú principal — **si funciona**, la navegación se reinicia correctamente
4. **Si no funciona** (depende de cómo 3C maneje Ctrl+Home en esa pantalla), las coordenadas serán incorrectas

### 13.7 Diagrama de flujo completo

```
INICIO
   │
   ├── Sleep(1000) — pausa inicial
   ├── WinMinimize("chrome.exe") / WinMinimize("msedge.exe")
   │
   ├── WinExist("3C")? ──NO──> ExitApp (ERROR)
   │   └──SÍ──> WinActivate + WinWaitActive
   │
   ├── SendInput("^Home") — Ctrl+Home (resync) + Sleep(300)
   │
   ├── Click "Almacenes" (888,189) → Sleep(500) → ValidarFoco
   ├── Click "Informes" (921,370)  → Sleep(500) → ValidarFoco
   ├── Click "Existencias" (1105,401) → Sleep(500) → ValidarFoco
   ├── Click "Depositos" (704,476) → Sleep(500) → ValidarFoco
   ├── Click "SeleccionarTodos" (962,858) → Sleep(500) → ValidarFoco
   ├── Click "Consulta" (440,341) → Sleep(300) → ValidarFoco
   ├── Click "Aceptar" (1196,902) → Sleep(2000) → ValidarFoco
   ├── Click "Excel" (940,575)    → Sleep(5000)    ◄ ÚLTIMO CLICK
   │
   ├── Loop 30s: WinExist("XLMAIN")?
   │   ├── No encontrado → Log + ExitApp
   │   └── Encontrado → Log("Excel detectado")
   │
   ├── Verificar Temp\tresc\ existe? ──NO──> ExitApp
   │   └──SÍ
   │       └── Loop 60s: buscar tresc*.xls
   │           ├── Encontrado → FileCopy + WinClose Excel + ExitApp (ÉXITO)
   │           └── Timeout → ExitApp (ERROR)
   │
   └── (catch) Log error + ExitApp

ESTADO FINAL:
   3C:   Abierta en pantalla de reporte (NO menú principal)
   Excel: Cerrado
   Navegador: Minimizado
   Archivo: En automation-watcher/3c_exports/tresc{N}.xls
```

### 13.8 Cambios necesarios para múltiples módulos secuenciales

#### Estado de 3C después del stock

Después del click en "Excel", 3C genera el reporte y abre Excel. Cuando AHK cierra Excel, 3C queda en la **pantalla del reporte de existencias** — NO en el menú principal.

Para continuar con otro módulo, hay que **volver al menú principal** primero. El `Ctrl+Home` del siguiente script podría funcionar, pero no es confiable.

#### Modificaciones al AHK actual para dejar estado predecible

```ahk
; Después de copiar el archivo y cerrar Excel:
WinClose("ahk_class XLMAIN")     ← ya existe

; Volver al menú principal de 3C:
WinActivate(windowTitle)
SendInput("^Home")
Sleep(500)
SendInput("{Esc}")               ← por si hay diálogos
Sleep(300)
SendInput("^Home")
Sleep(300)
```

#### Estrategia recomendada: un solo script con etapas

```ahk
; sync_3c_completo.ahk
Etapa := "stock"     ; "stock" | "reparaciones" | "ventas" | "todas"

if (Etapa = "stock" or Etapa = "todas") {
    NavigateToStock()
    ExportAndCopy("stock_")
    ReturnToMenu()
}

if (Etapa = "reparaciones" or Etapa = "todas") {
    NavigateToRepairs()
    ExportAndCopy("repair_")
    ReturnToMenu()
}

if (Etapa = "ventas" or Etapa = "todas") {
    NavigateToVentas()
    ExportAndCopy("ventas_")
    ReturnToMenu()
}
```

Cada fase:
1. Navega desde el menú principal al módulo
2. Aplica filtros
3. Exporta a Excel
4. Espera el archivo en `Temp\tresc\`
5. Copia con prefijo del módulo (ej: `stock_tresc{N}.xls`)
6. Vuelve al menú principal

#### Requisitos para implementación

| Necesidad | Solución |
|-----------|----------|
| Volver al menú principal | `Ctrl+Home + Esc + Ctrl+Home` al final de cada etapa |
| Foco en 3C | `WinActivate(windowTitle)` antes de cada etapa |
| Archivos distintos por módulo | Prefijo en nombre: `stock_`, `repair_`, `ventas_` |
| Parser distinto por módulo | El agente elige según el prefijo del archivo |
| Tiempo total | Timeout del agente = 120s × N módulos |
| Fallo parcial | Si una etapa falla, continuar con la siguiente |
| Coordenadas por módulo | Nuevas entradas en config.ini por módulo |
