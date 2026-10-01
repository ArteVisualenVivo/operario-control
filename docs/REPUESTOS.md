# Repuestos — buscador "¿este repuesto sirve en otra máquina?" (2026-10-01)

Ruta: **`/repuestos`** (entrada **Repuestos** del menú, después de «Pedidos Rep.»).

## Para qué existe

Pedido del dueño: *"quiero tener un buscador donde coloque el código o el nombre del repuesto y
que me dé una lista en qué máquina se utiliza… lo que necesito es saber si un repuesto se puede
utilizar en otra máquina si no consigo el original"*.

Se escribe un **código** o un **nombre** y la pantalla devuelve **una fila por máquina** donde ese
repuesto se usa, con cuántas veces, la última vez y el **historial** desplegable (nº de orden +
fechas). Si aparece en **2 o más máquinas**, sirve como reemplazo.

## Cómo funciona (piezas)

| Pieza | Rol |
|---|---|
| `lib/partCompatibility.ts` → `findCompatibleMachines()` | El motor (ya existía). Busca por código exacto (ignora espacios/mayúsculas) y, si no hay, por nombre tolerante a variantes. Se reutiliza, no se reescribió. |
| `app/(protected)/repuestos/page.tsx` | La pantalla: buscador + estados (cargando / sin resultados / cómo leer). |
| `components/parts/PartCompatibilityTable.tsx` | La tabla por máquina + el historial desplegable. |
| `hooks/useAllSparePartOrders` + `useSparePartsCache` + `useMachines` | Los datos, igual que el Dashboard: leen la fuente primaria (Redis / caché en disco), así funciona con la cuota de Firestore agotada. |

El buscador del **Dashboard** sigue existiendo igual (sección «Repuesto compatible»): usa el mismo
motor, así que también se benefició del arreglo de agrupación descrito abajo.

## La IDENTIDAD de la máquina es el MODELO COMPLETO (y por qué)

3C manda un **nombre corto** y repetido, y el **modelo** en otro campo con el prefijo
`REPARACION:`. Medido en los datos reales (48 pedidos):

| Nombre en 3C | Modelo completo (lo que distingue) |
|---|---|
| AMOLDADORA | AMOLADORA BOSCH 230 GWS 25-180 |
| AMOLADORA 230 BOSCH | AMOLADORA 230 BOSCH - GWS 28-230 |
| Amoladora bosch 230 | Amoladora bosch 230 GWS- 25-230 Bare \| 3 601 HF4 0H0 |
| AMOLADORA | AMOLADORA MAKITA 115 9557 HP |
| AMOLADORA | AMOLADORA BOSCH 230 GWS 2200-230 |
| CIRCULAR | CIRCULAR SKILL 5200 |

Tres máquinas **distintas** figuran las tres como «AMOLADORA»: agrupando por nombre se diría «es la
misma máquina» justo cuando se busca un repuesto para otra. Por eso:

- **Identidad = modelo completo** (sin el prefijo `REPARACION:`); si no hay modelo, el nombre.
- Si la máquina existe en el **catálogo** (`machines`), se agrupa por su **id real** (las fichas
  de repuestos siguen agrupando por máquina y su link «Ver repuestos» funciona).

## Arreglos de fondo que vinieron con esto

1. **Agrupaba por nº de orden.** `spare_part_orders.machineId` guarda el **nº de orden**
   («X 0001-00011174»), no una máquina: la búsqueda abría **una fila por pedido** y mostraba la
   misma máquina repetida, y el link «Ver repuestos» apuntaba a una máquina inexistente. Ahora se
   agrupa por máquina de verdad y el link sólo se dibuja cuando el id es una máquina real.
   Medido: buscar `1600210034` pasó de **6 filas** (una por pedido) a **4 máquinas distintas**.
2. **Historial por máquina.** Cada fila trae `detallePedidos` (nº de orden, repuesto, estado y
   fechas pedido/traído/utilizado, más recientes primero, hasta 8) y la pantalla lo despliega.

## El aviso «⚠ se parece a» (y por qué NO se fusiona)

Cuando dos identidades comparten **algún token con números** («230», «25», «180», «9557»), la
pantalla avisa *«se parece a: …»*. Es un **dato para el operario**, no una fusión:

- Fusionar mal (ej. juntar la **GWS 25**-180 con la **GWS 28**-230) haría decir «es la misma
  máquina» y llevaría a decidir mal en el momento crítico.
- Una categoría suelta («amoladora», «sierra», «circular») **no** alcanza para avisar: haría ruido
  en todas las filas.
- Si algún día se quiere fusionar en serio, se hace con una **lista de alias aprobada a mano**
  (ej. `AMOLDADORA` = `AMOLADORA BOSCH 230 GWS 25-180`), nunca automática.

## Límite conocido (está escrito en la pantalla)

El buscador encuentra **por código** sólo los repuestos que **tienen código guardado**. Los que
quedaron sin código en 3C (por ejemplo `INDUCIDO. SEGUN MUESTRAS`, ver `PEDIDOS_REPUESTOS.md` §20 y
§21) aparecen **sólo por nombre**; al corregirles el código a mano en «Pedidos Rep.», el buscador
los toma al instante (misma fuente).

## Verificación hecha (datos reales, 2026-10-01)

| Búsqueda | Resultado |
|---|---|
| `1600210034` | 4 máquinas distintas (3 amoladoras Bosch marcadas «⚠ se parece a» + CIRCULAR SKILL 5200) |
| `1 619 PB9 430` | 1 máquina: Sierra Circular Bosh 7" 1300W GKS130, con historial |
| `inducido` | 6 máquinas distintas, cada una con su historial |
| `rodamiento` | 1 máquina (AMOLADORA MAKITA 115 9557 HP, 2 veces, códigos 210042-8 y 210034-7) |
| `motosierr` | sin resultados (no hay motosierras cargadas) |
| `zzzz9999` | sin resultados |
