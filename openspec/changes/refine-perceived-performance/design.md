# Diseño: refine-perceived-performance

## Contexto

Lote L7 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (change 83 de docs/03 §7): M-28, M-31, M-09, M-23, M-24 y M-05, más M-29 condicionado. Decisiones del owner en [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md): D500 (política de navegadores), D511 (M-29 no se construye mientras no se resuelva el change 84) y D512 (lo implementa el agente `frontend`). Preguntas nuevas en [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md) (4 a 6).

**Resultado de M-30 (change 81, archivado).** Medición local en Chromium con 2 000 filas cargadas en la vista previa del import, mediana de 3 corridas: abrir fila 200 ms (192 / 200 / 208), filtrar 136 ms (120 / 136 / 144), aprobar ≈ 72 ms y edición masiva ≈ 30 ms. Ninguna mediana supera 200 ms, el objetivo de NFR-PERF-004. Consecuencias para este lote:

- **No hace falta trabajo de rendimiento en el hilo principal** (ceder con `scheduler.yield()`, mover cálculo al servidor): ningún flujo medido incumple. El lote queda en rendimiento **percibido** (transiciones, legibilidad, red en segundo plano).
- **«Abrir fila» está justo en el objetivo** (una de tres corridas en 208 ms) y se midió en un escritorio. Una transición mal ubicada o un teléfono modesto lo pasan del límite. Por eso el lote agrega dos salvaguardas: una regla de no regresión para las transiciones (decisión 2) y la medición con el procesador ralentizado (decisión 9, pregunta 4 de docs/85).
- La medición de L5 no cubrió **la navegación entre secciones**, que es lo que mejoraría el change 84. Ver la pregunta 5 de docs/85.

Estado relevante de `origin/main` (2026-11-27):

- Medición de INP en `tests/e2e/src/inp.ts` y `tests/e2e/specs/inp.spec.ts`, proyecto `inp` de Playwright fuera del job de PR (se corre a mano con `PF_E2E_PROJECT`).
- Consultas periódicas: `imports/ImportWizard.tsx` (persistencia, `setTimeout` encadenado con `If-None-Match`), `imports/ConnectionsPage.tsx` (`setInterval`), `forecasts/ForecastsPage.tsx` (bucle con espera), `DemoDataPanel.tsx` y `portability/PortabilityPanels.tsx` (`setTimeout` encadenado). Ya pausan con la pestaña oculta: `notifications/logic.ts` (`createUnreadPoller`) y `recurring/RecurringNavCount.tsx`.
- 74 atributos `title=` en componentes TSX; los casos de docs/78 M-09: `transactions/TransactionsListView.tsx` (marca «conciliada sin extracto»), `accounts/CatalogView.tsx`, `fx/FxRatesPage.tsx` y `reports/ReportChart.tsx` (`<title>` por punto del gráfico).
- Pestañas en una fila desde el change 77; `ConfirmDialog` sobre `<dialog>`; movimiento reducido declarado por componente (requirement «Movimiento reducido declarado por componente»).
- Breakpoints en px en `app/globals.css` y 19 `white-space: nowrap`. Campos `textarea` con alto fijo (`globals.css`, regla de `textarea`).

## Objetivos / No objetivos

**Objetivos**

- Que los cambios de pestaña y de filtro se lean como continuidad y no como un salto, sin empeorar la respuesta medida.
- Que la app no gaste batería ni datos con la pestaña oculta.
- Que ninguna explicación dependa del puntero (teléfono y teclado).
- Texto más legible en español y respeto del tamaño de texto del sistema.

**No objetivos**

- Optimizar el hilo principal o cambiar la vista previa del import (no hay incumplimiento medido; ver pregunta 4).
- Navegación del cliente (change 84) y speculation rules (M-32, descartado en docs/78).
- `popover="hint"`, interest invokers y anchor positioning (Limited; docs/78 M-09).
- `<meta name="text-scale">` (Limited; docs/78 M-24).
- Volver la medición de INP un gate de CI.

## Decisiones

1. **Transiciones en el mismo documento (M-28).** Un ayudante `withViewTransition(update)` en `src/ui/common/motion.ts`: si `document.startViewTransition` existe y `matchMedia('(prefers-reduced-motion: no-preference)').matches`, envuelve la actualización (con `flushSync` de React dentro del callback para que el DOM nuevo exista al capturar); si no, la ejecuta tal cual. Se usa en el componente común de pestañas y en los filtros de las listas y tablas. La animación es la de fundido por defecto, con `::view-transition-group(*) { animation-duration: 200ms }` dentro de `@media (prefers-reduced-motion: no-preference)` en `globals.css`; sin `view-transition-name` por elemento (evita el error de nombres duplicados de la guía y el costo de capturar muchos elementos). Foco: la guía pide reubicarlo tras la transición cuando aparece contenido nuevo; aquí el foco ya está en la pestaña o el filtro que el usuario usó y **no se mueve**. Durante la transición la página sigue usable (la captura no bloquea la entrada más allá de la actualización).
2. **No regresión de la respuesta (NFR-PERF-004).** `inp.spec.ts` mide los cuatro flujos con las transiciones activas (el contexto de Playwright con `reducedMotion: 'no-preference'`). Si la mediana de 3 corridas locales de un flujo supera 200 ms, esa vista se excluye del ayudante (lista explícita en `motion.ts`) y se anota en la tarea. Expectativa: la vista previa del import con 2 000 filas es la candidata a quedar fuera, porque capturar su tabla es caro; se decide con la medición, no de antemano.
3. **Pausa de consultas (M-31).** Un ayudante común `createVisiblePoller({ intervalMs, run, doc })` en `src/ui/common/polling.ts`, que generaliza `createUnreadPoller`: no consulta con `document.hidden`, reanuda con una consulta inmediata en `visibilitychange` y no arranca si la página nace oculta (guía `detect-initial-visibility-state`: `document.visibilityState` al montar es Widely; las entradas de rendimiento de visibilidad son Limited y no se usan). Migran las cinco pantallas del inventario. Los ya resueltos (`createUnreadPoller`, `RecurringNavCount`) pasan al ayudante solo si el cambio es trivial; si no, se quedan.
4. **Prioridad baja en consultas de fondo (M-31).** El cliente del BFF (`src/bff/finance-api-client.ts` o el `fetch` de la UI que use cada contador) acepta una opción `background: true` que agrega `priority: 'low'` a `fetch` (Newly 2024-10-29; se ignora sin soporte, sin detección). La usan solo el contador de notificaciones sin leer y los contadores de la barra (`RecurringNavCount`). Las consultas de avance de una tarea que el usuario espera (decisión 3) mantienen la prioridad normal. Verificación en Chromium con una sesión CDP (`Network.requestWillBeSent`, campo `request.initialPriority` = `Low`).
5. **Explicaciones accesibles (M-09).** Componente `InfoTip` en `src/ui/common/`: un `<button type="button">` con nombre accesible («Más información sobre …», i18n) y `popovertarget` hacia un elemento con `popover` (Newly 2025-01-27; tipos en `@types/react` 19.3.0). Abrir y cerrar con clic, toque, Enter, Espacio y Escape es nativo del popover; al cerrar con Escape el foco vuelve al botón (nativo). El contenido va en el DOM, así que lo leen los lectores de pantalla. **Sin soporte**, el navegador ignora el atributo `popover` y el texto queda visible junto al botón: eso cumple D500 (la tarea se completa). Por eso el CSS no oculta el contenido fuera de `:popover-open`. Inventario: los 74 `title=` se clasifican en (a) explicación que pasa a texto visible o a `InfoTip`, (b) redundante con el texto visible (se borra) y (c) excepción justificada (por ejemplo, el nombre completo de un elemento truncado que también está en el DOM), marcada con el comentario `title-ok:`. Un test estático falla con un `title=` sin la marca. Gráficos: el `<title>` por punto se conserva como ayuda del puntero, pero el valor exacto debe estar en la tabla alternativa (NFR-USAB-105); se verifica con el reporte de gastos.
6. **Legibilidad (M-23).** En `globals.css`: `h1, h2, h3 { text-wrap: balance }` (Newly 2024-05-13) y `p, li { text-wrap: pretty }` (Limited; sin soporte no cambia nada), y `max-inline-size: 70ch` en la clase de los textos de ayuda (`.pf-help` o la que use el as-built; se unifica en la tarea).
7. **Tamaño de texto del sistema (M-24).** Los breakpoints de `globals.css` pasan de px a em (base 16 px: 640 px → 40em, etc.); los `white-space: nowrap` de bloques de texto se quitan y se conservan en montos, fechas y códigos. Coordinación con el change 80 (L4, bloqueado): si 80 se implementa antes, sus breakpoints nuevos también se convierten aquí; si se implementa después, la tarea de este change deja una nota en el design del 80 para que los escriba en em. La prueba de 200 % no inyecta estilos (la CSP bloquea `page.addStyleTag` con estilos en línea): usa `Page.setFontSizes` de CDP con la fuente estándar en 32 px, que imita el ajuste de tamaño de texto del navegador. Las media queries en em se resuelven contra ese tamaño inicial, que es justo lo que se quiere; el zoom de página o el factor de escala del dispositivo no sirven porque escalan todo.
8. **Campos que crecen (M-05).** `@supports (field-sizing: content) { textarea { field-sizing: content; min-block-size: 3lh; max-block-size: 12lh } }` (Newly 2026-06-16; `lh` es Widely). Sin soporte, la regla actual de alto fijo y `overflow: auto` no cambia. Test estático: la regla está dentro del `@supports` y la regla de base no cambió.
9. **Medición con procesador lento (pregunta 4 de docs/85, recomendación A).** `inp.spec.ts` repite los cuatro flujos con `Emulation.setCPUThrottlingRate({ rate: 4 })` de CDP (solo Chromium) y agrega una columna al informe. Informativa: nunca falla. Si el owner elige otra opción, el requirement «Medición de la respuesta con un procesador lento» se retira del delta antes de archivar o se transforma según la respuesta.
10. **Transición entre documentos (M-29), condicionada.** D511 la deja fuera mientras no se resuelva el change 84. Si la resolución mantiene la navegación por documento (pregunta 5 de docs/85, opción A, u opción B con la medición del 84 dentro del objetivo), se agrega en `globals.css` `@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; } }` (Limited: en navegadores sin soporte no pasa nada; sin script, sin cambio de CSP). Si el 84 migra a navegación del cliente, el requirement «Transición entre secciones por documento» se retira del delta antes de archivar, sus TC (023 y 024) pasan a `deprecated` y la regla no se escribe (quedaría inerte). El grupo 6 de tareas espera esa respuesta; el resto del change no.

## Riesgos / Trade-offs

- **Transiciones y respuesta.** `startViewTransition` captura la página antes y después; en una tabla grande puede costar más que el propio filtro. Mitigación: decisión 2, con medición y exclusión por vista.
- **`flushSync` en React.** Forzar el render síncrono dentro del callback puede advertir en desarrollo si se llama durante un render. Se llama solo desde manejadores de eventos.
- **Inventario de `title`.** 74 apariciones; clasificarlas toca muchos archivos. Mitigación: el test estático con marca permite avanzar por dominio y deja visibles las excepciones.
- **Breakpoints en em.** Cambia el punto exacto de corte si el usuario tiene un tamaño de texto distinto de 16 px (es lo buscado), y puede mover capturas de E2E existentes a 360 y 1280 px (no deberían: con 16 px, 40em = 640 px).
- **Pruebas sin soporte.** Chromium soporta todo lo que se usa; «sin soporte» se emula borrando la API con `addInitScript` (transiciones) o se verifica con el marcado y el CSS (popover, `field-sizing`). El proyecto WebKit del job `e2e` agrega `web-interface.spec.ts` si el subconjunto lo permite (sin alargar el job más de 2 minutos).

## Plan de migración

Sin migraciones de datos ni de contratos. Vuelta atrás: revertir el PR. Se puede partir en tres PR dentro de la rama: (1) consultas en pausa, prioridad baja, legibilidad, breakpoints y campos que crecen; (2) `InfoTip` e inventario de `title`; (3) transiciones con la medición (y M-29 si la pregunta 5 lo habilita).

## Preguntas abiertas

En [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md):

4. **Margen de «abrir fila» y medición con procesador lento** (no bloquea; recomendación A).
5. **¿Se hace el change 84?** Bloquea solo el grupo 6 de este change (M-29).
6. **M-29 si se mantiene la navegación por documento** (no bloquea; depende de la 5).
