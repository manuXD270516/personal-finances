# Tareas

> Change 83, lote L7 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md); decisiones D500, D511 y D512 en [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md); preguntas en [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md) (**la 5 bloquea solo el grupo 6**; la 4 y la 6 no bloquean). **Lo implementa el agente `frontend` (D512).** Depende del change 81 (medición de INP, archivado). Gates: los de `CLAUDE.md`, más `pnpm test:e2e` con `PF_E2E_PROJECT=pfos-e2e-<nombre>` y puertos con prefijo 3 o 4 (cambia la UI). Reglas comunes: claves i18n nuevas en `messages/{es,en,pt}.json` en el mismo commit (`src/i18n.test.ts` en verde); ningún `<style>` ni `<script>` en línea ni dependencia nueva (CSP de `apps/web/proxy.ts`); política de navegadores de D500 (Newly solo como mejora progresiva, sin polyfills); `content-security-policy.spec.ts` y `a11y.spec.ts` en verde; capturas a 360 × 800 y a 1280 × 800 con `testInfo.outputPath` en cada spec de UI nuevo.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `platform/web-interface` contra D500 y D511, el resultado de M-30 del change 81 y docs/78 § 5.6–5.7; `openspec validate refine-perceived-performance --strict`
- [ ] 1.2 Revisar TC-PLATFORM-PERCEIVED-001..024 contra los scenarios y pasarlos a `ready` (023 y 024 quedan en `draft` hasta la pregunta 5)

## 2. DOMAIN

- [ ] 2.1 Sin lógica de dominio: el change es de la capa interface de `apps/web`

## 3. APPLICATION (utilidades de la UI, test-first)

- [ ] 3.1 `src/ui/common/motion.ts`: `withViewTransition(update, view)` con detección de soporte, de `prefers-reduced-motion` y la lista de vistas excluidas (design, decisiones 1 y 2). Criterio: test unitario con `document` y `matchMedia` simulados (con soporte, sin soporte, movimiento reducido, vista excluida): TC-PLATFORM-PERCEIVED-001..003 (parte unitaria)
- [ ] 3.2 `src/ui/common/polling.ts`: `createVisiblePoller({ intervalMs, run, doc })` (decisión 3): sin consulta con `doc.hidden`, consulta inmediata al volver, sin arranque si nace oculta, `stop()` que descarta respuestas en vuelo. Criterio: test unitario con temporizadores falsos: TC-PLATFORM-PERCEIVED-006..008 (parte unitaria)
- [ ] 3.3 Test estático de `title` (decisión 5) en `src/ui/common/title-attr.test.ts`: falla con un `title=` en TSX sin el comentario `title-ok:` en la misma línea o la anterior. Criterio: falla sobre `origin/main` con el inventario (anotar la cuenta real) y pasa tras 5.4: TC-PLATFORM-PERCEIVED-015
- [ ] 3.4 Test estático de CSS en `src/ui/common/perceived-css.test.ts`: `text-wrap: balance` en `h1-h3`, `pretty` en `p, li`, `max-inline-size: 70ch` en la clase de ayuda, ningún breakpoint en px en `globals.css`, `field-sizing` solo dentro de `@supports (field-sizing: content)` y regla base de `textarea` sin cambios, animación de transición solo dentro de `prefers-reduced-motion: no-preference`. Criterio: TC-PLATFORM-PERCEIVED-016, -021 (parte estática)

## 4. INFRASTRUCTURE (cliente HTTP de la UI)

- [ ] 4.1 Opción `background: true` en el `fetch` que usan los contadores (decisión 4) que agrega `priority: 'low'`; usarla en el contador de notificaciones sin leer y en `RecurringNavCount`. Criterio: test unitario de la opción y E2E de 7.3: TC-PLATFORM-PERCEIVED-009, -010

## 5. UI (`apps/web`)

- [ ] 5.1 Transiciones (decisión 1): `withViewTransition` en el componente común de pestañas y en los filtros de Transacciones, Presupuestos, Reportes y la vista previa del import; `::view-transition-group(*)` de 200 ms dentro de `no-preference` en `globals.css`. Criterio: TC-PLATFORM-PERCEIVED-001..003
- [ ] 5.2 Consultas en pausa (decisión 3): migrar a `createVisiblePoller` `imports/ImportWizard.tsx`, `imports/ConnectionsPage.tsx`, `forecasts/ForecastsPage.tsx`, `DemoDataPanel.tsx` y `portability/PortabilityPanels.tsx`, conservando `If-None-Match` y los límites actuales. Criterio: TC-PLATFORM-PERCEIVED-006..008 y los specs E2E existentes de import, conexiones, pronósticos, demostración y exportación en verde
- [ ] 5.3 `InfoTip` (decisión 5) con nombre accesible i18n, `popovertarget`, sin CSS que oculte el contenido fuera de `:popover-open`, y objetivo táctil ≥ 24 × 24 px (NFR-USAB-106). Criterio: test de marcado estático y TC-PLATFORM-PERCEIVED-011..013
- [ ] 5.4 Inventario de los `title=` (decisión 5): cada uno pasa a texto visible, a `InfoTip`, se borra por redundante o queda con `title-ok:` y su motivo. Anotar en la tarea la cuenta por categoría. Verificar que la tabla alternativa de `ReportChart` muestra el valor exacto de cada punto. Criterio: 3.3 en verde y TC-PLATFORM-PERCEIVED-014
- [ ] 5.5 Legibilidad (decisión 6) y breakpoints en em con `nowrap` solo en montos, fechas y códigos (decisión 7); revisar si el change 80 ya agregó breakpoints y convertirlos, o dejar la nota en su design. Criterio: 3.4 en verde, capturas a 360 y 1280 px sin diferencias de diseño con 16 px y TC-PLATFORM-PERCEIVED-016..019
- [ ] 5.6 Campos que crecen (decisión 8) en `globals.css`. Criterio: TC-PLATFORM-PERCEIVED-020, -021

## 6. Transición entre documentos (M-29), **condicionado a la pregunta 5 de docs/85**

- [ ] 6.1 Si se mantiene la navegación por documento (pregunta 5 en A, o en B con la medición del change 84 dentro del objetivo) y la pregunta 6 no la descarta: `@view-transition { navigation: auto; }` dentro de `@media (prefers-reduced-motion: no-preference)` en `globals.css` (decisión 10). Criterio: TC-PLATFORM-PERCEIVED-023, -024. Si no: retirar el requirement «Transición entre secciones por documento» del delta, pasar TC-PLATFORM-PERCEIVED-023 y -024 a `deprecated` y anotar la respuesta aquí

## 7. AUTOMATED TESTS y E2E (Playwright, Chromium)

Spec nuevo `tests/e2e/specs/perceived-performance.spec.ts` y cambios en `inp.spec.ts`, con el TC-id al inicio de cada `test(...)`:

- [ ] 7.1 Tests unitarios de 3.1 a 3.4 y 4.1 con el TC-id al inicio del nombre (`it('[TC-PLATFORM-PERCEIVED-001] …')`)
- [ ] 7.2 Transiciones: pestaña del detalle de un préstamo de 12000.00 BOB con `document.activeViewTransition` o `transition.finished` ≤ 300 ms y foco conservado; filtro «Gastos» con `reducedMotion: 'reduce'` sin transición; mismo filtro con `startViewTransition` borrado por `addInitScript`: TC-PLATFORM-PERCEIVED-001..003
- [ ] 7.3 Consultas: import de 2 000 filas con la pestaña oculta (`page.evaluate` que fija `document.hidden` y despacha `visibilitychange`, o una segunda página al frente) sin peticiones de estado durante 30 s, consulta inmediata al volver con el import terminado, Pronósticos abierto en segundo plano sin consultas; prioridad `Low` del contador de notificaciones y no `Low` de la búsqueda «supermercado» por CDP: TC-PLATFORM-PERCEIVED-006..010
- [ ] 7.4 Explicaciones: marca «conciliada sin extracto» con Tab, Enter y Escape (foco devuelto); toque a 360 px en una tasa de cambio; marcado con el contenido presente fuera de la capa; valor «Bs 1.234,56» en la tabla alternativa del reporte de gastos: TC-PLATFORM-PERCEIVED-011..014
- [ ] 7.5 Legibilidad y texto: `text-wrap` calculado del título a 360 px; ancho de las ayudas de Mis preferencias ≤ 70ch medido con `getComputedStyle`; Transacciones a 1280 px con `Page.setFontSizes` en 32 px sin desplazamiento horizontal y con el diseño angosto; «Bs 12.345,67» en una línea: TC-PLATFORM-PERCEIVED-016..019
- [ ] 7.6 Motivo de anulación de seis líneas para un gasto de 80.00 BOB: alto que crece sin desplazamiento interno y tope en el máximo: TC-PLATFORM-PERCEIVED-020
- [ ] 7.7 `inp.spec.ts`: los cuatro flujos con las transiciones activas (`reducedMotion: 'no-preference'`) y, con la pregunta 4 en A, repetidos con `Emulation.setCPUThrottlingRate` ×4; informe con las dos columnas y estado frente a 200 y 500 ms, sin fallar. Correr 3 veces en local con `--project=inp --no-deps`, anotar las medianas aquí y excluir de `withViewTransition` toda vista que pase de 200 ms: TC-PLATFORM-PERCEIVED-004, -005, -022
- [ ] 7.8 Suite E2E completa en verde dos veces con `PF_E2E_PROJECT=pfos-e2e-<nombre>`; axe sin violaciones `serious` ni `critical`; actualizar el front matter de los TC automatizados (`automated_tests`, `status: automated`, `automation_status: automated`)

## 8. DOCUMENTATION

- [ ] 8.1 docs/28 al as-built: transiciones (§ movimiento), `InfoTip`, consultas en pausa, legibilidad, breakpoints en em y `field-sizing`
- [ ] 8.2 docs/78 § 5.6–5.7: estado de M-28, M-31, M-09, M-23, M-24, M-05 y M-29 (con la respuesta de la pregunta 5)
- [ ] 8.3 Si el owner contestó las preguntas 4 a 6 de docs/85, aplicar la respuesta o anotar que siguen abiertas
- [ ] 8.4 `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; docs/38 y la fila 83 de docs/03 §7 con el estado del change
