# Tareas

> Change 81, lote L5 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md); decisiones D500, D511 y D512 en [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md); pregunta 7 de [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md) (no bloquea; solo aplica si la medición no confirma la paginación). **Lo implementa el agente `frontend` (D512).** Depende del change 77 (capability `platform/web-interface`). Gates: los de `CLAUDE.md`, más `pnpm test:e2e` con `PF_E2E_PROJECT=pfos-e2e-<nombre>` y puertos con prefijo 3 o 4 (cambia la UI). Reglas comunes a todas las tareas: claves i18n nuevas en `messages/{es,en,pt}.json` en el mismo commit (`src/i18n.test.ts` en verde); ningún `<style>` ni `<script>` en línea ni dependencia nueva (CSP de `apps/web/proxy.ts`); estilos nuevos como clases en `app/globals.css`; `content-security-policy.spec.ts` y `a11y.spec.ts` en verde; política de navegadores de D500 (`CLAUDE.md`); capturas a 360 × 800 y a 1280 × 800 con `testInfo.outputPath` en cada spec de UI nuevo. El extracto de 2 000 filas es sintético y se genera en el test: ningún dato real.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `platform/web-interface` contra docs/78 § 11.1 (puntos 7, 8 y 9); `openspec validate refine-data-tables --strict`
- [ ] 1.2 Revisar TC-PLATFORM-TABLES-001..022 contra los scenarios y pasarlos a `ready` (019 a 021 siguen en `draft` hasta el resultado de la tarea 6.1)

## 2. DOMAIN

- [ ] 2.1 Sin lógica de dominio: el change es de la capa interface de `apps/web`

## 3. APPLICATION (utilidades de la UI, test-first)

- [ ] 3.1 `src/ui/common/sort.ts` (design, decisión 8): `sortRows(rows, key, direction, kind)` con `kind` `text`, `decimal` (montos como string, comparados con `Money` de `@pf/shared-kernel`) y `date`. Criterio: test unitario con 1234.56, 999.00 y 45.30 BOB que falla si se compara el texto formateado: TC-PLATFORM-TABLES-011
- [ ] 3.2 Test estático `src/ui/common/tables.test.ts` (decisiones 1 y 12): ningún `.tsx` importa `tableWrapStyle`, todo `<table` de datos está dentro de `TableRegion`, y ninguna regla o estilo de `tr`, `tbody` o `thead` declara `content-visibility` o `contain`. Criterio: falla sobre `origin/main` (anotar la cuenta real de envoltorios en esta tarea) y pasa tras 5.2: TC-PLATFORM-TABLES-002, -022
- [ ] 3.3 `tests/e2e/src/inp.ts` (decisión 10): `installInpObserver(page)`, `readInp(page)` e `inpReport(rows)` puro con objetivo 200 ms y aviso 500 ms, que nunca lanza. Criterio: test unitario `tests/e2e/src/inp.test.ts` con un flujo de 650 ms marcado como «por encima del aviso»: TC-PLATFORM-TABLES-018

## 4. INFRASTRUCTURE

- [ ] 4.1 Proyecto `inp` en `tests/e2e/playwright.config.ts` (solo Chromium, `testMatch: inp.spec.ts`). Anotar la duración que suma al job `e2e`; si el job supera 35 minutos, excluir el proyecto del job de PR y dejarlo para corridas locales con `PF_E2E_PROJECT`, con la nota en esta tarea

## 5. UI (`apps/web`)

- [ ] 5.1 `TableRegion({ labelledBy, tall?, children, testId? })` en `src/ui/common/ui.tsx` (decisión 1) y clases `.pf-table-wrap`, `.pf-table-wrap--tall` (con `max-block-size: min(32rem, 70dvh)` y `thead th` fijo con fondo opaco), `.pf-table` con `border-collapse: separate; border-spacing: 0` y bordes por celda (decisiones 2 y 3). Criterio: test de marcado estático (rol, nombre y `tabIndex`)
- [ ] 5.2 Migrar los usos de `tableWrapStyle` a `TableRegion` y borrar `tableWrapStyle`; agregar `caption` con `id` a las tablas que no lo tengan; marcar con `tall` las del inventario de la decisión 2 (anotar el inventario final en esta tarea). Criterio: 3.2 en verde y E2E de 7.1 y 7.2
- [ ] 5.3 Columna de identificación fija (decisión 4, Could): `th scope="row"` y `sticky` en la vista previa del import y el cronograma de préstamo. Criterio: E2E de 7.3
- [ ] 5.4 Impresión (decisión 5): `@media print` al final de `globals.css`. Criterio: E2E de 7.4
- [ ] 5.5 Pista de desplazamiento (decisión 7, Could) con `@supports`, `@property` y `animation-timeline: scroll(self inline)`. Criterio: E2E de 7.5
- [ ] 5.6 Orden por columna (decisión 8, Could): `SortableHeader` en los reportes con tabla, el presupuesto contra real y el costo de suscripciones; `aria-sort` solo en la activa; anuncio único en un `role="status"` con `Tables.sortedBy` en es/en/pt; foco en el botón. Criterio: E2E de 7.6
- [ ] 5.7 Medidas y procesos (decisión 9, Could): `<meter>` en `debt/cards/parts.tsx`, `goals/parts.tsx` y `dashboard/GoalsCard.tsx`; `<progress>` en `imports/ProcessingPanel.tsx`; actualizar `cards.test.tsx` y `goals.test.tsx`. Criterio: tests de marcado y E2E de 7.7

## 6. Vista previa por páginas (condicionado a la medición)

- [ ] 6.1 Medir con `inp.spec.ts` (tarea 7.8) en local, 3 corridas, el INP de «abrir fila» y «filtrar» con las 2 000 filas cargadas con «Cargar más». Anotar la mediana. **Si supera 200 ms:** seguir con 6.2 y 6.3. **Si no:** no paginar, dejar TC-PLATFORM-TABLES-019..021 en `draft`, marcar 6.2 y 6.3 con la nota «la medición no lo confirma» y llevar la pregunta 7 de docs/82 al owner antes de archivar
- [ ] 6.2 Páginas de 200 filas en `imports/ReviewStep.tsx` (decisión 11): pila de cursores, «Anterior» y «Siguiente» en lugar de «Cargar más», texto `Imports.review.position` en es/en/pt, foco en la región de la tabla al cambiar de página y página 1 al cambiar el filtro. Criterio: E2E de 7.9
- [ ] 6.3 Ajustar `import-pipeline.spec.ts` y `csv-import.spec.ts` si usan `import-load-more` (`grep -rn "import-load-more" tests/e2e`). Criterio: suite completa en verde

## 7. AUTOMATED TESTS y E2E (Playwright, Chromium)

Spec nuevo `tests/e2e/specs/data-tables.spec.ts` y spec de medición `tests/e2e/specs/inp.spec.ts`, con el TC-id al inicio de cada `test(...)`:

- [ ] 7.1 Región del cronograma a 360 px (foco con Tab y flecha derecha) y axe a 360 px en Transacciones, Presupuestos, un reporte, el cronograma y la vista previa sin `scrollable-region-focusable` ni otras violaciones `serious` o `critical`: TC-PLATFORM-TABLES-001, -003
- [ ] 7.2 Cabecera fija de la vista previa con 200 filas (posición, alineación con las columnas y fondo opaco) y presupuesto de 6 líneas sin desplazamiento propio, con capturas a 360 y 1280 px: TC-PLATFORM-TABLES-004, -005
- [ ] 7.3 Columna de fecha fija y `th scope="row"` en la vista previa a 360 px: TC-PLATFORM-TABLES-006
- [ ] 7.4 Impresión del cronograma de 36 cuotas con `page.emulateMedia({ media: 'print' })` y `page.pdf()`: TC-PLATFORM-TABLES-007
- [ ] 7.5 Semántica de tabla a 360 px en Transacciones (árbol de accesibilidad y `scrollWidth` de la página) y pista de desplazamiento al inicio y al final del cronograma: TC-PLATFORM-TABLES-008, -009, -010
- [ ] 7.6 Orden del reporte de gastos por categoría por Monto (valor, `aria-sort`, anuncio único en es/en/pt) y con Enter en Categoría: TC-PLATFORM-TABLES-011, -012, -013
- [ ] 7.7 `meter` de la tarjeta (850.00 de 1000.00 BOB) y de la meta (5000.00 de 15000.00 BOB) y `progress` del procesamiento del import: TC-PLATFORM-TABLES-014, -015, -016
- [ ] 7.8 Medición de INP de los cuatro flujos con el extracto sintético de 2 000 filas; informe adjunto con `testInfo.attach`; anotar en la tarea los valores de la primera corrida en CI y de las 3 locales, y el resultado de la comprobación con y sin `content-visibility` en `tbody` (decisión 12): TC-PLATFORM-TABLES-017
- [ ] 7.9 Si 6.1 confirma: páginas de la vista previa con 450 filas, decisión conservada en la fila 10 y filtro que vuelve a la página 1: TC-PLATFORM-TABLES-019, -020, -021
- [ ] 7.10 Suite E2E completa en verde dos veces con `PF_E2E_PROJECT=pfos-e2e-<nombre>`; actualizar el front matter de los TC automatizados (`automated_tests`, `status: automated`, `automation_status: automated`)

## 8. DOCUMENTATION

- [ ] 8.1 docs/28 §11 al as-built: sin «tablas → listas de tarjetas en móvil» (las tablas se desplazan en su región), cabecera fija en tablas largas, orden por columna y medidas con `<meter>`
- [ ] 8.2 docs/78 § 11.3: anotar el resultado de la medición de INP y del supuesto de `content-visibility` en filas; docs/03 §7 filas 83 y 84 con el resultado de M-30 (lo esperan por D511)
- [ ] 8.3 `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; docs/38 y la fila 81 de docs/03 §7 con el estado del change
