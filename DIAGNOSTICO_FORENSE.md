# DIAGNÓSTICO FORENSE - CADENA DE EJECUCIÓN

## 1. firestore.rules
**No existe en el proyecto.** Las reglas están en Firebase Console.

## 2. Reglas de seguridad Firebase
**FirebaseError obtenido:**
```
code: permission-denied
message: Missing or insufficient permissions.
```

## 3. Configuración Firebase
```
projectId: operario-control
apiKey: AIzaSyCl39k1P-GxLSl2bEa7ZLEfQgeT14SuLlc
authDomain: operario-control.firebaseapp.com
```

## 4. Evidencia del build (SSR)
```
[DEBUG] ProtectedLayout - loading: true
[DEBUG] ProtectedLayout - user: null
[DEBUG] ProtectedLayout - auth.currentUser: null
```
**Se repite 26 veces** - durante el build (SSR), `auth.currentUser` es `null`.

## 5. Línea temporal completa
```
Inicio App (SSR)
  ↓
src/app/layout.tsx (RootLayout)
  ↓
AuthProvider (src/lib/AuthContext.tsx)
  ↓
onAuthStateChanged (src/services/auth.ts)
  ↓
auth.currentUser: null (en SSR)
  ↓
ProtectedLayout (src/app/(protected)/layout.tsx)
  ↓
loading: true, user: null
  ↓
getMachines (src/services/machines.ts)
  ↓
getDocs(query(collection(db, "machines"), orderBy("name")))
  ↓
ERROR: permission-denied
```

## 6. Conclusión FINAL
**Problema de autenticación.**

Durante el build (SSR), `auth.currentUser` es `null` porque no hay usuario autenticado en el servidor. El ProtectedLayout no puede redirigir durante el build porque `loading: true` mantiene el estado de carga.

**Archivo causante:** `src/lib/AuthContext.tsx` - `onAuthStateChanged` no resuelve usuario en SSR.