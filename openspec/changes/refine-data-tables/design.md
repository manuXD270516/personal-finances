# Diseño

## Contexto

Lote L5 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (change 81 de docs/03 §7). Reúne M-16, M-17, M-18, M-10, M-30 y M-19 con las condiciones de docs/78 § 11.1 (puntos 7, 8 y 9) y § 11.3 (supuesto de `content-visibility` en filas). Decisiones del owner ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md)): D500 (política de navegadores), D511 (el change 84 espera esta medición de INP) y D512 (lo implementa el agente `frontend`).

As-built: `tableWrapStyle` (`src/ui/common/ui.tsx:53-61`, `overflowX: 'auto'`) envuelve las tablas en 47 archivos (69 usos de elemento en `origin/main`; docs/78 contó 84 envoltorios). Solo una parte lleva `role="region"` y `tabIndex={0}` (47 apariciones de `role="region"` en todo `src`; la vista previa del import sí, `PreviewTable.tsx:132`). `tableStyle` usa `borderCollapse: 'collapse'` y `cellStyle` el borde. `thead th` ya tiene fondo (`globals.css`). No hay `@media print` ni `content-visibility` en `apps/web`. La utilización de tarjeta y el avance de metas usan `div role="progressbar"` (`debt/cards/parts.tsx:88`, `goals/parts.tsx`, `dashboard/GoalsCard.tsx:52`). La vista previa del import (`imports/ReviewStep.tsx`) pide páginas por cursor (`limit` por omisión 50, máximo 200 según el contrato) y las **acumula** con «Cargar más» (`import-load-more`), así que con un extracto grande todo queda en el DOM.

Depende del change 77 (capability). Es independiente de 78, 79 y 80; puede ir en paralelo con 78 y 79 (docs/03 §7). Si el change 79 (tema) ya está, la cabecera fija usa sus tokens; si no, los actuales.

Capa afectada: solo **interface** de `apps/web`. Sin contextos, agregados, puertos, tablas, eventos ni contratos.

## Objetivos / No objetivos

**Objetivos**
- El 100 % de las tablas en una región con nombre y foco.
- Cabecera visible en las tablas largas, sin perder la impresión ni la semántica.
- Montos comparables por orden de valor.
- Una medición de INP repetible que decida la paginación y alimente el change 84.

**No objetivos**
- Vista apilada por container queries (§ 11.1 punto 7).
- Ventaneo con IntersectionObserver (§ 11.1 punto 8: L, no recomendado).
- `content-visibility` en bloques que no son filas (L7).
- Reemplazar los 70 `aria-busy` en elementos genéricos (deuda transversal; docs/78 M-10 lo menciona, docs/03 §7 no lo incluye en L5).
- Orden de las tablas en el servidor: se ordena lo que ya está en pantalla.
- Hacer de la medición de INP un gate.

## Decisiones

1. **`TableRegion` en `src/ui/common/ui.tsx`.** Firma: `TableRegion({ labelledBy, tall?, children, testId? })`. Dibuja `<div role="region" aria-labelledby={labelledBy} tabIndex={0} className="pf-table-wrap">` y, con `tall`, `pf-table-wrap--tall`. `labelledBy` es obligatorio y apunta al `id` del `<caption>` (las tablas ya tienen 115 `caption`; las que no lo tengan ganan uno, visible u oculto con `.pf-visually-hidden`). `tabIndex={0}` va siempre: axe (`scrollable-region-focusable`) exige el foco solo cuando hay desbordamiento, pero calcularlo en cliente agrega un `ResizeObserver` por tabla sin beneficio claro. Los 69 usos de `tableWrapStyle` pasan a `TableRegion` y `tableWrapStyle` se borra. Un test estático (TC-PLATFORM-TABLES-002, `src/ui/common/tables.test.ts`) falla si un `.tsx` importa `tableWrapStyle` o si un `<table` no está dentro de `TableRegion` en el mismo archivo (comprobación por texto, suficiente para este repositorio; las excepciones se listan en el test con su motivo).

2. **Cabecera fija solo con alto máximo propio (§ 11.1 punto 7).** `position: sticky` sobre `thead th` solo funciona si el contenedor que desplaza tiene alto limitado: un `overflow-x: auto` sin alto computa `overflow-y: auto` y la cabecera se pega a un contenedor que no se desplaza. Por eso:

   ```css
   .pf-table-wrap { overflow-x: auto; }
   .pf-table-wrap--tall { max-block-size: min(32rem, 70dvh); overflow: auto; overscroll-behavior-inline: contain; }
   .pf-table-wrap--tall thead th { position: sticky; inset-block-start: 0; z-index: 1; background: var(--pf-surface-raised); }
   ```

   Tablas con `tall` (inventario de partida; `frontend` lo confirma y anota): vista previa del import (`PreviewTable.tsx`), cronograma de préstamo (`debt/`), cargos y estados de cuenta de tarjeta (`debt/cards/`), historial de auditoría (`AuditHistory.tsx`, `audit/`) y cronograma de metas. Las tablas cortas (presupuesto, plantillas, reportes) no llevan `tall`.

3. **`border-collapse: separate`.** `tableStyle` pasa a `borderCollapse: 'separate', borderSpacing: 0` y `cellStyle` dibuja la línea con `borderBlockEnd` por celda (hoy colapsada). Con `collapse`, el borde de una celda fija se pierde al desplazar en Chromium. Se mueve a clases (`.pf-table`, `.pf-table th`, `.pf-table td`) en `globals.css` en lugar de `style={{…}}`, como pide la deuda transversal de docs/78 § 8.

4. **Columna de identificación fija (Could).** Solo en la vista previa del import (fecha) y el cronograma de préstamo (número de cuota): la primera celda de cada fila pasa a `<th scope="row">` y lleva `position: sticky; inset-inline-start: 0; z-index: 1` con fondo opaco; la celda de la esquina (`thead th:first-child`) lleva `z-index: 2`. Las demás tablas no tienen encabezado de fila y no se tocan (§ 11.1 punto 7).

5. **Impresión.** Hoy no hay ninguna regla. Al final de `globals.css`:

   ```css
   @media print {
     .pf-table-wrap, .pf-table-wrap--tall { max-block-size: none; overflow: visible; }
     .pf-table-wrap--tall thead th, .pf-table th[scope='row'] { position: static; }
     thead { display: table-header-group; }
     tr { break-inside: avoid; }
   }
   ```

   La barra inferior, la lateral y la superior se ocultan en impresión si el change 80 ya está (`.pf-bottombar`, `.pf-sidebar`, `.pf-topbar { display: none }`); si no, se ocultan las que existan.

6. **Sin vista apilada.** `display: block` sobre `table`, `tr` y `td` hace que Chromium y Safari quiten los roles de tabla. Se descarta (§ 11.1 punto 7). En pantallas angostas la tabla se desplaza a lo ancho dentro de su región. Esto corrige docs/28 §11, que decía «Tablas → listas de tarjetas en móvil» (tarea 8.1). La excepción de reflujo de WCAG 1.4.10 cubre las tablas de datos con desplazamiento propio.

7. **Pista de desplazamiento (M-17, Could).** Mejora progresiva con una animación ligada al desplazamiento de la región (Newly 2026-10-27), dentro de `@supports (animation-timeline: scroll())`: una máscara `mask-image: linear-gradient(to right, black calc(100% - var(--pf-hint)), transparent)` cuyo `--pf-hint` (registrado con `@property` como `<length>`) va de `2rem` a `0rem` a medida que la región llega al final (`animation-timeline: scroll(self inline)`). Al llegar a la última columna la máscara deja de recortar. La máscara solo cambia la opacidad, no mueve nada, así que vale también con movimiento reducido. Sin soporte de la animación no hay pista y queda la barra de desplazamiento visible (no se oculta ni se personaliza). Las sombras con scroll-state queries son Limited: no se usan. Si el change 79 ya agregó el test de colores literales, la máscara usa la palabra clave `black` y `transparent`, que no son literales hexadecimales ni `rgb()`.

8. **Orden por columna (M-18, Could).** Utilidad pura `src/ui/common/sort.ts`: `sortRows(rows, key, direction, kind)` con `kind ∈ {'text', 'decimal', 'date'}`. Los montos se comparan como decimales exactos con las utilidades de `@pf/shared-kernel` que ya usa `src/ui/common/money.ts` (`Money`), a partir del string de la API, nunca con `Number` ni con el texto formateado. Componente `SortableHeader` (botón dentro de `th`, `aria-sort` solo en la columna activa, ícono con `aria-hidden`). El anuncio va a un `role="status"` propio de la tabla (no a la región de avisos del change 78, que es para resultados de acciones), una vez por cambio, con la clave `Tables.sortedBy` («Ordenado por {column}, {direction}», es/en/pt). Se reordenan las filas existentes; no se vuelve a pedir nada a la API. Tablas: los reportes con tabla (`reports/ReportParts.tsx`), presupuesto contra real (`planning/BudgetLinesTable.tsx`) y costo de suscripciones (`subscriptions/`). El orden inicial es el de hoy.

9. **Medidas y procesos (M-10, Could).** `<meter min={0} max={100} value={pct}>` para la utilización de tarjeta y el avance de metas, con `aria-label` actual y el texto visible que ya existe. `low`, `high` y `optimum` reflejan los umbrales de utilización de 30 % y 80 % (change 32 `add-credit-cards`); el color del navegador es solo refuerzo, el texto e ícono siguen. En el procesamiento del import, `<progress>` con `value`/`max` si el servicio informa filas procesadas, o indeterminado si no. `parts.tsx` conserva el `div` visual si hace falta para el estilo, pero el rol lo da el elemento nativo. Se actualizan `debt/cards/cards.test.tsx` y `goals/goals.test.tsx`.

10. **Medición de INP (M-30, § 11.1 punto 9).** Sin dependencias y sin tocar la CSP: el observador corre desde Playwright.
    - `tests/e2e/src/inp.ts`: `installInpObserver(page)` con `page.addInitScript` que registra `PerformanceObserver({ type: 'event', durationThreshold: 16, buffered: true })`, agrupa por `interactionId` y guarda el máximo por interacción en `window.__pfInp`; `readInp(page)` devuelve el máximo (con ≤ 50 interacciones, el percentil 98 es el máximo). `inpReport(rows)` es una función pura que arma la tabla con objetivo 200 ms y aviso 500 ms y nunca lanza (TC-PLATFORM-TABLES-018, test unitario en `tests/e2e/src/inp.test.ts`).
    - `tests/e2e/specs/inp.spec.ts`: genera en memoria un CSV sintético de 2 000 filas (fechas, descripciones y montos ficticios con escala 2 en BOB), lo importa y mide cuatro flujos: abrir una fila de la vista previa, filtrar, aprobar y una edición masiva de transacciones. Adjunta el informe con `testInfo.attach('inp', { body: JSON, contentType: 'application/json' })` y lo imprime. Solo Chromium (Event Timing no es fiable en otros motores en CI).
    - Proyecto propio `inp` en `playwright.config.ts`, para poder excluirlo del job de PR si alarga demasiado el job `e2e` (límite de 40 minutos); en ese caso corre a mano con `PF_E2E_PROJECT` y se anota en la tarea.

11. **Vista previa por páginas (M-19), condicionada a la medición.** Criterio: si el INP de «abrir fila» o «filtrar» con 2 000 filas cargadas supera 200 ms en la mediana de 3 corridas locales (no en CI), se pagina; si no, el grupo 6 se omite, TC-PLATFORM-TABLES-019..021 quedan en `draft` y se pregunta al owner (pregunta 7 de [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md)) si se pagina igual o se retira el requirement antes de archivar. Diseño si se pagina:
    - `limit=200` (el máximo del contrato): 10 páginas para 2 000 filas.
    - El cliente guarda la pila de cursores (`[undefined, c1, c2, …]`) para «Anterior» y «Siguiente»; «Cargar más» desaparece.
    - Texto de posición con `Imports.review.position` («Filas {from}–{to} de {total}», es/en/pt), con `total` de `summary.counts.rows` (o del conteo del filtro si existe).
    - Al cambiar de página, el foco va a la región de la tabla (`TableRegion` tiene `tabIndex={0}`) y se desplaza a su inicio.
    - Cambiar el filtro reinicia la pila de cursores (página 1).
    - Las decisiones por fila ya se guardan en el servidor con cada acción (`ReviewStep.tsx`); al volver a una página se releen. No hay estado local que perder.

12. **Sin `content-visibility` en filas (§ 11.1 punto 8).** La contención de tamaño y de diseño no se aplica a `display: table-row` ni a `table-row-group`, así que `content-visibility: auto` sobre `tr` o `tbody` se ignora. Un test estático (`tables.test.ts`, TC-PLATFORM-TABLES-022) falla si una regla con selector de `tr`, `tbody` o `thead` o un `style` de esos elementos declara `content-visibility` o `contain`. El supuesto de especificación se confirma de paso con la medición de la decisión 10 (con y sin la regla, una sola corrida local), y el resultado se anota en la tarea 7.6.

13. **Detalle de préstamo sin desbordamiento (hallazgo del change 77).** A 360 px, `debt/LoanDetail.tsx` (`LoanBalances`, `data-testid="loan-balances"`) desborda ~250 px a lo ancho. `frontend` diagnostica la causa con el inspector antes de corregir (candidatos: un `dd` con montos largos que no se parten, un hijo de `grid` o `flex` sin `min-inline-size: 0`, o un `white-space: nowrap` heredado) y la anota en la tarea 5.8. La corrección mueve los estilos en línea de la sección a clases en `globals.css`, conserva `nowrap` solo dentro de cada monto (no en el rótulo ni en el contenedor) y no reduce el tamaño de letra. Se prueba con `document.documentElement.scrollWidth ≤ 360` y una captura (TC-PLATFORM-TABLES-023).

14. **i18n y CSP.** Claves nuevas (`Tables.*`, `Imports.review.position`, `Imports.review.previous`, `Imports.review.next`) en es, en y pt; los `caption` nuevos también. Probadas a 360 px. Sin `<style>` ni `<script>` en línea, sin dependencias nuevas.

## Riesgos / Trade-offs

- **69 envoltorios a migrar.** Cambio mecánico por archivo; el test estático asegura que no quede ninguno.
- **Bordes al pasar a `separate`.** Pueden verse dobles o faltar. Mitigación: bordes por celda y capturas a 360 y 1280 px de una tabla de cada dominio.
- **Ruido de la medición en CI.** Es informativa; la decisión de paginar se toma con la mediana local.
- **Paginación y specs E2E.** `import-load-more` desaparece si se pagina; `import-pipeline.spec.ts` y `csv-import.spec.ts` se revisan.
- **Orden por Decimal en el cliente.** Los montos llegan como string; se parsean con la misma utilidad de la web, sin `Number`.

## Plan de migración

Sin migraciones de datos ni de contratos. Vuelta atrás: revertir el PR. Se puede partir en tres PR dentro de la rama del change: (1) `TableRegion`, bordes, cabecera fija, impresión y test estático; (2) medición de INP y, según el resultado, páginas de la vista previa; (3) pista, orden y medidas (Could).

## Preguntas abiertas

En [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md):

7. Si la medición no confirma el problema, ¿se pagina igual la vista previa del import o se retira el requirement? No bloquea: el grupo 6 depende de la medición, no del owner, salvo en ese caso.
