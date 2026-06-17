# AUDITORÍA COMPLETA — OPERARIO CONTROL

**Fecha:** 17/06/2026
**Versión:** 0.1.0
**Stack:** Next.js 16.2.9 + React 19.2.4 + TypeScript + Firebase + Tailwind CSS 4 + Base UI + shadcn/ui
**Idioma:** Español (ES)
**Firebase Project:** operario-control

---

## 1. ESTRUCTURA DEL PROYECTO

```
operario-control/
├── .env.local                    # Config Firebase (7 vars)
├── .gitignore                    # Ignora node_modules, .next, .env*, service-account.json, local_exports/
├── AGENTS.md                     # Reglas para Next.js v16
├── CLAUDE.md                     # Apunta a AGENTS.md
├── components.json               # Config shadcn/ui
├── eslint.config.mjs             # ESLint flat config (Next.js core-web-vitals + typescript)
├── next-env.d.ts                 # Tipos generados por Next
├── next.config.ts                # Config Next.js vacía
├── package.json                  # 20 dependencias, 6 scripts
├── postcss.config.mjs            # @tailwindcss/postcss
├── tsconfig.json                 # Strict, bundler, paths: @/ → src/
├── README.md                     # Template create-next-app
├── local_exports/logs/           # Directorio para exportación de logs
├── public/                       # 5 SVGs (file, globe, next, vercel, window)
├── scripts/
│   ├── seed-machines.ts          # Seed 67 máquinas (firebase-admin)
│   └── export-logs.ts            # Exportar audit_logs a .txt
└── src/
    ├── app/
    │   ├── globals.css            # Tema OKLCH, Tailwind 4, animaciones
    │   ├── layout.tsx             # Layout raíz: AuthProvider + Toaster
    │   ├── page.tsx               # Redirige a /dashboard
    │   ├── login/page.tsx         # Login email/password
    │   └── (protected)/
    │       ├── layout.tsx         # Nav + redirect si no auth
    │       ├── dashboard/page.tsx
    │       ├── machines/
    │       │   ├── page.tsx       # Listado
    │       │   ├── new/page.tsx   # Crear
    │       │   └── [id]/page.tsx  # Detalle + editar
    │       ├── rentals/
    │       │   ├── page.tsx
    │       │   ├── new/page.tsx
    │       │   └── [id]/page.tsx
    │       └── repairs/
    │           ├── page.tsx
    │           ├── new/page.tsx
    │           └── [id]/page.tsx
    ├── components/
    │   ├── machines/
    │   │   ├── ImportInventory.tsx  # Importar Excel .xlsx
    │   │   └── SeedInventory.tsx    # Seed button en UI
    │   └── ui/                      # 10 componentes shadcn
    │       ├── badge.tsx, button.tsx, card.tsx, dialog.tsx,
    │       ├── input.tsx, label.tsx, select.tsx, separator.tsx,
    │       ├── sonner.tsx, table.tsx
    ├── hooks/
    │   ├── useAuth.ts
    │   ├── useMachines.ts
    │   ├── useRentals.ts
    │   └── useRepairs.ts
    ├── lib/
    │   ├── AuthContext.tsx
    │   ├── categories.ts           # Subcategorías + colores + mapOldCategory
    │   ├── firebase.ts             # Init Firebase client
    │   └── utils.ts                # cn() con tailwind-merge
    ├── services/
    │   ├── auth.ts                 # signIn, signOut, onAuthStateChanged
    │   ├── machines.ts             # CRUD + rent/maintenance lifecycle
    │   ├── rentals.ts              # CRUD rentals + update machine status
    │   ├── repairs.ts              # CRUD repairs + update machine status
    │   └── audit.ts                # createAuditLog + fetchAuditLogs
    └── types/
        ├── index.ts                # Re-exporta todos
        ├── machine.ts              # Machine, MachineStatus, MachineCategory, etc.
        ├── rental.ts               # Rental, RentalStatus, RentalFormData
        ├── repair.ts               # Repair, RepairStatus, RepairFormData
        └── audit.ts                # AuditLog, AuditAction, AuditEntity
```

**Total archivos fuente:** 52 (excluyendo node_modules, .next, public SVGs, archivos raíz)

---

## 2. CONFIGURACIÓN

### 2.1 Firebase
- **Client SDK:** `firebase` v12.14.0
- **Admin SDK:** `firebase-admin` v14.0.0 (solo scripts)
- **Colecciones Firestore:** `machines`, `rentals`, `repairs`, `audit_logs`
- **Auth:** Email/password únicamente
- **Variables .env.local:** 7 vars (`NEXT_PUBLIC_FIREBASE_*`)
- **service-account.json:** Requerido en raíz para scripts, en .gitignore

### 2.2 Scripts npm
| Script | Comando | Descripción |
|--------|---------|-------------|
| `dev` | `next dev` | Servidor desarrollo |
| `build` | `next build` | Build producción |
| `start` | `next start` | Iniciar servidor producción |
| `lint` | `eslint` | Linting |
| `seed` | `tsx scripts/seed-machines.ts` | Seed 67 máquinas |
| `export:logs` | `tsx scripts/export-logs.ts` | Exportar audit logs |

### 2.3 Dependencias clave
- **UI:** `@base-ui/react` v1.5.0, `tailwindcss` v4, `shadcn` v4.11.0
- **Firebase:** `firebase` v12.14.0, `firebase-admin` v14.0.0
- **Utilidades:** `lucide-react`, `sonner`, `xlsx`, `clsx`, `tailwind-merge`, `class-variance-authority`
- **Next.js v16.2.9** con Turbopack

### 2.4 TypeScript
- Strict mode, target ES2017
- Path alias `@/` → `./src/*`
- Bundler module resolution

---

## 3. MODELO DE DATOS (FIRESTORE)

### 3.1 Colección `machines`
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

### 3.2 Colección `rentals` (legacy)
| Campo | Tipo |
|-------|------|
| `machineId`, `client`, `startDate`, `returnDate`, `status`, `createdAt`, `updatedAt` | Según `Rental` type |

### 3.3 Colección `repairs` (legacy)
| Campo | Tipo |
|-------|------|
| `machineId`, `issue`, `status`, `estimatedReturn`, `createdAt`, `updatedAt` | Según `Repair` type |

### 3.4 Colección `audit_logs`
| Campo | Tipo |
|-------|------|
| `action` | `"create" \| "update" \| "delete"` |
| `entity` | `"machine" \| "rental" \| "repair"` |
| `entityId` | string |
| `before` | Record \| null |
| `after` | Record \| null |
| `timestamp` | Timestamp |
| `userId` | string |

---

## 4. TIPOS (TypeScript)

### 4.1 Tipos de máquina (`types/machine.ts`)
```typescript
MachineStatus     = "available" | "rented" | "maintenance"
MachineLocation   = "taller" | "deposito" | "obra"
MachineCategory   = "andamio" | "maquinaria" | "herramienta"

Machine, MachineMetadata, RentalInfo, MaintenanceInfo,
CreateMachineInput, UpdateMachineInput
```

### 4.2 Otros tipos
```typescript
RentalStatus     = "active" | "closed"
RepairStatus     = "pending" | "repairing" | "done"
AuditAction      = "create" | "update" | "delete"
AuditEntity      = "machine" | "rental" | "repair"
```

---

## 5. CATEGORÍAS Y SUBCATEGORÍAS

### 5.1 Categorías
| Clave | Label | Color |
|-------|-------|-------|
| `andamio` | Andamio | naranja |
| `maquinaria` | Maquinaria | gris |
| `herramienta` | Herramienta | teal |

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

### 6.1 `machines.ts` — CRUD principal
- `createMachine(input)` → Crea doc + audit log
- `getMachine(id)` / `getMachines()` → Lectura con `docToMachine` (parsea Timestamps, aplica `mapOldCategory`)
- `updateMachine(id, data)` → Actualiza campos + audit log
- `deleteMachine(id)` → Elimina + audit log
- `rentMachine(id, rental)` → Status `rented` + embebe rental + audit
- `returnMachine(id)` → Status `available` + limpia rental + audit
- `startMaintenance(id, maintenance)` → Status `maintenance` + embebe maintenance + audit
- `completeMaintenance(id)` → Status `available` + limpia maintenance + audit

### 6.2 `rentals.ts` — Colección legacy de alquileres
- `createRental(data)` → Crea rental + actualiza máquina a `rented`
- `closeRental(id)` → Cierra rental + devuelve máquina a `available`

### 6.3 `repairs.ts` — Colección legacy de reparaciones
- `createRepair(data)` → Crea repair + actualiza máquina a `maintenance`
- `updateRepairStatus(id, status)` → Actualiza repair + sincroniza máquina

### 6.4 `auth.ts` — Autenticación
- `login(email, password)` → `signInWithEmailAndPassword`
- `logout()` → `signOut`
- `onAuthChange(callback)` → `onAuthStateChanged`

### 6.5 `audit.ts` — Auditoría
- `createAuditLog(action, entity, entityId, before, after)` → Firestore
- `fetchAuditLogs()` → Todos ordenados descendente

---

## 7. HOOKS (React)

| Hook | Expone | Importa de |
|------|--------|------------|
| `useAuth` | `user, loading, login, logout` | services/auth.ts |
| `useMachines` | `machines, loading, create, update, rent, returnMachine, setMaintenance, completeMaintenance, remove, reload` | services/machines.ts |
| `useRentals` | `rentals, loading, create, close, reload` | services/rentals.ts |
| `useRepairs` | `repairs, loading, create, updateStatus, reload` | services/repairs.ts |

Todos los hooks cargan datos al montarse y recargan después de cada mutación.

---

## 8. PÁGINAS (App Router)

### 8.1 Rutas
| Ruta | Archivo | Tipo | Protegida |
|------|---------|------|-----------|
| `/` | `page.tsx` | Redirige a /dashboard | No |
| `/login` | `login/page.tsx` | Login form | No |
| `/dashboard` | `(protected)/dashboard/page.tsx` | Dashboard | Sí |
| `/machines` | `(protected)/machines/page.tsx` | Listado | Sí |
| `/machines/new` | `(protected)/machines/new/page.tsx` | Crear | Sí |
| `/machines/[id]` | `(protected)/machines/[id]/page.tsx` | Detalle | Sí |
| `/rentals` | `(protected)/rentals/page.tsx` | Listado | Sí |
| `/rentals/new` | `(protected)/rentals/new/page.tsx` | Crear | Sí |
| `/rentals/[id]` | `(protected)/rentals/[id]/page.tsx` | Detalle | Sí |
| `/repairs` | `(protected)/repairs/page.tsx` | Listado | Sí |
| `/repairs/new` | `(protected)/repairs/new/page.tsx` | Crear | Sí |
| `/repairs/[id]` | `(protected)/repairs/[id]/page.tsx` | Detalle | Sí |

**Total:** 12 rutas (6 estáticas, 6 dinámicas)

### 8.2 Layouts
- **Root:** AuthProvider + Toaster + html lang=es
- **Protected:** NavBar (Dashboard, Máquinas, Alquileres, Reparaciones) + user email + logout. Redirige a /login si no autenticado.

### 8.3 Dashboard
- Tarjetas resumen: Disponibles / Alquiladas / Mantenimiento
- Buscador por nombre/modelo
- Filtro por estado (Todos / Disponible / Alquilada / Mantenimiento)
- Grid de tarjetas con nombre, modelo, ubicación, categoría + subcategoría, badge de estado
- SeedInventory si colección vacía

### 8.4 Máquinas (listado)
- Botón "Importar inventario" (Excel)
- Botón "Nueva máquina"
- Grid de tarjetas igual que dashboard

### 8.5 Máquina (detalle)
- Header: nombre, modelo, categoría > subcategoría, badge estado
- Modo edición: nombre, modelo, categoría (select), subcategoría (select dinámico if andamio), ubicación (select)
- Card alquiler activo (si rented): cliente, fechas, botón devolver
- Card mantenimiento activo (si maintenance): motivo, fechas, botón completar
- Formulario alquiler: cliente, inicio, retorno
- Formulario mantenimiento: motivo, inicio, fin estimado
- Acciones: Alquilar, Mantenimiento, Disponible
- Botón eliminar

### 8.6 Máquina (nueva)
- Formulario completo con: nombre, modelo, categoría, subcategoría (si andamio), ubicación, estado inicial
- Campos condicionales: datos alquiler si rented, datos mantenimiento si maintenance

### 8.7 Alquileres
- Tabla: máquina, cliente, inicio, retorno, estado, acción cerrar
- Crear: select máquina (filtrado disponibles), cliente
- Detalle: info + botón cerrar

### 8.8 Reparaciones
- Tabla: máquina, problema, estado, retorno estimado, acciones (iniciar/completar/ver)
- Crear: select máquina (filtrado no en maintenance), problema, retorno estimado
- Detalle: info + botones iniciar/completar

### 8.9 Login
- Formulario email + password
- Redirige a /dashboard si ya autenticado
- Muestra error en credenciales inválidas

---

## 9. COMPONENTES UI (shadcn/ui + Base UI)

10 componentes, todos en `src/components/ui/`:

| Componente | Líneas | Librería Base |
|------------|--------|---------------|
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

### 10.1 `SeedInventory.tsx` — Seed button
- 67 ítems precargados del catálogo Cocrear + mercado
- Andamios (15): tubular, modular, pasillero, reforzado, caballetes, tablón, puntales
- Maquinaria (22): pisón, hormigonera, martillo demoledor, vibrador, grupo electrógeno, allanadora, pulidora, compresor
- Herramientas (11): amoladora, taladro percutor, sierra circular, soldadora inverter, máquina de pintar
- Verifica duplicados por name+model antes de insertar
- Solo visible si colección vacía

### 10.2 `ImportInventory.tsx` — Importar Excel
- Acepta `.xlsx`/`.xls`
- Normaliza headers español/inglés (nombre, name, máquina, maquina, modelo, model, categoría, category, tipo, ubicación, location, etc.)
- Mapeo flexible: columnas → campos name, model, category, location
- Deduplicación por name+model
- Vista previa de registros detectados
- Resumen: insertados, omitidos, errores

---

## 11. SCRIPTS

### 11.1 `scripts/seed-machines.ts`
- Runtime: `npx tsx`
- SDK: `firebase-admin`
- Requiere: `service-account.json` en raíz
- Inserta 67 máquinas en Firestore
- Deduplica por name+model

### 11.2 `scripts/export-logs.ts`
- Runtime: `npx tsx`
- SDK: `firebase-admin`
- Requiere: `service-account.json` en raíz
- Exporta `audit_logs` a `local_exports/logs/` como .txt
- Formato: `[timestamp] action entity entityId`

---

## 12. SEGURIDAD Y BUENAS PRÁCTICAS

- **Sin secrets en código:** Firebase config via env vars
- **service-account.json** en `.gitignore`
- **Audit logging** en cada operación CRUD
- **Client SDK** en frontend (nunca admin SDK)
- **Sin `router.push` en render** — redirects en `useEffect`
- **Deduplicación** en seed e importación
- **Categorías con migración** — `mapOldCategory` para datos legacy

---

## 13. OBSERVACIONES

- Todas las páginas usan `"use client"` — 100% CSR, sin Server Components
- El sistema de `rentals` y `repairs` como colecciones separadas es legacy; la data actual se embebe en `machines`
- Los alquileres y reparaciones se crean desde las secciones dedicadas (`/rentals/new`, `/repairs/new`) y también sincronizan el estado de la máquina
- No hay reglas de seguridad de Firestore definidas (seguridad a nivel de app)
- Dependencia `shadcn` en package.json pero no se usa directamente (es el CLI)
- Base UI v1.5.0 reemplaza a Radix UI como capa headless
- El build produce 12 rutas (6 static, 6 dynamic) sin errores
