# Auditoría del Sistema — Operario Control

**Generada:** 2026-06-18 02:37:04
**Versión del proyecto:** 0.1.0
**Descripción:** —

---

## 1. Estado General del Proyecto

| Indicador | Valor |
|-----------|-------|
| Build | Último build disponible |
| Compilación TypeScript | 0 errores (última ejecución) |
| Framework | Next.js 16.2.9 |
| React | 19.2.4 |
| Firebase Client | ^12.14.0 |
| Firebase Admin | ^14.0.0 |
| Tailwind CSS | ^4 |
| Total dependencias | 15 producción + 8 desarrollo = 23 |
| Archivos fuente (src/) | 45 (27 TSX + 17 TS + 1 CSS) |

---

## 2. Firebase

### Configuración del Proyecto

| Variable | Valor |
|----------|-------|
| Project ID | `operario-control` |
| Auth Domain | `operario-control.firebaseapp.com` |
| Storage Bucket | `operario-control.firebasestorage.app` |

### Método de autenticación

- **Tipo:** Email/Password (Firebase Auth)
- **SDK usado:** `signInWithEmailAndPassword` desde `firebase/auth`
- **Persistencia:** Por defecto del SDK (local)
- **Provider configurado:** Sí, en consola Firebase (email/password habilitado)

### Inicialización

```ts
import { initializeApp, getApps } from "firebase/app"
import { getAuth } from "firebase/auth"
import { getFirestore } from "firebase/firestore"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

export const auth = getAuth(app)
export const db = getFirestore(app)
export default app
```

### Colecciones Firestore

| Colección | Descripción | Operaciones |
|-----------|-------------|-------------|
| `machines` | Catálogo de equipos con estado embebido | CRUD + rent/maintenance |
| `rentals` | Historial de alquileres (legacy) | CRUD |
| `repairs` | Historial de reparaciones (legacy) | CRUD |
| `audit_logs` | Registro de auditoría de todas las operaciones | Insert + fetch |

### Reglas de Seguridad

**NO CONFIGURADAS.** El proyecto no incluye archivo `firestore.rules`. Las reglas están en la consola de Firebase, no versionadas en el repositorio.

---

## 3. Vercel Deploy

| Aspecto | Estado |
|---------|--------|
| Archivo `vercel.json` | No |
| Variables de entorno para producción | No — solo .env.local presente |
| Service Account en producción | No (correcto) |

### Recomendaciones para Vercel

1. Configurar las 7 variables `NEXT_PUBLIC_FIREBASE_*` en el dashboard de Vercel (Project Settings > Environment Variables)
2. NO incluir `service-account.json` en el build — solo se usa localmente para scripts
3. Asegurar que `next.config.ts` no tenga `output: "export"` (Firebase Auth requiere SSR)

---

## 4. Arquitectura Next.js

### App Router

- **Root Layout:** `src/app/layout.tsx` — AuthProvider global + Toaster
- **Route Group `(protected)`:** `src/app/(protected)/layout.tsx` — NavBar + redirect si no auth
- **SSR:** Deshabilitado en todas las páginas (100% `"use client"`)
- **Middleware:** No implementado (la protección se hace en los layouts con `useEffect`)

### Rutas Registradas

| `/` | `src\app\page.tsx` | Dinámica |
| `/dashboard` | `src\app\(protected)\dashboard\page.tsx` | Dinámica |
| `/login` | `src\app\login\page.tsx` | Dinámica |
| `/machines` | `src\app\(protected)\machines\page.tsx` | Dinámica |
| `/machines/:id` | `src\app\(protected)\machines\[id]\page.tsx` | Dinámica |
| `/machines/new` | `src\app\(protected)\machines\new\page.tsx` | Dinámica |
| `/rentals` | `src\app\(protected)\rentals\page.tsx` | Dinámica |
| `/rentals/:id` | `src\app\(protected)\rentals\[id]\page.tsx` | Dinámica |
| `/rentals/new` | `src\app\(protected)\rentals\new\page.tsx` | Dinámica |
| `/repairs` | `src\app\(protected)\repairs\page.tsx` | Dinámica |
| `/repairs/:id` | `src\app\(protected)\repairs\[id]\page.tsx` | Dinámica |
| `/repairs/new` | `src\app\(protected)\repairs\new\page.tsx` | Dinámica |

**Total:** 12 rutas

---

## 5. Estructura de Firestore

### Documento `machines`

```typescript
export type MachineStatus = "available" | "rented"
export type MachineLocation = "deposito" | "obra" | "taller"
export type MachineCategory = "machine" | "tool" | "scaffold"

export interface MachineRental {
  clientName: string
  clientId?: string
  projectName: string
  startDate: Date
  expectedReturnDate: Date | null
  actualReturnDate?: Date | null
}

export interface Machine {
  id: string
  name: string
  model: string
  category: MachineCategory | null
  status: MachineStatus
  locationType: MachineLocation
  rental: MachineRental | null
  createdAt: Date
  updatedAt: Date
}

export interface UpdateMachineInput {
  name?: string
  model?: string
  category?: MachineCategory | null
  locationType?: MachineLocation
}

export interface CreateMachineInput {
  name: string
  model: string
  category?: MachineCategory | null
  locationType: MachineLocation
  status: MachineStatus
  rental: MachineRental | null
}
```

### Categorías y Subcategorías

```typescript
import type { MachineCategory } from "@/types/machine"

export const CATEGORY_COLORS: Record<string, string> = {
  scaffold: "bg-orange-100 text-orange-700",
  machine: "bg-slate-100 text-slate-700",
  tool: "bg-teal-100 text-teal-700",
}

export const CATEGORY_LABELS: Record<string, string> = {
  scaffold: "Andamio",
  machine: "Máquina",
  tool: "Herramienta",
}

export function getDefaultCategory(): MachineCategory {
  return "machine"
}
```

---

## 6. Estado de Autenticación

### Flujo

1. El `AuthProvider` en el layout raíz escucha cambios de auth via `onAuthStateChanged`
2. El layout protegido `(protected)/layout.tsx` redirige a `/login` si no hay usuario
3. La página `/login` redirige a `/dashboard` si ya hay usuario
4. El servicio `auth.ts` expone `login`, `logout` y `onAuthChange`

### Servicio de Auth

```ts
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth"
import { auth } from "@/lib/firebase"

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback)
}

export async function login(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password)
  return result.user
}

export async function logout(): Promise<void> {
  await signOut(auth)
}
```

### Usuarios

- **Registro:** No implementado en UI (solo desde consola Firebase)
- **Recuperación de contraseña:** No implementada
- **Persistencia de sesión:** Local (el navegador recuerda la sesión)

---

## 7. Servicios (Firebase)

### machines.ts — CRUD + Ciclo de vida

```ts
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc, getDocs,
  query, orderBy, serverTimestamp, Timestamp,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { createAuditLog } from "./audit"
import type { Machine, MachineRental, CreateMachineInput, UpdateMachineInput } from "@/types"

const COLLECTION = "machines"

function toDate(val: unknown): Date {
  if (val instanceof Timestamp) return val.toDate()
  if (val instanceof Date) return val
  return new Date()
}

function parseRental(raw: unknown): MachineRental | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  return {
    clientName: (r.clientName as string) ?? "",
    clientId: (r.clientId as string) ?? undefined,
    projectName: (r.projectName as string) ?? "",
    startDate: toDate(r.startDate),
    expectedReturnDate: r.expectedReturnDate ? toDate(r.expectedReturnDate) : null,
    actualReturnDate: r.actualReturnDate ? toDate(r.actualReturnDate) : null,
  }
}

function docToMachine(docSnap: { id: string; data: () => Record<string, unknown> }): Machine {
  const data = docSnap.data()
  return {
    id: docSnap.id,
    name: (data.name as string) ?? "",
    model: (data.model as string) ?? "",
    category: data.category as Machine["category"],
    status: data.status as Machine["status"],
    locationType: (data.locationType as Machine["locationType"]) ?? "deposito",
    rental: parseRental(data.rental),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  } as Machine
}

function marshalRental(r: MachineRental): Record<string, unknown> {
  return {
    clientName: r.clientName,
    clientId: r.clientId ?? null,
    projectName: r.projectName,
    startDate: r.startDate,
    expectedReturnDate: r.expectedReturnDate ?? null,
    actualReturnDate: r.actualReturnDate ?? null,
  }
}

export async function createMachine(input: CreateMachineInput): Promise<string> {
  const docData: Record<string, unknown> = {
    name: input.name,
    model: input.model,
    category: input.category ?? null,
    status: input.status,
    locationType: input.locationType,
    rental: input.rental ? marshalRental(input.rental) : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const docRef = await addDoc(collection(db, COLLECTION), docData)
  await createAuditLog("create", "machine", docRef.id, null, docData)
  return docRef.id
}

export async function rentMachine(id: string, rental: MachineRental): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const rentalData = marshalRental(rental)
  await updateDoc(ref, {
    status: "rented",
    rental: rentalData,
    updatedAt: serverTimestamp(),
  })
  const after = { ...before, status: "rented", rental: rentalData }
  await createAuditLog("update", "machine", id, before ?? null, after)
}

export async function returnMachine(id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const currentRental = before?.rental as Record<string, unknown> | undefined
  const rentalData = currentRental ? { ...currentRental, actualReturnDate: new Date() } : null
  await updateDoc(ref, {
    status: "available",
    rental: rentalData,
    updatedAt: serverTimestamp(),
  })
  const after = { ...before, status: "available", rental: rentalData }
  await createAuditLog("update", "machine", id, before ?? null, after)
}

export async function updateMachine(id: string, data: UpdateMachineInput): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  const updates = { ...data, updatedAt: serverTimestamp() }
  await updateDoc(ref, updates)
  const after = { ...before, ...updates }
  await createAuditLog("update", "machine", id, before ?? null, after)
}

export async function deleteMachine(id: string): Promise<void> {
  const ref = doc(db, COLLECTION, id)
  const before = (await getDoc(ref)).data() as Record<string, unknown> | undefined
  await deleteDoc(ref)
  await createAuditLog("delete", "machine", id, before ?? null, null)
}

export async function getMachine(id: string): Promise<Machine | null> {
  const ref = doc(db, COLLECTION, id)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return docToMachine(snap)
}

export async function getMachines(): Promise<Machine[]> {
  const q = query(collection(db, COLLECTION), orderBy("name"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map(docToMachine)
}
```

### audit.ts — Registro de auditoría

```ts
import { collection, addDoc, serverTimestamp, query, orderBy, getDocs, Timestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import type { AuditAction, AuditEntity, AuditLog } from "@/types"

const COLLECTION = "audit_logs"

export async function createAuditLog(
  action: AuditAction,
  entity: AuditEntity,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  try {
    await addDoc(collection(db, COLLECTION), {
      action,
      entity,
      entityId,
      before,
      after,
      timestamp: serverTimestamp(),
    })
  } catch {
    console.error("Error creating audit log")
  }
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const q = query(collection(db, COLLECTION), orderBy("timestamp", "desc"))
  const snapshot = await getDocs(q)
  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      action: data.action as AuditAction,
      entity: data.entity as AuditEntity,
      entityId: data.entityId as string,
      before: data.before as Record<string, unknown> | null,
      after: data.after as Record<string, unknown> | null,
      timestamp: (data.timestamp as Timestamp)?.toDate() ?? new Date(),
    } as AuditLog
  })
}
```

---

## 8. Errores Conocidos

| # | Error | Estado | Solución |
|---|-------|--------|----------|
| 1 | Datos legacy con categorías `machine`/ `scaffold`/ `tool` | Mitigado | `mapOldCategory()` convierte automáticamente en `docToMachine()` |
| 2 | Reparaciones con status `repairing` ya no existen como `MachineStatus` | Mitigado | El servicio `repairs.ts` mapea a `maintenance` al actualizar la máquina |
| 3 | No hay reglas de Firestore versionadas | Pendiente | Crear `firestore.rules` en el repositorio |
| 4 | No hay middleware de Next.js para auth | Pendiente | Considerar migrar de `useEffect` a middleware |
| 5 | `service-account.json` requerido para scripts | Informado | Documentado en `.gitignore` y en mensajes de error de scripts |
| 6 | `rentals` y `repairs` como colecciones separadas duplican datos | Legacy | La información activa se embebe en `machines`; las colecciones separadas persisten para histórico |

---

## 9. Problemas Críticos

### 🔴 Reglas de Firestore no versionadas
No hay archivo `firestore.rules` en el repositorio. Si se pierde la consola Firebase, las reglas se pierden.

### 🟡 Sin variables de entorno para Vercel
Solo existe `.env.local`. No hay `.env.production` ni configuración en Vercel documentada.

### 🟡 Sin Server Components
Todas las páginas usan `"use client"`. No se aprovecha SSR/RSC para rendimiento ni SEO.

### 🟢 Service Account en .gitignore
Correctamente excluido.

---

## 10. Recomendaciones Técnicas

1. **Versionar firestore.rules** — Crear `firestore.rules` en la raíz y sincronizar con la consola
2. **Agregar middleware de auth** — Migrar de `useEffect` en layout a `middleware.ts` para proteger rutas en el servidor
3. **Documentar deploy en Vercel** — Agregar `vercel.json` y documentar variables de entorno en README
4. **Migrar a Server Components** — Convertir páginas que no necesitan interactividad a RSC
5. **Eliminar colecciones legacy** — Una vez migrados todos los datos, eliminar `rentals` y `repairs` como colecciones separadas
6. **Agregar tests** — No hay tests unitarios ni de integración en el proyecto
7. **Agregar CI/CD** — No hay GitHub Actions ni pipeline configurado
8. **Implementar registro de usuarios** — Agregar formulario de registro o invitación por admin
9. **Cache de consultas** — Implementar React Query o SWR para cachear consultas a Firestore

---

*Documento generado automáticamente por `scripts/audit.ts`. Para regenerar: `npm run audit`*
