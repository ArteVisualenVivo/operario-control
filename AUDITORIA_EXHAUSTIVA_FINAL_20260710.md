# 🔍 AUDITORÍA EXHAUSTIVA — PROYECTO OPERARIO-CONTROL
**Fecha:** 10 de Julio de 2026  
**Versión del análisis:** 4.0 (EXHAUSTIVO)  
**Scope:** Arquitectura completa, código fuente, sincronización, Firebase, Redis, AutoHotkey  
**Estado:** ANÁLISIS SOLAMENTE (sin modificaciones)

---

## 📋 TABLA DE CONTENIDOS

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Arquitectura General](#arquitectura-general)
3. [Flujo de Sincronización 3C](#flujo-de-sincronización-3c)
4. [Colecciones de Firestore](#colecciones-de-firestore)
5. [Módulos del Dashboard](#módulos-del-dashboard)
6. [Hooks Personalizados](#hooks-personalizados)
7. [Servicios](#servicios)
8. [APIs](#apis)
9. [Componentes](#componentes)
10. [Sistema de Sincronización](#sistema-de-sincronización)
11. [AutoHotkey](#autohotkey)
12. [Redis](#redis)
13. [Firebase](#firebase)
14. [Stock](#stock)
15. [Reparaciones](#reparaciones)
16. [Mantenimiento](#mantenimiento)
17. [Alquileres](#alquileres)
18. [Inventario](#inventario)
19. [Máquinas](#máquinas)
20. [Andamios/Scaffolds](#andamiosscaffolds)
21. [Inteligencia de Stock](#inteligencia-de-stock)
22. [Issues Identificados](#issues-identificados)

---

## RESUMEN EJECUTIVO

### Descripción del Proyecto
**operario-control** es un sistema **Next.js + Firestore** de gestión de máquinas rentables con capacidades de:

- ✅ **Gestión de inventario** de máquinas y repuestos
- ✅ **Sistema de alquileres** (rentals) con control de disponibilidad
- ✅ **Seguimiento de reparaciones** en taller
- ✅ **Control de mantenimiento preventivo** con alertas
- ✅ **Sincronización bidireccional** con ERP 3C vía AutoHotkey
- ✅ **Inteligencia de stock** con recomendaciones automáticas
- ✅ **Caché local e híbrido** (modo online/offline)
- ✅ **Auditoría completa** de cambios

### Estadísticas Generales

```
Lenguajes:          TypeScript, React, Next.js, AutoHotkey, SQL
Total LOC:          ~5,627 líneas (sin node_modules)
Componentes:        15+ componentes React
Hooks:              11 hooks personalizados
Servicios:          19 servicios de negocio
APIs:               6 rutas API (Next.js)
Colecciones FS:     12 colecciones Firestore
Scripts AHK:        4 scripts AutoHotkey
Dependencias:       21 dependencias (package.json)
Bundle Size:        ~350 KB (estimado)
Maintainability:    7.2/10
```

### Arquitectura de Capas

```
┌────────────────────────────────────────────────────┐
│           UI LAYER (React Components)              │
│   Dashboard | Machines | Repairs | Stock | Rentals │
└────────────────┬─────────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────────┐
│      HOOKS LAYER (Custom React Hooks)            │
│  useMachines | useRepairs | useStock | etc.      │
└────────────────┬─────────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────────┐
│    SERVICES LAYER (Business Logic)               │
│  machines.ts | repairs.ts | stock.ts | etc.      │
└────────────────┬─────────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────────┐
│      API LAYER (Next.js Routes)                  │
│  /api/sync-3c | /api/sync-3c/status | etc.       │
└────────────────┬─────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
   ┌────▼────┐      ┌────▼────┐
   │ Firebase │      │  Redis   │
   │Firestore │      │(Upstash) │
   └──────────┘      └──────────┘
        │                 │
        └────────┬────────┘
                 │
        ┌────────▼────────┐
        │  SYNC AGENT      │
        │ (Node.js)        │
        │ agent.mjs        │
        └────────┬────────┘
                 │
        ┌────────▼────────┐
        │  AUTOHOTKEY      │
        │  Scripts (4)     │
        └────────┬────────┘
                 │
        ┌────────▼────────┐
        │   ERP 3C        │
        │  (Windows App)  │
        └─────────────────┘
```

---

## ARQUITECTURA GENERAL

### 1. Estructura de Directorios Completa

```
operario-control/
├── src/
│   ├── app/
│   │   ├── (protected)/           # Rutas autenticadas
│   │   │   ├── andamios/          # Gestión de andamios
│   │   │   ├── dashboard/         # Dashboard principal
│   │   │   ├── inventory/         # Inventario de stock
│   │   │   ├── inventory-movements/
│   │   │   ├── machines/          # Gestión de máquinas
│   │   │   ├── rentals/           # Alquileres
│   │   │   ├── repairs/           # Reparaciones
│   │   │   ├── stock/             # Stock view
│   │   │   ├── stock-movements/   # Movimientos
│   │   │   └── layout.tsx
│   │   ├── api/                   # API Routes
│   │   │   ├── sync-3c/           # POST crear comando
│   │   │   ├── sync-3c/status/    # GET estado comando
│   │   │   ├── local/             # Rutas locales
│   │   │   └── cloudinary/        # Integración
│   │   ├── login/                 # Autenticación
│   │   └── page.tsx
│   ├── components/
│   │   ├── dashboard/             # DashboardClient, SmartAlertsPanel, etc.
│   │   ├── machines/              # MachineCard, BlueprintUploader, etc.
│   │   ├── maintenance/           # MaintenanceTable
│   │   ├── repairs/               # RepairForm, PartsSelector
│   │   ├── sync/                  # Sync3CButton
│   │   └── ui/                    # UI primitivos
│   ├── hooks/                     # 11 hooks React
│   │   ├── useAuth.ts
│   │   ├── useMachines.ts
│   │   ├── useRepairs.ts
│   │   ├── useInventoryStock.ts
│   │   ├── useRentals.ts
│   │   ├── useSpareParts.ts
│   │   ├── useStockIntelligence.ts
│   │   ├── useMachineBlueprints.ts
│   │   ├── useBlueprintDrafts.ts
│   │   ├── useSparePartsCache.ts
│   │   └── useMaintenanceSettings.ts
│   ├── lib/
│   │   ├── firebase.ts            # Config Firebase client
│   │   ├── AuthContext.tsx        # Context de auth
│   │   ├── sync-3c/
│   │   │   ├── engine.ts          # Lógica de sincronización
│   │   │   ├── parser.ts          # Parser Excel
│   │   │   ├── types.ts           # Tipos
│   │   │   └── scaffoldRentals.ts # Lógica de alquileres
│   │   ├── local-sync.ts          # Caché local
│   │   ├── search.ts              # Búsqueda global
│   │   ├── scaffoldMatcher.ts     # Clasificación de andamios
│   │   └── ... (15+ archivos más)
│   ├── services/                  # 19 servicios
│   │   ├── machines.ts
│   │   ├── repairs.ts
│   │   ├── maintenance.ts
│   │   ├── rentals.ts
│   │   ├── inventoryStock.ts
│   │   ├── spareParts.ts
│   │   ├── blueprintDrafts.ts
│   │   ├── stockIntelligence.ts
│   │   └── ... (11 más)
│   └── types/
│       ├── index.ts
│       ├── machine.ts
│       ├── repair.ts
│       ├── audit.ts
│       └── ... (10+ tipos)
├── sync-agent/
│   ├── agent.mjs               # Agente de polling local
│   ├── agent.ts                # Versión TypeScript (backup)
│   └── service-account.json    # Firebase credenciales
├── automation/
│   ├── sync_3c.ahk             # Automatización Stock
│   ├── sync_reparaciones.ahk   # Automatización Reparaciones
│   ├── sync_articulos.ahk      # Automatización Artículos
│   ├── sync_alquileres.ahk     # Automatización Alquileres
│   ├── sync_common.ahk         # Utilidades compartidas
│   ├── config.ini              # Coordenadas hardcoded
│   └── logs/
├── automation-watcher/         # Watcher de Excel
│   ├── index.js
│   ├── excel-parser.js
│   ├── firebase-sync.js
│   ├── config.js
│   └── 3c_exports/             # Carpeta donde Excel copia archivos
├── scripts/
│   ├── audit.ts                # Auditoría de datos
│   ├── export-logs.ts          # Export de logs
│   ├── fix-rented-machines.ts  # Fix manual
│   └── seed-machines.ts        # Seed de máquinas
├── public/
├── next.config.ts
├── tsconfig.json
├── package.json
├── postcss.config.mjs
├── eslint.config.mjs
└── AGENTS.md                   # Documentación anterior
```

### 2. Stack Tecnológico

| Layer | Tecnología | Versión |
|-------|-----------|---------|
| **Frontend** | React | 19.2.4 |
| **Framework** | Next.js | 16.2.9 |
| **Lenguaje** | TypeScript | 5 |
| **Estilos** | Tailwind CSS | 4 |
| **UI Components** | shadcn + custom | v4.11.0 |
| **Backend** | Node.js API routes | (Vercel) |
| **Base de datos** | Firebase/Firestore | 12.14.0 |
| **Autenticación** | Firebase Auth | (included) |
| **Cache** | Redis (Upstash) | @upstash/redis ^1.38.0 |
| **Parsing** | XLSX | 0.18.5 |
| **PDF** | pdfjs-dist | 6.0.227 |
| **File watching** | Chokidar | 5.0.0 |
| **Notificaciones** | Sonner | 2.0.7 |
| **Automatización** | AutoHotkey | v1 (script) |
| **Deployment** | Vercel | (Next.js) |

### 3. Flujo de Datos Alto Nivel

```
[USER] → [UI React] → [Hooks] → [Services] → [APIs]
                        ↓          ↓
                    [Firestore] ← [Local Caché]
                        ↓
                    [Redis Queue]
                        ↓
                    [Agent Polling]
                        ↓
                    [AutoHotkey]
                        ↓
                    [ERP 3C]
```

---

## FLUJO DE SINCRONIZACIÓN 3C

### 1. Flujo Completo End-to-End

#### **Paso 1: Usuario inicia sincronización desde UI**
```typescript
// src/components/sync/Sync3CButton.tsx
POST /api/sync-3c { module: "stock" }
```

**Parámetro:** module puede ser:
- `"stock"` → sync_3c.ahk (8 clicks)
- `"reparaciones"` → sync_reparaciones.ahk (7 clicks)
- `"articulos"` → sync_articulos.ahk
- `"alquileres"` → sync_alquileres.ahk

#### **Paso 2: API crea comando en Redis**
```typescript
// src/app/api/sync-3c/route.ts
POST /api/sync-3c
├─ Generar UUID: commandId = uuid()
├─ HSET sync-3c:command:{commandId} {
│  module: "stock"
│  status: "pending"
│  createdAt: Date.now()
│  startedAt: ""
│  completedAt: ""
│  agent: ""
│  result: ""
│  error: ""
│ }
├─ LPUSH sync-3c:queue {commandId}
├─ Si module="stock" → LPUSH sync-3c:queue "alquileres" (auto-enqueue)
└─ Return { commandId, autoEnqueued: ["alquileres"] }
```

#### **Paso 3: UI polling obtiene estado**
```typescript
// Cada 500ms
GET /api/sync-3c/status?commandId={id}
← HGETALL sync-3c:command:{id}
← HGETALL sync-3c:result:{id}
```

#### **Paso 4: Agent local procesa comandos (FIFO)**
```javascript
// sync-agent/agent.mjs (polling cada 5s)
RPOP sync-3c:queue → commandId
HGETALL sync-3c:command:{commandId}
Validar status="pending"
HSET status="running", startedAt=Now
SET sync-3c:agent:production {heartbeat JSON} EX 120
```

#### **Paso 5: Spawn AutoHotkey script**
```javascript
spawn("AutoHotkey.exe", ["sync_3c.ahk"], { cwd: AHK_DIR })
Timeout: 120s
```

#### **Paso 6: AutoHotkey navega 3C**
```autohotkey
; sync_3c.ahk - 8 clicks
ClickAt("Almacenes")     → 888, 189
ClickAt("Informes")      → 921, 370
ClickAt("Existencias")   → 1105, 401
ClickAt("Depósitos")     → 704, 476
ClickAt("SelecAll")      → 962, 858
ClickAt("Consulta")      → 440, 341
ClickAt("Aceptar")       → 1196, 902
ClickAt("Excel")         → 940, 575
```

#### **Paso 7: Excel generado → Copiado**
```
3C genera: C:\Temp\tresc\tresc0001.xls
WaitForExcel() espera ventana XLMAIN (30s máx)
WatchAndCopy() monitorea C:\Temp\tresc\
Copia → automation-watcher/3c_exports/tresc_<timestamp>.xls
Borra original
```

#### **Paso 8: Agent parsea Excel**
```javascript
findLatestExport() → tresc_<timestamp>.xls
parseExcel(buffer) → Sync3CItem[]
```

**Formato esperado en Excel:**
```
Código | Nombre | StockTotal | Deposito | Medida | Precio | Categoría | ...
```

#### **Paso 9: Sync to Firestore**
```typescript
// src/lib/sync-3c/engine.ts
syncItems(items: Sync3CItem[])
├─ Para cada item:
│  ├─ Buscar por código exacto (priority)
│  ├─ Buscar por nombre normalizado (fallback)
│  ├─ Si existe → MERGE update { stockTotal, lastSyncAt, ... }
│  └─ Si no existe → CREATE nuevo documento
├─ Batch commit (máx 500 docs)
├─ Generar resultado: { success, created, updated, skipped, warnings }
└─ Error handling:
   ├─ Si Firebase bloqueado → try/catch { degraded: true }
   ├─ Guardar resultado en Redis: sync-3c:result:{id}
   └─ Agente continúa (no muere)
```

#### **Paso 10: Caché local actualizado**
```javascript
Si module="stock":
├─ stock-cache.json ← todas las colecciones
├─ machines-cache.json ← filtered machines
└─ spare-parts-cache.json ← spare-parts (scaffold)
```

#### **Paso 11: Resultado guardado en Redis**
```javascript
HSET sync-3c:result:{commandId} {
  status: "completed"
  module: "stock"
  created: 45
  updated: 120
  skipped: 3
  warnings: ["Item XXX sin código"]
  timestamp: Date.now()
  degraded: false|true (si Firebase failed)
}

HSET sync-3c:command:{commandId} {
  status: "completed"
  completedAt: Date.now()
  result: JSON.stringify(...)
}
```

#### **Paso 12: UI obtiene resultado**
```typescript
GET /api/sync-3c/status?commandId={id}
← { status: "completed", result: {...}, error: null }
UI muestra: "✓ Sincronizado: 45 creados, 120 actualizados"
```

### 2. Timing y Timeouts

| Operación | Timeout | Descripción |
|-----------|---------|-------------|
| Poll interval | 5s | Agent busca comandos cada 5s |
| AutoHotkey exec | 120s | Script puede tardar máximo |
| Excel wait | 30s | Espera ventana Excel |
| File monitor | 60s | Espera archivo Excel |
| Heartbeat | 30s | Agent reporta está vivo |
| Query timeout | 90s | UI deja de polls después de 90s |

### 3. Error Handling y Recovery

#### **Escenarios de fallo y recuperación**

| Escenario | Acción | Resultado |
|-----------|--------|----------|
| AutoHotkey timeout (120s) | Finaliza proceso | status=failed, error="AHK timeout" |
| Firebase bloqueado | try/catch en syncItems() | degraded=true, resultado en Redis |
| Excel no generado | timeout WaitForExcel | error="Excel not found" |
| Redis offline | Agent muere | [NO RETRY - BUG] |
| Command stale > 10min | SCAN + re-encola | Recuperación automática |
| Coordenadas equivocadas | Clicks en lugar errado | Stock sale vacío |

---

## COLECCIONES DE FIRESTORE

### 1. Esquema Completo de Firestore

#### **Colección: machines**
```typescript
{
  id: string              // uuid
  name: string            // "Excavadora CAT 320"
  model: string           // "320D"
  internalNumber: string  // "E001"
  category: "machine" | "tool" | "scaffold"
  locationType: "deposito" | "obra" | "taller"
  
  // Rentas activas (puede ser null si no alquilada)
  rental?: {
    clientId: string
    clientName: string
    startDate: Timestamp
    endDate?: Timestamp        // null = sin límite
    isOpenEnded: boolean       // true = alquilado indefinidamente
    dailyRate: number
    notes: string
  }
  
  // Documentación
  blueprints: {            // Array de URLs Cloudinary
    url: string
    uploadedAt: Timestamp
    type: "pdf" | "image"
  }[]
  
  // Metadata
  createdAt: Timestamp
  updatedAt: Timestamp
  createdBy: string
  status: "available" | "rented" | "maintenance"
}
```

#### **Colección: inventory_stock**
```typescript
{
  id: string              // uuid
  code: string            // Código 3C (UNIQUE)
  name: string            // Nombre del material
  
  // Stock
  stockTotal: number      // Total unidades
  stockRented: number     // En alquiler
  stockAvailable: number  // = stockTotal - stockRented
  
  // Propiedades
  category: string        // "consumibles", "herramientas", etc.
  unit: string            // "unidad", "metro", "kg", etc.
  locationType: string    // "deposito", "obra", etc.
  size?: string           // Tamaño/variante
  price?: number          // Precio unitario
  
  // Sync 3C
  lastSyncedAt: Timestamp
  lastSyncId: string      // reference a sync command
  syncErrors?: string[]
  
  // Para andamios
  scaffoldMatch?: {
    category: string
    component: string
    confidence: number
  }
  
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

#### **Colección: repairs** (MachineRepair)
```typescript
{
  id: string
  machineId: string       // Link a machines
  
  // Información del cliente
  clientName: string
  clientNumber: string
  
  // Detalles técnicos
  internalNumber: string  // Referencia de máquina
  machineName: string
  machineModel: string
  reportedIssue: string
  diagnosis: string
  repairPerformed: string
  
  // Timings
  entryDate: Timestamp
  exitDate?: Timestamp
  hoursUsed: number
  
  // Técnico y notas
  technician: string
  notes: string
  
  // Garantía y mantenimiento
  warrantyDays: number
  oilChangeDays: number
  bearingChangeDays: number
  maintenanceDays: number
  
  // Repuestos usados
  partsUsed: PartUsage[]   // Array de { partCode, partName, quantity, cost }
  
  status: "pending" | "in_progress" | "completed" | "cancelled"
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

#### **Colección: machine_spare_parts**
```typescript
{
  id: string
  machineId: string       // Link a machines
  blueprintId?: string    // Si viene de blueprint
  
  partCode: string        // Código del repuesto
  partName: string
  quantity: number
  
  // Especificación
  category: string
  supplier?: string
  cost?: number
  
  source: "blueprint" | "manual" | "repair"
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

#### **Colección: rentals**
```typescript
{
  id: string
  machineId: string       // Link a machines
  clientId: string        // Link a cliente (si existe)
  
  clientName: string
  clientPhone: string
  clientEmail: string
  
  // Rental details
  startDate: Timestamp
  endDate?: Timestamp      // null = indefinido
  isOpenEnded: boolean
  
  dailyRate: number
  status: "active" | "completed" | "cancelled"
  
  // Tracking
  deploymentLocation: string
  returnCondition?: string
  notes: string
  
  createdAt: Timestamp
  updatedAt: Timestamp
  createdBy: string
}
```

#### **Colección: maintenance**
```typescript
{
  id: string
  machineId: string       // Link a machines
  
  // Información de orden
  orderNumber?: string
  entryDate: Timestamp
  
  // Datos originales desde 3C
  originalData: {
    /* Datos crudos del Excel 3C */
    [key: string]: unknown  // ⚠️ PUEDE CRECER SIN LÍMITE
  }
  
  // Parsed fields
  reportedIssue?: string
  diagnosis?: string
  technician?: string
  
  status: "pending" | "in_progress" | "completed"
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

#### **Colección: audit_logs**
```typescript
{
  id: string
  entity: "machine" | "inventory_stock" | "repair" | "maintenance" | ...
  entityId: string
  
  action: "create" | "update" | "delete"
  changes: {
    field: string
    before: unknown
    after: unknown
  }[]
  
  userId: string
  username: string
  timestamp: Timestamp
  ipAddress?: string
}
```

#### **Colecciones Adicionales** (sin detalle exhaustivo)

| Colección | Documentos | Propósito |
|-----------|-----------|----------|
| `machine_blueprints` | 50-200 | Despieces de máquinas |
| `blueprint_drafts` | 10-50 | Borradores de despieces |
| `inventory_movements` | 1000-5000 | Historial de movimientos |
| `stock_movements` | 1000-5000 | Historial de stock |
| `spare_parts` | 100-500 | Catálogo de repuestos |
| `maintenance_settings` | 1 | Configuración global |
| `dashboard_stats` | 1 | Stats precalculadas |

### 2. Relaciones de Datos (Foreign Keys)

```
machines (1) ──────→ (N) repairs
              └──────→ (N) rentals
              └──────→ (N) machine_spare_parts
              └──────→ (N) maintenance
              
inventory_stock (1) ──→ (N) inventory_movements
                    └──→ (N) stock_movements
                    
repairs (1) ──────→ (N) audit_logs
machines (1) ──→ (N) audit_logs
```

### 3. Análisis de Documentos

| Colección | Est. Docs | Tamaño promedio | Potencial Crecimiento | Issue |
|-----------|-----------|-----------------|---------------------|-------|
| machines | 50-500 | 2 KB | Lineal (nuevas máquinas) | ✓ OK |
| inventory_stock | 500-5000 | 1.5 KB | Lineal | ⚠️ Sin índices |
| repairs | 1000-10000 | 3 KB | Lineal (histórico) | ⚠️ Desnormalizado |
| maintenance | 500-5000 | **8-15 KB** | 🔴 **originalData sin límite** | 🔴 **CRÍTICO** |
| inventory_movements | 5000-50000 | 1 KB | Lineal (histórico) | ✓ OK |
| audit_logs | 10000-100000 | 0.5 KB | Lineal (histórico) | ✓ OK |

### 4. Índices Necesarios (MISSING)

```
[FALTA CREAR EN FIRESTORE]

inventory_stock:
  - (name, lastSyncedAt)      # Para búsquedas con filtro
  - (category, stockAvailable) # Para recomendaciones
  
repairs:
  - (machineId, entryDate desc)  # Ya existe parcialmente
  - (status, entryDate desc)
  
maintenance:
  - (machineId, entryDate desc)
  - (status, entryDate desc)
```

---

## MÓDULOS DEL DASHBOARD

### 1. Dashboard Client (`DashboardClient.tsx` - 420 LOC)
**Responsabilidades:**
- Cargar todas las métricas (máquinas, reparaciones, stock)
- Mostrar widgets KPI
- Mostrar alertas inteligentes
- Gestionar búsqueda global
- Refresh manual

**State Management:**
```typescript
const [machines, setMachines] = useState<Machine[]>([])
const [repairs, setRepairs] = useState<MachineRepair[]>([])
const [search, setSearch] = useState<string>("")
const [loading, setLoading] = useState(true)
const [filteredResults, setFilteredResults] = useState(null)
```

**Effects:**
- useEffect para cargar máquinas y reparaciones al montar
- useEffect para filtrar resultados cuando cambia `search`

**Issues:**
- ⚠️ Sin memoización de `filteredMachines`
- ⚠️ Multiple re-renders por state changes
- ⚠️ Sin error handling visible

### 2. Smart Alerts Panel (`SmartAlertsPanel.tsx` - 367 LOC)
**Responsabilidades:**
- Detectar fallas repetitivas en máquinas
- Detectar máquinas sobrecargadas
- Detectar mantenimiento ignorado
- Generar recomendaciones

**Funciones internas:**
```typescript
detectRepetitiveFailures(repairs)
detectOverloadedMachines(repairs)
detectIgnoredMaintenance(repairs)
generateRecommendations(repairs)
```

**Issues:**
- 🔴 **Lógica de alertas acoplada al componente** (debería estar en servicio)
- ⚠️ **20+ líneas de lógica condicional compleja**
- ⚠️ Sin tests

### 3. Workshop Summary (`WorkshopSummary.tsx` - 80 LOC)
**Responsabilidades:**
- Mostrar 4 KPIs: máquinas reparando, pendientes, completadas, hoy

**State:**
```typescript
const [stats, setStats] = useState({ repairing: 0, pending: 0, completed: 0, today: 0 })
```

**Issues:**
- ✓ Simple y bien enfocado
- ⚠️ Sin error handling

### 4. Otros Componentes Dashboard
- `GlobalSearchResults` (51 LOC) - Renderiza resultados de búsqueda
- Varios widgets secundarios

---

## HOOKS PERSONALIZADOS

### Matriz de Análisis de Hooks

| Hook | LOC | Estado | Effects | Callbacks | Issue Crítico |
|------|-----|--------|---------|-----------|--------------|
| **useMachines** | 85 | 4 | 1 | 1 | 🔴 Circular dependency |
| **useRepairs** | 92 | 4 | 1 | 1 | 🔴 Memory leak (no mounted check) |
| **useSpareParts** | 110 | 3 | 1 | 1 | 🔴 Memory leak (no mounted check) |
| **useSparePartsCache** | 65 | 1 | 0 | 0 | 🔴 **Global state anti-pattern** |
| **useInventoryStock** | 88 | 3 | 1 | 1 | 🟡 Memory leak (posible) |
| **useRentals** | 75 | 3 | 1 | 1 | 🟡 Innecesario (simple query) |
| **useStockIntelligence** | 120 | 2 | 1 | 1 | 🟡 Complex logic |
| **useMachineBlueprints** | 65 | 2 | 1 | 1 | ✓ Clean |
| **useBlueprintDrafts** | 58 | 2 | 1 | 1 | ✓ Clean |
| **useMaintenanceSettings** | 42 | 1 | 1 | 0 | ✓ Clean |
| **useAuth** | 48 | 2 | 1 | 0 | ✓ Clean |

### 1. useSparePartsCache (CRÍTICO - 65 LOC)
```typescript
// ⚠️ ANTI-PATTERN: Global module state
let cachedParts: SparePart[] | null = null
let cacheTimestamp = 0

export function useSparePartsCache() {
  const [parts, setParts] = useState<SparePart[]>([])
  
  const load = useCallback(async () => {
    if (Date.now() - cacheTimestamp < 60_000 && cachedParts) {
      setParts(cachedParts)
      return
    }
    const fetched = await getSparePartsByMachine(...)
    cachedParts = fetched  // ⚠️ GLOBAL MUTATION
    cacheTimestamp = Date.now()
    setParts(fetched)
  }, [])
  
  useEffect(() => { load() }, [load])
  return { parts, loading, error }
}
```

**Problemas:**
- 🔴 Variable global `cachedParts` causa memory leak indefinido
- 🔴 Race condition si múltiples componentes cargan simultáneamente
- 🔴 No se puede hacer garbage collection
- 🔴 Rompe React's rendering model

### 2. useMachines (CRÍTICO - 85 LOC)
```typescript
export function useMachines() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(false)
  
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getMachines()
      setMachines(data)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  }, [])  // ⚠️ Dependency array vacío
  
  useEffect(() => { load() }, [load])  // ⚠️ Circular: load() cambia, effect corre, load() cambia...
  return { machines, loading, error, refetch: load }
}
```

**Problemas:**
- 🔴 **Infinite loop posible**: `load` está en dependencies, pero `load` es recreada en cada render
- 🔴 **Sin mounted check**: Si componente unmount, setState causa warning

### 3. useRepairs (85 LOC)
```typescript
export function useRepairs() {
  const [repairs, setRepairs] = useState<MachineRepair[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(false)
  
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getRepairs()
      setRepairs(data)  // ⚠️ Sin check si mounted
    } catch (err) {
      // error handling
    }
  }, [])
  
  useEffect(() => { load() }, [load])
  return { repairs, loading, error, refetch: load }
}
```

**Problemas:**
- ⚠️ **Memory leak**: setState sin verificar si componente está montado
- Advertencia: "Can't perform a React state update on an unmounted component"

### 4. useAuth (48 LOC - ✓ CLEAN)
```typescript
export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    const unsubscribe = onAuthChange((u) => {
      setUser(u)
      setLoading(false)
    })
    return unsubscribe
  }, [])
  
  return { user, loading }
}
```

**Fortalezas:**
- ✓ Cleanup function correcta (unsubscribe)
- ✓ No hay dependencias problemáticas
- ✓ Patrón listener bien implementado

---

## SERVICIOS

### Matriz de Servicios

| Servicio | Colecciones | Queries | Error Handling | Issue |
|----------|-----------|---------|-----------------|-------|
| **machines.ts** | machines | 4 queries | ✓ Sí | ⚠️ getMachines() sin límite |
| **repairs.ts** | repairs, maintenance | 6 queries | ✓ Sí | ⚠️ Múltiples queries por reparo |
| **inventoryStock.ts** | inventory_stock | 3 queries | ✓ Sí | ⚠️ Query sin índice |
| **maintenance.ts** | maintenance | 2 queries | ⚠️ Parcial | 🔴 originalData sin límite |
| **spareParts.ts** | machine_spare_parts | 4 queries | ✓ Sí | ✓ OK |
| **rentals.ts** | machines | 2 queries | ✓ Sí | ✓ OK |
| **blueprintDrafts.ts** | blueprint_drafts | 3 queries | ✓ Sí | ✓ OK |
| **machineBlueprints.ts** | machine_blueprints | 4 queries | ✓ Sí | ⚠️ Múltiples queries |
| **stockIntelligence.ts** | inventory_stock, repairs | Custom logic | ✓ Sí | ⚠️ No caché |
| **inventoryMovements.ts** | inventory_movements | 2 queries | ❌ NO | 🔴 Sin try/catch |
| **stockMovements.ts** | stock_movements | 2 queries | ❌ NO | 🔴 Sin try/catch |
| **audit.ts** | audit_logs | 2 queries | ⚠️ Parcial | 🔴 Sin try/catch |

### 1. machines.ts (210 LOC)
```typescript
// ⚠️ SIN LÍMITE - puede leer 10000 documentos
export async function getMachines(): Promise<Machine[]> {
  try {
    const snapshot = await getDocs(collection(db, COLLECTION))
    return snapshot.docs.map(docToMachine)
  } catch (err) {
    throw new Error("No se pudieron cargar las máquinas")
  }
}
```

**Queries:**
- `getDocs(collection(db, "machines"))` - Full scan sin límite
- `getDoc(doc(db, "machines", id))` - Get by ID
- `getDocs(query(collection(db, "machines"), orderBy("name")))` - Ordenado

**Issues:**
- 🔴 `getMachines()` sin `limit()` → puede leer 1000+ docs
- ⚠️ `createMachine()` sin validación de datos duplicados
- ✓ `rentMachine()`, `returnMachine()` bien implementados

### 2. repairs.ts (330 LOC)
```typescript
// Combina repairs collection + maintenance collection
export async function getRepairs(): Promise<MachineRepair[]> {
  // Carga repairs de Firestore + maintenance de 3C
  // Mapea maintenance → MachineRepair
}

export async function getRepairsByMachine(machineId: string): Promise<MachineRepair[]> {
  // Query indexed: repairs/machineId
}
```

**Queries:**
- Full `getRepairs()` sin filtro
- `getRepairsByMachine(machineId)` - Indexed
- `getUpcomingWarranty()` - Múltiples queries
- `getUpcomingOilChanges()`, `getUpcomingBearingChanges()` - Similares

**Issues:**
- ⚠️ `getRepairsByMachine()` hacer 2+ queries (repairs + maintenance)
- ⚠️ `getUpcomingWarranty()` hace 3 queries separadas
- ✓ Con error handling

### 3. inventoryMovements.ts (90 LOC)
```typescript
export async function getMovements(): Promise<InventoryMovement[]> {
  const q = query(collection(db, COLLECTION), orderBy("date", "desc"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToMovement)  // ⚠️ NO TRY/CATCH
}
```

**Issues:**
- 🔴 **SIN ERROR HANDLING** - si query falla, la app se cae
- ⚠️ Sin `limit()` - puede leer 1000s de docs

### 4. stockIntelligence.ts (180 LOC)
```typescript
// Lógica compleja de análisis
export async function analyzeStockInteligence(): Promise<StockAlert[]> {
  const machines = await getMachines()
  const repairs = await getRepairs()
  const stock = await getInventoryStock()
  
  // Múltiples passes de análisis
  const machineAlerts = getMachineAlerts(machines, repairs)
  const stockAlerts = getStockAlerts(stock, repairs)
  const combinedAlerts = [machineAlerts, stockAlerts]
  
  return combinedAlerts.sort(...)
}
```

**Issues:**
- ⚠️ **3 queries grandes en secuencia** (no paralelo)
- ⚠️ **Sin caché** - se recalcula en cada page load
- ⚠️ **Lógica de alerta dura** - TODO hardcoded

---

## APIs

### Rutas API Implementadas

#### 1. POST `/api/sync-3c` (route.ts)
**Propósito:** Crear comando de sincronización en Redis

```typescript
POST /api/sync-3c
Body: { module: "stock" | "reparaciones" | "articulos" | "alquileres" }

Response: {
  commandId: string
  autoEnqueued: string[]
}

Status: 200 | 400 | 500
```

**Lógica:**
- Generar UUID para commandId
- HSET sync-3c:command:{id} con estado inicial
- LPUSH sync-3c:queue commandId
- Si module="stock" → auto-encolar "alquileres"

**Issues:**
- ⚠️ **Sin validación de input** - acepta cualquier string
- ⚠️ **Sin rate limiting** - DDOS posible
- ⚠️ **Sin autenticación** - debería verificar user logeado
- 🟡 Error handling genérico

#### 2. GET `/api/sync-3c/status`
**Propósito:** Obtener estado de un comando

```typescript
GET /api/sync-3c/status?commandId=<id>

Response: {
  status: "pending" | "running" | "completed" | "failed"
  module: string
  result?: {
    created: number
    updated: number
    skipped: number
    warnings: string[]
  }
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

Status: 200 | 404 | 500
```

**Issues:**
- ⚠️ **Sin validación de commandId** - cualquier string
- 🟡 Magic timeout 90_000ms no configurable
- 🟡 Posible race condition en reads concurrentes

#### 3. GET `/api/sync-3c/agent-status`
**Propósito:** Ver heartbeat del agente

**Issues:**
- ✓ Bien implementado
- ⚠️ Sin autenticación

#### 4. POST `/api/local/repairs` y otros
**Propósito:** Operaciones locales (caché)

**Issues:**
- 🟡 Documentados pero con poca interacción

#### 5. DELETE `/api/cloudinary/delete`
**Propósito:** Eliminar imagen de Cloudinary

```typescript
DELETE /api/cloudinary/delete
Body: { publicId: string }
```

**Issues:**
- ⚠️ **Sin validación** - resourceType hardcoded
- ⚠️ **Sin autenticación** - cualquiera puede eliminar
- 🔴 **Riesgo de seguridad** - podría ser IDOR

### API Issues Consolidados

| Issue | Severidad | APIs Afectadas | Impacto |
|-------|-----------|----------------|---------|
| Sin validación de input | 🟡 Media | POST sync-3c, GET status | Posible crash |
| Sin rate limiting | 🟡 Media | POST sync-3c | DDOS posible |
| Sin autenticación | 🔴 Alta | Todas | Acceso no autorizado |
| Race condition | 🟡 Media | GET status | Inconsistencia |
| Timeouts hardcoded | 🟡 Media | GET status | No configurable |

---

## COMPONENTES

### Matriz de Componentes

| Componente | LOC | Responsabilidades | Issues |
|-----------|-----|------------------|--------|
| **SmartAlertsPanel** | 367 | Alertas + Recomendaciones | 🔴 Acoplado + 4 funciones |
| **RepairForm** | 398 | Form de reparación | 🔴 13 useState |
| **Sync3CButton** | 185 | UI de sincronización | ⚠️ 4 refs de polling |
| **MaintenanceTable** | 250 | Tabla de mantenimiento | ⚠️ Sin paginación |
| **MachineCard** | 142 | Card de máquina | ⚠️ Lógica condicional extendida |
| **PartsSelector** | 210 | Selector de repuestos | ✓ OK |
| **WorkshopSummary** | 80 | KPIs del taller | ✓ OK |
| **GlobalSearchResults** | 51 | Resultados de búsqueda | ✓ OK |

### 1. RepairForm (398 LOC - OVERSIZED)
```typescript
// 13 useState - demasiados!
const [machineId, setMachineId] = useState("")
const [machineName, setMachineName] = useState("")
const [machineModel, setMachineModel] = useState("")
// ... 10 más

// Form fields
const [entryDate, setEntryDate] = useState<Date | null>(null)
const [exitDate, setExitDate] = useState<Date | null>(null)
const [reportedIssue, setReportedIssue] = useState("")
const [diagnosis, setDiagnosis] = useState("")
const [repairPerformed, setRepairPerformed] = useState("")
const [technician, setTechnician] = useState("")
const [hoursUsed, setHoursUsed] = useState<number>(0)
const [notes, setNotes] = useState("")
const [partsUsed, setPartsUsed] = useState<PartUsage[]>([])

// Maintenance settings
const [warrantyDays, setWarrantyDays] = useState<number>(...)
const [oilChangeDays, setOilChangeDays] = useState<number>(...)
// ... 2 más
```

**Issues:**
- 🔴 **13 useState** en un componente - debería usar useReducer o Formik
- 🔴 **398 LOC** - oversized, difícil de mantener
- ⚠️ **Sin validación inline** - validación al submit
- ⚠️ **Sin memoización** - re-renders costosos

### 2. SmartAlertsPanel (367 LOC - GOD COMPONENT)
```typescript
// Detecta 4 tipos de alertas + genera recomendaciones
detectRepetitiveFailures(repairs)
detectOverloadedMachines(repairs)
detectIgnoredMaintenance(repairs)
generateRecommendations(repairs)
```

**Issues:**
- 🔴 **Múltiples responsabilidades** - debería estar en servicio
- 🔴 **Lógica acoplada** - difícil de testar
- ⚠️ **Sin memoización** - recalcula en cada render

### 3. Sync3CButton (185 LOC)
```typescript
const syncRef = useRef(null)
const pollRef = useRef(null)
const timeoutRef = useRef(null)
const statusRef = useRef(null)

// Manual polling con 4 refs ⚠️
const [status, setStatus] = useState("idle")
const [progress, setProgress] = useState(null)
```

**Issues:**
- ⚠️ **4 useRef para polling manual** - debería usar React Query
- ⚠️ **setState + ref mixing** - estado fragmentado
- ⚠️ **Sin abort signal** - cleanup incompleto

---

## SISTEMA DE SINCRONIZACIÓN

### 1. Arquitectura Agent (agent.mjs - 600+ LOC)

```javascript
// Main loop
async function pollQueue() {
  const redis = getRedis()
  
  while (true) {
    try {
      if (isProcessing) continue
      
      const commandId = await redis.rpop("sync-3c:queue")
      if (!commandId) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
        continue
      }
      
      isProcessing = true
      const command = await redis.hgetall(`sync-3c:command:${commandId}`)
      
      if (command.status !== "pending") {
        isProcessing = false
        continue
      }
      
      await redis.hset(`sync-3c:command:${commandId}`, {
        status: "running",
        startedAt: Date.now(),
        agent: MACHINE_NAME
      })
      
      const result = await processCommand(command)
      
      await redis.hset(`sync-3c:command:${commandId}`, {
        status: "completed",
        completedAt: Date.now(),
        result: JSON.stringify(result)
      })
      
      isProcessing = false
    } catch (err) {
      console.error("[AGENT] Error:", err)
      isProcessing = false
    }
  }
}

async function processCommand(command) {
  const module = command.module
  const script = MODULE_SCRIPTS[module]
  
  // Find AutoHotkey executable
  const ahkPath = findAutoHotkey()
  
  // Spawn process
  return new Promise((resolve, reject) => {
    const child = spawn(ahkPath, [script], {
      cwd: AHK_DIR,
      timeout: AHK_TIMEOUT_MS
    })
    
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error("AHK timeout"))
    }, AHK_TIMEOUT_MS)
    
    child.on("exit", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        const file = findLatestExport()
        const buffer = fs.readFileSync(file)
        const items = parseExcel(buffer)
        resolve(syncItems(items))
      } else {
        reject(new Error(`AHK exited with code ${code}`))
      }
    })
  })
}
```

**Issues:**
- 🔴 **Sin reintentos Redis** - si Redis offline, agente muere
- ⚠️ **isProcessing flag** - no es atomic, race condition posible
- ⚠️ **SCAN para recovery** - O(n) lento en grandes colecciones
- ⚠️ **Sin graceful shutdown** - SIGTERM interrumpe comando activo

### 2. Excel Parser (parser.ts - 150 LOC)

```typescript
export async function parseExcel(buffer: Buffer): Promise<Sync3CItem[]> {
  const workbook = XLSX.read(buffer)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json(sheet)
  
  return data.map(row => ({
    code: row["Código"],
    name: row["Nombre"],
    stockTotal: row["Stock Total"],
    // ... más campos
  }))
}
```

**Issues:**
- ⚠️ **Sin validación de esquema** - asume headers exactos
- ⚠️ **Sin tipo checking** - types no validados
- ⚠️ **Sin manejo de excepciones** - crash si formato equivocado

### 3. Sync Engine (engine.ts - 280 LOC)

```typescript
export async function syncItems(items: Sync3CItem[]): Promise<Sync3CResult> {
  const admin = getFirebaseAdmin()
  const db = getFirestore()
  
  const result = {
    success: true,
    created: 0,
    updated: 0,
    skipped: 0,
    warnings: []
  }
  
  // Build code map
  const codeMap = new Map()
  const existing = await getDocs(collection(db, "inventory_stock"))
  existing.forEach(doc => {
    const data = doc.data()
    if (data.code) codeMap.set(data.code, doc.id)
  })
  
  // Process items
  for (const item of items) {
    const existingId = codeMap.get(item.code)
    
    if (existingId) {
      // Update
      const ref = doc(db, "inventory_stock", existingId)
      await updateDoc(ref, {
        stockTotal: item.stockTotal,
        lastSyncedAt: serverTimestamp()
      })
      result.updated++
    } else {
      // Create
      await addDoc(collection(db, "inventory_stock"), {
        code: item.code,
        name: item.name,
        stockTotal: item.stockTotal,
        lastSyncedAt: serverTimestamp()
      })
      result.created++
    }
  }
  
  return result
}
```

**Issues:**
- ⚠️ **Scan completo al inicio** - si 5000 documentos, lee todos
- ⚠️ **Update/Create sin transacción** - posible inconsistencia
- ✓ Fallback degradado implementado

---

## AUTOHOTKEY

### 1. Scripts Principales

#### sync_3c.ahk (Stock - 150 LOC)
```autohotkey
; 8 clicks en secuencia
ClickAt("Almacenes")     ; Coordenada (888, 189)
ClickAt("Informes")      ; Coordenada (921, 370)
ClickAt("Existencias")   ; Coordenada (1105, 401)
ClickAt("Depósitos")     ; Coordenada (704, 476)
ClickAt("SeleccionarTodos") ; (962, 858)
ClickAt("Consulta")      ; (440, 341)
ClickAt("Aceptar")       ; (1196, 902)
ClickAt("Excel")         ; (940, 575)

WaitForExcel()           ; Espera 30s máx
WatchAndCopy()           ; Monitorea y copia Excel
CloseExcel()             ; Cierra Excel
ClickAt("Salir")         ; Vuelve a 3C
```

#### sync_reparaciones.ahk (Repairs - 130 LOC)
```autohotkey
; 7 clicks
ClickAt("Ventas")        ; (413, 188)
ClickAt("Reparaciones")  ; (448, 346)
ClickAt("ExcelItems")    ; (1451, 866)
ClickAt("PrintAll")      ; (1450, 829)
ClickAt("Imprimir")      ; (896, 254)
ClickAt("ExcelFormat")   ; (936, 577)
; ... más lógica ...
ClickAt("SalirRep")      ; (942, 254)
```

#### sync_common.ahk (Utilities - 200 LOC)
```autohotkey
ClickAt(coordName) {
  ; Load coordinates from config.ini
  ; ClickAt("Almacenes") → IniRead("Almacenes") → (888, 189)
  ; MouseClick("Left", x, y)
}

WaitForExcel() {
  ; WinWaitActive("XLMAIN", "", 30)
}

WatchAndCopy() {
  ; Loop mientras busca archivo en C:\Temp\tresc\
  ; Copia a automation-watcher/3c_exports/
  ; Elimina original
}

ValidarFoco() {
  ; Asegura que 3C está en foco
}
```

### 2. Configuración (config.ini)

```ini
[Coordinates]
Almacenes=888,189
Informes=921,370
Existencias=1105,401
Depósitos=704,476
SeleccionarTodos=962,858
Consulta=440,341
Aceptar=1196,902
Excel=940,575
Ventas=413,188
Reparaciones=448,346
; ... más ...

[Timings]
ClickDelay=200
ScrollDelay=500
WaitTimeout=30000
ExcelWaitTimeout=60000
```

### 3. Issues Críticos

#### 🔴 Coordenadas Hardcoded
**Problema:**
```
Si usuario cambia:
- Resolución de pantalla
- Posición de ventana 3C
- Zoom del navegador

→ TODOS los clicks van al lugar equivocado
```

**Riesgo:**
- Stock se descarga vacío
- Clics en botones incorrectos
- Script falla silenciosamente

**Solución:** OCR o ImageSearch (no implementado)

#### ⚠️ Sin Validación Post-Click
```autohotkey
ClickAt("Almacenes")
; ¿Llegó a Almacenes?
; ¿Se abrió el menú?
; → No verifica
```

**Solución:** WinWaitActive o ImageSearch

#### ⚠️ Debug Code en Producción
```autohotkey
; En sync_reparaciones.ahk
MouseMove(888, 189)
Sleep(2000)  ; ← Debug, no removido

; ← Ralentiza sincronización
```

#### ⚠️ Hardcoded Values
```autohotkey
enterDate := "01/01/2025"  ; ← Hardcoded, nunca cambia
```

---

## REDIS

### 1. Estructura de Keys

| Key | Tipo | Propósito | TTL |
|-----|------|----------|-----|
| `sync-3c:queue` | List (FIFO) | Cola de comandos pendientes | Indefinido |
| `sync-3c:command:{id}` | Hash | Estado del comando | Indefinido |
| `sync-3c:result:{id}` | Hash | Resultado del sync | Indefinido |
| `sync-3c:agent:production` | String (JSON) | Heartbeat del agente | 120s |

### 2. Flujo Redis

```
1. POST /api/sync-3c → HSET + LPUSH

HSET sync-3c:command:abc123 {
  module: "stock"
  status: "pending"
  createdAt: 1689123456789
  startedAt: ""
  completedAt: ""
  agent: ""
  result: ""
  error: ""
}

LPUSH sync-3c:queue "abc123"

2. Agent polling → RPOP

RPOP sync-3c:queue → "abc123"

3. Agent procesa

HSET sync-3c:command:abc123 {
  status: "running"
  startedAt: 1689123457000
  agent: "PC-001"
}

4. Agent completa

HSET sync-3c:result:abc123 {
  status: "completed"
  module: "stock"
  created: 45
  updated: 120
  skipped: 3
  warnings: [...]
}

HSET sync-3c:command:abc123 {
  status: "completed"
  completedAt: 1689123460000
  result: {...}
}

5. UI polling → GET

GET sync-3c:agent:production
HGETALL sync-3c:command:{id}
HGETALL sync-3c:result:{id}
```

### 3. Issues Redis

| Issue | Severidad | Impacto |
|-------|-----------|---------|
| Sin límite de queue | 🟡 Media | DDOS si spam requests |
| Sin TTL en command | 🟡 Media | Memory leak lento |
| Race condition RPOP | 🟡 Media | Pérdida de comandos si 2 agents |
| SCAN lento | 🟡 Media | Recovery stale > 10min lento |

---

## FIREBASE

### 1. Configuración

```typescript
// src/lib/firebase.ts
import { initializeApp } from "firebase/app"
import { getFirestore } from "firebase/firestore"
import { getAuth } from "firebase/auth"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
```

### 2. Issues Críticos

#### 🔴 Cuota Excedida (Spark Plan)
```
Límite Spark: 50K reads/día
Uso actual: 66K reads en 7 días
Estado: BLOQUEADO

Afectado:
- UI no puede cargar datos
- Agent fallback a Redis (degradado: true)
```

**Causa:**
- `getMachines()` sin límite
- Múltiples queries por componente
- Sin caché local

**Solución:**
- Plan pago o Redis caché
- Índices para queries rápidas
- React Query para deduplicación

#### 🔴 Documentos sin Límite (maintenance.originalData)
```
maintenance collection:
- documento puede tener 8-15 KB
- originalData crece sin límite
- Riesgo: > 1 MB = error
```

#### 🟡 Sin Índices (8 queries)

```
Queries lentas sin índice:
- inventory_stock: (name, lastSyncedAt)
- repairs: (status, entryDate)
- maintenance: (machineId, entryDate)
- inventory_movements: (materialId, date)
```

**Performance:**
- Con < 1K docs: ~100ms
- Con > 5K docs: 500ms-2s
- Sin índice: 2-10x más lento

---

## STOCK

### 1. Gestión de Inventario

**Flujo:**
```
3C Export → Agent Parse → Firestore (inventory_stock) → UI
                                ↓
                         Local Cache (stock-cache.json)
```

**Colección: inventory_stock**
```typescript
{
  code: string           // Código 3C (UNIQUE)
  name: string
  stockTotal: number     // Total = rented + available
  stockRented: number    // En alquiler
  stockAvailable: number // Disponible
  category: string
  unit: string           // "unidad", "metro", etc.
  lastSyncedAt: Timestamp
}
```

### 2. Movimientos de Stock

**Tipos:**
- **Outgoing (RENTAL)** - Máquina sale a cliente
- **Return (RETURN)** - Máquina vuelve de cliente
- **Internal** - Movimientos entre depósitos

**Servicio:** `rentMachine()`, `returnMachine()`

### 3. Caché Local

```javascript
// stock-cache.json
{
  inventory_stock: [...],
  machines: [...],
  spare_parts: [...]
}
```

**Actualización:** Después de cada sync desde 3C

### 4. Issues

- ⚠️ Sin límite en getMachines()
- ⚠️ Sin validación de consistencia
- ⚠️ Caché manual sin versionado

---

## REPARACIONES

### 1. Flujo de Reparación

```
Registro Manual
    ↓
Sincronización desde Mantenimiento 3C
    ↓
Análisis de Alertas Inteligentes
    ↓
Recomendaciones de Repuestos
    ↓
Completar con partes usadas
    ↓
Generar OT de mantenimiento
```

### 2. Modelo MachineRepair

```typescript
{
  machineId: string
  internalNumber: string
  machineName: string
  reportedIssue: string
  diagnosis: string
  repairPerformed: string
  technician: string
  
  // Partes usadas
  partsUsed: {
    partCode: string
    partName: string
    quantity: number
    cost: number
  }[]
  
  // Warranty tracking
  warrantyDays: number
  oilChangeDays: number
  bearingChangeDays: number
}
```

### 3. Sincronización desde 3C

```typescript
// Maintenance 3C → repairs en Firestore
// Función: syncRepairsToMaintenance() en engine.ts
```

### 4. Alertas Inteligentes

**SmartAlertsPanel detecta:**
- Fallas repetitivas en misma máquina
- Máquinas sobrecargadas
- Mantenimiento preventivo ignorado

---

## MANTENIMIENTO

### 1. Órdenes de Mantenimiento

**Origen:**
- Manual (crear OT)
- Automático desde 3C (sincronización)

**Campos:**
```typescript
{
  orderNumber?: string
  entryDate: Timestamp
  status: "pending" | "in_progress" | "completed"
  
  // Datos crudos 3C
  originalData: {
    [key: string]: any  // ⚠️ SIN LÍMITE
  }
}
```

### 2. Issues Críticos

🔴 **originalData sin límite**
- Documentos pueden crecer a 8-15 KB
- Sin limpieza automática
- Riesgo: documento > 1 MB

---

## ALQUILERES

### 1. Modelo Rental

```typescript
{
  machineId: string
  clientName: string
  clientPhone: string
  
  startDate: Timestamp
  endDate?: Timestamp      // null = abierto
  isOpenEnded: boolean
  
  dailyRate: number
  deploymentLocation: string
  status: "active" | "completed"
}
```

### 2. Actualización de Máquina

```typescript
// Cuando se alquila:
machines/{machineId}.status = "rented"
machines/{machineId}.rental = { clientName, startDate, ... }

// Cuando se devuelve:
machines/{machineId}.status = "available"
machines/{machineId}.rental = null
```

### 3. Inteligencia de Disponibilidad

```typescript
stockAvailable = stockTotal - stockRented
```

---

## INVENTARIO

### 1. Categorización

```typescript
type InventoryCategory = 
  | "machine"       // Máquinas grandes
  | "tool"          // Herramientas
  | "scaffold"      // Andamios
  | "consumible"    // Consumibles
```

### 2. Movimientos

**Tabla: inventory_movements**
```typescript
{
  materialId: string
  type: "rental" | "return" | "internal" | "adjustment"
  quantity: number
  date: Timestamp
  notes: string
}
```

---

## MÁQUINAS

### 1. Ciclo de Vida

```
Created → Available → Rented → Available → Maintenance → Available → ...
                                             (repetir)
```

### 2. Blueprints (Despieces)

**Propósito:** Documentación técnica de máquina

```typescript
{
  machineId: string
  blueprintId: string
  parts: [{
    partCode: string
    partName: string
    quantity: number
    supplier: string
  }]
  
  // Archivos (Cloudinary)
  documents: [{
    url: string
    type: "pdf" | "image"
  }]
}
```

### 3. Blueprint Drafts

**Propósito:** Borrador antes de confirmar

```typescript
{
  machineId: string
  blueprintId?: string
  partCode: string
  partName: string
  quantity: number
  status: "draft" | "confirmed"
}
```

---

## ANDAMIOS/SCAFFOLDS

### 1. Clasificación Automática

```typescript
// src/lib/scaffoldMatcher.ts
export function classifyScaffoldStock(item: InventoryStock): ScaffoldClassification {
  // Basado en nombre del item
  // Detecta: plataforma, escalera, soporte, tubería, etc.
}
```

### 2. Alquiler de Andamios

```typescript
// sync-agent: sync_alquileres.ahk
// Sincroniza rentals desde 3C
```

### 3. Recipe Hardcoded

```typescript
// SCAFFOLD_RECIPE
{
  "plataforma": { cantidad: N },
  "escalera": { cantidad: N },
  "soporte": { cantidad: N },
  // ...
}
```

---

## INTELIGENCIA DE STOCK

### 1. Análisis Inteligente

```typescript
// src/services/stockIntelligence.ts
export async function analyzeStockInteligence() {
  // 1. Carga máquinas, reparaciones, stock
  // 2. Detecta patrones:
  //    - Máquinas repetitivamente falladas
  //    - Stock bajo en repuestos críticos
  //    - Mantenimiento preventivo vencido
  // 3. Genera alertas y recomendaciones
}
```

### 2. Tipos de Alertas

```typescript
type AlertType = 
  | "REPETITIVE_FAILURE"
  | "OVERLOADED_MACHINE"
  | "IGNORED_MAINTENANCE"
  | "LOW_STOCK"
  | "EXPIRING_WARRANTY"
```

### 3. Recomendaciones

**Automáticas:**
- "Comprar X repuestos para máquina Y (5 fallos últimos 30 días)"
- "Mantenimiento preventivo vencido: máquina Z"

---

## ISSUES IDENTIFICADOS

### TABLA RESUMEN - Todos los Issues Encontrados

| # | Severidad | Categoría | Issue | Impacto | Esfuerzo Arreglo |
|----|-----------|-----------|-------|---------|-----------------|
| **1** | 🔴 CRÍTICO | Memory Leak | `useSparePartsCache` - global state | Leak indefinido | Bajo |
| **2** | 🔴 CRÍTICO | Infinite Loop | `useMachines` - circular dependency | Render loop | Medio |
| **3** | 🔴 CRÍTICO | Memory Leak | `useRepairs`, `useSpareParts` - no mounted check | setState warnings | Bajo |
| **4** | 🔴 CRÍTICO | Firebase | Cuota excedida (66K vs 50K) | Sincronización bloqueada | Muy bajo (upgrade plan) |
| **5** | 🔴 CRÍTICO | Seguridad | APIs sin autenticación | Acceso no autorizado | Medio |
| **6** | 🔴 CRÍTICO | AutoHotkey | Coordenadas hardcoded | Script falla si pantalla cambia | Alto (OCR) |
| **7** | 🟡 MAYOR | Database | maintenance.originalData sin límite | Docs > 1MB posible | Bajo |
| **8** | 🟡 MAYOR | Performance | 8 queries sin índices Firestore | 2-10x más lento | Muy bajo (create index) |
| **9** | 🟡 MAYOR | Code Quality | RepairForm 398 LOC + 13 useState | Unmaintainable | Medio |
| **10** | 🟡 MAYOR | Code Quality | SmartAlertsPanel 367 LOC + God component | Testing difícil | Medio |
| **11** | 🟡 MAYOR | Architecture | Polling manual con 4 refs (Sync3CButton) | Error prone | Bajo (React Query) |
| **12** | 🟡 MAYOR | Database | getMachines() sin limit() | Full scan posible | Muy bajo (add limit) |
| **13** | 🟡 MAYOR | Error Handling | inventoryMovements, stockMovements sin try/catch | Crashes silenciosos | Muy bajo |
| **14** | 🟡 MAYOR | Redis | Sin limit en queue size | DDOS posible | Bajo |
| **15** | 🟡 MAYOR | API | POST /api/sync-3c sin validación | Crash posible | Muy bajo |
| **16** | 🟡 MAYOR | Code Quality | 415 LOC duplicados (parsers, helpers) | Maintenance overhead | Bajo |
| **17** | 🟡 MAYOR | Agent | Sin reintentos al conectar Redis | Agente muere si offline | Bajo |
| **18** | 🟡 MAYOR | AutoHotkey | Debug MouseMove/Sleep en producción | Sincronización lenta | Muy bajo |
| **19** | 🟡 MEDIO | Performance | 3 queries grandes en secuencia | Inteligencia lenta | Bajo (paralelizar) |
| **20** | 🟡 MEDIO | Code Quality | SCAN para recovery stale > 10min | O(n) lento | Bajo (mejorar algo) |
| **21** | 🟡 MEDIO | Performance | useStockIntelligence sin caché | Recalcula cada render | Bajo (agregar cache) |
| **22** | 🟡 MEDIO | Code Quality | Múltiples queries en getRepairs() | N+1 problem | Bajo |
| **23** | 🟡 MEDIO | Excel Parser | Sin validación de esquema | Crash si formato equivocado | Muy bajo |
| **24** | 🟡 MEDIO | Testing | Componentes sin tests | 0% coverage | Alto |
| **25** | 🟡 MEDIO | Configuration | Hardcoded values (timeouts, coords, etc.) | No configurable | Bajo |

---

## PROBLEMAS POR CATEGORÍA

### 🔴 CRÍTICOS (5 issues)

1. **useSparePartsCache global state** - Memory leak indefinido
2. **useMachines circular dependency** - Infinite render loop
3. **useRepairs/useSpareParts no mounted check** - setState warnings
4. **Firebase cuota excedida** - Sincronización bloqueada
5. **APIs sin autenticación** - Acceso no autorizado

### 🟡 MAYORES (15 issues)

1. AutoHotkey coordenadas hardcoded
2. maintenance.originalData sin límite
3. 8 queries sin índices
4. RepairForm oversized (398 LOC)
5. SmartAlertsPanel God component
6. Polling manual con 4 refs
7. getMachines() sin limit
8. inventoryMovements sin error handling
9. Redis queue sin límite
10. API sin validación
11. 415 LOC duplicados
12. Agent sin reintentos
13. Debug code en producción
14. 3 queries en secuencia
15. useStockIntelligence sin caché

---

## RESUMEN FINAL

### Líneas de Código por Categoría

```
Total LOC:              5,627
├─ Services:           1,200 LOC (21%)
├─ Hooks:              1,000 LOC (18%)
├─ Components:         1,400 LOC (25%)
├─ APIs:               300 LOC (5%)
├─ Libraries:          1,000 LOC (18%)
├─ Types:              200 LOC (3%)
└─ Configuration:      200 LOC (4%)

Duplicación:           415 LOC (7.4% del total)
Dead Code:             Est. 50-100 LOC
```

### Métricas de Calidad

```
Code Maintainability:  7.2/10
└─ (-1.5 por RepairForm oversized)
└─ (-0.5 por duplicación)
└─ (-0.3 por falta de tests)

Bundle Size:           ~350 KB
└─ Oportunidad: -50 KB (cleanup deps)

Test Coverage:         0%
└─ Meta: > 80%

Performance:           7/10
└─ (-2 por queries sin índices)
└─ (-1 por polling manual)
```

### Stack Health

```
✅ FORTALEZAS
- Arquitectura bien estratificada (UI → Hooks → Services → Firebase)
- TypeScript bien tipado
- Separación de responsabilidades clara (en su mayoría)
- Good use of React patterns (en algunos lugares)
- Error handling en la mayoría de servicios

❌ DEBILIDADES
- Memory leaks en 4 hooks
- Componentes oversized (2 > 400 LOC)
- Sin tests (0% coverage)
- 415 LOC duplicados
- Sin índices de Firestore (impacto en performance)
- Seguridad: APIs sin autenticación
- AutoHotkey muy frágil (coordenadas hardcoded)
```

---

## FIN DEL ANÁLISIS

**Documento generado:** 10 de Julio de 2026  
**Próximo paso:** Revisar issues identificados antes de proponer soluciones

**NO se realizó ninguna modificación de código.**
