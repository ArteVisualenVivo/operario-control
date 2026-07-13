# EXPLORACIÓN EXHAUSTIVA DEL CODEBASE - operario-control

**Fecha:** 2026-07-10  
**Proyecto:** operario-control (Next.js 16.2.9)  
**Entorno:** Node.js, React 19.2.4, Firestore, Redis (Upstash), AutoHotkey  

---

## TABLA DE CONTENIDOS
1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Estructura de Directorios](#estructura-de-directorios)
3. [Configuración de Proyecto](#configuración-de-proyecto)
4. [Dependencias](#dependencias)
5. [Módulos Principales](#módulos-principales)
6. [Servicios (src/services/)](#servicios)
7. [Hooks (src/hooks/)](#hooks)
8. [Componentes (src/components/)](#componentes)
9. [APIs (src/app/api/)](#apis)
10. [Librería (src/lib/)](#librería)
11. [Tipos (src/types/)](#tipos)
12. [Sincronización 3C](#sincronización-3c)
13. [Agent Local](#agent-local)
14. [Automatización (AutoHotkey)](#automatización)
15. [Patrones Identificados](#patrones-identificados)
16. [Issues y Preocupaciones](#issues-y-preocupaciones)

---

## RESUMEN EJECUTIVO

### Descripción General
**operario-control** es un sistema Next.js de gestión de máquinas rentables con capacidades de:
- **Gestión de inventario**: Máquinas, repuestos, materiales
- **Alquileres**: Control de máquinas alquiladas a clientes
- **Reparaciones**: Seguimiento de equipos en taller
- **Sincronización con ERP**: Integración bidireccional con sistema 3C via AutoHotkey
- **Mantenimiento predictivo**: Recomendaciones basadas en inteligencia de stock
- **Auditoría**: Log completo de cambios en el sistema

### Arquitectura Estratificada
```
┌─────────────────────────────┐
│     UI (Next.js React)      │
│  (Components + Pages)       │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│  API Routes (Next.js)       │
│  - sync-3c/route.ts         │
│  - sync-3c/status/route.ts  │
│  - Cloudinary integration   │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Servicios (src/services/)              │
│  - Firestore CRUD operations            │
│  - Business logic                       │
└──────────────┬──────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
    ┌───▼──┐      ┌──▼────────┐
    │Hooks │      │Libraries  │
    │(UI)  │      │(Utils)    │
    └──────┘      └───────────┘
        │             │
        └─────┬───────┘
              │
    ┌─────────▼─────────┐
    │  Firebase/Firestore
    │  Redis (Upstash)
    │  Cloudinary
    └───────────────────┘
        │
    ┌───▼────────────────────┐
    │ Sync-Agent (Node.js)   │
    │ - agent.mjs            │
    │ - Poll Redis cada 5s   │
    │ - Spawn AutoHotkey     │
    └───┬────────────────────┘
        │
    ┌───▼────────────────────┐
    │ AutoHotkey Scripts     │
    │ - sync_3c.ahk          │
    │ - sync_reparaciones.ahk│
    │ - sync_articulos.ahk   │
    │ - sync_alquileres.ahk  │
    └───┬────────────────────┘
        │
    ┌───▼────────────────────┐
    │ ERP 3C (Windows App)   │
    │ - Export Excel         │
    └────────────────────────┘
```

### Flujo Principal de Sincronización
```
UI → POST /api/sync-3c {module: "stock"|"reparaciones"|"articulos"}
  ↓
Redis HSET command + LPUSH queue
  ↓
Agent.mjs RPOP cada 5s
  ↓
Spawn AutoHotkey script (sync_3c.ahk | sync_reparaciones.ahk | ...)
  ↓
AHK navega 3C → Export Excel → WaitForExcel (hasta 30s)
  ↓
WatchAndCopy → Copiar a automation-watcher/3c_exports/
  ↓
ParseExcel → syncItems() (Firebase Firestore)
  ↓
Redis HSET result + command status = "completed"
  ↓
UI polling GET /api/sync-3c/status?commandId=...
```

---

## ESTRUCTURA DE DIRECTORIOS

```
operario-control/
├── src/
│   ├── app/
│   │   ├── (protected)/          # Routes protegidas por auth
│   │   ├── api/                  # API routes
│   │   │   ├── cloudinary/       # Upload/delete blueprints
│   │   │   ├── local/            # Local mode APIs
│   │   │   └── sync-3c/
│   │   │       ├── route.ts      # POST crear comando sync
│   │   │       ├── status/       # GET estado del comando
│   │   │       └── agent-status/ # GET heartbeat del agent
│   │   ├── login/                # Login page
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Redirect a /dashboard
│   │   └── globals.css           # Tailwind CSS global
│   │
│   ├── components/
│   │   ├── dashboard/            # Dashboard UI components
│   │   │   ├── GlobalSearchResults.tsx
│   │   │   ├── SmartAlertsPanel.tsx
│   │   │   └── WorkshopSummary.tsx
│   │   ├── machines/             # Machine management
│   │   │   ├── BlueprintImportPanel.tsx
│   │   │   ├── BlueprintUploader.tsx
│   │   │   ├── ImportInventory.tsx
│   │   │   ├── MachineCard.tsx
│   │   │   ├── MaintenanceTimeline.tsx
│   │   │   ├── SeedInventory.tsx
│   │   │   └── SparePartCard.tsx
│   │   ├── maintenance/          # Maintenance screens
│   │   ├── repairs/              # Repair management
│   │   ├── sync/
│   │   │   └── Sync3CButton.tsx  # Trigger sync button
│   │   └── ui/                   # Shared UI components
│   │
│   ├── hooks/
│   │   ├── useAuth.ts            # Firebase auth hook
│   │   ├── useBlueprintDrafts.ts # Blueprint draft management
│   │   ├── useInventoryStock.ts  # Stock items hook
│   │   ├── useMachineBlueprints.ts
│   │   ├── useMachines.ts        # Machines CRUD
│   │   ├── useMaintenanceSettings.ts
│   │   ├── useRentals.ts         # Filtered rentals hook
│   │   ├── useRepairs.ts         # Repairs hook
│   │   ├── useSpareParts.ts      # Spare parts hook
│   │   ├── useSparePartsCache.ts # Cache management
│   │   └── useStockIntelligence.ts # Stock analysis
│   │
│   ├── services/
│   │   ├── audit.ts              # Audit log creation/fetch
│   │   ├── auth.ts               # Firebase auth service
│   │   ├── blueprintDrafts.ts    # Blueprint draft CRUD
│   │   ├── inventoryMovements.ts # Movement tracking
│   │   ├── inventoryStock.ts     # Stock CRUD
│   │   ├── machineBlueprints.ts  # Blueprint upload/management
│   │   ├── machines.ts           # Machine CRUD, rentals
│   │   ├── maintenance.ts        # Maintenance record management
│   │   ├── maintenanceSettings.ts # Global settings
│   │   ├── pdfPartsExtractor.ts  # PDF → parts extraction
│   │   ├── recommendationAudit.ts # Audit recommendations
│   │   ├── recommendationEngine.ts # AI-like suggestions
│   │   ├── rentals.ts            # Rental operations
│   │   ├── repairImports.ts      # Import repairs from Excel
│   │   ├── repairs.ts            # Repair CRUD
│   │   ├── scaffoldRental.ts     # Andamios specific rental logic
│   │   ├── spareParts.ts         # Spare parts CRUD
│   │   ├── stockIntelligence.ts  # Stock analysis & alerts
│   │   └── stockMovements.ts     # Stock movement tracking
│   │
│   ├── lib/
│   │   ├── AuthContext.tsx       # Auth provider context
│   │   ├── categories.ts         # Category constants
│   │   ├── cloudinary.ts         # Cloudinary integration
│   │   ├── dashboardStats.ts     # Dashboard statistics
│   │   ├── filterBySearch.ts     # Search filter utility
│   │   ├── firebase.ts           # Firebase config & instances
│   │   ├── inventoryGroups.ts    # Group inventory items
│   │   ├── local-inventory-cache.ts
│   │   ├── local-seeds.ts        # Mock data for local mode
│   │   ├── local-sync.ts         # Local sync logic
│   │   ├── machine-links.ts      # Machine relationship helpers
│   │   ├── measure.ts            # Measurement utilities
│   │   ├── parseFirebaseError.ts # Error handling
│   │   ├── runtimeMode.ts        # LOCAL_MODE flag
│   │   ├── scaffoldConfig.ts     # Scaffold-specific config
│   │   ├── scaffoldMatcher.ts    # Classify scaffold items
│   │   ├── search.ts             # Search/filter logic
│   │   ├── sync-3c/              # Sync engine
│   │   │   ├── engine.ts         # syncItems(), Firestore ops
│   │   │   ├── parser.ts         # Excel parsing
│   │   │   ├── scaffoldRentals.ts# Andamios rental logic
│   │   │   └── types.ts          # Sync types
│   │   ├── sync-exclusions.ts    # Items to exclude from sync
│   │   ├── ui.ts                 # UI helpers
│   │   ├── utils.ts              # General utilities
│   │   └── write-local-sync.js   # Write local data (legacy)
│   │
│   └── types/
│       ├── index.ts              # Type exports
│       ├── audit.ts              # AuditLog types
│       ├── errors.ts             # Error types
│       ├── inventoryMovement.ts  # Movement types
│       ├── inventoryStock.ts     # Stock types
│       ├── machine.ts            # Machine types
│       ├── rental.ts             # Rental types
│       ├── repair.ts             # Repair types
│       ├── sparePart.ts          # Spare part types
│       ├── stockAlert.ts         # Alert types
│       └── stockMovement.ts      # Movement types
│
├── sync-agent/
│   ├── agent.mjs                 # Main polling agent
│   ├── agent.ts                  # Agent TypeScript version
│   └── service-account.json      # Firebase Admin SDK key
│
├── automation/
│   ├── sync_3c.ahk              # Stock sync (8 clicks)
│   ├── sync_reparaciones.ahk    # Repairs sync (7 clicks)
│   ├── sync_articulos.ahk       # Articles/parts sync
│   ├── sync_alquileres.ahk      # Rentals sync
│   ├── sync_common.ahk          # Common functions library
│   ├── config.ini               # Button coordinates & timings
│   ├── test_com.ahk             # COM diagnostics
│   └── logs/
│       └── last_status.ini      # Last execution status
│
├── automation-watcher/
│   ├── index.js                 # Chokidar Excel watcher
│   ├── config.js                # Watcher configuration
│   ├── excel-parser.js          # Excel parsing
│   ├── firebase-sync.js         # Firebase sync (legacy)
│   ├── state.json               # Processed files cache
│   ├── 3c_exports/              # Excel files from 3C
│   │   └── *.xls, *.xlsx
│   └── cache/
│       ├── stock-cache.json     # Cached stock
│       ├── machines-cache.json  # Cached machines
│       └── maintenance-cache.json
│
├── scripts/
│   ├── audit.ts                 # System audit script
│   ├── export-logs.ts           # Export audit logs
│   ├── firebase-cleanup.js      # Cleanup script
│   ├── fix-rented-machines.ts   # Fix rental state
│   ├── mark-legacy-seed.js      # Legacy data marking
│   └── seed-machines.ts         # Initialize DB with machines
│
├── docs/
│   ├── arquitectura.md          # Architecture docs
│   ├── auditoria-completa.md    # Audit report
│   └── audit/
│
├── public/                       # Static assets
├── package.json                  # Dependencies
├── tsconfig.json                # TypeScript config
├── next.config.ts               # Next.js config
├── eslint.config.mjs            # ESLint rules
├── postcss.config.mjs           # PostCSS config
└── AGENTS.md                    # Audit notes & architecture

```

---

## CONFIGURACIÓN DE PROYECTO

### package.json
```json
{
  "name": "operario-control",
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "export:logs": "npx tsx scripts/export-logs.ts",
    "seed": "npx tsx scripts/seed-machines.ts",
    "audit": "npx tsx scripts/audit.ts",
    "fix:rented": "npx tsx scripts/fix-rented-machines.ts",
    "watch:3c": "node automation-watcher/index.js",
    "sync-agent": "npx tsx sync-agent/agent.mjs"
  }
}
```

### tsconfig.json
- **Target**: ES2017
- **Module**: esnext
- **Strict**: true
- **JSX**: react-jsx
- **Alias**: `@/*` → `./src/*`

### next.config.ts
```typescript
const nextConfig: NextConfig = {}
// Minimal config, default behavior
```

---

## DEPENDENCIAS

### Dependencias Principales
| Paquete | Versión | Propósito |
|---------|---------|----------|
| `next` | 16.2.9 | Framework React/SSR |
| `react` | 19.2.4 | UI library |
| `react-dom` | 19.2.4 | React DOM rendering |
| `firebase` | 12.14.0 | Client SDK (Auth, Firestore) |
| `firebase-admin` | 14.0.0 | Admin SDK (backend sync) |
| `@upstash/redis` | 1.38.0 | Redis client (queue) |
| `xlsx` | 0.18.5 | Excel parsing |
| `pdfjs-dist` | 6.0.227 | PDF processing |
| `chokidar` | 5.0.0 | File system watcher |
| `tailwindcss` | 4 | CSS framework |
| `lucide-react` | 1.18.0 | Icon library |
| `sonner` | 2.0.7 | Toast notifications |
| `clsx` | 2.1.1 | Class name utilities |
| `next-themes` | 0.4.6 | Theme support |

### DevDependencies
- TypeScript 5
- ESLint 9
- TSX 4.22.4 (run TypeScript scripts)

---

## MÓDULOS PRINCIPALES

### 1. **MÁQUINAS** (`src/services/machines.ts`)

**Responsabilidades:**
- CRUD de máquinas (create, read, update, delete)
- Gestión de alquileres (rent, return)
- Scaffold-specific operations

**Funciones Principales:**
```typescript
getMachines() → Machine[]
getMachine(id: string) → Machine | null
createMachine(input: CreateMachineInput) → string (id)
updateMachine(id: string, data) → void
deleteMachine(id: string) → void
deleteAllMachines() → number (count)
rentMachine(id: string, rental: MachineRental) → void
returnMachine(id: string) → void
```

**Estructura Machine:**
```typescript
{
  id: string
  name: string
  model: string
  category: "machine" | "tool" | "scaffold"
  status: "available" | "rented" | "maintenance" | "retired"
  locationType: "deposito" | "obra"
  location: LocationInfo | null
  rental: MachineRental | null
  createdAt: Date
  updatedAt: Date
}
```

**Firestore Collection:** `machines`

---

### 2. **INVENTARIO DE STOCK** (`src/services/inventoryStock.ts`)

**Responsabilidades:**
- CRUD de materiales agregados (no máquinas individuales)
- Control de stock total/disponible/rentado
- Sincronización desde ERP 3C

**Regla de Dominio Crítica:**
- `machines` → alquiler unitario (1 doc = 1 unidad física)
- `inventory_stock` → inventario agregado (1 doc = stock total de material)
- **NO se alquilan como unidad individual**, solo se controla por cantidad

**Funciones Principales:**
```typescript
getStockItems() → InventoryStock[]
getStockItem(id: string) → InventoryStock | null
createStockItem(input: CreateStockInput) → string (id)
updateStockItem(id: string, data) → void
deleteStockItem(id: string) → void
rentStockItem(id: string, quantity: number) → void
returnStockItem(id: string, quantity: number) → void
```

**Estructura InventoryStock:**
```typescript
{
  id: string
  name: string
  category: string
  unit: "unidad" | "metro" | "kg" | ...
  stockTotal: number
  stockAvailable: number
  stockRented: number
  subtype: StockSubtype | null
  size: StockSize | string | null
  locationType: "deposito"
  source: "3c" | "manual"
  createdAt: Date
  updatedAt: Date
}
```

**Firestore Collection:** `inventory_stock`

---

### 3. **REPARACIONES** (`src/services/repairs.ts`)

**Responsabilidades:**
- CRUD de reparaciones/mantenimiento
- Cálculo automático de fechas de garantía y mantenimiento
- Importación desde ERP 3C
- Tracking de piezas utilizadas

**Funciones Principales:**
```typescript
getRepairs() → MachineRepair[]
getRepair(id: string) → MachineRepair | null
createRepair(input: CreateRepairInput) → string (id)
updateRepair(id: string, data) → void
deleteRepair(id: string) → void
getRepairsByMachine(machineId: string) → MachineRepair[]
```

**Estructura MachineRepair:**
```typescript
{
  id: string
  machineId: string
  machineName: string
  clientName: string
  reportedIssue: string
  diagnosis?: string
  repairPerformed: string
  technician: string
  entryDate: Date
  exitDate: Date
  hoursUsed?: number
  warrantyDays: number
  warrantyUntil: Date
  oilChangeDueDate?: Date
  bearingChangeDueDate?: Date
  maintenanceDueDate?: Date
  partsUsed: Array<{partId, name, quantity}>
  status: "EN_TALLER" | "FINALIZADO"
  source: "3c" | "manual" | "import"
  externalId?: string
  createdAt: Date
  updatedAt: Date
}
```

**Firestore Collection:** `repairs`

---

### 4. **ALQUILERES** (`src/services/rentals.ts`)

**Responsabilidades:**
- Operaciones de alquiler de máquinas
- Lógica específica para andamios (scaffolds)

**Nota:** Re-exporta `rentMachine` y `returnMachine` de `machines.ts`

---

### 5. **REPUESTOS** (`src/services/spareParts.ts`)

**Responsabilidades:**
- CRUD de repuestos por máquina
- Control de stock disponible/usado
- Validación de duplicados

**Funciones Principales:**
```typescript
getAllSpareParts() → SparePart[]
getSparePartsByMachine(machineId: string) → SparePart[]
getSparePartById(id: string) → SparePart | null
createSparePart(input: CreateSparePartInput) → string (id)
updateSparePart(id: string, data) → void
deleteSparePart(id: string) → void
usePart(id: string, quantity: number) → void
```

**Estructura SparePart:**
```typescript
{
  id: string
  machineId: string
  machineName: string
  machineModel: string
  partName: string
  partCode: string
  category: SparePartCategory
  unit: string
  stockTotal: number
  stockAvailable: number
  stockUsed: number
  source: "manual" | "blueprint"
  blueprintId?: string
  createdAt: Date
  updatedAt: Date
}
```

**Firestore Collection:** `machine_spare_parts`

---

### 6. **AUDITORÍA** (`src/services/audit.ts`)

**Responsabilidades:**
- Logging inmutable de todos los cambios
- Tracking de antes/después para cambios

**Funciones Principales:**
```typescript
createAuditLog(
  action: AuditAction,
  entity: AuditEntity,
  entityId: string,
  before: Record | null,
  after: Record | null
) → void

fetchAuditLogs() → AuditLog[]
```

**Tipos:**
```typescript
type AuditAction = "create" | "update" | "delete"
type AuditEntity = "machines" | "inventory_stock" | "repairs" | ...
```

**Firestore Collection:** `audit_logs`

---

### 7. **MOVIMIENTOS DE STOCK** (`src/services/stockMovements.ts` & `inventoryMovements.ts`)

**Responsabilidades:**
- Tracking de cada movimiento de stock
- Historial completo de transacciones

**Funciones Principales:**
```typescript
createMovement(
  partId: string,
  type: "rent" | "return" | "use" | "add" | "remove",
  source: "rental" | "maintenance" | "manual" | "import",
  referenceId: string,
  quantity: number
) → string (id)

getMovementsByPart(partId: string) → StockMovement[]
getAllMovements() → StockMovement[]
```

**Firestore Collections:**
- `stock_movements` (repuestos)
- `inventory_movements` (stock)

---

### 8. **DESPIECES/BLUEPRINTS** (`src/services/machineBlueprints.ts`)

**Responsabilidades:**
- Upload de PDFs/imágenes a Cloudinary
- Extracción automática de piezas desde PDFs
- Gestión de borradores de piezas

**Funciones Principales:**
```typescript
uploadBlueprint(machineId: string, file: File) → string (id)
deleteBlueprint(id: string) → void
getBlueprints(machineId: string) → MachineBlueprint[]
extractPartsFromPdf(fileUrl: string) → Array<{partName, partCode}>
```

**Firestore Collection:** `machine_blueprints`

---

### 9. **INTELIGENCIA DE STOCK** (`src/services/stockIntelligence.ts`)

**Responsabilidades:**
- Análisis de stock y generación de alertas
- Scoring de salud de materiales y máquinas
- Recomendaciones de reabastecimiento

**Funciones Principales:**
```typescript
getStockIntelligence() → StockIntelligence {
  materials: InventoryStock[]
  spareParts: SparePart[]
  machines: Machine[]
  repairs: MachineRepair[]
  alerts: StockAlert[]
  health: StockHealthScore
}

// Alertas automáticas:
// - CRITICAL: Stock disponible = 0
// - WARNING: Stock disponible < 20% (materiales) o < 15% (repuestos)
```

**Firestore Collections:** Lectura de `inventory_stock`, `machine_spare_parts`, `machines`, `repairs`

---

### 10. **MOTOR DE RECOMENDACIONES** (`src/services/recommendationEngine.ts`)

**Responsabilidades:**
- Matching de máquinas basado en keywords
- Intent detection (demolition, cutting, drilling, etc.)
- Scoring de máquinas relevantes

**Funciones Principales:**
```typescript
recommendMachines(query: string) → RecommendationResult {
  intent: "demolition" | "cutting" | "drilling" | "scaffolding" | ...
  matches: Machine[]
  primary: Machine | null
  alternatives: Machine[]
  responseText: string
}
```

**Reglas de Matching:** Via keywords + machine name/category

---

### 11. **MANTENIMIENTO** (`src/services/maintenance.ts`)

**Responsabilidades:**
- CRUD de registros de mantenimiento
- Parsing de datos desde 3C
- Tracking de fechas de vencimiento

**Firestore Collection:** `maintenance_records`

---

### 12. **CONFIGURACIÓN DE MANTENIMIENTO** (`src/services/maintenanceSettings.ts`)

**Responsabilidades:**
- Almacenar configuración global de mantenimiento
- Valores por defecto para intervalos (oil, bearing, general)

**Estructura MaintenanceSettings:**
```typescript
{
  oilChangeDays: number
  bearingChangeDays: number
  maintenanceDays: number
  warrantyDays: number
}
```

**Firestore Collection:** `maintenance_settings` (doc: "config")

---

### 13. **DESPIECES/DRAFTS** (`src/services/blueprintDrafts.ts`)

**Responsabilidades:**
- Borradores de repuestos extraídos de PDFs
- Confirmación manual antes de crear repuesto real

**Firestore Collection:** `blueprint_drafts`

---

## HOOKS

### Hook Pattern
Todos los hooks siguen el patrón "use client" con:
```typescript
const [data, setData] = useState<T[]>([])
const [loading, setLoading] = useState(true)

const load = useCallback(async () => { ... }, [])
useEffect(() => { load() }, [load])

return { data, loading, create, update, remove, reload: load }
```

### Lista de Hooks

| Hook | Propósito |
|------|-----------|
| `useAuth()` | Firebase auth state + login/logout |
| `useMachines()` | Máquinas CRUD + lifecycle |
| `useRentals()` | Derived: filtro máquinas alquiladas |
| `useInventoryStock()` | Materiales CRUD |
| `useRepairs()` | Reparaciones CRUD |
| `useSpareParts()` | Repuestos CRUD |
| `useSparePartsCache()` | Cache local de repuestos |
| `useMachineBlueprints()` | Blueprints CRUD |
| `useBlueprintDrafts()` | Drafts de repuestos |
| `useMaintenanceSettings()` | Configuración global |
| `useStockIntelligence()` | Stock analysis con alertas |

---

## COMPONENTES

### Ubicación: `src/components/`

#### Dashboard Components (`dashboard/`)
| Componente | Propósito |
|-----------|----------|
| `GlobalSearchResults.tsx` | Búsqueda global unificada |
| `SmartAlertsPanel.tsx` | Panel de alertas inteligentes |
| `WorkshopSummary.tsx` | Resumen de taller/mantenimiento |

#### Máquinas (`machines/`)
| Componente | Propósito |
|-----------|----------|
| `MachineCard.tsx` | Card visual de máquina |
| `BlueprintUploader.tsx` | Upload despieces |
| `BlueprintImportPanel.tsx` | Importar desde PDF |
| `SparePartCard.tsx` | Card de repuesto |
| `MaintenanceTimeline.tsx` | Timeline de reparaciones |
| `SeedInventory.tsx` | Inicializar DB con datos |
| `ImportInventory.tsx` | Importar máquinas masivamente |

#### Sincronización (`sync/`)
| Componente | Propósito |
|-----------|----------|
| `Sync3CButton.tsx` | Botón para triggear sync |

#### UI (`ui/`)
- Componentes de shadcn/ui reutilizables

---

## APIs

### Ubicación: `src/app/api/`

#### POST `/api/sync-3c`
```typescript
Body: { module: "stock" | "reparaciones" | "articulos" | "alquileres" }

Response: {
  success: boolean
  commandId: string
  status: "pending"
  createdAt: number
}
```

**Lógica:**
1. Generar UUID para command
2. HSET en Redis: `sync-3c:command:{id}` con status "pending"
3. LPUSH en Redis: `sync-3c:queue` con command ID
4. Auto-enqueue "alquileres" si module es "stock" o "articulos"

---

#### GET `/api/sync-3c/status`
```typescript
Query: { commandId: string }

Response: {
  module: string
  status: "pending" | "running" | "completed" | "failed"
  createdAt: number
  startedAt: number | ""
  completedAt: number | ""
  agent: string (machine name)
  result: string | {...} (JSON)
  error: string
}
```

---

#### GET `/api/sync-3c/agent-status`
```typescript
Response: {
  online: boolean
  status: string
  machineName: string | null
  lastHeartbeat: string (ISO)
}
```

**Lógica:**
- Lee Redis key: `sync-3c:agent:production`
- online = heartbeat timestamp < 90 segundos atrás

---

#### POST `/api/cloudinary/delete`
```typescript
Body: { publicId: string, resourceType: string }
```

---

#### Local API (`/api/local/`)
- APIs para modo local (sin Firebase)

---

## LIBRERÍA

### Ubicación: `src/lib/`

#### **firebase.ts** - Configuración Firebase
```typescript
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

export const auth = getAuth(app)
export const db = getFirestore(app)
```

---

#### **runtimeMode.ts** - Local Mode Toggle
```typescript
export const LOCAL_MODE =
  process.env.NEXT_PUBLIC_LOCAL_MODE === "1" ||
  process.env.LOCAL_MODE === "1"
```

**Propósito:** Permitir desarrollo sin Firebase activo

---

#### **local-seeds.ts** - Mock Data
```typescript
export const LOCAL_MACHINE_SEED: Machine[]
export const LOCAL_STOCK_SEED: InventoryStock[]
export const LOCAL_SPARE_PART_SEED: SparePart[]
```

---

#### **AuthContext.tsx** - Provider de Autenticación
```typescript
interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email, password) => Promise<User>
  logout: () => Promise<void>
}

export function AuthProvider({ children }: { children: ReactNode })
export function useAuth() // Hook para acceder al contexto
```

---

#### **scaffoldMatcher.ts** - Clasificador de Andamios
```typescript
function classifyScaffoldStock(name: string) → {
  kind: "structure" | "piece" | "accessory" | null
  category: "puntales" | "riendas" | "andamio_accesorios" | "consumibles"
  subtype: "puntal" | "rienda" | "plataforma" | "diagonal" | "otros" | null
}
```

**Reglas de matching:**
- "rienda" → category: "riendas", subtype: "rienda"
- "puntal" → category: "puntales", subtype: "puntal"
- "plataforma" → category: "andamio_accesorios", subtype: "plataforma"
- "tabl*" | "andamio" | "caballet*" → category: "andamio_accesorios"

---

#### **cloudinary.ts** - Upload de Blueprints
```typescript
async function uploadBlueprintToCloudinary(file: File) → {
  publicId: string
  secureUrl: string
  originalFilename: string
  format: string
  resourceType: string
}

async function deleteFromCloudinary(publicId, resourceType)
```

---

#### **sync-3c/** - Motor de Sincronización

##### **engine.ts** - Lógica Principal
```typescript
export async function syncItems(
  items: Sync3CItem[],
  options?: SyncEngineOptions
): Promise<Sync3CResult> {
  // 1. Obtener service account Firebase Admin
  // 2. GET todos los docs de inventory_stock
  // 3. Crear map por name + codigo para deduplicación
  // 4. Para cada item:
  //    - Buscar match por código o nombre normalizado
  //    - Si existe: UPDATE con stockTotal/available
  //    - Si no existe: CREATE documento nuevo
  //    - Clasificar como scaffold si aplica
  // 5. Retornar {success, created, updated, skipped, warnings}
}

export async function syncRepairsToMaintenance(
  repairs: RepairData[]
): Promise<void> {
  // Importar reparaciones desde Excel a maintenance_records
}
```

**Nota:** Service account path = `sync-agent/service-account.json`

---

##### **parser.ts** - Parse de Excel
```typescript
export function parseExcel(buffer: ArrayBuffer | Buffer): ParseResult {
  // 1. Leer workbook con xlsx
  // 2. Mapear columnas según config.COLUMNS
  // 3. Iterar desde DATA_START_ROW hasta fin
  // 4. Normalizar nombres, mapear unidades
  // 5. Agregar por código (deduplicación)
  // 6. Retornar {items, rawCount}
}
```

**Columnas Mapeadas:**
- `codigo` (col 2)
- `name` (col 5)
- `stockTotal` (col 20)
- `deposito` (col 1)
- `unidadRaw` (col 7)

---

##### **types.ts** - Tipos Sync
```typescript
export interface Sync3CItem {
  codigo: string
  name: string
  normalizedName: string
  stockTotal: number
  unit: string
  deposito: number
  source: "3c"
  stockWarning: boolean
  category?: string
  subtype?: string
  scaffoldKind?: ScaffoldStockKind
}

export interface Sync3CResult {
  success: boolean
  created: number
  updated: number
  skipped: number
  warnings: string[]
  degraded?: boolean
}
```

---

#### **local-sync.ts** - Sincronización Local (sin Firebase)
```typescript
// Funciones de parsing sin librerías externas
// Para mode local = true
```

---

#### **sync-exclusions.ts** - Ítems a Excluir
```typescript
// Lista de materiales que no deben sincronizarse
```

---

#### **categories.ts** - Categorías Constantes
```typescript
export const MACHINE_CATEGORIES = [...]
export const STOCK_CATEGORIES = [...]
export const SPARE_PART_CATEGORIES = [...]
```

---

#### **dashboardStats.ts** - Estadísticas
```typescript
// Funciones para calcular KPIs del dashboard
```

---

#### **utils.ts** - Utilidades Generales
```typescript
// Helper functions, formatters, validators
```

---

## TIPOS

### Ubicación: `src/types/`

#### **machine.ts**
```typescript
export interface Machine {
  id: string
  name: string
  model: string
  category: "machine" | "tool" | "scaffold"
  status: "available" | "rented" | "maintenance" | "retired"
  locationType: "deposito" | "obra"
  location: LocationInfo | null
  rental: MachineRental | null
  createdAt: Date
  updatedAt: Date
}

export interface MachineRental {
  clientName: string
  clientAddress: string
  projectName: string
  projectAddress: string
  startDate: Date
  expectedEndDate: Date | null
  isOpenEnded: boolean
}

export interface LocationInfo {
  client: { name: string; address: string }
  project: { name: string; address: string }
}
```

---

#### **inventoryStock.ts**
```typescript
export interface InventoryStock {
  id: string
  name: string
  category: string
  unit: "unidad" | "metro" | "kg" | ...
  stockTotal: number
  stockAvailable: number
  stockRented: number
  subtype: StockSubtype | null
  size: StockSize | string | null
  locationType: "deposito"
  source?: "3c" | "manual"
  createdAt: Date
  updatedAt: Date
}
```

---

#### **repair.ts**
```typescript
export interface MachineRepair {
  id: string
  machineId: string
  machineName: string
  clientName: string
  reportedIssue: string
  repairPerformed: string
  technician: string
  entryDate: Date
  exitDate: Date
  warrantyDays: number
  warrantyUntil: Date
  status: "EN_TALLER" | "FINALIZADO"
  source: "3c" | "manual" | "import"
  partsUsed: Array<{partId, name, quantity}>
  createdAt: Date
  updatedAt: Date
}
```

---

#### **sparePart.ts**
```typescript
export interface SparePart {
  id: string
  machineId: string
  machineName: string
  partName: string
  partCode: string
  category: SparePartCategory
  unit: string
  stockTotal: number
  stockAvailable: number
  stockUsed: number
  source: "manual" | "blueprint"
  blueprintId?: string
  createdAt: Date
  updatedAt: Date
}
```

---

#### **rental.ts**
```typescript
export interface Rental {
  id: string
  machineId: string
  clientName: string
  startDate: Date
  returnDate?: Date
  isActive: boolean
}
```

---

#### **stockAlert.ts**
```typescript
export interface StockAlert {
  id: string
  type: "CRITICAL" | "WARNING"
  entityType: "MATERIAL" | "SPARE_PART" | "MACHINE"
  entityId: string
  message: string
  detail: string
  createdAt: Date
}

export interface StockIntelligence {
  materials: InventoryStock[]
  spareParts: SparePart[]
  machines: Machine[]
  repairs: MachineRepair[]
  alerts: StockAlert[]
  health: StockHealthScore
}
```

---

#### **audit.ts**
```typescript
export interface AuditLog {
  id: string
  action: "create" | "update" | "delete"
  entity: AuditEntity
  entityId: string
  before: Record | null
  after: Record | null
  timestamp: Date
}
```

---

## SINCRONIZACIÓN 3C

### Arquitectura General

**Problema Resuelto:** Importación manual de Excel desde ERP 3C

**Solución:** Automatización via AutoHotkey + Node.js Agent

### Flujo Completo

```
┌─────────────────────────────────────────────────────────┐
│ 1. UI: Usuario hace clic en "Sincronizar Stock"         │
│    → POST /api/sync-3c {module: "stock"}                │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 2. API Route: sync-3c/route.ts                          │
│    - Generar UUID commandId                             │
│    - HSET `sync-3c:command:{id}` status="pending"       │
│    - LPUSH `sync-3c:queue` commandId                    │
│    - Return {commandId}                                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼ (Redis)
┌─────────────────────────────────────────────────────────┐
│ 3. Agent Local: agent.mjs                              │
│    - Poll cada 5s: RPOP `sync-3c:queue`                │
│    - Si hay comando:                                    │
│      1. HSET status = "running"                         │
│      2. Resolver ruta AHK según module                 │
│      3. Spawn AutoHotkey                               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 4. AutoHotkey Script: sync_3c.ahk (ej: stock)          │
│    Click sequence (8 steps):                            │
│    1. Almacenes (888,189)                              │
│    2. Informes (921,370)                               │
│    3. Existencias (1105,401)                           │
│    4. Depósitos (704,476)                              │
│    5. Seleccionar Todos (962,858)                      │
│    6. Consulta (440,341)                               │
│    7. Aceptar (1196,902)                               │
│    8. Excel (940,575)                                  │
│    → 3C exports Excel to Desktop/Downloads             │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 5. WaitForExcel(): Agent.mjs                           │
│    - Buscar archivo en automation-watcher/3c_exports/  │
│    - Retry 10 veces (cada 1s)                          │
│    - Timeout 10s total                                 │
│    - Si no encuentra: ERROR                            │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 6. parseExcel(): parser.ts                             │
│    - Leer buffer del Excel                             │
│    - Iterar columnas según config                      │
│    - Mapear código → nombre → stock normalizado         │
│    - Retornar {items, rawCount}                        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 7. syncItems(): engine.ts                              │
│    - Usar Firebase Admin SDK                           │
│    - GET todos los docs de inventory_stock             │
│    - Crear maps (byName, byCodigo)                     │
│    - Para cada item:                                   │
│      - Buscar match                                    │
│      - Si existe: UPDATE (stockTotal, stockAvailable)  │
│      - Si no existe: CREATE                            │
│      - Clasificar como scaffold si aplica              │
│    - Retornar {success, created, updated, warnings}    │
│    - HSET resultado en Redis: `sync-3c:result:{id}`    │
│                                                         │
│    En caso de error (ej: Firebase bloqueado):          │
│    - try/catch internal                                │
│    - Retornar {degraded: true, skipped: items.length}  │
│    - **Agent NO se cae**                               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼ (Redis)
┌─────────────────────────────────────────────────────────┐
│ 8. Agent: HSET `sync-3c:command:{id}`                 │
│    - status = "completed"                              │
│    - completedAt = now                                 │
│    - result = JSON.stringify(syncResult)               │
│    - agent = MACHINE_NAME                              │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼ (Polling)
┌─────────────────────────────────────────────────────────┐
│ 9. UI: GET /api/sync-3c/status?commandId={id}         │
│    - Leer Redis `sync-3c:command:{id}`                │
│    - Parse result si es JSON                          │
│    - Retornar estado + resultado                      │
│    - Mostrar toast/alert al usuario                   │
└─────────────────────────────────────────────────────────┘
```

---

### Módulos Sincronizados

| Módulo | Script AHK | Clicks | Destino |
|--------|-----------|--------|---------|
| **stock** | `sync_3c.ahk` | 8 | Almacenes → Informes → Existencias → Excel |
| **reparaciones** | `sync_reparaciones.ahk` | 7 | Ventas → Reparaciones → Excel |
| **articulos** | `sync_articulos.ahk` | ? | Artículos → Excel |
| **alquileres** | `sync_alquileres.ahk` | ? | Alquileres Pendientes → Excel |

---

### Configuración: config.ini

```ini
[Coords]
Almacenes=888,189
Informes=921,370
Existencias=1105,401
... (todas las coordenadas por módulo)

[Timing]
InitDelay=1000
AfterClick=500
AfterQuery=300
AfterExcel=5000
```

---

### Manejo de Errores

| Error | Manejo |
|-------|--------|
| AutoHotkey no encontrado | FATAL: instalación requerida |
| AHK timeout (120s) | ERROR: "3C no respondió" |
| Excel no generado (10 retries) | ERROR: "No se exportó correctamente" |
| Firebase bloqueado | DEGRADED: resultado guardado en Redis |
| Parser error | ERROR + skip file |

---

## AGENT LOCAL

### Ubicación: `sync-agent/agent.mjs`

### Responsabilidades
1. **Polling:** Cada 5s revisar Redis queue
2. **Dispatch:** Spawn AutoHotkey según módulo
3. **Monitoring:** Timeout, logs, recovery
4. **Heartbeat:** Cada 30s actualizar alive status
5. **Stale Recovery:** Buscar comandos running > 10 min

---

### Configuración

```javascript
const MACHINE_NAME = process.env.COMPUTERNAME || "unknown-pc"
const AHK_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 5_000
const HEARTBEAT_INTERVAL_MS = 30_000
const EXPORT_RETRIES = 10
const STALE_THRESHOLD_MINUTES = 10

const MODULE_SCRIPTS = {
  stock: "sync_3c.ahk",
  reparaciones: "sync_reparaciones.ahk",
  articulos: "sync_articulos.ahk",
}
```

---

### Flujo de Ejecución

```javascript
// 1. Inicializar Redis
const redis = getRedis() // URL + Token de Upstash

// 2. Main loop cada POLL_INTERVAL_MS
setInterval(async () => {
  if (isProcessing) return

  const commandId = await redis.rpop("sync-3c:queue")
  if (!commandId) return

  isProcessing = true
  try {
    // 3. HSET status = "running"
    await redis.hset(`sync-3c:command:${commandId}`, {
      status: "running",
      startedAt: now,
      agent: MACHINE_NAME,
    })

    // 4. Obtener módulo
    const command = await redis.hgetall(`sync-3c:command:${commandId}`)
    const module = command.module
    const scriptName = MODULE_SCRIPTS[module]

    // 5. Spawn AHK
    const scriptPath = path.join(AHK_DIR, scriptName)
    await runAhk(scriptPath)

    // 6. WaitForExport
    const exportFile = await waitForExport()

    // 7. parseExcel + syncItems
    const buffer = fs.readFileSync(exportFile.fullPath)
    const { items } = parseExcel(buffer)
    const result = await syncItems(items)

    // 8. HSET command = "completed" + result
    await redis.hset(`sync-3c:command:${commandId}`, {
      status: "completed",
      completedAt: now,
      result: JSON.stringify(result),
    })

  } catch (error) {
    // Error handling + HSET status = "failed"
  } finally {
    isProcessing = false
  }
}, POLL_INTERVAL_MS)

// 3. Heartbeat cada HEARTBEAT_INTERVAL_MS
setInterval(async () => {
  await redis.set("sync-3c:agent:production", JSON.stringify({
    machineName: MACHINE_NAME,
    status: "idle",
    lastHeartbeat: Date.now(),
  }), { ex: 300 }) // Expire 5 min
}, HEARTBEAT_INTERVAL_MS)
```

---

### Logging

```javascript
// Redirigir console.log a archivo
const logStream = fs.createWriteStream("sync-agent/agent.log", {flags: "a"})
console.log = (...args) => {
  logStream.write(`[${timestamp}] ${args.join(" ")}\n`)
}
```

---

### AutoHotkey Resolution

```javascript
const CANDIDATE_PATHS = [
  "AutoHotkey64.exe",
  "AutoHotkey32.exe",
  "AutoHotkey.exe",
  "C:\\Program Files\\AutoHotkey\\AutoHotkey64.exe",
  "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe",
]

function findAhkExe() {
  // Buscar en PATH y rutas estándar
  // Retornar primera match o null
}
```

---

### Stale Recovery

```javascript
// Cada intervalo, buscar comandos stuck en "running"
async function recoverStaleCommands() {
  const commands = await redis.scan(0, { match: "sync-3c:command:*" })
  for (const key of commands.keys) {
    const data = await redis.hgetall(key)
    if (data.status === "running" && now - data.startedAt > 10 * 60 * 1000) {
      // Re-encolar para retry
      await redis.lpush("sync-3c:queue", data.id)
    }
  }
}
```

---

## AUTOMATIZACIÓN

### Ubicación: `automation/`

### AutoHotkey Scripts

#### **sync_common.ahk** - Librería Compartida

```autohotkey
; Funciones reutilizables por todos los módulos

ClickAt(buttonName) {
  ; Leer coordenadas desde config.ini
  ; Hacer click en (X, Y)
  ; Esperar AfterClick delay
}

WaitForExcel() {
  ; Esperar hasta 30s por ventana XLMAIN
  ; Retornar 1 si se abre, 0 si timeout
}

WatchAndCopy() {
  ; Monitorear %TEMP%\tresc\tresc*.xls
  ; Copiar a automation-watcher/3c_exports/
}

ValidarFoco() {
  ; Validar que 3C tenga el foco
  ; Re-activar si es necesario
}

FocusFix() {
  ; Hacer click en 3C para regain foco
}
```

---

#### **sync_3c.ahk** - Stock (8 clicks)

```autohotkey
#Requires AutoHotkey v2.0
#SingleInstance Force
SetWorkingDir(A_ScriptDir)

; Cargar config.ini
config := Map()
; ... load config

; Secuencia de clicks
ClickAt("Almacenes")     ; Paso 1
Sleep(AfterSubmenu)
ClickAt("Informes")      ; Paso 2
Sleep(AfterSubmenu)
ClickAt("Existencias")   ; Paso 3
Sleep(AfterQuery)
ClickAt("Depositos")     ; Paso 4
Sleep(AfterClick)
ClickAt("SeleccionarTodos") ; Paso 5
Sleep(AfterClick)
ClickAt("Consulta")      ; Paso 6
Sleep(AfterQuery)
ClickAt("Aceptar")       ; Paso 7
Sleep(AfterAccept)
ClickAt("Excel")         ; Paso 8 - Generar Excel
Sleep(AfterExcel)

; Esperar Excel
if !WaitForExcel() {
  MsgBox("Excel no se abrió en 30 segundos")
  ExitApp(1)
}

; Monitorear y copiar
WatchAndCopy()

; Cerrar Excel
WinClose("XLMAIN")

; Salir 3C
WinActivate("3C")
Sleep(500)
ClickAt("Salir")

ExitApp(0)
```

---

#### **sync_reparaciones.ahk** - Repairs (7 clicks)

```autohotkey
; Secuencia:
; 1. Ventas
; 2. Reparaciones
; 3. ExcelItems (List export)
; 4. PrintAll
; 5. Imprimir
; 6. ExcelFormat
; 7. Excel

; Similar a sync_3c.ahk pero con diferentes clicks
; Al final: WinClose Excel → WinActivate 3C → ClickAt("SalirRep")
```

---

#### **sync_articulos.ahk** - Articles

- Módulo para artículos/consumibles
- Secuencia similar

---

#### **sync_alquileres.ahk** - Rentals

- Módulo para alquileres pendientes
- Secuencia específica para rentals

---

#### **config.ini** - Coordenadas Globales

```ini
[Coords]
Almacenes=888,189
Informes=921,370
Existencias=1105,401
Depositos=704,476
SeleccionarTodos=962,858
Consulta=440,341
Aceptar=1196,902
Excel=940,575
...
```

**Nota:** Las coordenadas dependen de la resolución de pantalla. Deben calibrarse por PC.

---

## PATRONES IDENTIFICADOS

### 1. **REGLA DE DOMINIO CRÍTICA: Máquinas vs Stock**

```
machines (Firestore)
├── 1 documento = 1 unidad física
├── Propósito: Alquiler unitario
├── Ejemplo: Andamio tubular #001, Andamio modular #042
└── Status: available | rented | maintenance | retired

inventory_stock (Firestore)
├── 1 documento = stock agregado de un material
├── Propósito: Inventario por cantidad
├── Ejemplo: "Riendas largas" (100 uds), "Puntales 3m" (50 uds)
├── NO se alquilan individualmente
└── Tracking: stockTotal, stockAvailable, stockRented (qty)
```

**Implicación:** `rentMachine()` para máquinas, `rentStockItem()` para materiales.

---

### 2. **PATRÓN DE HOOKS: Standardized Lifecycle**

```typescript
// Todos los hooks siguen este patrón:
const [items, setItems] = useState<T[]>([])
const [loading, setLoading] = useState(true)

const load = useCallback(async () => {
  setLoading(true)
  const data = await service.getItems()
  setItems(data)
  setLoading(false)
}, [])

useEffect(() => { load() }, [load])

return {
  items,
  loading,
  create: async (input) => { await service.create(input); await load() },
  update: async (id, data) => { await service.update(id, data); await load() },
  remove: async (id) => { await service.delete(id); await load() },
  reload: load,
}
```

**Ventaja:** Consistencia, retry fácil, loading state uniforme

---

### 3. **PATRÓN FIREBASE: Conversión Bidireccional**

```typescript
// Firebase → Tipo Local
function docToMachine(docSnap): Machine {
  const data = docSnap.data()
  return {
    id: docSnap.id,
    name: data.name ?? "",
    // ... mapping
  }
}

// Tipo Local → Firebase
function marshalMachine(m: Machine): Record {
  return {
    name: m.name,
    // ... marshaling
    updatedAt: serverTimestamp(),
  }
}
```

**Ventaja:** Validación, valores por defecto, normalización

---

### 4. **PATRÓN ASYNC QUEUE: Redis + Agent**

```
UI POST → API crear command + LPUSH queue
         ↓
Agent RPOP queue cada 5s
    ↓
    if comando: execute() + HSET result
    ↓
UI GET /status ← read result desde Redis
```

**Ventaja:** Desacoplamiento, no bloquea API, polling simple

---

### 5. **PATRÓN LOCAL MODE: Firebase Optional**

```typescript
export const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "1"

export async function getStockItems(): Promise<InventoryStock[]> {
  try {
    const data = await getDocs(query(...)) // Firebase
    if (LOCAL_MODE && data.length === 0) return LOCAL_STOCK_SEED
    return data
  } catch {
    if (LOCAL_MODE) return LOCAL_STOCK_SEED // Fallback
    throw
  }
}
```

**Ventaja:** Desarrollo sin Firebase, demo, testing offline

---

### 6. **PATRÓN AUDIT: Before/After Tracking**

```typescript
async function updateMachine(id, data) {
  const before = (await getDoc(...)).data()
  await updateDoc(...)
  await createAuditLog("update", "machines", id, before, data)
}
```

**Ventaja:** Compliance, debugging, traceabilidad

---

### 7. **PATRÓN DE CLASIFICACIÓN: Scaffold Matcher**

```typescript
function classifyScaffoldStock(name: string) {
  const text = normalize(name)
  // Múltiples if/else por keyword
  if (text.includes("rienda")) return { kind: "piece", category: "riendas" }
  if (text.includes("puntal")) return { kind: "piece", category: "puntales" }
  // ...
  return { kind: null, category: "consumibles" }
}
```

**Ventaja:** Categorización automática, consistencia

---

## ISSUES Y PREOCUPACIONES

### 🔴 **CRÍTICOS**

#### 1. **Firebase Firestore - Cuota de Lectura Excedida (Registrado en AGENTS.md)**

**Estado:** Aplicado fallback degradado (2026-06-28)

**Síntoma:** Service account key revocada/deshabilitada en GCP; Firebase bloquea lecturas

**Solución Actual:**
```javascript
// agent.mjs - syncItems() con try/catch
try {
  const result = await syncItems(items)
} catch (error) {
  const degradedResult = {
    success: true,
    degraded: true,
    skipped: items.length,
  }
  // Guardar en Redis sin Firestore
  await redis.hset(`sync-3c:result:{id}`, degradedResult)
}
```

**Pendiente:** Esperar reset de cuota Firebase (~24h)

**Riesgo:** Si Firebase sigue bloqueado > 24h, implementar Supabase/Postgres completo

---

#### 2. **AutoHotkey Coordinates - Dependencia de Resolución de Pantalla**

**Problema:** Las coordenadas de `config.ini` (ej: 888,189) son absolutas, dependen de resolución

**Síntoma:** Si cambias PC o resolución, los clicks fallan porque apuntan a posiciones incorrectas

**Solución Actual:** Manual calibration necesaria por PC

**Mejora Posible:**
- Usar Windows OCR para encontrar botones dinámicamente
- O usar AutoHotkey Image Recognition (más frágil)

---

#### 3. **Excel Timeout - Depuración Limitada**

**Problema:** Si 3C no genera Excel en 10 segundos, agent retorna error genérico

**Síntoma:** Usuario no sabe por qué falló (¿3C no respondió? ¿Excel corrupto? ¿Permisos?)

**Mejora Posible:** Agregar logs más detallados en AHK scripts

---

### ⚠️ **MAYORES**

#### 4. **Firestore Cuota - Plan Spark Limitado**

**Problema:** 50K reads/día límite en plan Spark

**Métrica:** 66K reads en 7 días (excedido)

**Servicios que Disparan Reads:**
- `getStockItems()` - O(1) query, pero llamado frecuentemente
- `getMachines()` - Similar
- `getRepairs()`, `getAllSpareParts()`, etc.

**Solución Propuesta:**
1. Implementar caché cliente agresivo (TTL 60s)
2. O pasar a plan pago de Firebase
3. O migrar a Supabase (reads ilimitados por defecto)

---

#### 5. **Rendimiento: Múltiples Llamadas Redundantes**

**Problema:** Hooks llaman `getStockItems()` cada vez que se monta

**Ejemplo:**
```typescript
// Dashboard.tsx → useStockIntelligence()
// Dashboard.tsx → useInventoryStock()
// Ambos llaman getStockItems()
```

**Impacto:** 2 reads de Firestore para el mismo dato

**Solución:**
- Implementar React Query / SWR con deduplicación
- O Zustand global store con caché

---

#### 6. **Sincronización 3C - Sin Validación de Cambios**

**Problema:** Cada sync sobrescribe `stockTotal` sin ver si cambió

**Síntoma:** Si el usuario modifica manualmente stock en Firestore, se pierde al siguiente sync

**Solución:**
- Agregar `lastSyncValue` en documento
- Comparar ante/después antes de sobrescribir
- O implementar merge inteligente

---

#### 7. **Local Mode - Datos Hardcoded**

**Problema:** `LOCAL_STOCK_SEED` está hardcoded en TypeScript

**Síntoma:** Para cambiar datos demo, hay que recompilar

**Solución:** Cargar desde JSON externo

---

#### 8. **Error Handling - Mensajes Genéricos**

**Problema:** Muchos `catch {}` silenciosos

**Ejemplo:**
```typescript
catch {
  if (LOCAL_MODE) return LOCAL_STOCK_SEED
  throw new Error("No se pudieron cargar los materiales")
}
```

**Mejora:** Log del error original para debugging

---

### ⚡ **MENORES**

#### 9. **Códigos de Error Inconsistentes**

**Problema:** ExitApp(1) vs ExitApp(0) en AHK scripts

**Mejora:** Definir codes uniformes

---

#### 10. **TypeScript - Tipos Any**

**Problema:** Algunos servicios usan `Record<string, unknown>` sin tipar

**Mejora:** Usar tipos genéricos más específicos

---

#### 11. **Cloudinary - Hardcoded Upload Preset**

```typescript
formData.append("upload_preset", "operario_blueprints")
formData.append("upload_url", "https://api.cloudinary.com/v1_1/dpcdsorty/auto/upload")
```

**Riesgo:** Si presenten expira, requiere reconfiguramiento

**Solución:** Guardar en env vars

---

#### 12. **Auditoría - Sin Purga de Logs Antiguos**

**Problema:** `audit_logs` crece sin límite

**Solución:** Implementar retention policy (ej: 1 año)

---

### 🔧 **MEJORAS PENDIENTES** (Según AGENTS.md)

#### Corto Plazo
- [ ] Esperar reset Firebase cuota
- [ ] Probar sync stock + reparaciones completo
- [ ] Remover debug MouseMove de sync_reparaciones.ahk

#### Medio Plazo
- [ ] Nuevo módulo: REMITOS (leer remitos de 3C)
  - Nueva script: `sync_remitos.ahk`
  - Nuevas coordenadas en `config.ini`
  - Parser remitos Excel
  - Redis hash `rentals:active`
- [ ] Alimentar stock de máquinas disponibles desde remitos

#### Largo Plazo
- [ ] Migrar Firestore reads a Redis o Postgres
- [ ] Evaluar plan pago Firebase vs Supabase

---

## RESUMEN DE RIESGOS

| Severidad | Riesgo | Estado |
|-----------|--------|--------|
| 🔴 CRÍTICO | Firebase bloqueado | Fallback degradado activo |
| ⚠️ MAYOR | Cuota Firestore agotada | Monitoreo |
| ⚠️ MAYOR | AutoHotkey coords dependen de resolución | Manual calibration |
| ⚠️ MAYOR | Rendimiento: múltiples reads | Candidato a caché |
| ⚠️ MAYOR | Sincronización sin merge inteligente | A mejorar |
| ⚡ MENOR | Local mode hardcoded | No urgente |
| ⚡ MENOR | Auditoría sin purga | No urgente |

---

## SIGUIENTE PASOS RECOMENDADOS

### Inmediato (24h)
1. ✅ Esperar reset Firebase (~24h desde 2026-06-28)
2. ✅ Verificar sync stock + reparaciones funcionan
3. ✅ Probar en 2-3 máquinas diferentes

### Corto Plazo (1 semana)
1. Implementar React Query para deduplicar reads Firestore
2. Agregar merge inteligente en syncItems() (comparar antes/después)
3. Calibrar AutoHotkey coords en 3-4 PCs diferentes

### Medio Plazo (1-2 meses)
1. Diseñar módulo REMITOS
2. Implementar alertas de cuota Firestore (>80% de límite)
3. Crear dashboard de monitoring (# reads/día, latency)

### Largo Plazo (3+ meses)
1. Evaluar migración a Supabase + Postgres
2. Implementar caché distribuida (Redis)
3. Agregar replicación offline-first

---

## APÉNDICE: Rutas Firestore

```
📦 operario-control (Project)
├── 📂 machines (collection)
│   └── 📄 machine_id
│       ├── name, model, category, status
│       ├── locationType, location, rental
│       └── createdAt, updatedAt
├── 📂 inventory_stock (collection)
│   └── 📄 stock_id
│       ├── name, category, unit
│       ├── stockTotal, stockAvailable, stockRented
│       ├── source (3c|manual), codigo, deposito
│       └── createdAt, updatedAt
├── 📂 machine_spare_parts (collection)
│   └── 📄 part_id
│       ├── machineId, machineName, partName, partCode
│       ├── stockTotal, stockAvailable, stockUsed
│       ├── source (manual|blueprint), blueprintId
│       └── createdAt, updatedAt
├── 📂 repairs (collection)
│   └── 📄 repair_id
│       ├── machineId, machineName, clientName
│       ├── entryDate, exitDate, warrantyUntil
│       ├── status (EN_TALLER|FINALIZADO), partsUsed
│       ├── source (3c|manual|import), externalId
│       └── createdAt, updatedAt
├── 📂 maintenance_records (collection)
│   └── 📄 maintenance_id
├── 📂 stock_movements (collection)
│   └── 📄 movement_id
│       ├── partId, type (rent|return|use|add|remove)
│       ├── source, quantity, referenceId, date
├── 📂 inventory_movements (collection)
│   └── 📄 movement_id
│       ├── materialId, type, quantity, date
├── 📂 machine_blueprints (collection)
│   └── 📄 blueprint_id
│       ├── machineId, fileUrl, publicId (Cloudinary)
│       ├── fileType (pdf|image), createdAt
├── 📂 blueprint_drafts (collection)
│   └── 📄 draft_id
│       ├── machineId, blueprintId, partName, partCode
│       ├── status (draft|confirmed), createdAt
├── 📂 audit_logs (collection)
│   └── 📄 log_id
│       ├── action, entity, entityId
│       ├── before, after, timestamp
├── 📂 maintenance_settings (collection)
│   └── 📄 config
│       ├── oilChangeDays, bearingChangeDays
│       ├── maintenanceDays, warrantyDays
```

---

**Fin de Exploración Exhaustiva**

*Documento generado: 2026-07-10*  
*Codebase: operario-control@v0.1.0*  
*Framework: Next.js 16.2.9 + React 19.2.4*
