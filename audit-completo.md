# AUDITORÍA COMPLETA — OPERARIO CONTROL

**Fecha:** 26/06/2026
**Versión:** 0.1.0
**Stack:** Next.js 16.2.9 + React 19.2.4 + TypeScript + Firebase + Tailwind CSS 4 + Base UI + shadcn/ui
**Idioma:** Español (ES)
**Firebase Project:** operario-control

---

## 1. ESTRUCTURA DEL PROYECTO

```
operario-control/
├── .env.local                    # Config Firebase (9 vars: 7 Firebase + 2 Cloudinary)
├── .gitignore                    # Ignora node_modules, .next, .env*, service-account.json, local_exports/
├── AGENTS.md                     # Reglas para Next.js v16
├── CLAUDE.md                     # Apunta a AGENTS.md
├── components.json               # Config shadcn/ui
├── eslint.config.mjs             # ESLint flat config (Next.js core-web-vitals + typescript)
├── next-env.d.ts                 # Tipos generados por Next
├── next.config.ts                # Config Next.js vacía
├── package.json                  # 23 dependencias prod, 8 dev, 8 scripts
├── postcss.config.mjs            # @tailwindcss/postcss
├── tsconfig.json                 # Strict, bundler, paths: @/ → src/
├── README.md                     # Template create-next-app
├── audit-completo.md             # Esta auditoría
├── local_exports/logs/           # Directorio para exportación de logs
├── public/                       # 5 SVGs (file, globe, next, vercel, window)
├── scripts/
│   ├── seed-machines.ts          # Seed 67 máquinas (firebase-admin)
│   ├── export-logs.ts            # Exportar audit_logs a .txt
│   ├── fix-rented-machines.ts    # Fix rented machines inconsistentes
│   └── audit.ts                  # Auto-auditoría (legacy)
├── docs/
│   ├── auditoria-sistema.md      # Auditoría detallada del sistema
│   └── chat-log.txt              # Log de conversaciones relevantes
└── src/
    ├── app/
    │   ├── globals.css            # Tema OKLCH, Tailwind 4, animaciones
    │   ├── layout.tsx             # Layout raíz: AuthProvider + Toaster
    │   ├── page.tsx               # Redirige a /dashboard
    │   ├── login/page.tsx         # Login email/password
    │   ├── api/
    │   │   └── cloudinary/
    │   │       └── delete/route.ts  # Server: destroy en Cloudinary (Basic Auth)
    │   └── (protected)/
    │       ├── layout.tsx         # NavBar + redirect si no auth
    │       ├── dashboard/page.tsx # KPIs, categories, alerts, machine grid, stock grid
    │       ├── andamios/page.tsx  # Andamios: machine grid + stock grid
    │       ├── inventory/
    │       │   ├── page.tsx       # Listado de stock de materiales
    │       │   ├── new/page.tsx   # Crear item de stock
    │       │   └── [id]/page.tsx  # Detalle de item de stock
    │       ├── stock/page.tsx     # Stock global unificado
    │       ├── stock-movements/page.tsx  # Movimientos de stock (repuestos)
    │       ├── inventory-movements/page.tsx  # Movimientos de materiales
    │       ├── machines/
    │       │   ├── page.tsx       # Listado de máquinas
    │       │   ├── new/page.tsx   # Crear máquina (con quantity loop)
    │       │   └── [id]/
    │       │       ├── page.tsx   # Detalle + editar + rental + spare parts + blueprints
    │       │       ├── parts/page.tsx   # Spare parts CRUD + blueprint import
    │       │       └── blueprints/page.tsx  # Blueprint list + upload + delete
    │       ├── rentals/
    │       │   ├── page.tsx       # Listado (legacy)
    │       │   ├── new/page.tsx   # Crear (legacy)
    │       │   └── [id]/page.tsx  # Detalle (legacy)
    │       └── repairs/
    │           ├── page.tsx       # Listado (legacy)
    │           ├── new/page.tsx   # Crear (legacy)
    │           └── [id]/page.tsx  # Detalle (legacy)
    ├── components/
    │   ├── machines/
    │   │   ├── MachineCard.tsx           # Card con 3 ramas (Alquilada/Disponible/En reparación)
    │   │   ├── SparePartCard.tsx         # Card con partCode, badge categoría, stock, use/restock
    │   │   ├── BlueprintUploader.tsx     # Drag & drop zone con preview PDF/imagen
    │   │   ├── BlueprintImportPanel.tsx  # Split view: PDF left + draft form right
    │   │   ├── ImportInventory.tsx       # Importar Excel .xlsx/.xls
    │   │   └── SeedInventory.tsx         # Seed button en UI
    │   ├── ui/
    │   │   ├── ErrorState.tsx            # Renderiza error según tipo
    │   │   ├── badge.tsx, button.tsx, card.tsx, dialog.tsx,
    │   │   ├── input.tsx, label.tsx, select.tsx, separator.tsx,
    │   │   ├── sonner.tsx, table.tsx
    │   └── ui/[brand]/...               # Componentes de dominio adicionales
    ├── hooks/
    │   ├── useAuth.ts
    │   ├── useMachines.ts
    │   ├── useRentals.ts
    │   ├── useRepairs.ts
    │   ├── useSpareParts.ts
    │   ├── useMachineBlueprints.ts
    │   ├── useBlueprintDrafts.ts
    │   └── useInventoryStock.ts
    ├── lib/
    │   ├── AuthContext.tsx
    │   ├── categories.ts           # Subcategorías + colores + mapOldCategory
    │   ├── firebase.ts             # Init Firebase client
    │   ├── ui.ts                   # Funciones UI (formatDate, etc.)
    │   └── utils.ts                # cn() con tailwind-merge
    ├── services/
    │   ├── auth.ts                 # signIn, signOut, onAuthStateChanged
    │   ├── machines.ts             # CRUD + rent/maintenance lifecycle + scaffold middleware
    │   ├── rentals.ts              # CRUD rentals + update machine status (legacy)
    │   ├── repairs.ts              # CRUD repairs + update machine status (legacy)
    │   ├── audit.ts                # createAuditLog + fetchAuditLogs
    │   ├── inventoryStock.ts       # CRUD stock materiales + rentStockItem/returnStockItem + createMovement
    │   ├── inventoryMovements.ts   # CRUD movimientos de inventario (ALQUILER/DEVOLUCION/AJUSTE)
    │   ├── scaffoldRental.ts       # BOM andamios: rent/return scaffold components del stock
    │   ├── spareParts.ts           # CRUD repuestos + usePart/restockPart + deleteBlueprintSpareParts
    │   ├── machineBlueprints.ts    # Upload/get/delete despieces (Cloudinary + Firestore)
    │   ├── blueprintDrafts.ts      # CRUD borradores + confirm → spare_parts
    │   ├── pdfPartsExtractor.ts    # Extraer códigos Bosch de PDF con pdfjs-dist
    │   ├── stockMovements.ts       # CRUD movimientos de stock de repuestos
    │   ├── recommendationEngine.ts # Motor de recomendación (6 intents en español)
    │   └── recommendationAudit.ts  # Auditoría de recomendaciones
    └── types/
        ├── index.ts                # Re-exporta todos
        ├── machine.ts              # Machine, MachineStatus, MachineCategory, etc.
        ├── rental.ts               # Rental, RentalStatus, RentalFormData
        ├── repair.ts               # Repair, RepairStatus, RepairFormData
        ├── audit.ts                # AuditLog, AuditAction, AuditEntity
        ├── inventoryStock.ts       # InventoryStock, StockCategory, StockUnit, StockSize
        ├── inventoryMovement.ts    # InventoryMovement, InventoryMovementType
        ├── sparePart.ts            # SparePart, SparePartCategory, SparePartSource
        ├── blueprint.ts            # MachineBlueprint
        ├── blueprintDraft.ts       # BlueprintDraft
        ├── stockMovement.ts        # StockMovement, StockMovementType
        ├── recommendation.ts       # Recommendation, RecommendationIntent
        └── errors.ts               # AppError
```

**Total archivos fuente:** ~110+ (TSX + TS + CSS)

---

## 2. CONFIGURACIÓN

### 2.1 Firebase
- **Client SDK:** `firebase` v12.14.0
- **Admin SDK:** `firebase-admin` v14.0.0 (solo scripts)
- **Colecciones Firestore (11):** `machines`, `rentals`, `repairs`, `audit_logs`, `inventory_stock`, `inventory_movements`, `machine_spare_parts`, `machine_blueprints`, `blueprint_drafts`, `recommendation_audit`, `stock_movements`
- **Auth:** Email/password únicamente
- **Variables .env.local:** 7 vars Firebase (`NEXT_PUBLIC_FIREBASE_*`) + 2 vars Cloudinary
- **service-account.json:** Requerido en raíz para scripts, en .gitignore

### 2.2 Cloudinary
- **Cloud Name:** `dpcdsorty`
- **Upload Preset:** `operario_blueprints` (unsigned, público)
- **Carpeta:** `blueprints`
- **Formatos:** `pdf, jpg, jpeg, png, gif, webp`
- **Eliminación:** API route `/api/cloudinary/delete` (Basic Auth)

### 2.3 Scripts npm
| Script | Comando | Descripción |
|--------|---------|-------------|
| `dev` | `next dev --turbopack` | Servidor desarrollo con Turbopack |
| `build` | `next build` | Build producción |
| `start` | `next start` | Iniciar servidor producción |
| `lint` | `next lint` | Linting |
| `seed` | `tsx scripts/seed-machines.ts` | Seed 67 máquinas |
| `export-logs` | `tsx scripts/export-logs.ts` | Exportar audit logs a Excel |
| `fix:rented` | `tsx scripts/fix-rented-machines.ts` | Fix rented machines inconsistentes |
| `audit` | `tsx scripts/audit.ts` | Auto-auditoría (legacy) |

### 2.4 Dependencias clave
- **UI:** `@base-ui/react` v1.5.0, `tailwindcss` v4, `shadcn` v2.0.0
- **Firebase:** `firebase` v12.14.0, `firebase-admin` v14.0.0
- **PDF:** `pdfjs-dist` v6.0.227
- **Utilidades:** `lucide-react`, `sonner`, `xlsx`, `clsx`, `tailwind-merge`, `class-variance-authority`, `tw-animate-css`, `next-themes`
- **Next.js v16.2.9** con Turbopack

### 2.5 TypeScript
- Strict mode, target ES2017
- Path alias `@/` → `./src/*`
- Bundler module resolution

---

## 3. MODELO DE DATOS (FIRESTORE)

### 3.1 Colección `machines` (11 campos)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `name` | string | Nombre del equipo |
| `model` | string | Modelo específico |
| `category` | `"andamio" \| "maquinaria" \| "herramienta"` | Categoría principal |
| `subcategory` | string \| null | Subcategoría (solo andamios) |
| `status` | `"available" \| "rented" \| "maintenance"` | Estado actual |
| `location` | `"taller" \| "deposito" \| "obra"` | Ubicación física |
| `rental` | RentalInfo \| null | Datos del alquiler activo |
| `maintenance` | MaintenanceInfo \| null | Datos del mantenimiento activo |
| `metadata` | { priceAction: boolean } \| null | Metadatos varios |
| `createdAt` | Timestamp | Fecha creación |
| `updatedAt` | Timestamp | Fecha última modificación |

### 3.2 Colección `audit_logs`
| Campo | Tipo |
|-------|------|
| `action` | `"create" \| "update" \| "delete"` |
| `entity` | `"machine" \| "rental" \| "repair" \| "spare_part" \| "inventory_stock" \| "machine_blueprint" \| "blueprint_draft"` |
| `entityId` | string |
| `before` | Record \| null |
| `after` | Record \| null |
| `timestamp` | Timestamp |
| `userId` | string |

### 3.3 Colección `inventory_stock`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `name` | string | Nombre del material |
| `category` | `"puntales" \| "riendas" \| "andamio_accesorios" \| "consumibles"` | Categoría |
| `size` | string \| null | Tamaño (ej. "1m", "2m", "3m") |
| `unit` | `"unidad" \| "metro" \| "kg"` | Unidad de medida |
| `stockTotal` | number | Stock total |
| `stockRented` | number | Stock actualmente alquilado |
| `createdAt` | Timestamp | |
| `updatedAt` | Timestamp | |

### 3.4 Colección `inventory_movements` (FASE 2)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `materialId` | string | ID del material (inventory_stock) |
| `type` | `"ALQUILER" \| "DEVOLUCION" \| "AJUSTE"` | Tipo de movimiento |
| `quantity` | number | Cantidad |
| `date` | Timestamp | Fecha del movimiento |
| `clientName` | string \| null | Cliente asociado |
| `projectName` | string \| null | Obra asociada |
| `reference` | string \| null | ID de máquina/rental |
| `rentalId` | string \| null | ID de rental (futuro) |

### 3.5 Colección `machine_spare_parts`
| Campo | Tipo |
|-------|------|
| `machineId` | string |
| `machineName` | string |
| `machineModel` | string |
| `partName` | string |
| `partCode` | string |
| `category` | `"motor" \| "filtro" \| "electrico" \| "estructural" \| "consumible" \| "otro"` |
| `unit` | string |
| `stockTotal` | number |
| `stockAvailable` | number |
| `stockUsed` | number |
| `source` | `"manual" \| "imported" \| "blueprint"` |
| `blueprintId` | string \| null |
| `createdAt` | Timestamp |
| `updatedAt` | Timestamp |

### 3.6 Colección `machine_blueprints`
| Campo | Tipo |
|-------|------|
| `machineId` | string |
| `fileUrl` | string |
| `publicId` | string |
| `fileName` | string |
| `fileType` | `"pdf" \| "image"` |
| `createdAt` | Timestamp |

### 3.7 Colección `blueprint_drafts`
| Campo | Tipo |
|-------|------|
| `machineId` | string |
| `blueprintId` | string |
| `partCode` | string |
| `partName` | string |
| `createdAt` | Timestamp |

### 3.8 Colecciones legacy: `rentals`, `repairs`, `stock_movements`, `recommendation_audit`

---

## 4. TIPOS (TypeScript)

### 4.1 Tipos de máquina (`types/machine.ts`)
```typescript
MachineStatus     = "available" | "rented" | "maintenance"
MachineLocation   = "taller" | "deposito" | "obra"
MachineCategory   = "andamio" | "maquinaria" | "herramienta"

Machine, MachineRental, MachineMetadata,
CreateMachineInput, UpdateMachineInput
```

### 4.2 Tipos de inventario (`types/inventoryStock.ts`)
```typescript
StockCategory   = "puntales" | "riendas" | "andamio_accesorios" | "consumibles"
StockUnit       = "unidad" | "metro" | "kg"
StockSize       = string

InventoryStock {
  id, name, category, size?, unit,
  stockTotal: number,
  stockRented: number,
  createdAt, updatedAt
}

CreateStockInput
```

### 4.3 Tipos de movimiento de inventario (`types/inventoryMovement.ts`)
```typescript
InventoryMovementType = "ALQUILER" | "DEVOLUCION" | "AJUSTE"

InventoryMovement {
  id, materialId, type, quantity, date,
  clientName?, projectName?, reference?, rentalId?
}
```

### 4.4 Tipos de repuesto (`types/sparePart.ts`)
```typescript
SparePartCategory = "motor" | "filtro" | "electrico" | "estructural" | "consumible" | "otro"
SparePartSource   = "manual" | "imported" | "blueprint"

SparePart {
  id, machineId, machineName, machineModel,
  partName, partCode, category, unit,
  stockTotal, stockAvailable, stockUsed,
  source, blueprintId?,
  createdAt, updatedAt
}

CreateSparePartInput
```

### 4.5 Otros tipos
```typescript
RentalStatus         = "active" | "closed"
RepairStatus         = "pending" | "repairing" | "done"
AuditAction          = "create" | "update" | "delete"
AuditEntity          = "machine" | "rental" | "repair" | "spare_part" | ...
StockMovementType    = "ENTRADA" | "SALIDA" | "AJUSTE"
RecommendationIntent = "comprar" | "alquilar" | "reparar" | "vender" | "mantener" | "reevaluar"
```

---

## 5. CATEGORÍAS Y SUBCATEGORÍAS

### 5.1 Categorías
| Clave | Label | Color | Icono |
|-------|-------|-------|-------|
| `andamio` | Andamio | naranja | `<Building2 />` |
| `maquinaria` | Maquinaria | gris | `<Cog />` |
| `herramienta` | Herramienta | teal | `<Wrench />` |

### 5.2 Subcategorías (solo `andamio`)
1. `base`
2. `rienda corta`
3. `rienda larga`
4. `pasillero`
5. `reforzado`
6. `caballetes`
7. `tablón`
8. `puntales`

### 5.3 Migración (`mapOldCategory`)
| Valor antiguo (DB) | Nuevo valor |
|--------------------|-------------|
| `machine` | `maquinaria` |
| `maquina` | `maquinaria` |
| `scaffold` | `andamio` |
| `tool` | `herramienta` |

---

## 6. SERVICIOS (Firebase)

### 6.1 `machines.ts` — CRUD + ciclo de vida + scaffold middleware
- `createMachine(input)` → Crea doc + audit log
- `getMachine(id)` / `getMachines()` → Lectura con `docToMachine`
- `updateMachine(id, data)` → Actualiza campos + audit log
- `deleteMachine(id)` → Elimina + audit log
- `deleteAllMachines()` → Batch delete
- `rentMachine(id, rental)` → Status `rented` + embebe rental + audit + si scaffold: consume BOM del inventory_stock (pasa contexto clientName/projectName a scaffoldRental)
- `returnMachine(id)` → Status `available` + limpia rental + audit + si scaffold: devuelve BOM al stock (lee contexto del rental embebido)
- `startMaintenance(id, maintenance)` → Status `maintenance` + embebe maintenance + audit
- `completeMaintenance(id)` → Status `available` + limpia maintenance + audit

### 6.2 `inventoryStock.ts` — Stock de materiales (andamios)
- `getStockItems()` / `getStockItem(id)` → Lectura
- `createStockItem(input)` → Crea item + previene duplicados por (name + size) + audit
- `updateStockItem(id, data)` → Actualiza + valida stockTotal >= stockRented + audit
- `deleteStockItem(id)` → Elimina + audit
- `rentStockItem(id, quantity, options?)` → Incrementa stockRented + crea movimiento ALQUILER en inventory_movements
- `returnStockItem(id, quantity, options?)` → Decrementa stockRented + crea movimiento DEVOLUCION en inventory_movements

### 6.3 `inventoryMovements.ts` — Trazabilidad de materiales (FASE 2)
- `createInventoryMovement(data)` → Inserta movimiento en inventory_movements
- `getAllInventoryMovements()` → Todos ordenados por date desc
- `getInventoryMovementsByMaterial(materialId)` → Filtrados por material

### 6.4 `scaffoldRental.ts` — BOM de andamios
- Receta: 2 Riendas largas + 2 Riendas cortas + 1 Tablón 3m por cuerpo
- `rentScaffoldComponents(options?)` → Consume del stock (mayor cantidad disponible primero). Acepta parámetros de contexto (clientName, projectName, reference).
- `returnScaffoldComponents(options?)` → Devuelve al stock (al de mayor rented primero). Acepta contexto.

### 6.5 `spareParts.ts` — Repuestos de máquinas
- `getSparePartsByMachine(machineId)` → Lista por máquina (sin orderBy para evitar índice)
- `getSparePartById(id)` → Busca por ID
- `createSparePart(input)` → Crea + previene duplicados por (machineId + partCode) + audit
- `updateSparePart(id, data)` → Actualiza + audit
- `deleteSparePart(id)` → Elimina + audit
- `deleteBlueprintSpareParts(machineId)` → Batch delete source="blueprint"
- `usePart(id, quantity)` → Decrementa stockTotal y stockAvailable, incrementa stockUsed
- `restockPart(id, quantity)` → Incrementa stockTotal y stockAvailable

### 6.6 `machineBlueprints.ts` — Despieces técnicos
- `uploadBlueprint(machineId, file)` → Sube a Cloudinary → Firestore → extrae repuestos del PDF (pdfjs-dist). Antes de extraer, limpia repuestos `source="blueprint"`.
- `getBlueprints(machineId)` → Lista despieces de una máquina
- `deleteBlueprint(id)` → Cloudinary destroy → elimina repuestos asociados → elimina doc Firestore

### 6.7 `blueprintDrafts.ts` — Borradores
- `createDraft(input)` → Crea borrador temporal
- `getDrafts(machineId, blueprintId?)` → Lista borradores
- `updateDraft(id, data)` → Actualiza
- `deleteDraft(id)` → Elimina
- `confirmDrafts(machineId, blueprintId, machineName, machineModel)` → Migra todos a machine_spare_parts

### 6.8 `pdfPartsExtractor.ts` — Extracción de códigos Bosch
- `extractPartsFromPdf(fileUrl)` → Descarga PDF, extrae texto con pdfjs-dist, parsea códigos Bosch (formato `1 619 P10 958`) + descripciones

### 6.9 `stockMovements.ts` — Movimientos de stock de repuestos
- `createStockMovement(data)` → Inserta en stock_movements
- `getStockMovements()` → Todos ordenados por date desc
- `getStockMovementsBySparePart(sparePartId)` → Filtrados por repuesto

### 6.10 `recommendationEngine.ts` — Motor de recomendación
- 6 intents: `comprar`, `alquilar`, `reparar`, `vender`, `mantener`, `reevaluar`
- `detectIntent(input)` → Clasifica texto libre del usuario
- `scoreMachine(machine, intent)` → Puntúa según estado, ubicación, días alquilado
- `rankMachines(machines, intent)` → Ranking descendente por score
- `recommendMachine(machines, input)` → Detecta intent + ranking

### 6.11 Otros servicios
| Servicio | Funciones |
|----------|-----------|
| `auth.ts` | `login()`, `logout()`, `onAuthChange()` |
| `audit.ts` | `createAuditLog()`, `fetchAuditLogs()` |
| `rentals.ts` | CRUD básico legacy |
| `repairs.ts` | CRUD básico legacy |
| `recommendationAudit.ts` | `logRecommendation()` |

---

## 7. HOOKS (React)

| Hook | Parámetros | Expone | Descripción |
|------|-----------|--------|-------------|
| `useAuth` | — | `user`, `loading`, `login`, `logout` | Autenticación |
| `useMachines` | — | `machines`, `loading`, `error`, `create`, `update`, `rent`, `returnMachine`, `setMaintenance`, `completeMaintenance`, `remove` | CRUD + ciclo de vida |
| `useSpareParts` | `machineId` | `spareParts`, `loading`, `error`, `create`, `update`, `remove`, `usePart`, `restockPart`, `deleteBlueprintParts` | CRUD + use/restock. Sort in-memory con localeCompare("es") |
| `useMachineBlueprints` | `machineId` | `blueprints`, `loading`, `error`, `upload`, `remove` | CRUD + upload Cloudinary |
| `useBlueprintDrafts` | `machineId`, `blueprintId?` | `drafts`, `create`, `update`, `remove`, `confirm` | Drafts + confirm → spare_parts |
| `useInventoryStock` | — | `items`, `loading`, `error`, `create`, `update`, `remove`, `rent`, `return` | CRUD + rent/return stock materiales |
| `useRentals` | — | `items`, `loading`, `error` | Legacy |
| `useRepairs` | — | `items`, `loading`, `error` | Legacy |

---

## 8. PÁGINAS (App Router)

### 8.1 Rutas
| Ruta | Archivo | Tipo | Protegida |
|------|---------|------|-----------|
| `/` | `page.tsx` | Redirige a /dashboard | No |
| `/login` | `login/page.tsx` | Login form | No |
| **API:** `/api/cloudinary/delete` | `api/cloudinary/delete/route.ts` | Server | No |
| `/dashboard` | `(protected)/dashboard/page.tsx` | Dashboard con KPIs, categorías, alertas | Sí |
| `/machines` | `(protected)/machines/page.tsx` | Listado con filtros + bulk delete | Sí |
| `/machines/new` | `(protected)/machines/new/page.tsx` | Crear con quantity loop | Sí |
| `/machines/[id]` | `(protected)/machines/[id]/page.tsx` | Detalle + editar + rental + spare parts + blueprints | Sí |
| `/machines/[id]/parts` | `(protected)/machines/[id]/parts/page.tsx` | Spare parts CRUD + blueprint import | Sí |
| `/machines/[id]/blueprints` | `(protected)/machines/[id]/blueprints/page.tsx` | Blueprint list + upload + delete | Sí |
| `/andamios` | `(protected)/andamios/page.tsx` | Andamios: machine grid + stock grid | Sí |
| `/inventory` | `(protected)/inventory/page.tsx` | Listado stock materiales + cards resumen + filtros | Sí |
| `/inventory/new` | `(protected)/inventory/new/page.tsx` | Crear item stock | Sí |
| `/inventory/[id]` | `(protected)/inventory/[id]/page.tsx` | Detalle stock + rent/return + historial | Sí |
| `/stock` | `(protected)/stock/page.tsx` | Stock global unificado (machines, scaffolds, spare parts) | Sí |
| `/stock-movements` | `(protected)/stock-movements/page.tsx` | Movimientos stock repuestos + cards + filtros | Sí |
| `/inventory-movements` | `(protected)/inventory-movements/page.tsx` | Movimientos materiales + cards + filtros | Sí |
| `/rentals` | `(protected)/rentals/page.tsx` | Listado (legacy) | Sí |
| `/rentals/new` | `(protected)/rentals/new/page.tsx` | Crear (legacy) | Sí |
| `/rentals/[id]` | `(protected)/rentals/[id]/page.tsx` | Detalle (legacy) | Sí |
| `/repairs` | `(protected)/repairs/page.tsx` | Listado (legacy) | Sí |
| `/repairs/new` | `(protected)/repairs/new/page.tsx` | Crear (legacy) | Sí |
| `/repairs/[id]` | `(protected)/repairs/[id]/page.tsx` | Detalle (legacy) | Sí |

**Total:** 21 rutas (20 páginas + 1 API endpoint). 100% `"use client"`.

### 8.2 Layouts
- **Root:** AuthProvider + Toaster + html lang=es
- **Protected:** NavBar con 10 items: Dashboard, Máquinas, Andamios, Inventario, Stock, Alquileres, Reparaciones, Mov. Stock, Mov. Materiales, Mantenimiento + user email + logout. Redirige a /login si no autenticado.

### 8.3 Dashboard
- 4 tarjetas resumen: Disponibles, Alquiladas, Mantenimiento, Total
- Grid de categorías con íconos y contadores
- Sección de alertas (máquinas en mantenimiento > 7 días)
- Grid de máquinas con buscador y filtro por estado
- Grid de stock con items con poco stock (stockRented >= stockTotal)
- SeedInventory si colección vacía

### 8.4 Máquinas (listado)
- Botón "Importar inventario" (Excel)
- Botón "Nueva máquina"
- Grid de tarjetas con nombre, modelo, ubicación, categoría, badge estado
- Filtros por estado + búsqueda por nombre/modelo
- Modo bulk delete

### 8.5 Máquina (detalle)
- Header: nombre, modelo, categoría > subcategoría, badge estado
- Modo edición: nombre, modelo, categoría + subcategoría condicional, ubicación
- Card alquiler activo: cliente, fechas, botón devolver
- Card mantenimiento activo: motivo, fechas, botón completar
- Formulario alquiler: cliente, inicio, retorno
- Formulario mantenimiento: motivo, inicio, fin estimado
- Sección de repuestos (SparePartCard + botón agregar)
- Sección de despieces (BlueprintUploader + lista + delete)
- Botón eliminar

### 8.6 Andamios
- Grid de máquinas categoría "andamio" con cards
- Grid de stock de materiales (inventory_stock) con cards

### 8.7 Inventario (materiales)
- 5 cards resumen: Total items, Stock total, Alquilado, Disponible, Categorías
- Tabla con nombre, tamaño, categoría, stock total, alquilado, disponible, badge estado (completo/parcial/sin_stock)
- Filtros por categoría + búsqueda por nombre + rango stock alquilado
- Acciones: Ver detalle

### 8.8 Stock Global
- 4 secciones: Máquinas, Andamios (stock materiales), Repuestos, Stock crítico
- Cada sección con su tabla y resumen numérico
- Badges de estado para stock (completo/parcial/sin_stock)

### 8.9 Mov. Stock (repuestos)
- 4 cards resumen: Total movimientos, Entradas, Salidas, Ajustes
- Tabla con fecha, tipo, repuesto, cantidad, referencia
- Filtros por tipo + rango fecha + búsqueda
- Botón registrar movimiento (ENTRADA/SALIDA/AJUSTE)

### 8.10 Mov. Materiales (FASE 2)
- 4 cards resumen: Total movimientos, Alquileres, Devoluciones, Materiales afectados
- Tabla con fecha, tipo, material, cantidad, cliente, obra, referencia
- Filtros por tipo + rango fecha + búsqueda (material/cliente/obra)
- Link a detalle de material y a máquina

### 8.11 Login
- Formulario email + password
- Redirige a /dashboard si ya autenticado

---

## 9. COMPONENTES UI (shadcn/ui + Base UI)

13 componentes, todos en `src/components/ui/`:

| Componente | Líneas | Librería Base |
|------------|--------|---------------|
| `ErrorState.tsx` | ~50 | Nativo |
| `badge.tsx` | 52 | `@base-ui/react/useRender` |
| `button.tsx` | 58 | `@base-ui/react/button` |
| `card.tsx` | 103 | Nativo |
| `dialog.tsx` | 160 | `@base-ui/react/dialog` |
| `input.tsx` | 20 | `@base-ui/react/input` |
| `label.tsx` | 20 | Nativo |
| `select.tsx` | 201 | `@base-ui/react/select` |
| `separator.tsx` | 25 | `@base-ui/react/separator` |
| `sonner.tsx` | 49 | `sonner` + `next-themes` |
| `table.tsx` | 116 | Nativo |

---

## 10. COMPONENTES DE NEGOCIO

### 10.1 `MachineCard.tsx`
- 3 ramas visuales según estado: Alquilada (azul), Disponible (verde), En reparación (ámbar)
- Muestra nombre, modelo, ubicación, cliente si alquilado

### 10.2 `SparePartCard.tsx`
- partCode destacado, badge de categoría
- Stock: total, disponible, usado
- Botones use/restock

### 10.3 `BlueprintUploader.tsx`
- Drag & drop zone
- Preview PDF/imagen
- Subida asíncrona a Cloudinary

### 10.4 `BlueprintImportPanel.tsx`
- Split view: PDF izquierda + formulario draft derecha
- Extracción automática de códigos Bosch

### 10.5 `SeedInventory.tsx`
- 67 ítems precargados del catálogo Cocrear + mercado
- Andamios (15), Maquinaria (22), Herramientas (11) + stock inicial + repuestos
- Verifica duplicados por name+model antes de insertar
- Solo visible si colección vacía

### 10.6 `ImportInventory.tsx`
- Acepta `.xlsx`/`.xls`
- Normaliza headers español/inglés
- Mapeo flexible: columnas → campos
- Deduplicación por name+model
- Vista previa + resumen

---

## 11. SCRIPTS

### 11.1 `scripts/seed-machines.ts`
- Runtime: `npx tsx`, SDK: `firebase-admin`
- Requiere: `service-account.json` en raíz
- Inserta 67 máquinas, stock inicial y repuestos
- Deduplica por name+model

### 11.2 `scripts/export-logs.ts`
- Exporta `audit_logs` a `local_exports/logs/` como .txt

### 11.3 `scripts/fix-rented-machines.ts`
- Detecta y corrige máquinas con estado inconsistente (rented pero sin rental data)

### 11.4 `scripts/audit.ts`
- Auto-auditoría de colecciones Firestore (legacy)

---

## 12. SEGURIDAD Y BUENAS PRÁCTICAS

- **Sin secrets en código:** Firebase config via env vars
- **service-account.json** en `.gitignore`
- **Audit logging** en cada operación CRUD
- **Client SDK** en frontend (nunca admin SDK)
- **Sin `router.push` en render** — redirects en `useEffect`
- **Deduplicación** en seed, importación, creación de stock y repuestos
- **Categorías con migración** — `mapOldCategory` para datos legacy
- **API route protegida** con Basic Auth (Cloudinary delete)
- **Validación stock** — stockTotal >= stockRented en updates
- **Índices evitados** — sort in-memory con localeCompare para evitar compuestos innecesarios
- **Backward compatibility** — options object opcional en rentStockItem/returnStockItem (FASE 2)

---

## 13. OBSERVACIONES

- Todas las páginas usan `"use client"` — 100% CSR, sin Server Components
- El sistema de `rentals` y `repairs` como colecciones separadas es legacy; la data actual se embebe en `machines`
- Las operaciones de andamio (scaffold) son un middleware dentro de machines.ts que consume/devuelve del inventory_stock
- La trazabilidad de materiales (FASE 2) conecta machines.ts → scaffoldRental.ts → inventoryStock.ts → inventory_movements
- No hay reglas de seguridad de Firestore definidas (seguridad a nivel de app)
- Base UI v1.5.0 reemplaza a Radix UI como capa headless
- El build produce ~21 rutas (20 estáticas, 1 dinámica API) sin errores TS
- Sin tests unitarios ni de integración
- Sin CI/CD pipeline
- Sin variables de entorno configuradas en Vercel (solo `.env.local`)
