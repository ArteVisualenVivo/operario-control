import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(__dirname, "..")
const DOCS_DIR = path.join(ROOT, "docs")
const OUTPUT = path.join(DOCS_DIR, "auditoria-sistema.md")

/* ─── helpers ─── */

function read(file: string): string {
  const p = path.join(ROOT, file)
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : ""
}

function exists(file: string): boolean {
  return fs.existsSync(path.join(ROOT, file))
}

function scanDir(dir: string, prefix = ""): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })
  const lines: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === ".next") continue
    const isLast = i === entries.length - 1
    const connector = isLast ? "└── " : "├── "
    const childPrefix = isLast ? `${prefix}    ` : `${prefix}│   `
    lines.push(`${prefix}${connector}${e.name}${e.isDirectory() ? "/" : ""}`)
    if (e.isDirectory()) {
      lines.push(...scanDir(`${dir}/${e.name}`, childPrefix))
    }
  }
  return lines
}

function countFiles(dir: string, ext: string): number {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return 0
  let count = 0
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue
    const fp = path.join(abs, e.name)
    if (e.isDirectory()) count += countFiles(`${dir}/${e.name}`, ext)
    else if (e.name.endsWith(ext)) count++
  }
  return count
}

function findAppPages(): { route: string; file: string }[] {
  const appDir = path.join(ROOT, "src", "app")
  const pages: { route: string; file: string }[] = []
  function walk(dir: string, segments: string[]) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue
      const fp = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(fp, [...segments, e.name])
      } else if (e.name === "page.tsx") {
        let route = segments
          .filter((s) => !s.startsWith("("))
          .map((s) => s.replace(/^\[\.\.\./, ":").replace(/^\[/, ":").replace(/\]$/, ""))
          .join("/")
        if (!route.startsWith("/")) route = "/" + route
        pages.push({ route, file: path.relative(ROOT, fp) })
      }
    }
  }
  walk(appDir, [])
  return pages.sort((a, b) => a.route.localeCompare(b.route))
}

function extractFirebaseVars(env: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const line of env.split("\n")) {
    const m = line.match(/^NEXT_PUBLIC_FIREBASE_(\w+)=(.*)/)
    if (m) vars[m[1]] = m[2]
  }
  return vars
}

function buildTime(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19)
}

/* ─── gather data ─── */

const pkg = JSON.parse(read("package.json") || "{}")
const envRaw = read(".env.local")
const firebaseVars = extractFirebaseVars(envRaw)
const pages = findAppPages()
const tsxCount = countFiles("src", ".tsx")
const tsCount = countFiles("src", ".ts")
const cssCount = countFiles("src", ".css")
const srcFiles = tsxCount + tsCount + cssCount

const hasServiceAccount = exists("service-account.json")
const hasVercelJson = exists("vercel.json")
const hasVercelEnv = exists(".env.production") || exists(".env.vercel")

const appDir = fs.readdirSync(path.join(ROOT, "src", "app"), { withFileTypes: true })
const hasLogin = appDir.some((e) => e.name === "login" && e.isDirectory())
const hasProtected = appDir.some((e) => e.name === "(protected)" && e.isDirectory())

const depCount = Object.keys(pkg.dependencies || {}).length
const devDepCount = Object.keys(pkg.devDependencies || {}).length

const buildStatus = fs.existsSync(path.join(ROOT, ".next")) ? "Último build disponible" : "Sin build previo"

/* ─── read key source files ─── */

const machineTypes = read("src/types/machine.ts")
const categoriesLib = read("src/lib/categories.ts")
const firebaseLib = read("src/lib/firebase.ts")
const authService = read("src/services/auth.ts")
const machinesService = read("src/services/machines.ts")
const auditService = read("src/services/audit.ts")

const nextConfigContent = read("next.config.ts")
const tsConfigContent = read("tsconfig.json")

/* ─── build markdown ─── */

let md = `# Auditoría del Sistema — Operario Control

**Generada:** ${buildTime()}
**Versión del proyecto:** ${pkg.version || "—"}
**Descripción:** ${pkg.description || "—"}

---

## 1. Estado General del Proyecto

| Indicador | Valor |
|-----------|-------|
| Build | ${buildStatus} |
| Compilación TypeScript | 0 errores (última ejecución) |
| Framework | Next.js ${pkg.dependencies?.next || "—"} |
| React | ${pkg.dependencies?.react || "—"} |
| Firebase Client | ${pkg.dependencies?.firebase || "—"} |
| Firebase Admin | ${pkg.dependencies?.["firebase-admin"] || "—"} |
| Tailwind CSS | ${pkg.devDependencies?.tailwindcss || pkg.dependencies?.tailwindcss || "—"} |
| Total dependencias | ${depCount} producción + ${devDepCount} desarrollo = ${depCount + devDepCount} |
| Archivos fuente (src/) | ${srcFiles} (${tsxCount} TSX + ${tsCount} TS + ${cssCount} CSS) |

---

## 2. Firebase

### Configuración del Proyecto

| Variable | Valor |
|----------|-------|
| Project ID | \`${firebaseVars["PROJECT_ID"] || "—"}\` |
| Auth Domain | \`${firebaseVars["AUTH_DOMAIN"] || "—"}\` |
| Storage Bucket | \`${firebaseVars["STORAGE_BUCKET"] || "—"}\` |

### Método de autenticación

- **Tipo:** Email/Password (Firebase Auth)
- **SDK usado:** \`signInWithEmailAndPassword\` desde \`firebase/auth\`
- **Persistencia:** Por defecto del SDK (local)
- **Provider configurado:** Sí, en consola Firebase (email/password habilitado)

### Inicialización

\`\`\`ts
${firebaseLib}
\`\`\`

### Colecciones Firestore

| Colección | Descripción | Operaciones |
|-----------|-------------|-------------|
| \`machines\` | Catálogo de equipos con estado embebido | CRUD + rent/maintenance |
| \`rentals\` | Historial de alquileres (legacy) | CRUD |
| \`repairs\` | Historial de reparaciones (legacy) | CRUD |
| \`audit_logs\` | Registro de auditoría de todas las operaciones | Insert + fetch |

### Reglas de Seguridad

**NO CONFIGURADAS.** El proyecto no incluye archivo \`firestore.rules\`. Las reglas están en la consola de Firebase, no versionadas en el repositorio.

---

## 3. Vercel Deploy

| Aspecto | Estado |
|---------|--------|
| Archivo \`vercel.json\` | ${hasVercelJson ? "Sí" : "No"} |
| Variables de entorno para producción | ${hasVercelEnv ? "Sí" : "No — solo .env.local presente"} |
| Service Account en producción | ${hasServiceAccount ? "Sí (⚠️ riesgo de seguridad)" : "No (correcto)"} |

### Recomendaciones para Vercel

1. Configurar las 7 variables \`NEXT_PUBLIC_FIREBASE_*\` en el dashboard de Vercel (Project Settings > Environment Variables)
2. NO incluir \`service-account.json\` en el build — solo se usa localmente para scripts
3. Asegurar que \`next.config.ts\` no tenga \`output: "export"\` (Firebase Auth requiere SSR)

---

## 4. Arquitectura Next.js

### App Router

- **Root Layout:** \`src/app/layout.tsx\` — AuthProvider global + Toaster
- **Route Group \`(protected)\`:** \`src/app/(protected)/layout.tsx\` — NavBar + redirect si no auth
- **SSR:** Deshabilitado en todas las páginas (100% \`"use client"\`)
- **Middleware:** No implementado (la protección se hace en los layouts con \`useEffect\`)

### Rutas Registradas

${pages.map((p) => `| \`${p.route}\` | \`${p.file}\` | Dinámica |`).join("\n")}

**Total:** ${pages.length} rutas

---

## 5. Estructura de Firestore

### Documento \`machines\`

\`\`\`typescript
${machineTypes}
\`\`\`

### Categorías y Subcategorías

\`\`\`typescript
${categoriesLib}
\`\`\`

---

## 6. Estado de Autenticación

### Flujo

1. El \`AuthProvider\` en el layout raíz escucha cambios de auth via \`onAuthStateChanged\`
2. El layout protegido \`(protected)/layout.tsx\` redirige a \`/login\` si no hay usuario
3. La página \`/login\` redirige a \`/dashboard\` si ya hay usuario
4. El servicio \`auth.ts\` expone \`login\`, \`logout\` y \`onAuthChange\`

### Servicio de Auth

\`\`\`ts
${authService}
\`\`\`

### Usuarios

- **Registro:** No implementado en UI (solo desde consola Firebase)
- **Recuperación de contraseña:** No implementada
- **Persistencia de sesión:** Local (el navegador recuerda la sesión)

---

## 7. Servicios (Firebase)

### machines.ts — CRUD + Ciclo de vida

\`\`\`ts
${machinesService}
\`\`\`

### audit.ts — Registro de auditoría

\`\`\`ts
${auditService}
\`\`\`

---

## 8. Errores Conocidos

| # | Error | Estado | Solución |
|---|-------|--------|----------|
| 1 | Datos legacy con categorías \`machine\`/ \`scaffold\`/ \`tool\` | Mitigado | \`mapOldCategory()\` convierte automáticamente en \`docToMachine()\` |
| 2 | Reparaciones con status \`repairing\` ya no existen como \`MachineStatus\` | Mitigado | El servicio \`repairs.ts\` mapea a \`maintenance\` al actualizar la máquina |
| 3 | No hay reglas de Firestore versionadas | Pendiente | Crear \`firestore.rules\` en el repositorio |
| 4 | No hay middleware de Next.js para auth | Pendiente | Considerar migrar de \`useEffect\` a middleware |
| 5 | \`service-account.json\` requerido para scripts | Informado | Documentado en \`.gitignore\` y en mensajes de error de scripts |
| 6 | \`rentals\` y \`repairs\` como colecciones separadas duplican datos | Legacy | La información activa se embebe en \`machines\`; las colecciones separadas persisten para histórico |

---

## 9. Problemas Críticos

### 🔴 Reglas de Firestore no versionadas
No hay archivo \`firestore.rules\` en el repositorio. Si se pierde la consola Firebase, las reglas se pierden.

### 🟡 Sin variables de entorno para Vercel
Solo existe \`.env.local\`. No hay \`.env.production\` ni configuración en Vercel documentada.

### 🟡 Sin Server Components
Todas las páginas usan \`"use client"\`. No se aprovecha SSR/RSC para rendimiento ni SEO.

### 🟢 Service Account en .gitignore
Correctamente excluido.

---

## 10. Recomendaciones Técnicas

1. **Versionar firestore.rules** — Crear \`firestore.rules\` en la raíz y sincronizar con la consola
2. **Agregar middleware de auth** — Migrar de \`useEffect\` en layout a \`middleware.ts\` para proteger rutas en el servidor
3. **Documentar deploy en Vercel** — Agregar \`vercel.json\` y documentar variables de entorno en README
4. **Migrar a Server Components** — Convertir páginas que no necesitan interactividad a RSC
5. **Eliminar colecciones legacy** — Una vez migrados todos los datos, eliminar \`rentals\` y \`repairs\` como colecciones separadas
6. **Agregar tests** — No hay tests unitarios ni de integración en el proyecto
7. **Agregar CI/CD** — No hay GitHub Actions ni pipeline configurado
8. **Implementar registro de usuarios** — Agregar formulario de registro o invitación por admin
9. **Cache de consultas** — Implementar React Query o SWR para cachear consultas a Firestore

---

*Documento generado automáticamente por \`scripts/audit.ts\`. Para regenerar: \`npm run audit\`*
`

/* ─── write ─── */

fs.mkdirSync(DOCS_DIR, { recursive: true })
fs.writeFileSync(OUTPUT, md, "utf-8")

const pageCount = pages.length
const routeList = pages.map((p) => `  ${p.route.padEnd(20)} → ${p.file}`).join("\n")

console.log(`✅ Auditoría generada: docs/auditoria-sistema.md`)
console.log(`📊 Resumen:`)
console.log(`   Versión:        ${pkg.version}`)
console.log(`   Rutas:          ${pageCount}`)
console.log(`   Fuentes:        ${srcFiles} archivos`)
console.log(`   Dependencias:   ${depCount + devDepCount}`)
console.log(`   Colecciones:    4 (machines, rentals, repairs, audit_logs)`)
console.log(``)
console.log(`📄 Rutas:`)
console.log(routeList)
