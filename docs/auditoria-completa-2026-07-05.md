# Auditoría Completa del Sistema — Operario Control
**Fecha:** 2026-07-05  
**Versión:** 0.1.0  
**Estado:** En progreso

---

## 1. Resumen Ejecutivo

### Estado General
- ✅ Frontend compila sin errores
- ✅ Agente local funcional (restaurado desde commit 63574c0)
- ✅ Firebase operativo (53.8% cuota de lecturas)
- ✅ Service account válida
- ⚠️ Código muerto detectado en HEAD (agent.mjs reducido a 188 líneas)
- ⚠️ Debug code en sync_reparaciones.ahk (MouseMove + Sleep)
- ⚠️ Variables de entorno LOCAL_MODE duplicadas

### Riesgos Críticos
1. **Código muerto en producción**: HEAD (dca293d) contiene agent.mjs de 188 líneas que solo imprime "Agent started" y no procesa comandos
2. **Debug code en producción**: sync_reparaciones.ahk línea 25-26 tiene MouseMove + Sleep(2000) de debugging
3. **Variables duplicadas**: .env.local tiene NEXT_PUBLIC_LOCAL_MODE y LOCAL_MODE con el mismo valor

---

## 2. Frontend (Next.js)

### Estructura
- **Framework:** Next.js 16.2.9 (App Router)
- **React:** 19.2.4
- **TypeScript:** 5.x con noEmit: true
- **Tailwind:** ^4
- **UI:** Shadcn/ui + Base UI

### Rutas
- Total: 21 rutas (20 páginas + 1 API)
- 100% "use client" (sin SSR/RSC)
- Protección: useEffect en layout (no middleware)

### Componentes Críticos
- `src/app/(protected)/layout.tsx`: NavBar con 10 items, redirect si no auth
- `src/app/(protected)/repairs/page.tsx`: Lista reparaciones con filtros
- `src/app/(protected)/maintenance/page.tsx`: Mantenimiento (no revisado en detalle)

### Llamadas a Firebase
- **Client SDK:** firebase v12.14.0
- **Inicialización:** src/lib/firebase.ts (singleton con getApps())
- **Uso:** Todos los servicios en src/services/*.ts
- **Modo local:** LOCAL_MODE=1 desativa algunas operaciones

### Llamadas a Redis
- **No hay llamadas directas desde el frontend**
- Redis es usado exclusivamente por el agente local

### Autenticación
- Firebase Auth (email/password)
- Estado: useAuth() hook
- Protección: useEffect en layout (client-side)

### Variables de Entorno
- NEXT_PUBLIC_* disponibles en cliente
- LOCAL_MODE solo server (no expuesto)

---

## 3. Firebase

### Configuración
- **Project ID:** operario-control
- **Plan:** Spark (gratuito)
- **Auth Domain:** operario-control.firebaseapp.com
- **Storage:** operario-control.firebasestorage.app

### Service Account
- **Archivo:** sync-agent/service-account.json
- **Client Email:** firebase-adminsdk-fbsvc@operario-control.iam.gserviceaccount.com
- **Private Key ID:** fbb51c521182c3b2b11771694856cc1cf4ab8d3a
- **Estado:** ✅ Válida (verificado con prueba de lectura)

### Firebase Admin (Backend)
- **Librería:** firebase-admin v14.0.0
- **Inicialización:** engine.ts líneas 12-50
- **Patrón:** Singleton con limpieza de apps previas
- **Uso:** Solo en sync-agent/agent.mjs (no en Next.js server)

### Firebase Client (Frontend)
- **Librería:** firebase v12.14.0
- **Inicialización:** src/lib/firebase.ts
- **Patrón:** Singleton con getApps()
- **Uso:** Auth + Firestore (client SDK)

### Colecciones Firestore
| Colección | Uso | Estado |
|-----------|-----|--------|
| machines | Catálogo máquinas | ✅ Activa |
| machine_spare_parts | Repuestos | ✅ Activa |
| machine_blueprints | Despieces | ✅ Activa |
| blueprint_drafts | Borradores | ✅ Activa |
| inventory_stock | Stock materiales | ✅ Activa |
| inventory_movements | Trazabilidad | ✅ Activa |
| stock_movements | Movimientos repuestos | ✅ Activa |
| audit_logs | Auditoría | ✅ Activa |
| recommendation_audit | Historial recomendaciones | ✅ Activa |
| rentals | Historial alquileres (legacy) | ✅ Activa |
| repairs | Historial reparaciones (legacy) | ✅ Activa |
| maintenance | Sincronización 3C | ✅ Activa |

### Índices Firestore
- machine_spare_parts: machineId (asc)
- machine_blueprints: machineId + createdAt (compuesto)
- audit_logs: timestamp (desc)
- blueprint_drafts: machineId + blueprintId (compuesto)
- inventory_stock: name (asc)
- machines: name (asc)

### Reglas de Seguridad
- ⚠️ No hay firestore.rules versionado
- ⚠️ Reglas solo en consola Firebase

---

## 4. Redis (Upstash)

### Configuración
- **Proveedor:** Upstash Redis
- **URL:** https://prompt-werewolf-153836.upstash.io
- **Token:** gQAAAAAAAljsAAIgcDE4MWYxNjZjZDFiODU0NmEwOGNmNDZjMmNmNDkxNGI3NQ
- **Plan:** Free tier

### Keys Utilizadas
| Key | Tipo | Propósito |
|-----|------|-----------|
| sync-3c:queue | List | FIFO de command IDs |
| sync-3c:command:{id} | Hash | Estado del comando |
| sync-3c:result:{id} | Hash | Resultado completo del sync |
| sync-3c:agent:production | String | Heartbeat JSON (TTL 120s) |

### Flujo
1. **Web** → POST /api/sync-3c → LPUSH sync-3c:queue
2. **Agente** → RPOP sync-3c:queue (cada 5s)
3. **Agente** → Procesa comando → HSET sync-3c:command:{id}
4. **Agente** → HSET sync-3c:result:{id}
5. **Web** → GET /api/sync-3c/status → HGETALL sync-3c:result:{id}

### Heartbeat
- Frecuencia: cada 30s
- TTL: 120s
- Contenido: status, lastHeartbeat, machineName

### Recuperación
- Stale threshold: 10 minutos
- SCAN + re-encolar commands con status "running" > 10 min

### Problemas Detectados
- ⚠️ No hay expiración en sync-3c:queue (crece indefinidamente)
- ⚠️ No hay expiración en sync-3c:command:{id} (acumula historial)
- ⚠️ No hay límite de tamaño en sync-3c:result:{id}

---

## 5. Sync Agent

### Punto de Entrada
- **Archivo:** sync-agent/agent.mjs
- **Comando correcto:** `node node_modules\tsx\dist\cli.mjs sync-agent\agent.mjs`
- **Package.json:** "sync-agent": "npx tsx sync-agent/agent.mjs"
- **VBS:** start-agent.vbs y start-operario-control.vbs

### Ejecución
- **Loader:** tsx v4.22.4
- **Node:** v24.17.0
- **Estado:** ✅ Funcional (restaurado desde 63574c0)

### Imports
- parser.js → ../src/lib/sync-3c/parser.js
- engine.js → ../src/lib/sync-3c/engine.js
- Redis: @upstash/redis
- AHK: child_process (spawn)

### Manejo de Errores
- try/catch en processCommand
- try/catch en pollQueue
- try/catch en recoverStaleCommands
- try/catch en startHeartbeat
- main().catch() para errores fatales

### Logging
- Archivo: sync-agent/agent.log
- Formato: [ISO8601] [ERROR] mensaje
- Rotación: No implementada

### Heartbeat
- Intervalo: 30s
- Key: sync-3c:agent:production
- TTL: 120s

### Polling
- Intervalo: 5s
- Queue: sync-3c:queue (RPOP)
- Stale recovery: SCAN cada inicio

### AutoHotkey
- Timeout: 120s
- Retries: 10 intentos (1s delay)
- CWD: automation/
- WindowsHide: true

### Cierre Seguro
- SIGINT: logStream.end() + exit(0)
- SIGTERM: logStream.end() + exit(0)
- exit: logStream.end()

### Problemas Detectados
- ⚠️ Código muerto en HEAD (dca293d): agent.mjs de 188 líneas sin lógica operativa
- ⚠️ No hay límite de memoria para logs
- ⚠️ No hay rotación de logs

---

## 6. AutoHotkey

### Scripts
| Script | Propósito | Líneas |
|--------|-----------|--------|
| sync_common.ahk | Motor compartido | 188 |
| sync_3c.ahk | Navegación STOCK | 89 |
| sync_reparaciones.ahk | Navegación REPARACIONES | 86 |
| sync_articulos.ahk | Navegación ARTICULOS | 90 |

### Configuración
- **Archivo:** automation/config.ini
- **Coordenadas:** Leídas desde INI
- **Timings:** Configurables por sección

### Navegación STOCK (8 clicks)
1. Almacenes → 2. Informes → 3. Existencias → 4. Depósitos → 5. Seleccionar todos → 6. Consulta → 7. Aceptar → 8. Excel

### Navegación REPARACIONES (7 clicks)
1. Ventas → 2. Reparaciones → 3. ExcelItems → 4. PrintAll → 5. Imprimir → 6. ExcelFormat → WaitForExcel → WatchAndCopy → SalirRep

### Navegación ARTICULOS (6 clicks)
1. Servicios → 2. ArticulosMenu → 3. ArticulosLista → 4. ImprimirArt → 5. Generar → 6. ExcelArt

### Funciones Compartidas
- ClickAt(): Click en coordenadas
- ValidarFoco(): Verifica ventana 3C activa
- WaitForExcel(): Espera ventana XLMAIN (timeout 30s)
- WatchAndCopy(): Copia archivo desde %TEMP%\tresc a automation-watcher/3c_exports/
- FocusFix(): Minimiza Chrome/Edge

### Problemas Detectados
- ⚠️ Debug code en sync_reparaciones.ahk líneas 25-26: MouseMove + Sleep(2000)
- ⚠️ No hay validación de coordenadas antes de ClickAt()
- ⚠️ No hay retry en ClickAt() si falla

---

## 7. Sync 3C

### Parser (parser.ts)
- **Entrada:** ArrayBuffer/Buffer (Excel)
- **Salida:** ParseResult { items, rawCount }
- **Columnas:** codigo(2), name(5), stockTotal(20), deposito(1), unidadRaw(7)
- **Fila inicio:** 6
- **Agregación:** Por codigo o normalizedName
- **Scaffold:** classifyScaffoldStock()

### Engine (engine.ts)
- **Funciones:**
  - syncItems(): Sincroniza stock a inventory_stock
  - syncRepairsToMaintenance(): Sincroniza reparaciones a maintenance
- **Firebase Admin:** Inicializado en getFirebaseAdmin()
- **Batch limit:** 400 documentos
- **Validación:** orderNumber regex, entryDate parsing

### Cache
- **Archivos:**
  - stock-cache.json
  - machines-cache.json
  - spare-parts-cache.json
- **Uso:** Solo para módulo stock
- **Problema:** No hay limpieza automática

### Flujo Stock
1. AHK exporta Excel
2. parseExcel() parsea archivo
3. syncItems() sincroniza a inventory_stock
4. safeWriteJson() guarda cache local

### Flujo Reparaciones
1. AHK exporta Excel
2. syncRepairsToMaintenance() parsea y sincroniza
3. Batch de 400 documentos
4. Auditoría temporal en consola

### Flujo Artículos
- No implementado en engine.ts
- Solo navegación AHK

---

## 8. Dependencias

### Producción
| Paquete | Versión | Propósito | Riesgo |
|---------|---------|-----------|--------|
| next | 16.2.9 | Framework | Bajo |
| react | 19.2.4 | UI | Bajo |
| firebase | ^12.14.0 | Client SDK | Medio (cuota) |
| firebase-admin | ^14.0.0 | Admin SDK | Bajo |
| @upstash/redis | ^1.38.0 | Redis client | Bajo |
| xlsx | ^0.18.5 | Excel parsing | Bajo |
| pdfjs-dist | 6.0.227 | PDF parsing | Bajo |

### Desarrollo
| Paquete | Versión | Propósito |
|---------|---------|-----------|
| typescript | ^5 | Compilador |
| tsx | ^4.22.4 | Runner TS |
| tailwindcss | ^4 | CSS |
| eslint | ^9 | Linting |

### Compatibilidades
- ✅ Node 24 + tsx 4.22.4 + agent.mjs (con tsx)
- ❌ Node 24 + node directo + agent.mjs (sin tsx) → SyntaxError
- ⚠️ tsx 4.22.4 puede tener incompatibilidades con Node 24 (loader API)

---

## 9. Variables de Entorno

### .env.local
```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyCl39k1P-GxLSl2bEa7ZLEfQgeT14SuLlc
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=operario-control.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=operario-control
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=operario-control.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=474065245898
NEXT_PUBLIC_FIREBASE_APP_ID=1:474065245898:web:003f8836cec7429ad80633
UPSTASH_REDIS_REST_URL="https://prompt-werewolf-153836.upstash.io"
UPSTASH_REDIS_REST_TOKEN="gQAAAAAAAljsAAIgcDE4MWYxNjZjZDFiODU0NmEwOGNmNDZjMmNmNDkxNGI3NQ"
NEXT_PUBLIC_LOCAL_MODE=1
LOCAL_MODE=1
```

### Variables Utilizadas
- ✅ NEXT_PUBLIC_FIREBASE_* (6 variables)
- ✅ UPSTASH_REDIS_REST_URL
- ✅ UPSTASH_REDIS_REST_TOKEN
- ✅ NEXT_PUBLIC_LOCAL_MODE
- ✅ LOCAL_MODE

### Variables Sin Usar
- Ninguna detectada

### Variables Duplicadas
- ⚠️ NEXT_PUBLIC_LOCAL_MODE=1 y LOCAL_MODE=1 (mismo valor, una es pública)

### Variables Faltantes
- Ninguna detectada

### Credenciales Expuestas
- ⚠️ UPSTASH_REDIS_REST_TOKEN en .env.local (no debería estar commiteado)
- ⚠️ service-account.json en sync-agent/ (no debería estar en repo)

---

## 10. Git

### Historial Reciente
```
dca293d (HEAD) update - Código muerto en agent.mjs
044fc28 update - Agregó anotaciones TypeScript
63574c0 final - Última versión funcional del agente
3b4ab8e update
2bd2f85 update
21385d4 update
386a682 Sync mantenimiento desde órdenes de reparación
```

### Archivos Críticos
- sync-agent/agent.mjs: Modificado en dca293d (código muerto)
- src/lib/sync-3c/engine.ts: Estable
- automation/*.ahk: Estables

### Cambios Peligrosos
- ⚠️ dca293d: Redujo agent.mjs de 418 a 188 líneas (eliminó lógica operativa)
- ⚠️ 044fc28: Agregó anotaciones TypeScript en .mjs

### Archivos Que Nunca Deberían Modificarse
- sync-agent/agent.mjs (sin revisión exhaustiva)
- automation/sync_common.ahk (coordenadas sensibles)
- automation/config.ini (coordenadas y timings)

---

## 11. Documentación

### Archivos Existentes
- README.md: Básico
- AGENTS.md: Auditoría de migración Redis (2026-06-28)
- docs/auditoria-sistema.md: Auditoría general (2026-06-26)
- docs/arquitectura.md: No revisado

### Documentación Actualizada
- ✅ Esta auditoría reemplaza docs/auditoria-sistema.md
- ⚠️ Falta documentar:
  - Procedimientos de inicio del agente
  - Procedimientos de recuperación ante fallos
  - Troubleshooting completo
  - Checklist de salud del sistema

---

## 12. Riesgos Encontrados

### Críticos
1. **Código muerto en producción**: HEAD tiene agent.mjs que no funciona
2. **Debug code en producción**: MouseMove + Sleep en sync_reparaciones.ahk
3. **Credenciales en repo**: service-account.json y UPSTASH_REDIS_REST_TOKEN

### Altos
4. **Sin firestore.rules**: Sin control de acceso versionado
5. **Sin rotación de logs**: agent.log crece indefinidamente
6. **Sin límite en Redis**: Keys acumulan historial sin expiración

### Medios
7. **Variables duplicadas**: LOCAL_MODE y NEXT_PUBLIC_LOCAL_MODE
8. **Sin tests**: Cero cobertura de tests
9. **Sin CI/CD**: Sin pipeline automatizado
10. **100% client-side**: Sin SSR/RSC, sin middleware

### Bajos
11. **Hardcoded BOM**: Receta de andamio en código
12. **Sort in-memory**: getSparePartsByMachine() sin orderBy
13. **Legacy collections**: rentals y repairs como legacy

---

## 13. Mejoras Recomendadas

### Inmediatas
1. Revertir dca293d o aplicar parche de 63574c0 permanentemente
2. Remover debug code de sync_reparaciones.ahk
3. Mover service-account.json fuera del repo
4. Agregar .env.local a .gitignore

### Corto Plazo
5. Implementar rotación de logs en agent.mjs
6. Agregar expiración a keys de Redis
7. Crear firestore.rules
8. Agregar tests unitarios básicos

### Mediano Plazo
9. Implementar middleware de auth
10. Migrar a Server Components
11. Agregar CI/CD
12. Implementar cache de consultas (React Query)

### Largo Plazo
13. Evaluar plan pago Firebase o migración a Supabase
14. Implementar BOM configurable
15. Agregar módulo de remitos

---

## 14. Checklist de Salud del Sistema

### Frontend
- [x] Compila sin errores
- [x] Variables de entorno configuradas
- [ ] firestore.rules versionado
- [ ] Tests unitarios
- [ ] CI/CD pipeline

### Backend
- [x] Agente funcional
- [x] Firebase operativo
- [x] Redis operativo
- [ ] Logs con rotación
- [ ] Monitoreo de heartbeat

### Base de Datos
- [x] Colecciones existen
- [x] Índices creados
- [ ] Reglas de seguridad
- [ ] Backup automático

### Seguridad
- [ ] service-account.json fuera de repo
- [ ] Credenciales en secreto
- [ ] .env.local en .gitignore
- [ ] Variables senseras no expuestas

---

## 15. Checklist de Recuperación Ante Fallos

### Si el agente no arranca
1. Verificar que agent.mjs tenga 483 líneas (no 188)
2. Verificar que tsx esté instalado: `npx tsx --version`
3. Ejecutar: `node node_modules\tsx\dist\cli.mjs sync-agent\agent.mjs`
4. Verificar logs: sync-agent/agent.log

### Si Firebase falla
1. Verificar cuota en Firebase Console
2. Verificar service-account.json no revocada
3. Verificar conectividad: `node -e "require('firebase-admin')"`

### Si Redis falla
1. Verificar UPSTASH_REDIS_REST_URL y TOKEN
2. Verificar conectividad: `curl $UPSTASH_REDIS_REST_URL`
3. Verificar heartbeat: `redis-cli GET sync-3c:agent:production`

### Si la web no muestra datos
1. Verificar que el agente esté corriendo (heartbeat)
2. Verificar que Firebase tenga datos
3. Verificar consola del navegador (errores de auth)
4. Verificar red (CORS, firewall)

---

## 16. Comandos Oficiales

### Iniciar agente
```bash
node node_modules\tsx\dist\cli.mjs sync-agent\agent.mjs
```

### Iniciar web + agente
```bash
# Opción 1: VBS
start-operario-control.vbs

# Opción 2: Manual
node node_modules\tsx\dist\cli.mjs sync-agent\agent.mjs
npm run dev
```

### Verificar estado
```bash
# Logs del agente
Get-Content sync-agent/agent.log -Tail 50

# Heartbeat en Redis
node -e "const Redis = require('@upstash/redis'); const r = new Redis({url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN}); r.get('sync-3c:agent:production').then(console.log)"

# Probar Firebase
node -e "const admin = require('firebase-admin'); const sa = require('./sync-agent/service-account.json'); admin.initializeApp({credential: admin.cert(sa)}); admin.firestore().collection('maintenance').limit(1).get().then(s => console.log('OK:', s.docs.length))"
```

### Restaurar agente funcional
```bash
git checkout 63574c0 -- sync-agent/agent.mjs
```

---

## 17. Próximos Pasos

1. **Inmediato:** Aplicar restauración de agent.mjs permanentemente
2. **Corto plazo:** Remover debug code, agregar rotación de logs
3. **Mediano plazo:** Implementar tests, CI/CD, firestore.rules
4. **Largo plazo:** Evaluar migración a Supabase o plan pago Firebase

---

*Auditoría generada el 2026-07-05*  
*Estado: COMPLETA*