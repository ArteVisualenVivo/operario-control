# Auditoría del Sistema — Operario Control

**Generada:** 2026-06-18
**Versión del proyecto:** 0.1.0
**Último build:** Exitoso — 0 errores TypeScript, 0 errores compilación

---

## 1. Resumen General

| Indicador | Valor |
|-----------|-------|
| Framework | Next.js 16.2.9 (App Router) |
| React | 19.2.4 |
| TypeScript | Sí |
| Tailwind CSS | ^4 |
| UI Library | Shadcn/ui + Base UI |
| Estado del build | ✅ Compila sin errores |
| Total dependencias prod | 16 |
| Total dependencias dev | 8 |
| Archivos fuente (src/) | 71 (21 TSX + 38 TS + 1 CSS + 1 JSON) |
| Rutas de aplicación | 15 (1 API + 14 páginas) |
| Servicios backend | 14 |
| Hooks React | 8 |
| Componentes UI | 15 |
| Scripts CLI | 4 |

---

## 2. Infraestructura Cloud

### 2.1 Firebase

| Aspecto | Detalle |
|---------|---------|
| Project ID | `operario-control` |
| Auth Domain | `operario-control.firebaseapp.com` |
| Storage Bucket | `operario-control.firebasestorage.app` |
| Plan | Spark (gratuito) |
| Auth Provider | Email/Password |
| SDK Cliente | `firebase` ^12.14.0 |
| SDK Admin | `firebase-admin` ^14.0.0 |
| Reglas versionadas | ❌ No (solo en consola Firebase) |

#### Colecciones Firestore

| Colección | Descripción | Operaciones CRUD |
|-----------|-------------|------------------|
| `machines` | Catálogo de equipos con estado embebido | CRUD + rent/return + batch delete |
| `machine_spare_parts` | Catálogo de repuestos por modelo de máquina | CRUD + use/restock + upsert + batch delete por fuente |
| `machine_blueprints` | Metadatos de despieces técnicos subidos a Cloudinary | CRUD sin actualización |
| `blueprint_drafts` | Repuestos temporales antes de confirmar | CRUD + confirm (migra a spare_parts) |
| `inventory_stock` | Stock agregado de materiales de andamio | CRUD + rent/return por cantidad |
| `audit_logs` | Auditoría de todas las operaciones | Insert + fetch |
| `recommendation_audit` | Historial de recomendaciones | Insert + fetch |
| `rentals` | Historial de alquileres (legacy) | CRUD |
| `repairs` | Historial de reparaciones (legacy) | CRUD |

#### Índices Firestore Existentes

| Colección | Campos | Tipo |
|-----------|--------|------|
| `machine_spare_parts` | `machineId` (asc) | Simple |
| `machine_blueprints` | `machineId` (asc) + `createdAt` (desc) | Compuesto |
| `audit_logs` | `timestamp` (desc) | Simple |
| `blueprint_drafts` | `machineId` (asc) + `blueprintId` (asc) | Compuesto |
| `inventory_stock` | `name` (asc) | Simple |
| `machines` | `name` (asc) | Simple |

**Nota:** Se eliminó `orderBy("partName")` de `getSparePartsByMachine()` para evitar requerir un índice compuesto. El ordenamiento se hace en memoria en el hook `useSpareParts()` con `localeCompare`.

### 2.2 Cloudinary

| Aspecto | Detalle |
|---------|---------|
| Cloud Name | `dpcdsorty` |
| Upload Method | Unsigned (desde el cliente) |
| Upload Preset | `operario_blueprints` (tipo `upload`, público) |
| Endpoint | `auto/upload` (acepta imágenes y PDFs) |
| Autenticación (server) | API Key + API Secret vía Basic Auth |
| Delete Endpoint | `image/destroy` para imágenes, `raw/destroy` para PDFs |
| Formatos permitidos | `pdf`, `jpg`, `jpeg`, `png`, `gif`, `webp` |
| Tipo de asset | `upload` (público, configurado en preset) |
| Carpeta | `blueprints` |

#### Variables de Entorno Cloudinary

| Variable | Fuente | Uso |
|----------|--------|-----|
| `CLOUDINARY_API_KEY` | `.env.local` | Server API route (auth) |
| `CLOUDINARY_API_SECRET` | `.env.local` | Server API route (auth) |

**Flujo de subida:**
```
Cliente → Cloudinary auto/upload (unsigned, preset) → public_id + secure_url
  → Firestore: machine_blueprints
  → Si PDF: pdfjs-dist extrae texto → detecta códigos Bosch → crea repuestos
```

**Flujo de eliminación:**
```
Cliente → API route (server) → Cloudinary destroy (Basic Auth)
  → Firestore: eliminar repuestos blueprint → eliminar documento blueprint
```

### 2.3 Vercel (Deploy)

| Aspecto | Estado |
|---------|--------|
| Archivo `vercel.json` | ❌ No existe |
| Variables de entorno prod | ❌ No configuradas (solo `.env.local`) |
| Service Account en build | ❌ No (correctamente excluido) |
| `output: "export"` en next.config | ❌ No (correcto para Firebase Auth) |

#### Requisitos para deploy en Vercel

1. Configurar estas variables en Vercel Dashboard → Project Settings → Environment Variables — Production:

| Variable | Descripción |
|----------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase API Key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | operario-control.firebaseapp.com |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | operario-control |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | operario-control.firebasestorage.app |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | 474065245898 |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | 1:474065245898:web:003f8836cec7429ad80633 |
| `CLOUDINARY_API_KEY` | 241839134494653 |
| `CLOUDINARY_API_SECRET` | 1d6a_-qzdDTIq_oCN4_CZBdISfE |

2. NO incluir `service-account.json` en el build

---

## 3. Data Model (TypeScript)

### 3.1 Tipos base (`src/types/`)

| Archivo | Interfaces exportadas |
|---------|----------------------|
| `machine.ts` | `Machine`, `MachineRental`, `MachineStatus`, `MachineLocation`, `MachineCategory`, `CreateMachineInput`, `UpdateMachineInput` |
| `sparePart.ts` | `SparePart`, `CreateSparePartInput`, `SparePartCategory`, `SparePartSource` |
| `inventoryStock.ts` | `InventoryStock`, `CreateStockInput`, `StockCategory`, `StockUnit`, `StockSize` |
| `audit.ts` | `AuditLog`, `AuditAction`, `AuditEntity` |
| `errors.ts` | `AppError` |
| `rental.ts` | `Rental` |
| `repair.ts` | `Repair` |

### 3.2 Máquina (`Machine`)

```typescript
interface Machine {
  id: string
  name: string
  model: string
  category: "machine" | "tool" | "scaffold" | null
  status: "available" | "rented" | "maintenance"
  locationType: "deposito" | "obra" | "taller"
  rental: MachineRental | null
  createdAt: Date
  updatedAt: Date
}
```

### 3.3 Repuesto (`SparePart`)

```typescript
interface SparePart {
  id: string
  machineId: string
  machineName: string
  machineModel: string
  partName: string
  partCode: string
  category: "motor" | "filtro" | "electrico" | "estructural" | "consumible" | "otro"
  unit: string
  stockTotal: number
  stockAvailable: number
  stockUsed: number
  source: "manual" | "imported" | "blueprint"
  blueprintId?: string
  createdAt: Date
  updatedAt: Date
}
```

### 3.4 Inventory Stock

```typescript
interface InventoryStock {
  id: string
  name: string
  category: "puntales" | "riendas" | "andamio_accesorios" | "consumibles"
  size?: string
  unit: "unidad" | "metro" | "kg"
  stockTotal: number
  stockRented: number
  createdAt: Date
  updatedAt: Date
}
```

### 3.5 Blueprint (despiece)

```typescript
interface MachineBlueprint {
  id: string
  machineId: string
  fileUrl: string
  publicId: string
  fileName: string
  fileType: "pdf" | "image"
  createdAt: Date
}
```

### 3.6 Blueprint Draft

```typescript
interface BlueprintDraft {
  id: string
  machineId: string
  blueprintId: string
  partCode: string
  partName: string
  createdAt: Date
}
```

---

## 4. Servicios

### 4.1 `src/services/machines.ts` — CRUD de máquinas + ciclo de alquiler

| Función | Descripción |
|---------|-------------|
| `createMachine(input)` | Crea máquina con timestamp server |
| `rentMachine(id, rental)` | Cambia status a "rented", guarda rental data. Si categoría es "scaffold", consume BOM del inventory_stock |
| `returnMachine(id)` | Cambia status a "available", registra fecha devolución. Si scaffold, devuelve BOM al stock |
| `updateMachine(id, data)` | Actualiza campos parciales |
| `deleteMachine(id)` | Elimina máquina + audit log |
| `deleteAllMachines()` | Batch delete todas las máquinas |
| `getMachine(id)` | Retorna una máquina o null |
| `getMachines()` | Retorna todas las máquinas ordenadas por name |

**Audit:** `createAuditLog` en cada operación. **Scaffold middleware:** Llama a `rentScaffoldComponents()`/`returnScaffoldComponents()` en `rent/return`.

### 4.2 `src/services/spareParts.ts` — CRUD de repuestos

| Función | Descripción |
|---------|-------------|
| `getSparePartsByMachine(machineId)` | Lista repuestos por máquina |
| `getSparePartById(id)` | Busca por ID |
| `createSparePart(input)` | Crea repuesto. Previene duplicados por `(machineId + partCode)`. Guarda `blueprintId`. |
| `updateSparePart(id, data)` | Actualiza nombre/categoría |
| `deleteSparePart(id)` | Elimina repuesto |
| `deleteBlueprintSpareParts(machineId)` | Elimina todos los repuestos con `source === "blueprint"` para una máquina |
| `usePart(id, quantity)` | Decrementa `stockTotal` y `stockAvailable`, incrementa `stockUsed` |
| `restockPart(id, quantity)` | Incrementa `stockTotal` y `stockAvailable` |

**Audit:** Cada operación registra `createAuditLog`.

### 4.3 `src/services/machineBlueprints.ts` — Despieces técnicos

| Función | Descripción |
|---------|-------------|
| `uploadBlueprint(machineId, file)` | Sube a Cloudinary → Firestore → extrae repuestos del PDF (pdfjs-dist). Antes de extraer, limpia repuestos `source="blueprint"` |
| `getBlueprints(machineId)` | Lista despieces de una máquina |
| `deleteBlueprint(id)` | Elimina de Cloudinary (destroy) → elimina repuestos asociados (blueprintId + legacy sin bpId) → elimina doc Firestore |

**Origen de spare parts:** `"blueprint"` con `blueprintId` opcional.

### 4.4 `src/services/blueprintDrafts.ts` — Borradores de importación manual

| Función | Descripción |
|---------|-------------|
| `createDraft(input)` | Crea borrador temporal |
| `getDrafts(machineId, blueprintId?)` | Lista borradores |
| `updateDraft(id, data)` | Actualiza borrador |
| `deleteDraft(id)` | Elimina borrador |
| `confirmDrafts(machineId, blueprintId, machineName, machineModel)` | Migra todos los borradores a `machine_spare_parts` |

### 4.5 `src/services/inventoryStock.ts` — Stock de materiales

| Función | Descripción |
|---------|-------------|
| `getStockItems()` | Lista todos los items de stock |
| `getStockItem(id)` | Busca por ID |
| `createStockItem(input)` | Crea item. Previene duplicados por `(name + size)`. |
| `updateStockItem(id, data)` | Actualiza. Valida `newStockTotal >= stockRented`. |
| `deleteStockItem(id)` | Elimina item |
| `rentStockItem(id, quantity)` | Incrementa `stockRented` |
| `returnStockItem(id, quantity)` | Decrementa `stockRented` |

### 4.6 `src/services/scaffoldRental.ts` — BOM de andamios

| Función | Descripción |
|---------|-------------|
| `rentScaffoldComponents(components, clientData)` | Consume del stock (mayor cantidad disponible primero). Si `size` especificado, busca por name+size; si no, por name solo. |
| `returnScaffoldComponents(components)` | Devuelve al stock (al de mayor rented primero) |

**Receta:** 2 Riendas largas + 2 Riendas cortas + 1 Tablón 3m por cuerpo de andamio.

### 4.7 `src/services/pdfPartsExtractor.ts` — Extracción automática de códigos Bosch

| Función | Descripción |
|---------|-------------|
| `extractPartsFromPdf(fileUrl)` | Descarga PDF, extrae texto con pdfjs-dist, parsea códigos Bosch (formato `1 619 P10 958`) + descripciones, retorna `ExtractedPart[]` |

**Worker:** `cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs`

### 4.8 Otros servicios

| Servicio | Funciones | Descripción |
|----------|-----------|-------------|
| `audit.ts` | `createAuditLog()`, `fetchAuditLogs()` | Registro de auditoría centralizado |
| `auth.ts` | `login()`, `logout()`, `onAuthChange()` | Firebase Auth |
| `recommendationEngine.ts` | `detectIntent()`, `scoreMachine()`, `rankMachines()`, `recommendMachine()` | Motor de recomendación de 6 intents (español) |
| `recommendationAudit.ts` | `logRecommendation()` | Persistencia de auditoría de recomendaciones |
| `rentals.ts` | CRUD básico | Legacy |
| `repairs.ts` | CRUD básico | Legacy |

---

## 5. Hooks React

| Hook | Parámetros | Retorna | Descripción |
|------|-----------|---------|-------------|
| `useAuth()` | — | `user`, `loading` | Estado de autenticación |
| `useMachines()` | — | `machines`, `loading`, `error`, `create`, `update`, `remove`, ... | CRUD + rent/return |
| `useSpareParts(machineId)` | machineId | `spareParts`, `loading`, `error`, `create`, `update`, `remove`, `usePart`, `restockPart`, `deleteBlueprintParts` | CRUD + use/restock + batch delete blueprint. Sort in-memory con `localeCompare("es")`. |
| `useMachineBlueprints(machineId)` | machineId | `blueprints`, `loading`, `error`, `upload`, `remove` | CRUD + upload a Cloudinary |
| `useBlueprintDrafts(machineId, blueprintId?)` | machineId, blueprintId | `drafts`, `create`, `update`, `remove`, `confirm` | Drafts + confirm → spare_parts |
| `useInventoryStock()` | — | `items`, `loading`, `error`, `create`, `update`, `remove`, `rent`, `return` | CRUD + rent/return |
| `useRentals()` | — | `items`, `loading`, `error` | Legacy |
| `useRepairs()` | — | `items`, `loading`, `error` | Legacy |

---

## 6. Componentes UI

### 6.1 Shadcn/ui (genéricos)

| Componente | Archivo |
|-----------|---------|
| `Badge` | `src/components/ui/badge.tsx` |
| `Button` | `src/components/ui/button.tsx` |
| `Card`, `CardHeader`, `CardTitle`, `CardContent` | `src/components/ui/card.tsx` |
| `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` | `src/components/ui/dialog.tsx` |
| `Input` | `src/components/ui/input.tsx` |
| `Label` | `src/components/ui/label.tsx` |
| `Select` | `src/components/ui/select.tsx` |
| `Separator` | `src/components/ui/separator.tsx` |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell` | `src/components/ui/table.tsx` |
| `Toaster` (sonner) | `src/components/ui/sonner.tsx` |

### 6.2 Componentes de dominio

| Componente | Archivo | Descripción |
|-----------|---------|-------------|
| `ErrorState` | `src/components/ui/ErrorState.tsx` | Renderiza error según tipo (INDEX_MISSING, PERMISSION_DENIED, GENERIC) |
| `MachineCard` | `src/components/machines/MachineCard.tsx` | Card con 3 ramas (Alquilada/Disponible/En reparación) |
| `SparePartCard` | `src/components/machines/SparePartCard.tsx` | Card con partCode destacado, badge de categoría, stock, botones use/restock |
| `BlueprintUploader` | `src/components/machines/BlueprintUploader.tsx` | Drag & drop zone con preview PDF/imagen |
| `BlueprintImportPanel` | `src/components/machines/BlueprintImportPanel.tsx` | Split view: PDF left + draft form right |
| `SeedInventory` | `src/components/machines/SeedInventory.tsx` | Seeds 38 máquinas + stock + repuestos |
| `ImportInventory` | `src/components/machines/ImportInventory.tsx` | Importación vía xlsx |

### 6.3 Layouts

| Archivo | Descripción |
|---------|-------------|
| `src/app/layout.tsx` | Root: AuthProvider + Toaster |
| `src/app/(protected)/layout.tsx` | Protected: NavBar + redirect si no auth |
| `src/app/login/page.tsx` | Login page |

---

## 7. Rutas de Aplicación

| Ruta | Archivo | Tipo | Componentes usados |
|------|---------|------|-------------------|
| `/` | `src/app/page.tsx` | Client | Redirect a /dashboard |
| `/login` | `src/app/login/page.tsx` | Client | Auth form |
| `/dashboard` | `dashboard/page.tsx` | Client | KPIs, categories, alerts, machine grid, stock grid |
| `/machines` | `machines/page.tsx` | Client | List + filters + bulk delete |
| `/machines/new` | `machines/new/page.tsx` | Client | Create form with quantity loop |
| `/machines/[id]` | `machines/[id]/page.tsx` | Client | Detail + edit + rental + spare parts + blueprints |
| `/machines/[id]/parts` | `machines/[id]/parts/page.tsx` | Client | Spare parts CRUD + blueprint import + delete importados button |
| `/machines/[id]/blueprints` | `machines/[id]/blueprints/page.tsx` | Client | Blueprint list + upload + delete |
| `/andamios` | `andamios/page.tsx` | Client | Machine grid + stock grid |
| `/inventory/new` | `inventory/new/page.tsx` | Client | Create stock item |
| `/inventory/[id]` | `inventory/[id]/page.tsx` | Client | Stock detail |
| `/rentals`, `/rentals/[id]`, `/rentals/new` | `rentals/*` | Client | Legacy |
| `/repairs`, `/repairs/[id]`, `/repairs/new` | `repairs/*` | Client | Legacy |
| **API:** `/api/cloudinary/delete` | `api/cloudinary/delete/route.ts` | Server | Cloudinary destroy (Basic Auth) |

**Total:** 15 rutas (14 páginas + 1 API endpoint). **100% "use client".**

---

## 8. Librerías y Dependencias

### Producción (16)

| Paquete | Versión | Propósito |
|---------|---------|-----------|
| `next` | ^16.0.0 | Framework |
| `react`, `react-dom` | ^19.0.0 | UI |
| `firebase` | ^12.14.0 | Cliente Firebase (Auth + Firestore) |
| `firebase-admin` | ^14.0.0 | Admin SDK (scripts) |
| `pdfjs-dist` | 6.0.227 | Extracción de texto de PDFs |
| `tailwind-merge` | ^3.0.0 | Merge de clases Tailwind |
| `clsx` | ^2.1.1 | Classnames condicionales |
| `class-variance-authority` | ^0.7.1 | Variantes de componentes |
| `tw-animate-css` | ^1.0.0 | Animaciones Tailwind |
| `lucide-react` | ^0.0.0 | Iconos |
| `sonner` | ^2.0.0 | Toast notifications |
| `next-themes` | ^0.4.6 | Temas (dark/light) |
| `shadcn` | ^2.0.0 | CLI de Shadcn |
| `@base-ui/react` | ^0.0.0 | Base UI primitives |
| `xlsx` | ^0.0.0 | Importación Excel |

### Desarrollo (8)

| Paquete | Propósito |
|---------|-----------|
| `typescript` | Compilador TS |
| `@types/react`, `@types/react-dom`, `@types/node` | Tipos |
| `tailwindcss`, `@tailwindcss/postcss` | CSS |
| `eslint`, `eslint-config-next` | Linting |

---

## 9. Scripts (package.json)

| Script | Comando | Descripción |
|--------|---------|-------------|
| `dev` | `next dev --turbopack` | Dev con Turbopack |
| `build` | `next build` | Build producción |
| `start` | `next start` | Servir build |
| `lint` | `next lint` | ESLint |
| `seed` | `tsx scripts/seed-machines.ts` | Seed CLI (firebase-admin) |
| `export-logs` | `tsx scripts/export-logs.ts` | Exportar audit_logs a Excel |
| `fix:rented` | `tsx scripts/fix-rented-machines.ts` | Fix rented machines inconsistentes |
| `audit` | `tsx scripts/audit.ts` | Auto-auditoría (legacy) |

---

## 10. Configuración Cloudinary

### 10.1 Upload Preset

| Parámetro | Valor |
|-----------|-------|
| Nombre | `operario_blueprints` |
| Tipo | `upload` (público) |
| Unsigned | `true` |
| Carpeta | `blueprints` |
| Formatos | `pdf, jpg, jpeg, png, gif, webp` |
| Creado | vía API con credenciales Root |

### 10.2 Account Settings

- **PDF/ZIP delivery:** ✅ Habilitado (requerido para visualizar PDFs en navegador)

### 10.3 API Route de eliminación

- **Endpoint:** `POST /api/cloudinary/delete`
- **Auth:** Basic Auth (API Key + API Secret en `CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`)
- **Body:** `{ publicId: string, resourceType: "image" | "raw" }`
- **Endpoints:** `image/destroy` para imágenes, `raw/destroy` para PDFs

---

## 11. Problemas Conocidos

| # | Problema | Severidad | Estado |
|---|----------|-----------|--------|
| 1 | No hay `firestore.rules` versionado | 🔴 Alta | Pendiente |
| 2 | No hay variables de entorno configuradas en Vercel | 🟡 Media | Pendiente |
| 3 | Sin tests unitarios ni de integración | 🟡 Media | Pendiente |
| 4 | Sin CI/CD pipeline | 🟡 Media | Pendiente |
| 5 | Todas las páginas son `"use client"` (sin SSR/RSC) | 🟢 Baja | Pendiente |
| 6 | `service-account.json` requerido en root para scripts | 🟢 Baja | Informado |
| 7 | Datos legacy de Firebase Storage (campo `fileName` en blueprints) | 🟢 Baja | Mitigado (backward-compat) |
| 8 | `rentals` y `repairs` como colecciones separadas | 🟢 Baja | Legacy (convivir) |

---

## 12. Recomendaciones Técnicas

1. **Crear `firestore.rules`** — Versionar en repositorio y sincronizar con consola Firebase
2. **Configurar Vercel** — Agregar variables de entorno para producción; opcionalmente crear `vercel.json`
3. **Agregar tests** — Unit tests para servicios y componentes críticos
4. **Agregar CI/CD** — GitHub Actions para lint + typecheck + build
5. **Middleware de auth** — Migrar de `useEffect` en layout a `middleware.ts` para proteger rutas server-side
6. **Migrar a Server Components** — Convertir páginas estáticas (dashboard, login) a RSC
7. **Cache de consultas** — Implementar React Query o SWR para cachear Firestore reads
8. **Registro de usuarios** — Agregar formulario de registro o invitación
9. **Historial de cambios** — Agregar un changelog en el repositorio

---

*Documento generado manualmente. Refleja el estado del proyecto al 2026-06-18.*
