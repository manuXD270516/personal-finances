# 78 — Propuesta de mejora de UI/UX con Modern Web Guidance

> **Estado:** Propuesta (pendiente de revisión del agente `frontend` y de decisiones del owner) · **Fecha:** 2026-11-25 · **Autor:** agente `ui-ux` · **Relacionado:** [28-ui-ux-design-system.md](28-ui-ux-design-system.md), [02-non-functional-requirements.md](02-non-functional-requirements.md) (NFR-USAB-001..010, 101..108), [00-product-vision.md](00-product-vision.md) (§ PWA), `openspec/changes/archive/2026-11-24-add-web-content-security-policy`, [despliegue/GUIA-PRUEBAS-FUNCIONALES.md](despliegue/GUIA-PRUEBAS-FUNCIONALES.md)
>
> **Fuente de referencia:** guías de **Modern Web Guidance** de Google Chrome (licencia Apache-2.0), commit `2b4aa13` del 2026-11-23, leídas localmente como material de consulta (no se ejecutó su CLI ni se copiaron al repositorio). Cada guía se cita por su id (ruta relativa a `guides/` sin `.md`); los enlaces están en el [§ 12](#12-referencias).

---

## 1. Resumen

PFOS tiene una base de accesibilidad mejor que la media: tokens semánticos en una hoja propia (`apps/web/app/globals.css`), foco visible, enlace para saltar al contenido, tablas con `caption` y `scope`, pestañas WAI-ARIA completas, estados financieros que nunca dependen solo del color y contraste AA medido en el tema claro (§ 3.3). Lo que falta no es un rediseño: son **patrones de interacción** que la plataforma web ya resuelve de forma nativa y que hoy PFOS construye a mano o no tiene.

Las brechas con más impacto para el usuario, en orden:

1. **El alta de un gasto no es rápida** (el flujo más frecuente, RISK-025): el monto no es el primer campo ni toma el foco, no se recuerda la última cuenta, y al guardar se navega al detalle en lugar de ofrecer "registrar otro" y un aviso con **Deshacer** (docs/28 §4.1 lo pide; no existe ningún toast).
2. **Errores de formulario poco anunciados**: el formulario de transacciones valida solo al enviar y deja el foco en el botón; otros (préstamo, comparación) sí llevan el foco al primer error. Falta un patrón único.
3. **Confirmaciones de acciones irreversibles** (anular, revertir import, cerrar periodo) en un panel en línea que no devuelve el foco al cancelar y enfoca el contenedor en vez de la acción segura. No hay ningún `<dialog>` nativo.
4. **Movimiento reducido mal resuelto**: una regla global fuerza `animation-duration: 0.01ms` en todo, lo que la guía desaconseja de forma explícita.
5. **Navegación móvil**: 15 secciones planas en un panel que empuja el contenido, sin agrupar, sin cierre con Esc y sin acceso directo a "＋ Registrar".
6. **Tablas largas sin cabecera fija** (vista previa del import, cronogramas, reportes): se pierde a qué columna pertenece cada monto.
7. **Solo tema claro**: `color-scheme: light` fijo y 18 colores hexadecimales en TS/TSX; NFR-USAB-103 y docs/28 §9 piden claro y oscuro.
8. **No hay PWA**: `apps/web/public/` está vacío (sin manifiesto); el pedido "PWA" del owner hoy no se cumple.

La matriz tiene 34 puntos (31 con mejora propuesta) agrupados en **7 lotes**, cada uno un futuro change OpenSpec (§ 8). Los dos primeros (accesibilidad base y captura rápida) son **Must**, de costo acotado, y casi no dependen de la política de soporte (usan funciones Widely available o mejoras progresivas). El resto depende de la política de soporte (§ 4, pregunta P1).

## 2. Alcance y método

- **Auditoría desde el código** del worktree sobre `origin/main` (`7a2740b4`, 2026-11-25): `apps/web/app`, `apps/web/src/ui` (≈ 380 archivos), `proxy.ts`, `src/security/csp.ts`, `tests/e2e/playwright.config.ts`, docs/28, docs/02 y la guía de pruebas funcionales. **No se levantó la app** (requiere el stack con Docker y Keycloak; no se usó Docker por las reglas de entorno). Las observaciones de comportamiento en el navegador quedan como supuestos a confirmar en la revisión de `frontend` (§ 10).
- **Guías revisadas**: las 170 de las categorías `accessibility/*`, `forms/*`, `ui-components/*`, `ui-behaviors/*`, `ui-atoms/*`, `user-experience/*`, `visual-design/*`, `css/*`, `performance/` y `pwa/` (resumen, encabezados y datos de compatibilidad de cada una), y en detalle 29 (reglas obligatorias y prohibiciones) de las que tocan los flujos de PFOS; de `performance/` y `pwa/` se usaron las que afectan la experiencia (INP, tareas largas, renderizado diferido, búsquedas en segundo plano, transiciones, instalación). Quedaron fuera (41 de 211) `built-in-ai`, `security` (ya cubierto por `add-web-content-security-policy`), `html` de web components, `wasm` y `webmcp`.
- **Datos de soporte**: los estados Baseline y fechas citados salen de la sección de compatibilidad de cada guía en ese commit; no se volvieron a verificar contra webstatus.dev (supuesto a revalidar al abrir cada change).
- **Datos ficticios**: los ejemplos usan montos y nombres inventados.

## 3. Diagnóstico de la interfaz actual

### 3.1 Lo que ya funciona (se conserva)

| Área | Evidencia |
|---|---|
| Tokens semánticos y base sin framework | `apps/web/app/globals.css:15-86` (color, financieros, tipografía `rem`, escala de 4 px, radios, sombras); estilos base en `:where()` (especificidad 0). |
| Foco visible y no oculto | `globals.css:149-152` (`outline` 2 px + offset), `globals.css:573-574` y `602-604` (`scroll-padding-top`, WCAG 2.4.11). |
| Estructura accesible del marco | `AppFrame.tsx:39-41` (saltar al contenido), `:67` (`nav` con nombre), `:71` (`main` único con foco programático), `:137` (`aria-current="page"`). |
| Objetivos táctiles | `.pf-icon-button`, `.pf-nav-link`, `.pf-menu-item` con 2,75 rem (44 px) (`globals.css:371-379`, `534-544`, `463-476`). |
| Campos rotulados | `Field` en `src/ui/common/ui.tsx:87-124`: `label` asociado, error y pista en `aria-describedby`, `aria-invalid`; el error no es región viva (correcto según `accessibility/accessible-error-announcement`). |
| Teclado numérico en montos | `inputMode="decimal"` en 106 campos; `autoComplete="off"` en montos. |
| Pestañas | `src/ui/common/Tabs.tsx:52-121` (roles, foco itinerante, flechas, Inicio y Fin, paneles montados con `hidden`). |
| Tablas | 115 `caption`, 389 `th scope="col"`, `tabular-nums` global (`globals.css:239-242`); la vista previa del import ya es región desplazable con foco (`PreviewTable.tsx:132`). |
| Gráficos | SVG propio con `role="img"` y `title`/descripción (`reports/ReportChart.tsx:73-79`); tabla alternativa en `<details>` (`cash-flow/CashFlowView.tsx:280`). |
| Progresivo con `<details>` | 19 usos; p. ej. "Más opciones" del alta (`TransactionForm.tsx:666-694`). |
| CSP estricta | `src/security/csp.ts:45-60`: `script-src` con nonce y `strict-dynamic`, `style-src 'self' 'nonce-…'`, `style-src-attr 'unsafe-inline'` (D457). |

### 3.2 Brechas transversales

| Hallazgo | Evidencia | Consecuencia |
|---|---|---|
| El as-built no usa Tailwind, shadcn/ui ni ECharts (docs/28 encabezado y §6-7 los nombran) | `apps/web/package.json` sin esas dependencias; `globals.css:1-13` | docs/28 describe un stack que no existe. Recomendación: actualizar docs/28 al as-built (pregunta P7), no migrar. |
| 1 291 objetos `style={{…}}` en TSX | conteo en `apps/web/src` | Funciona con la CSP (atributos permitidos), pero dificulta temas y estados (`:hover`, `:focus-visible`, `@media`, `@container` no se pueden expresar en línea). Deuda a reducir por dominio cuando se toque, no un lote propio. |
| 18 colores hexadecimales fijos en TS/TSX | `dashboard/styles.ts:12,21,24-27`, `lifecycle/LifecycleDiagram.tsx:4-7,132`, `fx/ConversionForm.tsx:391` | Rompen cualquier tema oscuro y saltean los tokens. |
| Navegación por documento completo | 0 usos de `next/link`; enlaces `<a href>` en `AppFrame.tsx:134-142` | Cada clic recarga y rehidrata la app (con `connection()` en `app/[locale]/layout.tsx:32`). Afecta la velocidad percibida; habilita transiciones entre documentos (§ 5, M-29). |
| E2E solo en Chromium de escritorio | `tests/e2e/playwright.config.ts:19,29-35` | NFR-USAB-005 pide Chromium, Firefox y WebKit. Cualquier adopción de funciones "Newly available" queda sin prueba en Safari/Firefox. |
| Sin PWA | `apps/web/public/` vacío; el design de `add-web-content-security-policy` lo confirma | El acceso rápido desde el teléfono (pantalla de inicio, ventana propia) no existe. |

### 3.3 Contraste medido (tema claro actual)

Medido con la fórmula de luminancia relativa de WCAG 2.2 sobre los valores de `globals.css`:

| Par | Ratio | Umbral | Resultado |
|---|---|---|---|
| `--pf-fg-muted` sobre `--pf-surface` | 7,24 | 4,5 | Cumple |
| `--pf-control-border` sobre `--pf-bg` | 4,76 | 3 | Cumple |
| `--pf-primary` sobre `--pf-primary-soft` (ítem activo) | 6,16 | 4,5 | Cumple |
| `--pf-primary-fg` sobre `--pf-primary` | 6,70 | 4,5 | Cumple |
| `--pf-fin-ok` sobre `--pf-surface` | 4,79 | 4,5 | Cumple (justo) |
| `--pf-fin-neutral` sobre `--pf-surface` | 4,55 | 4,5 | Cumple (justo) |
| `--pf-focus` sobre `--pf-surface` | 4,94 | 3 | Cumple |
| `--pf-border-strong` (borde de insignias) sobre `--pf-bg` | 2,56 | 3 | No aplica: decorativo, el texto de la insignia identifica el estado. Si una insignia se distingue solo por el borde, falla. |
| `#d0d7de` (borde de tarjetas del Home, `dashboard/styles.ts:12`) | 1,45 | — | Decorativo; además fuera de tokens. |

## 4. Política de soporte de navegadores (pregunta P1 para el owner)

Las guías asumen **Baseline Widely available** (funciones estables en todos los navegadores principales desde hace 30 meses) como seguras sin alternativa; para todo lo demás exigen seguir su estrategia de respaldo **salvo que el proyecto declare una política propia** (sección "Interpreting Browser Support & Fallbacks" del `SKILL.md`). PFOS tiene una política implícita en NFR-USAB-005 ("últimas 2 versiones estables de Chrome, Edge, Firefox y Safari, escritorio y móvil") que no se traduce en reglas de código.

Funciones que esta propuesta quiere usar y su estado según las guías:

| Función | Estado Baseline (fecha) | Uso propuesto |
|---|---|---|
| `<dialog>` + `showModal()` | Widely (2022-03-14) | Confirmaciones irreversibles, cajón de navegación. |
| `:user-invalid` | Widely (2023-11-02) | Estilo de error tras interacción. |
| Container queries de tamaño | Widely (2023-02-14) | Tablas apiladas, tarjetas del Home. |
| `:has()` | Widely (2023-12-19) | Grupo de campo con error. |
| `inert` | Widely (2023-04-11) | Fondo de cajones no modales. |
| `color-scheme` | Widely (2022-02-03) | Tema claro/oscuro. |
| `light-dark()` | Newly (2024-05-13) | Tokens de color por esquema. |
| `text-wrap: balance` | Newly (2024-05-13) | Títulos. |
| `@starting-style`, `transition-behavior` | Newly (2024-08-06) | Animar entrada y salida de diálogos y avisos. |
| Popover (`popover`, `popovertarget`) | Newly (2025-01-27) | Menú de usuario, avisos, toggletips. |
| `content-visibility` | Newly (2025-09-15) | Listas largas. |
| View transitions (mismo documento) | Newly (2025-10-14) | Reordenar filas. |
| Invoker commands (`command`/`commandfor`) | Newly (2025-12-12) | Abrir diálogos sin script propio. |
| `ariaNotify()` | Newly (2026-09-14) | Anunciar avisos. |
| Transiciones entre documentos, anchor positioning, `closedby`, `hidden=until-found`, `focusgroup`, interest invokers, scroll-state queries, `<meta name="text-scale">`, `beforeinstallprompt`, speculation rules | Limited availability | Solo como mejora opcional que no cambia la tarea. |

**Opciones:**

- **A. Baseline Widely available estricto.** Todo lo "Newly" lleva su respaldo o polyfill según la guía. Máxima compatibilidad; más código y dependencias (p. ej. `@oddbird/popover-polyfill`, `invokers-polyfill`), que con la CSP deben autohospedarse en el bundle.
- **B. Widely como piso + Newly con mejora progresiva, sin polyfills (recomendada).** Una función "Newly" se usa si su ausencia deja la tarea completable (p. ej. sin `light-dark()` el usuario ve el tema claro; sin `@starting-style` no hay animación). Si su ausencia rompe la tarea, se usa la alternativa Widely (p. ej. `showModal()` en lugar de `command="show-modal"`). Respaldo propio de ≤ 20 líneas y sin dependencias; nunca un polyfill. "Limited" solo como adorno.
- **C. Literal de NFR-USAB-005 (últimas 2 versiones).** Casi equivale a "Newly available" sin respaldos. Menos código, pero deja afuera a quien no actualiza Safari en iOS, frecuente en teléfonos que ya no reciben actualizaciones.

**Recomendación: B**, y declararla en `CLAUDE.md` como regla de código, por ejemplo: *"Soporte de navegadores: Baseline Widely available como piso. Se permiten funciones Newly available si su ausencia no impide completar la tarea (mejora progresiva) o con un respaldo propio de ≤ 20 líneas sin dependencias. Sin polyfills. Limited availability solo como mejora opcional."* Costo: hay que agregar un proyecto WebKit (y opcionalmente Firefox) a Playwright, al menos nightly, para que la mejora progresiva se pruebe de verdad (pregunta P8).

## 5. Matriz guía → estado → brecha → mejora

**Prioridad:** Must (bloquea una tarea o incumple WCAG 2.2 AA / un NFR Must), Should (mejora clara de una tarea frecuente), Could (pulido). **Esfuerzo** (estimado, supuesto a validar por `frontend`): S ≤ 1 día, M 2-4 días, L 1-2 semanas. **Estado:** Cumple, Parcial, Brecha, No aplica.

### 5.1 Formularios y errores

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-01 | [`accessibility/accessible-error-announcement`][g-err], [`forms/forms`][g-forms] | Parcial | `TransactionForm.tsx:295-313` valida al enviar, pinta errores y no mueve el foco; sí lo hacen `debt/ComparePage.tsx:130-135` y `debt/LoanForm.tsx:670`. 55 formularios con `noValidate`. | Con lector de pantalla o con el teclado del teléfono abierto, el usuario toca "Registrar" y no pasa nada visible: no sabe qué campo falla. | Utilidad común (`useFocusFirstError`) aplicada a todos los formularios: tras un envío fallido, foco al primer campo inválido; en formularios largos (préstamo, tarjeta, mapeo del import) un resumen de errores con enlaces a cada campo. | Must | M |
| M-02 | [`forms/validate-input-after-interaction`][g-validate], [`forms/required-field-feedback`][g-required], [`css/style-parent-with-has`][g-has] | Brecha | Sin validación al salir del campo; p. ej. "USDT admite hasta 6 decimales" (docs/28 §8.4) solo aparece al enviar (`TransactionForm.tsx:298`). | El error de escala o formato de un monto llega tarde, después de completar el resto. | Validar en `blur`/`change` con la lógica de parseo existente y limpiar en `input` (matriz de tiempos de `forms/forms`); `aria-invalid` sincronizado con el estado visual (ya soportado por `Field`). Se mantiene `noValidate` porque los mensajes son i18n propios. | Should | M |
| M-03 | [`forms/forms`][g-forms] (pistas de entrada) | Parcial | Monto después de la cuenta y sin foco inicial (`TransactionForm.tsx:445-476`); 0 usos de `enterKeyHint`. docs/28 §4.1 pide "monto primero". | En el teléfono, el alta empieza eligiendo una cuenta en un `select` y no con el número. | Monto primero con `autoFocus` solo en `/transacciones/nueva`; `enterKeyHint="next"`/`"done"`; mantener `inputMode="decimal"`. | Must | S |
| M-04 | [`forms/ime-safe-enter-submit`][g-ime] | Brecha menor | `recurring/OccurrenceActionPanel.tsx:402-406` busca con Enter sin comprobar composición. | Con teclados con composición (o algunas teclas muertas) la búsqueda se dispara a mitad de palabra. | Ignorar Enter si `event.isComposing` o `keyCode === 229`. | Could | S |
| M-05 | [`forms/form-fields-automatically-fit-contents`][g-fieldsizing] | Brecha | Notas y motivos con alto fijo (`globals.css:173-175`). | Motivos de anulación largos se editan en una caja chica. | `field-sizing: content` con `min/max-block-size` como mejora progresiva (Newly 2026-06-16; sin él queda el alto actual). | Could | S |

### 5.2 Diálogos, menús y avisos

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-06 | [`ui-components/dialog`][g-dialog], [`ui-behaviors/prevent-page-scroll-under-modal-dialog`][g-scrolllock] | Brecha | 0 `<dialog>`. `ConfirmPanel` (`common/ui.tsx:130-184`, 39 usos) enfoca el contenedor (`:156-158`), pone "Confirmar" antes que "Cancelar" (`:175-180`) y al cancelar se desmonta sin devolver el foco (p. ej. `transactions/TransactionDetail.tsx:572`). | Al anular una transacción, revertir un import o cerrar un periodo, quien usa teclado pierde el foco al cancelar; el botón destructivo queda primero y a mano. | Dos niveles: (a) confirmaciones locales y reversibles siguen en línea, pero devuelven el foco al disparador y ponen el foco inicial en la acción segura; (b) acciones irreversibles o con efecto contable (anular, revertir import, cerrar periodo, eliminar, archivar) pasan a un `ConfirmDialog` con `<dialog>` + `showModal()` (Widely), nombre por `aria-labelledby`, `autofocus` en "Cancelar", sin `role="dialog"` ni trampa de foco manual, y `overscroll-behavior: contain`. | Must | M |
| M-07 | [`ui-components/persistent-toast-notifications`][g-toast] | Brecha | 0 avisos tipo toast. El alta navega a otra página con `?aviso=registrada` (`TransactionDetail.tsx:110-115`); el resto usa `role="status"` dentro de la página. | No hay "Deshacer" tras registrar (docs/28 §4.1); el resultado se pierde si la página cambia. | Una región de avisos única y nombrada (`role="region"`) en el marco, avisos `popover="manual"` (Newly 2025-01; sin popover se muestran en flujo normal), botón "Cerrar" enfocable sin robar el foco, anuncio con `ariaNotify()` y respaldo `role="status"`. **Deshacer** = anular (void) con su motivo predefinido. Persistente hasta cerrarlo (la guía prefiere persistencia; un límite de 10 s choca con WCAG 2.2.1). La misma información queda en el detalle de la transacción. | Must | M |
| M-08 | [`ui-components/menu`][g-menu], [`user-experience/natural-interactions`][g-natural] | Parcial | Menú de usuario como disclosure con escuchas propias de documento para clic afuera y Esc (`AppFrame.tsx:169-187`). | Funciona, pero es código propio que la plataforma ya resuelve. | `popover="auto"` + `popovertarget` en el botón: cierre por clic afuera, Esc y retorno de foco nativos. Sin `focusgroup` (Limited). | Could | S |
| M-09 | [`ui-behaviors/interest-triggered-tooltips`][g-tooltips] | Brecha | Atributo `title` como única explicación (`transactions/TransactionsListView.tsx:51-53`, `accounts/CatalogView.tsx:158`, `fx/FxRatesPage.tsx:458`); `<title>` por punto como único acceso al valor (`reports/ReportChart.tsx:111`). | En el teléfono y con teclado no hay forma de leer esas explicaciones ("conciliada sin extracto: por qué aparece"). | Texto visible corto o **toggletip** (botón "i" con `popover`); valor exacto de los puntos en la tabla alternativa. `popover="hint"` e interest invokers son Limited: no se usan. | Should | M |
| M-10 | [`ui-components/progress`][g-progress] | Parcial | Utilización de tarjeta y avance de metas con `div role="progressbar"` (`debt/cards/parts.tsx:88`, `dashboard/GoalsCard.tsx:52`); 70 `aria-busy` en elementos genéricos (p. ej. `TransactionDetail.tsx:97`). | Lectores de pantalla anuncian "barra de progreso" para una medida que no avanza; `aria-busy` en `<p>` sin rol tiene soporte irregular. | `<meter>` para medidas (utilización, ejecución del presupuesto) y `<progress>` para procesos (import); estado de carga con texto en `role="status"`. | Could | S |

### 5.3 Navegación y marco

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-11 | [`ui-components/navigation-drawer`][g-drawer], [`ui-components/navbar`][g-navbar] | Brecha | Bajo 768 px la navegación es un panel en flujo que empuja el contenido (`globals.css:518-526`, `AppFrame.tsx:66-70`): no deja inerte el resto, no cierra con Esc y lista 15 secciones planas (`shell/nav.ts:31-55`). docs/28 §2.1 define grupos y una barra inferior. | En el teléfono el menú tapa la mitad superior con 15 ítems sin orden por tarea; "Registrar" no está a mano. | Ver pregunta P4. Recomendado: barra inferior de 5 destinos (Inicio · Transacciones · ＋ Registrar · Plan · Más) y "Más" como cajón `<dialog>` modal con los grupos de docs/28 (Día a día, Planificar, Analizar, Organizar, Ajustes). En escritorio, la misma agrupación con encabezados en la barra lateral. | Should | L |
| M-12 | [`user-experience/form-factor-adaptation`][g-formfactor] | Brecha | `100vh` en el marco y la barra lateral (`globals.css:298`, `690`); sin `safe-area-inset`. | En móvil, con la barra del navegador dinámica, el alto salta y lo fijo abajo puede quedar bajo el área del sistema. | `100dvh`/`100svh` (Widely), `env(safe-area-inset-bottom)` en la barra inferior y `scroll-padding-bottom` igual a su alto para que el foco no quede tapado (WCAG 2.4.11). | Should | S |
| M-13 | [`user-experience/content-first-noise-reduction`][g-noise] | Parcial | Sin intersticiales (cumple). En < 640 px la barra superior ocupa dos filas porque el selector de workspace va a ancho completo (`globals.css:658-673`). | Menos espacio para el contenido en cada pantalla. | En móvil, mover el selector de workspace al cajón "Más" o al menú de usuario; barra superior de una fila. | Could | S |
| M-14 | [`visual-design/color`][g-color] (colores forzados) | Brecha | El ítem activo se marca con `box-shadow: inset` y fondo (`globals.css:562-567`); en colores forzados ambos desaparecen. | Con alto contraste de Windows no se distingue la sección actual. | Borde real (`border-inline-start`) u `outline` en `[aria-current='page']`, o regla `@media (forced-colors: active)`. | Should | S |
| M-15 | [`ui-components/tabs`][g-tabs] | Parcial | Las pestañas envuelven en varias filas (`common/Tabs.tsx:30`), la seleccionada cambia el peso de fuente (`:42`) y cada pestaña lleva `aria-controls` (`:93`). | En el detalle de préstamo o tarjeta, en el teléfono, las pestañas saltan de fila y cambian de ancho al elegirlas. | Una sola fila con desplazamiento horizontal y pista de desplazamiento; peso de fuente constante e indicador con borde (no `box-shadow`); quitar `aria-controls`. | Should | S |

### 5.4 Tablas, listas y datos

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-16 | [`ui-atoms/responsive-table`][g-table] | Parcial | 43 de 84 envoltorios `tableWrapStyle` tienen `role="region"` + `tabIndex={0}` (`PreviewTable.tsx:132` sí); 0 cabeceras fijas (`common/ui.tsx:53-61`). | En la vista previa del import (cientos de filas) y en cronogramas de préstamo se pierde a qué columna corresponde cada monto al desplazarse. | Cabecera `position: sticky` y primera columna fija en tablas anchas; alto máximo con desplazamiento propio en tablas de mucho volumen; región con nombre y foco en el 100 % de los envoltorios; vista apilada con container queries (Widely) para tablas de ≤ 4 columnas en contenedores angostos. | Should | M |
| M-17 | [`ui-atoms/scrollability-affordance-hints`][g-scrollhint] | Brecha | Tablas con `overflow-x: auto` sin pista visual. | En móvil no se nota que hay más columnas a la derecha. | Desvanecido con máscara animada por desplazamiento (Newly 2026-10-27) como mejora; sin soporte queda la barra visible. Las sombras con scroll-state queries son Limited: no. | Could | S |
| M-18 | [`ui-behaviors/sortable-table`][g-sort], [`ui-behaviors/dynamic-sort`][g-dynsort] | Brecha | 0 `aria-sort`; no hay orden por columna. | Para comparar gastos por categoría o líneas de presupuesto hay que leer toda la tabla. | En tablas comparativas (reportes, presupuesto vs real, suscripciones): botón dentro de `th`, `aria-sort` solo en la columna activa, ordenar por el valor y no por el texto formateado (montos Decimal en string), mover las filas existentes y anunciar una vez en `role="status"`. | Could | M |
| M-19 | [`performance/defer-rendering-heavy-content`][g-cv], [`performance/interactions-in-complex-layouts`][g-complex] | Brecha (a medir) | 0 `content-visibility`; listas largas completas (vista previa del import, auditoría, transacciones). | Supuesto: con extractos grandes, abrir filas o decidir duplicados tarda en responder. | Medir primero (M-30). Si se confirma, `content-visibility: auto` + `contain-intrinsic-size` en bloques fuera de pantalla (Newly 2025-09-15; sin soporte no cambia nada). | Should | S |

### 5.5 Tema, color y tipografía

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-20 | [`visual-design/dark-mode`][g-dark], [`ui-atoms/component-specific-light-dark-theme`][g-cdark] | Brecha | `color-scheme: light` fijo (`globals.css:16`); sin `<meta name="color-scheme">` (`app/[locale]/layout.tsx:36-41`); 18 hexadecimales fijos (§ 3.2). NFR-USAB-103 exige contraste "en modo claro y oscuro". | Uso nocturno con el teléfono: pantalla blanca; incumple un NFR Must. | Tokens con `light-dark()` y `color-scheme: light dark` en `:root` (con P1=B, sin `light-dark()` se ve el claro); valores oscuros de docs/28 §5.1 (contraste medido: § 6); migrar los 18 hexadecimales a tokens; temas de gráficos desde tokens. | Should | M |
| M-21 | [`ui-components/dark-mode-toggle`][g-darktoggle] | Brecha | No hay preferencia de tema; docs/28 §9 pide `system`/`light`/`dark` persistido por usuario. | — | Sin interruptor permanente en la barra (la guía lo desaconseja para usuarios no técnicos). Control de 3 estados en Preferencias, guardado en el perfil (`/me`) y aplicado **en el servidor** (`data-theme` y `<meta name="color-scheme">` en el HTML), sin script en línea (CSP) ni parpadeo. | Should | S |
| M-22 | [`visual-design/browser-ui-theming`][g-browserui], [`visual-design/customize-scrollbar-color-and-thickness`][g-scrollbar] | Parcial | `accent-color` en casillas y radios (`globals.css:184-190`); sin `theme-color`. | La barra del navegador móvil no acompaña el tema. | `theme-color` por esquema con la exportación `viewport` de Next (sin script); barras de desplazamiento nativas (no se personalizan). | Could | S |
| M-23 | [`visual-design/typography`][g-type], [`visual-design/improve-text-layout-and-legibility`][g-textlayout] | Parcial | Escala `rem` y fuentes del sistema (cumple); sin `text-wrap: balance` en títulos ni `pretty` en párrafos; sin medida máxima en textos de ayuda. | Títulos largos en español (≈ 25 % más que en inglés) cortan con una palabra huérfana. | `text-wrap: balance` en `h1-h3` y `pretty` en `p, li` (Newly; sin soporte no cambia), `max-inline-size: 70ch` en párrafos de ayuda. | Could | S |
| M-24 | [`accessibility/respect-os-text-scale`][g-textscale] | Parcial | No se fija `font-size` raíz (cumple); breakpoints en px (`globals.css:637,644,658,675`) y 19 `white-space: nowrap`. `<meta name="text-scale">` es Limited. | Con texto del sistema al 200 % el diseño de escritorio se mantiene aunque el texto ya no entre. | Media queries en `em`; revisar los `nowrap` en bloques de texto (se conservan en montos y fechas). No adoptar `text-scale` todavía. | Could | S |
| M-25 | [`visual-design/visually-stable-font-fallbacks`][g-fontfallback] | No aplica | Fuentes del sistema; docs/28 pregunta 6 sigue abierta (Inter autohospedada). | — | Si se adopta Inter, `font-size-adjust` para evitar saltos; si no, nada. | — | — |

### 5.6 Movimiento y transiciones

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-26 | [`ui-behaviors/motion`][g-motion] | Brecha | Regla global `*{animation-duration:0.01ms !important; transition-duration:0.01ms !important}` (`globals.css:701-711`), que la guía prohíbe expresamente porque vuelve algunas animaciones más bruscas. El Home ya lo resuelve bien por componente (`dashboard/home.css:300`). | Quien pide menos movimiento recibe cambios instantáneos en lugares donde un fundido suave sería más cómodo; además pisa decisiones locales. | Quitar la regla global; cada animación declara su variante dentro de `@media (prefers-reduced-motion: no-preference)` o `reduce`, junto a la regla. Animar solo `opacity` y `transform`. | Must | S |
| M-27 | [`ui-behaviors/animate-to-from-top-layer`][g-toplayer], [`ui-behaviors/animate-element-entry-exit`][g-entryexit] | No aplica hoy | Sin elementos en la capa superior. | — | Al crear el diálogo, el cajón y los avisos (M-06, M-07, M-11): entrada y salida con `@starting-style` y `transition-behavior: allow-discrete` como propiedad aparte (Newly 2024-08; sin soporte aparecen sin animación). | Could | S |
| M-28 | [`ui-behaviors/same-document-transitions`][g-samedoc], [`ui-behaviors/group-element-transitions`][g-group] | Brecha | Cambios de filtro o de pestaña reemplazan el contenido de golpe. | Al filtrar la vista previa del import se pierde la referencia visual de qué cambió. | `document.startViewTransition()` detectando soporte (Newly 2025-10-14), solo con `no-preference`. | Could | M |
| M-29 | [`ui-behaviors/cross-document-transitions`][g-crossdoc] | Brecha | La navegación es por documento completo (§ 3.2) y no tiene transición. | Cada cambio de sección "parpadea" en blanco. | `@view-transition { navigation: auto; }` en CSS, dentro de `no-preference` (Limited: en navegadores sin soporte no pasa nada). Validar con `frontend` si conviene antes migrar a `next/link` (navegación del lado del cliente), que mejora más la velocidad percibida. | Could | S |

### 5.7 Rendimiento percibido

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-30 | [`performance/identify-inp-causes`][g-inp], [`performance/break-up-long-tasks`][g-longtasks], [`performance/performance`][g-perf] | Sin medir | No hay medición de INP en la web; los flujos con más trabajo en el cliente son la vista previa del import, la edición masiva, el simulador de deudas y los reportes. | Supuesto: respuestas lentas en extractos grandes o teléfonos modestos. | Medir INP con `PerformanceObserver` (event timing, Newly 2025-12-12) en la suite e2e y en desarrollo, sin servicios de terceros. Donde haya tareas > 50 ms, ceder el hilo (`scheduler.yield()` con respaldo `setTimeout`) o mover cálculo al servidor. | Should | M |
| M-31 | [`performance/deprioritize-background-fetches`][g-bgfetch], [`performance/detect-initial-visibility-state`][g-visibility] | Brecha | Sondeos que siguen con la pestaña oculta: `imports/ImportWizard.tsx:161-181`, `forecasts/ForecastsPage.tsx:21-22`, `DemoDataPanel.tsx:21`. | Gasto de batería y datos móviles en segundo plano. | Pausar con `visibilitychange` y reanudar al volver; `priority: 'low'` en las consultas de fondo (Newly; se ignora si no hay soporte). | Could | S |
| M-32 | [`performance/improve-next-page-load-performance`][g-speculation] | No adoptar | — | — | Speculation rules es Limited, requiere un `<script>` en línea (nonce) y prerenderizar páginas autenticadas con efectos es riesgoso. Se registra y se descarta por ahora. | — | — |

### 5.8 Instalación (PWA)

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-33 | [`pwa/install-web-app`][g-install] | Brecha | Sin manifiesto (`apps/web/public/` vacío); docs/00 y docs/28 §11 la dejan como Could. | No se puede "instalar" PFOS en el teléfono para registrar un gasto con un toque. | Manifiesto estático con `id` estable, `start_url`, `display: standalone`, íconos y `theme_color`; enlazado desde `metadata.manifest` de Next. Botón "Instalar" solo cuando llega `beforeinstallprompt` (Chromium); nunca un botón que no funcione (`<install>` y `navigator.install()` no tienen soporte todavía). Sin service worker en esta etapa (ver P5). | Could | M |
| M-34 | [`pwa/migrate-web-app-origin`][g-migrate] | No aplica | — | — | Solo si cambia el dominio público después de instalada. Fijar el dominio definitivo antes de publicar el manifiesto. | — | — |

## 6. Tokens propuestos (re-tematizar, no migrar)

La hoja actual se conserva; solo cambian los valores y se agrega el esquema oscuro. Valores oscuros de docs/28 §5.1, con contraste medido (WCAG 2.2):

| Token | Claro (actual) | Oscuro (propuesto) | Contraste oscuro medido |
|---|---|---|---|
| `--pf-bg` / `--pf-surface` / `--pf-surface-raised` | `#ffffff` / `#f8fafc` / `#ffffff` | `#0b0f14` / `#121821` / `#1a2230` | — |
| `--pf-fg` | `#0f172a` | `#e2e8f0` | 15,59 sobre bg; 12,95 sobre raised |
| `--pf-fg-muted` | `#475569` | `#94a3b8` | 6,95 sobre surface; 6,23 sobre raised |
| `--pf-control-border` | `#64748b` | `#7c8aa0` (nuevo) | 4,56 sobre raised (≥ 3) |
| `--pf-border` | `#e2e8f0` | `#273244` | 1,49 (decorativo) |
| `--pf-primary` / `--pf-primary-fg` | `#1d4ed8` / `#ffffff` | `#60a5fa` / `#0b0f14` | 7,56 / 7,56 |
| `--pf-focus` | `#2563eb` | `#93c5fd` | 9,88 sobre surface |
| `--pf-fin-income` | `#047857` | `#34d399` | 9,27 |
| `--pf-fin-warning` | `#b45309` | `#fbbf24` | 10,68 |
| `--pf-fin-over-budget` | `#b91c1c` | `#f87171` | 6,44 |
| `--pf-fin-ok` | `#15803d` | `#4ade80` | 10,23 |
| `--pf-fin-conversion` | `#6d28d9` | `#a78bfa` | 6,55 |

Se agregan tokens que hoy faltan y aparecen como hexadecimales: `--pf-chart-on`, `--pf-chart-off`, `--pf-chart-visited` (diagrama de recorrido) y `--pf-card-border` (Home). La elevación en oscuro se expresa con diferencia de superficie, no con sombra (docs/28 §5.4).

## 7. Flujos de valor: antes y después

| Flujo | Hoy | Propuesta | Mejoras |
|---|---|---|---|
| **Alta rápida de gasto** | Cuenta → monto → fecha → … → "Registrar" → navega al detalle. Sin cuenta recordada; errores solo al enviar; sin deshacer. | Monto con foco y teclado decimal → categoría sugerida (ya existe el chip) → cuenta recordada → "Registrar". Se queda en el formulario limpio con un aviso "Gasto de Bs 45,00 registrado · Deshacer · Ver". Opción "Registrar e ir al detalle". Acceso "＋" en la barra superior y en la barra inferior móvil. | M-01, M-03, M-07, M-11 |
| **Import y vista previa** | Tabla completa sin cabecera fija; región desplazable con foco (cumple); decisiones con `aria-pressed` y foco conservado (cumple). | Cabecera y columna de fecha fijas, pista de desplazamiento, filtros con transición, renderizado diferido de filas fuera de pantalla tras medir; "Revertir import" en `<dialog>`. | M-06, M-16, M-17, M-19, M-28, M-30 |
| **Reportes y tablas** | Gráfico SVG con tabla alternativa; valores exactos solo en `<title>` al pasar el mouse. | Tabla alternativa siempre accesible; orden por columna en tablas comparativas; cabecera fija. | M-09, M-16, M-18 |
| **Presupuestos** | Tablas y barras `div role="progressbar"`. | `<meter>` para ejecución, orden por desvío, confirmación de "Aplicar al plan" con diálogo si reemplaza montos. | M-06, M-10, M-18 |
| **Tarjetas y préstamos** | Pestañas que envuelven; cronogramas largos sin cabecera fija; formularios largos con foco al primer error (cumple en préstamos). | Pestañas en una fila; cronograma con cabecera fija; resumen de errores en el alta de tarjeta y de préstamo. | M-01, M-15, M-16 |
| **Notificaciones** | Campana con contador y región viva (cumple). | Avisos de la propia sesión (registro, import terminado) en la región de avisos, sin duplicar la bandeja. | M-07 |
| **Home** | Tarjetas con colores fijos (`dashboard/styles.ts`); esqueleto que respeta movimiento reducido (cumple). | Tokens y tema oscuro; tarjetas con container queries; títulos balanceados. | M-20, M-23 |

## 8. Lotes propuestos (futuros changes OpenSpec)

Cada lote es un change con su proposal, design, tasks, specs y TC; el orden respeta dependencias. Ninguno toca los changes en curso.

| Lote | Change | Prio | Mejoras | Depende de | Esfuerzo (supuesto) |
|---|---|---|---|---|---|
| L1 | `refine-web-accessibility-foundations` | Must | M-01, M-02, M-04, M-06, M-14, M-15, M-26 | — | M-L |
| L2 | `add-quick-capture` | Must | M-03, M-07, alta en el lugar con "registrar otro", cuenta recordada (preferencia de usuario en el servidor), acceso "＋" | L1 (diálogo y foco) | M |
| L3 | `add-dark-theme` | Should | M-20, M-21, M-22, tokens de § 6, migración de los 18 hexadecimales | P1, P2 | M |
| L4 | `refine-mobile-navigation` | Should | M-11, M-12, M-13, M-08, M-27 | P4; L2 (botón ＋) | L |
| L5 | `refine-data-tables` | Should | M-16, M-17, M-18, M-10, M-19, M-30 (medición) | P1 | M |
| L6 | `add-pwa-install` | Could | M-33, M-22 | P5; dominio definitivo | M |
| L7 | `refine-perceived-performance` | Could | M-28, M-29, M-31, M-09, M-23, M-24, M-05 | P1; resultado de M-30 | M |

Deuda transversal (sin lote propio): reducir `style={{…}}` y mover estilos a clases por dominio cada vez que un lote toque ese dominio; actualizar docs/28 al as-built (sin Tailwind, shadcn ni ECharts) si el owner lo confirma (P7).

## 9. Riesgos

| Riesgo | Detalle | Mitigación |
|---|---|---|
| **CSP con nonce** | La política (`src/security/csp.ts:45-60`) permite estilos en atributo (`style-src-attr 'unsafe-inline'`) pero no `<style>` ni `<script>` en línea sin nonce. Un tema sin parpadeo suele resolverse con un script en línea en `<head>`; speculation rules también requiere script en línea. | Tema aplicado en el servidor desde el perfil (M-21); nada de `<style>`/`<script>` en línea nuevos; CSS en `globals.css` u hojas de módulo; si hiciera falta un polyfill (opción A de P1), autohospedado en el bundle, nunca desde un CDN. El manifiesto queda fuera del `matcher` de `proxy.ts:73` y lo cubre `default-src 'self'`. Un service worker futuro exigiría revisar `worker-src`. |
| **i18n** | Avisos, diálogo, cajón y textos nuevos en es, en y pt; el español es ≈ 25 % más largo; los anuncios (`ariaNotify`, `role="status"`) deben salir en el idioma de la UI. | Claves en los tres catálogos en el mismo PR; probar a 320 px con textos en español; no truncar títulos. |
| **Accesibilidad** | Popover, `<dialog>` y foco cambian lo que oyen los lectores de pantalla; `ariaNotify()` es muy nuevo (2026-09). | Respaldo `role="status"`; prueba manual con NVDA y TalkBack por lote (docs/28 §10); axe sin violaciones serias en la suite. |
| **E2E** | Solo Chromium de escritorio; los cambios de foco, de orden (monto primero) y la navegación móvil rompen selectores y pasos. Las mejoras progresivas no se prueban en Safari ni Firefox. | Mantener los `data-testid`; agregar casos a 360 px (ya hay precedentes en `accounts.spec.ts:129`); proyecto WebKit al menos nightly (P8). Siempre con `PF_E2E_PROJECT=pfos-e2e-<nombre>`. |
| **Comportamiento financiero** | "Deshacer" no puede borrar: debe anular (void) con su motivo y respetar periodos cerrados y reconciliaciones. | Deshacer = el mismo comando de anulación con su validación; si el periodo se cerró mientras tanto, el aviso informa el error del catálogo. |
| **Alcance** | 1 291 estilos en línea hacen que cada cambio visual toque muchos archivos. | Lotes por dominio, sin reescrituras masivas; re-tematizar primero (barato) y migrar componentes solo donde cambia la interacción. |

## 10. Preguntas para el owner

| ID | Pregunta | Opciones | Recomendación |
|---|---|---|---|
| P1 | ¿Qué política de soporte de navegadores adoptamos para el código de UI? | A. Baseline Widely estricto con polyfills. B. Widely como piso + Newly con mejora progresiva, sin polyfills. C. Literal de NFR-USAB-005 (últimas 2 versiones). | **B** (§ 4), escrita en `CLAUDE.md` y en NFR-USAB-005. |
| P2 | ¿Tema oscuro, y cuál por defecto? | A. Solo claro (posponer). B. Sistema por defecto con override Claro/Oscuro en Preferencias. C. Interruptor visible en la barra superior. | **B**. Cumple NFR-USAB-103 y la guía desaconseja el interruptor permanente para usuarios no técnicos. |
| P3 | Tras registrar un gasto, ¿qué pasa? | A. Igual que hoy: ir al detalle. B. Quedarse en el formulario limpio con aviso "Deshacer · Ver". C. B con preferencia para elegir. | **B**: es lo que más acorta la carga de varios gastos seguidos (NFR-USAB-007, RISK-025). |
| P4 | Navegación móvil. | A. Cajón lateral `<dialog>` con los grupos de docs/28. B. Barra inferior de 5 destinos + "Más" como cajón (docs/28 §2.1). C. Mantener el panel actual, solo agrupado. | **B**: deja "＋ Registrar" y Transacciones a un toque. Costo L. |
| P5 | ¿PWA, y hasta dónde? | A. No por ahora. B. Solo instalable (manifiesto e íconos, sin funcionamiento sin conexión). C. Instalable + cola de altas sin conexión (service worker). | **B** primero. C exige decidir conflictos, idempotencia sin conexión y `worker-src` en la CSP: change aparte. |
| P6 | Tipografía. | A. Fuentes del sistema (as-built). B. Inter autohospedada (docs/28 pregunta 6). | **A**: cero descarga, cero cambio de CSP y buen soporte de `tabular-nums`. Revisar si el owner quiere una identidad propia. |
| P7 | docs/28 nombra Tailwind, shadcn/ui y ECharts, que no están en el código. | A. Actualizar docs/28 al as-built (CSS propio, SVG propio). B. Migrar al stack de docs/28. | **A**: migrar es caro y no mejora ninguna tarea; la hoja propia ya cumple la CSP sin excepciones. |
| P8 | ¿Ampliamos la matriz de E2E? | A. Solo Chromium (hoy). B. + WebKit nightly. C. + WebKit y Firefox en cada PR. | **B**: cubre Safari/iOS (donde más fallan las funciones Newly) sin alargar cada PR. |
| P9 | ¿"Deshacer" con límite de tiempo? | A. 10 s como docs/28 §4.1. B. Persistente hasta cerrar el aviso o salir de la página; después, anular desde el detalle. | **B**: un límite corto incumple WCAG 2.2.1 para quien necesita más tiempo y la guía de avisos prefiere persistencia. |

## 11. Viabilidad técnica (pendiente de revisión del agente frontend)

> Sección vacía a propósito. El agente `frontend` debe validar, por punto, si es viable en el stack real (Next 16.4.5, React 19.3.0, next-intl, CSP con nonce, sin framework CSS), con qué esfuerzo y con qué riesgo, y completar aquí sus conclusiones.

Puntos a validar:

1. **`<dialog>` y `showModal()` en React 19** con componentes cliente: refs, cierre por Esc y `returnValue`; interacción con la navegación de documento completo; `ConfirmDialog` reutilizable que reemplace los usos irreversibles de `ConfirmPanel` sin romper sus `data-testid`.
2. **Atributos nuevos en JSX** (`popover`, `popovertarget`, `command`/`commandfor`, `enterKeyHint`) con los tipos de `@types/react` 19.3: si hace falta extender tipos o usar spread tipado.
3. **Región de avisos** en `AppFrame` que sobreviva a la navegación por documento completo (¿el aviso de "registrado" debe persistir tras una recarga? ¿`sessionStorage` o parámetro?).
4. **Tema en el servidor sin parpadeo**: leer la preferencia del perfil en `app/[locale]/layout.tsx` (ya hace `connection()`), poner `data-theme` y `<meta name="color-scheme">` sin script; costo de agregar el campo `theme` a `/me` (contrato aditivo, `oasdiff`).
5. **`light-dark()` y `color-scheme`** con la hoja actual y los CSS de módulo (`home.css`, `cash-flow.css`, `forecasts.css`, `networth.css`, `report-chart.css`): inventario de colores fijos y de gráficos.
6. **`next/link` frente a `<a href>`**: ganancia real de navegación del lado del cliente frente a `@view-transition` entre documentos; impacto en `proxy.ts` (sesión y CSP por petición) y en los E2E.
7. **Cabecera fija en tablas** dentro de contenedores con `overflow-x: auto` (el `sticky` vertical necesita que el contenedor desplace en ambos ejes): alto máximo, impresión y lectura en lectores de pantalla.
8. **`content-visibility`** en filas de tabla (soporte irregular en `tr`): medir con extractos sintéticos grandes antes de adoptarlo.
9. **Medición de INP** en Playwright sin dependencias nuevas (o con `web-vitals` autohospedado) y umbrales por flujo.
10. **Manifiesto PWA** servido por Next (`app/manifest.ts` o archivo en `public/`), íconos, `metadata.manifest`, y que el `matcher` de `proxy.ts` no exija sesión para el manifiesto ni los íconos.
11. **Barra inferior móvil y cajón**: convivencia con la barra superior sticky, `scroll-padding`, `safe-area`, teclado virtual abierto en el alta rápida.
12. **Proyecto WebKit en Playwright**: tiempo de CI, estabilidad con Keycloak y el stack `pfos-e2e`.
13. **Esfuerzos S/M/L** de la matriz y orden de los lotes.

## 12. Referencias

Guías de Modern Web Guidance (Google Chrome, Apache-2.0), commit `2b4aa13`:

[g-err]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/accessible-error-announcement.md
[g-textscale]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/accessibility/respect-os-text-scale.md
[g-forms]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md
[g-validate]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/validate-input-after-interaction.md
[g-required]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/required-field-feedback.md
[g-ime]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/ime-safe-enter-submit.md
[g-fieldsizing]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/form-fields-automatically-fit-contents.md
[g-has]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/css/style-parent-with-has.md
[g-dialog]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/dialog.md
[g-scrolllock]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/prevent-page-scroll-under-modal-dialog.md
[g-toast]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/persistent-toast-notifications.md
[g-menu]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/menu.md
[g-natural]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/user-experience/natural-interactions.md
[g-tooltips]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/interest-triggered-tooltips.md
[g-progress]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/progress.md
[g-drawer]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/navigation-drawer.md
[g-navbar]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/navbar.md
[g-formfactor]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/user-experience/form-factor-adaptation.md
[g-noise]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/user-experience/content-first-noise-reduction.md
[g-color]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/visual-design/color.md
[g-tabs]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/tabs.md
[g-table]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/responsive-table.md
[g-scrollhint]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/scrollability-affordance-hints.md
[g-sort]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/sortable-table.md
[g-dynsort]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/dynamic-sort.md
[g-cv]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/defer-rendering-heavy-content.md
[g-complex]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/interactions-in-complex-layouts.md
[g-dark]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/visual-design/dark-mode.md
[g-cdark]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/component-specific-light-dark-theme.md
[g-darktoggle]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/dark-mode-toggle.md
[g-browserui]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/visual-design/browser-ui-theming.md
[g-scrollbar]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/visual-design/customize-scrollbar-color-and-thickness.md
[g-type]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/visual-design/typography.md
[g-textlayout]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/visual-design/improve-text-layout-and-legibility.md
[g-fontfallback]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/visual-design/visually-stable-font-fallbacks.md
[g-motion]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/motion.md
[g-toplayer]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/animate-to-from-top-layer.md
[g-entryexit]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/animate-element-entry-exit.md
[g-samedoc]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/same-document-transitions.md
[g-group]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/group-element-transitions.md
[g-crossdoc]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/cross-document-transitions.md
[g-inp]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/identify-inp-causes.md
[g-longtasks]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/break-up-long-tasks.md
[g-perf]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/performance.md
[g-bgfetch]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/deprioritize-background-fetches.md
[g-visibility]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/detect-initial-visibility-state.md
[g-speculation]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/improve-next-page-load-performance.md
[g-install]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/pwa/install-web-app.md
[g-migrate]: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/pwa/migrate-web-app-origin.md

| Id de guía | Enlace |
|---|---|
| `accessibility/accessible-error-announcement` | [guía][g-err] |
| `accessibility/respect-os-text-scale` | [guía][g-textscale] |
| `forms/forms` | [guía][g-forms] |
| `forms/validate-input-after-interaction` | [guía][g-validate] |
| `forms/required-field-feedback` | [guía][g-required] |
| `forms/ime-safe-enter-submit` | [guía][g-ime] |
| `forms/form-fields-automatically-fit-contents` | [guía][g-fieldsizing] |
| `css/style-parent-with-has` | [guía][g-has] |
| `ui-components/dialog` | [guía][g-dialog] |
| `ui-behaviors/prevent-page-scroll-under-modal-dialog` | [guía][g-scrolllock] |
| `ui-components/persistent-toast-notifications` | [guía][g-toast] |
| `ui-components/menu` | [guía][g-menu] |
| `user-experience/natural-interactions` | [guía][g-natural] |
| `ui-behaviors/interest-triggered-tooltips` | [guía][g-tooltips] |
| `ui-components/progress` | [guía][g-progress] |
| `ui-components/navigation-drawer` | [guía][g-drawer] |
| `ui-components/navbar` | [guía][g-navbar] |
| `user-experience/form-factor-adaptation` | [guía][g-formfactor] |
| `user-experience/content-first-noise-reduction` | [guía][g-noise] |
| `visual-design/color` | [guía][g-color] |
| `ui-components/tabs` | [guía][g-tabs] |
| `ui-atoms/responsive-table` | [guía][g-table] |
| `ui-atoms/scrollability-affordance-hints` | [guía][g-scrollhint] |
| `ui-behaviors/sortable-table` | [guía][g-sort] |
| `ui-behaviors/dynamic-sort` | [guía][g-dynsort] |
| `performance/defer-rendering-heavy-content` | [guía][g-cv] |
| `performance/interactions-in-complex-layouts` | [guía][g-complex] |
| `visual-design/dark-mode` | [guía][g-dark] |
| `ui-atoms/component-specific-light-dark-theme` | [guía][g-cdark] |
| `ui-components/dark-mode-toggle` | [guía][g-darktoggle] |
| `visual-design/browser-ui-theming` | [guía][g-browserui] |
| `visual-design/customize-scrollbar-color-and-thickness` | [guía][g-scrollbar] |
| `visual-design/typography` | [guía][g-type] |
| `visual-design/improve-text-layout-and-legibility` | [guía][g-textlayout] |
| `visual-design/visually-stable-font-fallbacks` | [guía][g-fontfallback] |
| `ui-behaviors/motion` | [guía][g-motion] |
| `ui-behaviors/animate-to-from-top-layer` | [guía][g-toplayer] |
| `ui-behaviors/animate-element-entry-exit` | [guía][g-entryexit] |
| `ui-behaviors/same-document-transitions` | [guía][g-samedoc] |
| `ui-behaviors/group-element-transitions` | [guía][g-group] |
| `ui-behaviors/cross-document-transitions` | [guía][g-crossdoc] |
| `performance/identify-inp-causes` | [guía][g-inp] |
| `performance/break-up-long-tasks` | [guía][g-longtasks] |
| `performance/performance` | [guía][g-perf] |
| `performance/deprioritize-background-fetches` | [guía][g-bgfetch] |
| `performance/detect-initial-visibility-state` | [guía][g-visibility] |
| `performance/improve-next-page-load-performance` | [guía][g-speculation] |
| `pwa/install-web-app` | [guía][g-install] |
| `pwa/migrate-web-app-origin` | [guía][g-migrate] |

También se consultaron, sin brecha que proponer: `accessibility/accessibility` (landmarks, encabezados, skip link: cumple), `ui-components/accordion` (los `<details>` actuales cumplen), `ui-components/card`, `forms/switch` (Limited), `ui-atoms/state-aware-sticky-headers` y `ui-atoms/shrinking-header-on-scroll` (scroll-state Limited) y `css/size-aware-styling` (se usa dentro de M-16 y M-20).
