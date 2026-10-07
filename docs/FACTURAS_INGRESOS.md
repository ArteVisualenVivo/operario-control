# Ingresos de Mercadería — facturas PDF → stock (Fase 1)

Sistema de ingesta de facturas de compra para reemplazar la carga manual:
PDF/escaneo/foto → texto → renglones estructurados → revisión → confirmación.
**100 % gratuito**: sin APIs de pago, sin OCR de nube, sin servicios nuevos.

```
             ┌── Web (PC o celular) ── dropzone ─────────────┐
Canales ─────┼── Carpeta inbox (correo/WhatsApp copiado) ────┼─→ parse + match
             │   (despertador cada 1 min lo procesa solo)    │     (heurísticas
             └── Email IMAP: Fase 2 (stub reservado) ────────┘      + Gemini opc.)
                                       │
                                       ▼
                     Redis módulo `invoices` (Upstash, ya en el plan)
                                       │
                                       ▼
                  Pantalla /ingresos/[id]: editar renglones, elegir
                  artículo 3C (EXISTE / NUEVO), Confirmar ✓
```

## Cómo probar (pasos del dueño)

1. Abrir la web → pestaña **Ingresos** en el menú superior.
2. Arrastrar el PDF de la factura (o “Elegir PDF / imagen”; en el celular
   también sirve tomar la foto con la cámara).
   - PDF con texto → casi instantáneo.
   - PDF escaneado o foto → OCR en el navegador (tesseract.js, `spa+eng`),
     10-60 s por página con barra de progreso. **No cerrar la pestaña.**
3. Se abre la factura en revisión: proveedor, CUIT, fecha, nro y renglones.
   - Editar cualquier celda (cantidad, precio, descripción, código).
   - “+ Agregar renglón” si el parser se comió algo; “×” para quitar.
   - Cada renglón muestra **EXISTE** (ya está en el catálogo 3C), **NUEVO**
     (hay que darlo de alta) o **SIN CATÁLOGO**. Con el combo se puede
     cambiar el match a mano o marcar “Nuevo artículo”.
4. **Confirmar ingreso ✓** (queda `confirmed` en Redis) o **Descartar**.
5. El archivo original queda respaldado en Cloudinary (preset
   `operario_blueprints`, gratis) — link “ver archivo original” en la revisión.

### Requisito para que el match funcione
El catálogo sale del módulo Redis `articulos` (informe **Artículos** de 3C).
Si está vacío, los renglones quedan en **SIN CATÁLOGO** y la pantalla lo
avisa: correr la sincronización “Artículos” desde el dashboard 3C.

## Canal carpeta (correo / WhatsApp)

```
automation-watcher/inbox/facturas/      ← acá se copian los archivos
automation-watcher/inbox/processed/     ← los que ya entraron
automation-watcher/inbox/needs-ocr/     ← PDF escaneado sin texto (subir por la web)
automation-watcher/inbox/failed/        ← errores
```

- El despertador `wake-agent-if-pending.ps1` (tarea programada, cada 1 min)
  detecta archivos y lanza oculto `npx tsx scripts/inbox-ingest.ts`.
- Log: `sync-agent/inbox-ingest.log`.
- PDF con capa de texto → se ingresa solo. PDF escaneado → `needs-ocr`
  (el render de PDF a imagen no corre en Node sin canvas nativo; el OCR del
  navegador sí lo resuelve). Fotos JPG/PNG → OCR con tesseract.js en Node.
- Lock propio (`inbox/.inbox-ingest.lock`): nunca dos corridas a la vez.
- Verificación manual: `npx tsx scripts/inbox-ingest.ts` (sale solo).

## API y datos

| Ruta | Método | Qué hace |
|---|---|---|
| `/api/invoices/ingest` | POST | `{ fileName, fileUrl, source, method, text }` → parse + match → guarda |
| `/api/invoices` | GET | listado |
| `/api/invoices/[id]` | GET / PATCH / DELETE | leer / editar (re-matchea) / descartar |

- Persistencia: envelope Redis `invoices` (`redisPrimary.ts`, particionado).
  **Sin Firestore** → sin cuota que gastar.
- Tipos: `src/types/invoice.ts` · Parser: `src/lib/invoices/parseInvoice.ts`
  · Match: `matchArticles.ts` · Store: `store.ts` · OCR/web: `extractClient.ts`.

## Parseo: heurísticas + Gemini (opcional, gratis)

1. **Heurísticas locales** (default, siempre disponibles): números AR
   (`1.234,56`), encabezado (proveedor por palabras clave + cercanía al
   CUIT, fecha etiquetada, nro `A 0001-00012345`), renglones en 3 formatos
   (cantidad al inicio, código al inicio, con/sin total) y totales
   (subtotal / IVA / total a pagar). Sin dependencias externas.
2. **Gemini free tier** (opcional): si existe la env `GEMINI_API_KEY`, el
   parser intenta primero el LLM y si algo falla vuelve a heurísticas.
   Key gratis en <https://aistudio.google.com/apikey> → agregar
   `GEMINI_API_KEY` en `.env.local` **y** en Vercel → Environment Variables.
   El resultado SIEMPRE pasa por la pantalla de revisión.

## Verificación

```powershell
npm run verify:invoices     # fixtures digital + OCR + match + roundtrip Redis
npx tsc --noEmit            # tipos
npx eslint src/lib/invoices "src/app/(protected)/ingresos"   # lint de este módulo
```

## Pendientes (Fase 2)

- [ ] Empujar renglones confirmados al stock de 3C (investigar si 3C acepta
      import Excel/CSV de artículos/stock, o si requiere alta manual).
- [ ] Canal email IMAP (poll con credenciales gratis de Gmail/App Password).
- [ ] Alta masiva de artículos nuevos en 3C desde `alta_stock`.
- [ ] Refinar heurísticas con facturas reales de los proveedores habituales.
