# Propuesta: refine-perceived-performance

## Why

La interfaz responde a tiempo, pero no siempre lo parece ni lo comunica: los cambios de pestaña y de filtro reemplazan el contenido de golpe, cinco pantallas siguen consultando el servidor con la pestaña oculta, varias explicaciones viven solo en el atributo `title` (inaccesibles en el teléfono y con el teclado), los títulos largos en español cortan con una palabra huérfana, el diseño ignora el tamaño de texto del sistema y los motivos largos se editan en una caja chica. Es el lote L7 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (M-28, M-31, M-09, M-23, M-24 y M-05), que dependía del resultado de M-30. Ese resultado llegó con el change 81: con 2 000 filas, las medianas locales de abrir fila (200 ms), filtrar (136 ms), aprobar (72 ms) y la edición masiva (30 ms) no superan los 200 ms de NFR-PERF-004. Por eso el lote no incluye trabajo de rendimiento en el hilo principal y sí una salvaguarda para no empeorarlo. M-29 queda condicionado al change 84 (D511).

## What Changes

- **Transiciones en el mismo documento (M-28):** cambio de pestaña y filtros de listas con `document.startViewTransition()` (Newly 2025-10-14) detectando soporte y solo con `prefers-reduced-motion: no-preference`; sin soporte, cambio instantáneo. El foco no se mueve.
- **No regresión de la respuesta:** la medición de INP del change 81 se repite con las transiciones activas; una vista cuya mediana pase de 200 ms queda sin transición.
- **Consultas en pausa (M-31):** ayudante común que no consulta con la pestaña oculta y reanuda al volver, en las cinco pantallas que hoy siguen consultando; `priority: 'low'` (Newly, se ignora sin soporte) en los contadores de fondo.
- **Explicaciones accesibles (M-09):** componente `InfoTip` (botón con `popover`, Newly 2025-01-27); sin soporte, el texto queda visible. Inventario de los 74 `title=` con un test estático que solo admite excepciones marcadas. Valor exacto de los puntos del gráfico en la tabla alternativa.
- **Legibilidad (M-23):** `text-wrap: balance` en títulos, `pretty` en párrafos (Limited, sin soporte no cambia) y ayuda a ≤ 70ch.
- **Tamaño de texto del sistema (M-24):** breakpoints en em; `nowrap` solo en montos, fechas y códigos.
- **Campos que crecen (M-05):** `field-sizing: content` (Newly 2026-06-16) dentro de `@supports`, con alto mínimo y máximo.
- **Medición con procesador lento:** filas informativas con la CPU ralentizada ×4 (pregunta 4 de [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md)).
- **M-29 condicionado:** `@view-transition { navigation: auto }` solo si se mantiene la navegación por documento (preguntas 5 y 6 de docs/85); si no, el requirement se retira antes de archivar.
- **Fuera de alcance:** ceder el hilo o mover cálculo al servidor (no hay incumplimiento medido), paginar la vista previa del import (descartado en el 81), navegación del cliente (84), speculation rules (M-32), `popover="hint"`, interest invokers, anchor positioning, `<meta name="text-scale">` y volver la medición un gate de CI.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities
- `platform/web-interface`: 10 ADDED (2 Should, 8 Could): transición al cambiar de pestaña o de filtro, respuesta sin empeorar, consultas en pausa, prioridad baja en consultas de fondo, explicaciones accesibles, títulos y párrafos legibles, tamaño de texto del sistema, campos que crecen, medición con procesador lento y transición entre secciones por documento (condicionada).

## Impact

**Specs impactadas:** `platform/web-interface` (10 ADDED). Lee sin modificar: `imports/import-pipeline` (vista previa y persistencia), `notifications/alerts` (contador de no leídas), la pantalla de Pronósticos (changes 64 y 65, aún sin archivar), `reporting/financial-reports` (tabla alternativa de los gráficos).

**Componentes/contextos impactados:** solo `apps/web` (capa interface): `app/globals.css` (transiciones, legibilidad, breakpoints, `field-sizing`), `src/ui/common/motion.ts`, `polling.ts` e `InfoTip` (nuevos), el componente común de pestañas, los filtros de listas, `imports/ImportWizard.tsx`, `imports/ConnectionsPage.tsx`, `forecasts/ForecastsPage.tsx`, `DemoDataPanel.tsx`, `portability/PortabilityPanels.tsx`, `notifications/`, `recurring/RecurringNavCount.tsx`, los archivos con `title=`, `reports/ReportChart.tsx`, `messages/{es,en,pt}.json` y `tests/e2e` (`inp.spec.ts`, spec nuevo). Ningún contexto de dominio.

**APIs impactadas:** ninguna (`contracts/openapi` no cambia).

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-PERCEIVED-001..024 (24). MODIFICADOS — ninguno (TC-PLATFORM-TABLES-018, informe de INP, sigue igual; el informe gana columnas). DEPRECADOS — ninguno.

**Impacto de regresión:** medio y repartido: breakpoints en em, `title` reemplazados y consultas migradas al ayudante tocan muchas pantallas. Mitigación: capturas a 360 y 1280 px, axe sin violaciones serias, specs existentes de import, pronósticos, notificaciones y demostración en verde, y la medición de INP antes y después.

**Riesgos introducidos:** sin RISK-id registrado. Costo de las transiciones en tablas grandes (mitigado por la decisión 2 del design) y cortes de diseño distintos con tamaños de texto no estándar (es el objetivo de M-24).

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX ni periodos).
