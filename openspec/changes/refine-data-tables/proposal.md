# Propuesta: refine-data-tables

## Why

PFOS muestra casi todo en tablas, y en el teléfono y en las tablas largas se vuelven difíciles de leer. Al desplazar la vista previa de un import o el cronograma de un préstamo se pierde a qué columna corresponde cada monto: no hay ninguna cabecera fija. Solo la mitad de los envoltorios de tabla son regiones con nombre y foco, así que con el teclado no se pueden desplazar. No hay pista de que hay más columnas a la derecha. Las tablas comparativas no se pueden ordenar. La utilización de una tarjeta y el avance de una meta se anuncian como «barra de progreso». Además, a 360 px el detalle de un préstamo desborda unos 250 px a lo ancho en su sección «Detalle» (`loan-balances`), según encontró el change 77. Nadie midió cuánto tarda la vista previa de un import grande en responder. Es el lote L5 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (M-16, M-17, M-18, M-10, M-30 y M-19), con las condiciones de § 11.1 puntos 7, 8 y 9. El owner adoptó las recomendaciones el 2026-11-25 ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md), D500 y D512), y su medición de INP es la que espera el change 84 (D511).

## What Changes

- **Región común de tabla (M-16):** un componente `TableRegion` reemplaza a los envoltorios `tableWrapStyle` (≈ 84 según docs/78; 69 usos de elemento en `origin/main`, que `frontend` recuenta): `role="region"`, nombre por el `caption` y `tabIndex={0}` en el 100 % de las tablas.
- **Cabecera fija (M-16):** solo en tablas de mucho volumen y solo con un alto máximo propio (`max-block-size: min(32rem, 70dvh)`); un `overflow-x: auto` sin alto no fija nada (§ 11.1 punto 7). `border-collapse: separate` con `border-spacing: 0` y bordes por celda. Columna de identificación fija (fecha o número de cuota) como Could, con `th scope="row"`.
- **Impresión:** `@media print` quita el alto máximo y el desplazamiento propio; hoy no hay ninguna regla de impresión.
- **Sin vista apilada:** `display: block` sobre `table`, `tr` y `td` pierde la semántica de tabla (§ 11.1 punto 7). Las tablas se desplazan a lo ancho dentro de su región.
- **Pista de desplazamiento (M-17, Could):** máscara animada por desplazamiento como mejora progresiva (Newly); sin soporte queda la barra visible.
- **Orden por columna (M-18, Could):** en reportes, presupuesto contra real y costo de suscripciones; montos por su valor Decimal, `aria-sort` solo en la columna activa, un anuncio.
- **Medidas y procesos (M-10, Could):** `<meter>` para la utilización de tarjeta y el avance de metas; `<progress>` para el procesamiento del import.
- **Medición de INP (M-30):** `PerformanceObserver` desde Playwright, sin dependencias, en cuatro flujos con un extracto sintético de 2 000 filas. Informativa: no hace fallar la suite.
- **Vista previa por páginas (M-19, condicionada):** `content-visibility` no actúa sobre `tr`/`tbody` (§ 11.1 punto 8), así que no se usa en filas. Si la medición confirma el problema (INP > 200 ms al abrir o filtrar con 2 000 filas), la vista previa pasa de «Cargar más» acumulativo a páginas de 200 filas. Si no lo confirma, el grupo se omite y la decisión vuelve al owner (pregunta 7 de [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md)).
- **Detalle de préstamo a 360 px:** se corrige el desbordamiento horizontal de ~250 px de la sección «Detalle» (`loan-balances`, `debt/LoanDetail.tsx`) que encontró el change 77.
- **Fuera de alcance:** vista apilada, ventaneo con IntersectionObserver, `content-visibility` en otros bloques (L7), estados de carga con `aria-busy` (deuda transversal), orden en el servidor, transiciones de filtro (M-28, L7) y convertir la medición de INP en gate (docs/78 § 11.1 punto 9: después de 2-3 semanas de datos).

## Capabilities

### New Capabilities

Ninguna. `platform/web-interface` la crea el change 77.

### Modified Capabilities
- `platform/web-interface`: 12 ADDED (1 Must, 7 Should, 4 Could): región con nombre y foco, cabecera fija, columna de identificación fija, impresión, semántica en pantallas angostas, pista de desplazamiento, orden por columna, medidas y procesos, medición de INP, vista previa por páginas, filas sin contención y detalle de préstamo sin desbordamiento.

## Impact

**Specs impactadas:** `platform/web-interface` (12 ADDED). Lee sin modificar: `imports/import-pipeline` (vista previa, decisiones por fila y paginación por cursor del servicio), `reporting/financial-reports`, `planning/budgets`, `debt/credit-cards`, `goals/savings-goals` y `commitments/subscriptions` (las tablas y medidas que se ajustan), más el cronograma de préstamos del change activo `add-loans`.

**Componentes/contextos impactados:** solo `apps/web` (capa interface): `src/ui/common/ui.tsx` (`TableRegion`, `tableStyle` y `cellStyle`), los ≈ 47 archivos que usan `tableWrapStyle`, `src/ui/imports/ReviewStep.tsx` y `PreviewTable.tsx` (cabecera, columna fija y páginas), `src/ui/imports/ProcessingPanel.tsx` (`<progress>`), `src/ui/debt/cards/parts.tsx` y `src/ui/goals/parts.tsx` más `dashboard/GoalsCard.tsx` (`<meter>`), las tablas comparativas de `reports`, `planning` y `subscriptions` (orden), `app/globals.css`, `messages/{es,en,pt}.json` y `tests/e2e` (spec de tablas y spec de INP). Ningún contexto de dominio.

**APIs impactadas:** ninguna. La vista previa ya pagina por cursor con `limit` de 1 a 200; las páginas usan `limit=200` y guardan los cursores en el cliente. `contracts/openapi` no cambia.

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-TABLES-001..023 (23). MODIFICADOS — ninguno. DEPRECADOS — ninguno (TC-PLATFORM-TABLES-019..021 se deprecan solo si la medición no confirma la paginación y el owner decide no paginar).

**Impacto de regresión:** todas las tablas de la UI cambian de envoltorio y de modelo de bordes. Los tests unitarios que buscan `role="progressbar"` (`debt/cards/cards.test.tsx`, `goals/goals.test.tsx`) se actualizan a `meter`. Los specs E2E de import que usan «Cargar más» (`import-load-more`) cambian si se pagina. La suite completa y `a11y.spec.ts` corren en verde antes de fusionar.

**Riesgos introducidos:** sin RISK-id registrado. (1) La medición en el runner compartido es ruidosa: es informativa y se repite en local. (2) `border-collapse: separate` cambia el dibujo de los bordes: se pasa a `border-block-end` por celda y se revisa con capturas. (3) El extracto de 2 000 filas alarga el job `e2e` unos minutos: el spec de INP corre en su propio proyecto de Playwright y puede excluirse del job de PR si supera el margen de 40 minutos.

**Invariantes afectadas:** ninguna. El orden por monto compara Decimal y no cambia ningún valor.
