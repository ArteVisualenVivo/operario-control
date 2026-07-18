# DIAGNÓSTICO FORENSE - CADENA DE EJECUCIÓN

## Archivo 1: `src/app/page.tsx`
- **Línea 4:** `redirect("/dashboard")`
- **Endpoint:** N/A
- **Colección Firebase:** N/A
- **API:** N/A
- **try/catch:** No
- **Error:** N/A

## Archivo 2: `src/app/(protected)/dashboard/page.tsx`
- **Línea 8:** `const orders = await loadMaintenanceRecords()`
- **Endpoint:** N/A
- **Colección Firebase:** `maintenance`
- **API:** N/A
- **try/catch:** No
- **Error:** N/A

## Archivo 3: `src/services/machines.ts`
- **Línea 12:** `const COLLECTION = "machines"`
- **Línea 213:** `export async function getMachines(): Promise<Machine[]>`
- **Línea 219:** `const q = query(collection(db, COLLECTION), orderBy("name"))`
- **Línea 221:** `const snapshot = await getDocs(q)`
- **Línea 230-234:**
```typescript
} catch {
  if (LOCAL_MODE) {
    return LOCAL_MACHINE_SEED
  }
  throw new Error("No se pudieron cargar las máquinas")
}
```
- **Endpoint:** N/A
- **Colección Firebase:** `machines`
- **API:** N/A
- **try/catch:** Sí
- **Error:** "No se pudieron cargar las máquinas" (línea 234)

## Archivo 4: `src/services/inventoryStock.ts`
- **Línea 21:** `const COLLECTION = "inventory_stock"`
- **Línea 56:** `export async function getStockItems(): Promise<InventoryStock[]>`
- **Línea 62:** `const q = query(collection(db, COLLECTION), orderBy("name"))`
- **Línea 64:** `const snapshot = await getDocs(q)`
- **Línea 73-77:**
```typescript
} catch {
  if (LOCAL_MODE) {
    return LOCAL_STOCK_SEED
  }
  throw new Error("No se pudieron cargar los materiales")
}
```
- **Endpoint:** N/A
- **Colección Firebase:** `inventory_stock`
- **API:** N/A
- **try/catch:** Sí
- **Error:** "No se pudieron cargar los materiales" (línea 77)

## Archivo 5: `src/lib/firebase.ts`
- **Línea 1-17:** Configuración Firebase
- **Línea 14:** `const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]`
- **Línea 17:** `export const db = getFirestore(app)`
- **Endpoint:** N/A
- **Colección Firebase:** N/A
- **API:** N/A
- **try/catch:** No
- **Error:** N/A

## Archivo 6: `src/lib/runtimeMode.ts`
- **Línea 1-2:**
```typescript
export const LOCAL_MODE =
  process.env.NEXT_PUBLIC_LOCAL_MODE === "1" ||
  process.env.LOCAL_MODE === "1"
```
- **Endpoint:** N/A
- **Colección Firebase:** N/A
- **API:** N/A
- **try/catch:** No
- **Error:** N/A

## Archivo 7: `src/hooks/useMachines.ts`
- **Línea 11-15:** `load()` sin try/catch
- **Endpoint:** N/A
- **Colección Firebase:** `machines`
- **API:** N/A
- **try/catch:** No
- **Error:** N/A

## Archivo 8: `src/hooks/useInventoryStock.ts`
- **Línea 19-23:** `load()` sin try/catch
- **Endpoint:** N/A
- **Colección Firebase:** `inventory_stock`
- **API:** N/A
- **try/catch:** No
- **Error:** N/A

## Código completo getMachines()

**Archivo:** `src/services/machines.ts`
**Líneas 213-241:**
```typescript
export async function getMachines(): Promise<Machine[]> {
  if (machinesCache) return machinesCache
  if (machinesPromise) return machinesPromise

  machinesPromise = (async () => {
    try {
      const q = query(collection(db, COLLECTION), orderBy("name"))
      const start = Date.now()
      const snapshot = await getDocs(q)
      getMachinesCalls++
      console.log(`[SYNC] getMachines() Call #${getMachinesCalls} docs=${snapshot.size} time=${(Date.now() - start).toFixed(1)}ms`)
      const data = snapshot.docs.map(docToMachine)
      if (LOCAL_MODE && data.length === 0) {
        return LOCAL_MACHINE_SEED
      }
      machinesCache = data
      return data
    } catch {
      if (LOCAL_MODE) {
        return LOCAL_MACHINE_SEED
      }
      throw new Error("No se pudieron cargar las máquinas")
    } finally {
      machinesPromise = null
    }
  })()

  return machinesPromise
}
```

## Código completo getStockItems()

**Archivo:** `src/services/inventoryStock.ts`
**Líneas 56-84:**
```typescript
export async function getStockItems(): Promise<InventoryStock[]> {
  if (stockItemsCache) return stockItemsCache
  if (stockItemsPromise) return stockItemsPromise

  stockItemsPromise = (async () => {
    try {
      const q = query(collection(db, COLLECTION), orderBy("name"))
      const start = Date.now()
      const snapshot = await getDocs(q)
      getStockItemsCalls++
      console.log(`[SYNC] getStockItems() Call #${getStockItemsCalls} docs=${snapshot.size} time=${(Date.now() - start).toFixed(1)}ms`)
      const data = snapshot.docs.map(docToStock)
      if (LOCAL_MODE && data.length === 0) {
        return LOCAL_STOCK_SEED
      }
      stockItemsCache = data
      return data
    } catch {
      if (LOCAL_MODE) {
        return LOCAL_STOCK_SEED
      }
      throw new Error("No se pudieron cargar los materiales")
    } finally {
      stockItemsPromise = null
    }
  })()

  return stockItemsPromise
}
```

## Error original perdido

**Problema:** El catch está vacío (líneas 230-234 y 73-77)
```typescript
} catch {
  // El error original de Firebase (FirebaseError) se pierde aquí
  if (LOCAL_MODE) {
    return LOCAL_MACHINE_SEED
  }
  throw new Error("No se pudieron cargar las máquinas")
}
```

**El error original de Firebase (FirebaseError) se pierde en el catch vacío.**

## Configuración Firebase

**Archivo:** `src/lib/firebase.ts`
**Líneas 1-18:**
```typescript
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

**firebaseConfig:**
- apiKey: `AIzaSyCl39k1P-GxLSl2bEa7ZLEfQgeT14SuLlc`
- authDomain: `operario-control.firebaseapp.com`
- projectId: `operario-control`
- storageBucket: `operario-control.firebasestorage.app`
- messagingSenderId: `474065245898`
- appId: `1:474065245898:web:003f8836cec7429ad80633`

## Verificación de archivos Firebase

**No existe otro firebase.ts duplicado.** Solo existe `src/lib/firebase.ts`.

## Colecciones verificadas

| Archivo | Colección |
|---------|----------|
| `src/services/machines.ts` | `machines` |
| `src/services/inventoryStock.ts` | `inventory_stock` |

## FirebaseError REAL obtenido

**Prueba ejecutada:** `node firebase-test.mjs`

**Resultado:**
```
=== FIREBASE TEST ===
firebaseConfig: {
  "apiKey": "AIzaSyCl39k1P-GxLSl2bEa7ZLEfQgeT14SuLlc",
  "authDomain": "operario-control.firebaseapp.com",
  "projectId": "operario-control",
  "storageBucket": "operario-control.firebasestorage.app",
  "messagingSenderId": "474065245898",
  "appId": "1:474065245898:web:003f8836cec7429ad80633"
}
LOCAL_MODE check:
  NEXT_PUBLIC_LOCAL_MODE: undefined
  LOCAL_MODE: undefined

=== Testing collection 'machines' ===
machines ERROR:
  code: permission-denied
  message: Missing or insufficient permissions.
  stack: FirebaseError: Missing or insufficient permissions.

=== Testing collection 'inventory_stock' ===
inventory_stock ERROR:
  code: permission-denied
  message: Missing or insufficient permissions.
  stack: FirebaseError: Missing or insufficient permissions.
```

## LOCAL_MODE
- **Valor actual:** `undefined` (en Node.js)
- **Definido en:** `src/lib/runtimeMode.ts` (líneas 1-2)
- **En .env.local:** `NEXT_PUBLIC_LOCAL_MODE=1` y `LOCAL_MODE=1`
- **Problema:** En Node.js, `process.env.NEXT_PUBLIC_LOCAL_MODE` no está disponible (solo en Next.js)

## Tabla de Diagnóstico

| Archivo | Línea | Error encontrado | Impacto | Probabilidad |
|---------|-------|------------------|---------|-------------|
| `src/services/machines.ts` | 230-234 | Catch vacío, error Firebase perdido | Loading infinito | ALTA |
| `src/services/inventoryStock.ts` | 73-77 | Catch vacío, error Firebase perdido | Loading infinito | ALTA |
| `src/hooks/useMachines.ts` | 11-15 | Sin try/catch | Loading infinito | ALTA |
| `src/hooks/useInventoryStock.ts` | 19-23 | Sin try/catch | Loading infinito | ALTA |

## Causa raíz identificada:
1. `getMachines()` llama a `getDocs(q)` (línea 221)
2. Firebase devuelve `permission-denied` (reglas de seguridad)
3. El catch está vacío (línea 230)
4. El error original de Firebase (FirebaseError) se pierde
5. Se lanza error genérico "No se pudieron cargar las máquinas" (línea 234)
6. El hook `useMachines` no maneja el error
7. `loading` queda en `true` infinitamente