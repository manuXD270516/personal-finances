# 78 — Propuesta de mejora de UI/UX con Modern Web Guidance

> **Estado:** Propuesta revisada por el agente `frontend` (§ 11); pendiente de decisiones del owner · **Fecha:** 2026-11-25 · **Autor:** agente `ui-ux` · **Relacionado:** [28-ui-ux-design-system.md](28-ui-ux-design-system.md), [02-non-functional-requirements.md](02-non-functional-requirements.md) (NFR-USAB-001..010, 101..108), [00-product-vision.md](00-product-vision.md) (§ PWA), `openspec/changes/archive/2026-11-24-add-web-content-security-policy`, [despliegue/GUIA-PRUEBAS-FUNCIONALES.md](despliegue/GUIA-PRUEBAS-FUNCIONALES.md)
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
7. **Solo tema claro**: `color-scheme: light` fijo, 29 colores hexadecimales en TS/TSX y un bloque que redeclara 13 tokens en el Home (§ 11.4); NFR-USAB-103 y docs/28 §9 piden claro y oscuro.
8. **No hay PWA**: `apps/web/public/` está vacío (sin manifiesto); el pedido "PWA" del owner hoy no se cumple.

La matriz tiene 34 puntos (31 con mejora propuesta) agrupados en **7 lotes**, cada uno un futuro change OpenSpec (§ 8). Los dos primeros (accesibilidad base y captura rápida) son **Must**, de costo acotado, y casi no dependen de la política de soporte (usan funciones Widely available o mejoras progresivas). El resto depende de la política de soporte (§ 4, pregunta P1).

## 2. Alcance y método

- **Auditoría desde el código** del worktree sobre `origin/main` (`7a2740b4`, 2026-11-25): `apps/web/app`, `apps/web/src/ui` (≈ 380 archivos), `proxy.ts`, `src/security/csp.ts`, `tests/e2e/playwright.config.ts`, docs/28, docs/02 y la guía de pruebas funcionales. **No se levantó la app** (requiere el stack con Docker y Keycloak; no se usó Docker por las reglas de entorno). Las observaciones de comportamiento en el navegador quedan como supuestos a confirmar en la revisión de `frontend` (§ 10).
- **Guías revisadas**: las 170 de las categorías `accessibility/*`, `forms/*`, `ui-components/*`, `ui-behaviors/*`, `ui-atoms/*`, `user-experience/*`, `visual-design/*`, `css/*`, `performance/` y `pwa/` (resumen, encabezados y datos de compatibilidad de cada una), y en detalle 29 (reglas obligatorias y prohibiciones) de las que tocan los flujos de PFOS; de `performance/` y `pwa/` se usaron las que afectan la experiencia (INP, tareas largas, renderizado diferido, búsquedas en segundo plano, transiciones, instalación). Quedaron fuera (41 de 211) `built-in-ai`, `security` (ya cubierto por `add-web-content-security-policy`), `html` de web components, `wasm` y `webmcp`.
- **Datos de soporte**: los estados Baseline y fechas citados salen de la sección de compatibilidad de cada guía en ese commit; no se volvieron a verificar contra webstatus.dev (supuesto a revalidar al abrir cada change). El agente `frontend` los contrastó con cada guía en la revisión (§ 11.2): 3 correcciones.
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
| 29 apariciones de colores hexadecimales fijos en 10 archivos TS/TSX, 4 en CSS de módulo y un bloque que redeclara 13 tokens | `dashboard/styles.ts:12,21,24-27`, `lifecycle/LifecycleDiagram.tsx:4-7,132`, `fx/ConversionForm.tsx:391` y otros 7 archivos (lista completa en § 11.1, punto 5); `dashboard/home.css:2-15` (tokens propios de `.pf-home`) y `:240-243`; `upcoming/upcoming.css:38` | Rompen cualquier tema oscuro y saltean los tokens. |
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
| M-04 | [`forms/ime-safe-enter-submit`][g-ime] | Brecha menor | `recurring/OccurrenceActionPanel.tsx:402-406` busca con Enter sin comprobar composición. | Con teclados con composición (o algunas teclas muertas) la búsqueda se dispara a mitad de palabra. | Ignorar Enter si `event.isComposing` **o** `keyCode === 229`: las dos comprobaciones, porque `isComposing` es Limited y en Safari llega en falso (§ 11.2). | Could | S |
| M-05 | [`forms/form-fields-automatically-fit-contents`][g-fieldsizing] | Brecha | Notas y motivos con alto fijo (`globals.css:173-175`). | Motivos de anulación largos se editan en una caja chica. | `field-sizing: content` con `min/max-block-size` como mejora progresiva (Newly 2026-06-16; sin él queda el alto actual). | Could | S |

### 5.2 Diálogos, menús y avisos

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-06 | [`ui-components/dialog`][g-dialog], [`ui-behaviors/prevent-page-scroll-under-modal-dialog`][g-scrolllock] | Brecha | 0 `<dialog>`. `ConfirmPanel` (`common/ui.tsx:130-184`, 39 usos) enfoca el contenedor (`:156-158`), pone "Confirmar" antes que "Cancelar" (`:175-180`) y al cancelar se desmonta sin devolver el foco (p. ej. `transactions/TransactionDetail.tsx:572`). | Al anular una transacción, revertir un import o cerrar un periodo, quien usa teclado pierde el foco al cancelar; el botón destructivo queda primero y a mano. | Dos niveles: (a) confirmaciones locales y reversibles siguen en línea, pero devuelven el foco al disparador y ponen el foco inicial en la acción segura; (b) acciones irreversibles o con efecto contable (anular, revertir import, cerrar periodo, eliminar, archivar) pasan a un `ConfirmDialog` con `<dialog>` + `showModal()` (Widely), nombre por `aria-labelledby`, foco inicial en "Cancelar" (con `focus()` tras `showModal()`: el `autoFocus` de React no sirve dentro de un `<dialog>` cerrado), `role="alertdialog"` explícito (7 specs E2E lo usan; sin `aria-modal` ni trampa de foco manual) y `overscroll-behavior: contain` como mejora progresiva (Limited en contenedores sin desbordamiento; sin Safari). Detalle en § 11.1 punto 1. | Must | M |
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
| M-16 | [`ui-atoms/responsive-table`][g-table] | Parcial | 43 de 84 envoltorios `tableWrapStyle` tienen `role="region"` + `tabIndex={0}` (`PreviewTable.tsx:132` sí); 0 cabeceras fijas (`common/ui.tsx:53-61`). | En la vista previa del import (cientos de filas) y en cronogramas de préstamo se pierde a qué columna corresponde cada monto al desplazarse. | Cabecera `position: sticky` y primera columna fija en tablas anchas; alto máximo con desplazamiento propio en tablas de mucho volumen; región con nombre y foco en el 100 % de los envoltorios; con `border-collapse: separate`; **sin** vista apilada por container queries (`display:block` pierde la semántica de tabla; § 11.1 punto 7). | Should | M |
| M-17 | [`ui-atoms/scrollability-affordance-hints`][g-scrollhint] | Brecha | Tablas con `overflow-x: auto` sin pista visual. | En móvil no se nota que hay más columnas a la derecha. | Desvanecido con máscara animada por desplazamiento (Newly 2026-10-27) como mejora; sin soporte queda la barra visible. Las sombras con scroll-state queries son Limited: no. | Could | S |
| M-18 | [`ui-behaviors/sortable-table`][g-sort], [`ui-behaviors/dynamic-sort`][g-dynsort] | Brecha | 0 `aria-sort`; no hay orden por columna. | Para comparar gastos por categoría o líneas de presupuesto hay que leer toda la tabla. | En tablas comparativas (reportes, presupuesto vs real, suscripciones): botón dentro de `th`, `aria-sort` solo en la columna activa, ordenar por el valor y no por el texto formateado (montos Decimal en string), mover las filas existentes y anunciar una vez en `role="status"`. | Could | M |
| M-19 | [`performance/defer-rendering-heavy-content`][g-cv], [`performance/interactions-in-complex-layouts`][g-complex] | Brecha (a medir) | 0 `content-visibility`; listas largas completas (vista previa del import, auditoría, transacciones). | Supuesto: con extractos grandes, abrir filas o decidir duplicados tarda en responder. | Medir primero (M-30). Si se confirma, paginar o "mostrar más" la vista previa; `content-visibility: auto` + `contain-intrinsic-size` solo en bloques que no sean filas de tabla (no actúa sobre `tr`/`tbody`; § 11.1 punto 8; Newly 2025-09-15). | Should | S |

### 5.5 Tema, color y tipografía

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-20 | [`visual-design/dark-mode`][g-dark], [`ui-atoms/component-specific-light-dark-theme`][g-cdark] | Brecha | `color-scheme: light` fijo (`globals.css:16`); sin `<meta name="color-scheme">` (`app/[locale]/layout.tsx:36-41`); 18 hexadecimales fijos (§ 3.2). NFR-USAB-103 exige contraste "en modo claro y oscuro". | Uso nocturno con el teléfono: pantalla blanca; incumple un NFR Must. | Tokens oscuros con `@media (prefers-color-scheme: dark)` y `:root[data-theme]` más `color-scheme: light dark` (o `light-dark()` dentro de `@supports`; § 11.1 punto 5); valores oscuros de docs/28 §5.1 (contraste medido: § 6); borrar el bloque de tokens propio de `.pf-home` (`home.css:2-15`) y migrar los 29 hexadecimales a tokens; temas de gráficos desde tokens. | Should | M |
| M-21 | [`ui-components/dark-mode-toggle`][g-darktoggle] | Brecha | No hay preferencia de tema; docs/28 §9 pide `system`/`light`/`dark` persistido por usuario. | — | Sin interruptor permanente en la barra (la guía lo desaconseja para usuarios no técnicos). Control de 3 estados en Preferencias, guardado en el perfil (`preferences.theme` de `/me`, sin cambio de contrato) y aplicado **en el servidor** con una cookie espejo `pfos_theme` (§ 11.1 punto 4) (`data-theme` y `<meta name="color-scheme">` en el HTML), sin script en línea (CSP) ni parpadeo. | Should | S |
| M-22 | [`visual-design/browser-ui-theming`][g-browserui], [`visual-design/customize-scrollbar-color-and-thickness`][g-scrollbar] | Parcial | `accent-color` en casillas y radios (`globals.css:184-190`); sin `theme-color`. | La barra del navegador móvil no acompaña el tema. | `theme-color` por esquema con la exportación `viewport` de Next (sin script); barras de desplazamiento nativas (no se personalizan). | Could | S |
| M-23 | [`visual-design/typography`][g-type], [`visual-design/improve-text-layout-and-legibility`][g-textlayout] | Parcial | Escala `rem` y fuentes del sistema (cumple); sin `text-wrap: balance` en títulos ni `pretty` en párrafos; sin medida máxima en textos de ayuda. | Títulos largos en español (≈ 25 % más que en inglés) cortan con una palabra huérfana. | `text-wrap: balance` en `h1-h3` y `pretty` en `p, li` (Limited; sin soporte no cambia), `max-inline-size: 70ch` en párrafos de ayuda. | Could | S |
| M-24 | [`accessibility/respect-os-text-scale`][g-textscale] | Parcial | No se fija `font-size` raíz (cumple); breakpoints en px (`globals.css:637,644,658,675`) y 19 `white-space: nowrap`. `<meta name="text-scale">` es Limited. | Con texto del sistema al 200 % el diseño de escritorio se mantiene aunque el texto ya no entre. | Media queries en `em`; revisar los `nowrap` en bloques de texto (se conservan en montos y fechas). No adoptar `text-scale` todavía. | Could | S |
| M-25 | [`visual-design/visually-stable-font-fallbacks`][g-fontfallback] | No aplica | Fuentes del sistema; docs/28 pregunta 6 sigue abierta (Inter autohospedada). | — | Si se adopta Inter, `font-size-adjust` para evitar saltos; si no, nada. | — | — |

### 5.6 Movimiento y transiciones

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-26 | [`ui-behaviors/motion`][g-motion] | Brecha | Regla global `*{animation-duration:0.01ms !important; transition-duration:0.01ms !important}` (`globals.css:701-711`), que la guía prohíbe expresamente porque vuelve algunas animaciones más bruscas. El Home ya lo resuelve bien por componente (`dashboard/home.css:300`). | Quien pide menos movimiento recibe cambios instantáneos en lugares donde un fundido suave sería más cómodo; además pisa decisiones locales. | Quitar la regla global; cada animación declara su variante dentro de `@media (prefers-reduced-motion: no-preference)` o `reduce`, junto a la regla. Animar solo `opacity` y `transform`. | Must | S |
| M-27 | [`ui-behaviors/animate-to-from-top-layer`][g-toplayer], [`ui-behaviors/animate-element-entry-exit`][g-entryexit] | No aplica hoy | Sin elementos en la capa superior. | — | Al crear el diálogo, el cajón y los avisos (M-06, M-07, M-11): entrada y salida con `@starting-style` y `transition-behavior: allow-discrete` como propiedad aparte (Newly 2024-08; sin soporte aparecen sin animación; `transition-behavior` aplicado a `display` es Limited). | Could | S |
| M-28 | [`ui-behaviors/same-document-transitions`][g-samedoc], [`ui-behaviors/group-element-transitions`][g-group] | Brecha | Cambios de filtro o de pestaña reemplazan el contenido de golpe. | Al filtrar la vista previa del import se pierde la referencia visual de qué cambió. | `document.startViewTransition()` detectando soporte (Newly 2025-10-14), solo con `no-preference`. | Could | M |
| M-29 | [`ui-behaviors/cross-document-transitions`][g-crossdoc] | Brecha | La navegación es por documento completo (§ 3.2) y no tiene transición. | Cada cambio de sección "parpadea" en blanco. | `@view-transition { navigation: auto; }` en CSS, dentro de `no-preference` (Limited: en navegadores sin soporte no pasa nada). Validado por `frontend` (§ 11.1 punto 6): la regla queda inerte si se migra a `next/link`, que mejora más la velocidad percibida pero es un change aparte (P12); decidir P12 antes de construirla. | Could | S |

### 5.7 Rendimiento percibido

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-30 | [`performance/identify-inp-causes`][g-inp], [`performance/break-up-long-tasks`][g-longtasks], [`performance/performance`][g-perf] | Sin medir | No hay medición de INP en la web; los flujos con más trabajo en el cliente son la vista previa del import, la edición masiva, el simulador de deudas y los reportes. | Supuesto: respuestas lentas en extractos grandes o teléfonos modestos. | Medir INP con `PerformanceObserver` (event timing, Newly 2025-12-12) en la suite e2e y en desarrollo, sin servicios de terceros. Donde haya tareas > 50 ms, ceder el hilo (`scheduler.yield()` con respaldo `setTimeout`) o mover cálculo al servidor. | Should | M |
| M-31 | [`performance/deprioritize-background-fetches`][g-bgfetch], [`performance/detect-initial-visibility-state`][g-visibility] | Brecha | Sondeos que siguen con la pestaña oculta: `imports/ImportWizard.tsx:161-181`, `forecasts/ForecastsPage.tsx:21-22`, `DemoDataPanel.tsx:21`. | Gasto de batería y datos móviles en segundo plano. | Pausar con `visibilitychange` y reanudar al volver; `priority: 'low'` en las consultas de fondo (Newly; se ignora si no hay soporte). | Could | S |
| M-32 | [`performance/improve-next-page-load-performance`][g-speculation] | No adoptar | — | — | Speculation rules es Limited, requiere un `<script>` en línea (nonce) y prerenderizar páginas autenticadas con efectos es riesgoso. Se registra y se descarta por ahora. | — | — |

### 5.8 Instalación (PWA)

| ID | Guía | Estado | Brecha (archivo:línea) | Impacto para el usuario | Mejora | Prio | Esf. |
|---|---|---|---|---|---|---|---|
| M-33 | [`pwa/install-web-app`][g-install] | Brecha | Sin manifiesto (`apps/web/public/` vacío); docs/00 y docs/28 §11 la dejan como Could. | No se puede "instalar" PFOS en el teléfono para registrar un gasto con un toque. | Manifiesto estático con `id` estable, `start_url`, `display: standalone`, íconos y `theme_color`; enlazado desde `metadata.manifest` de Next. Botón "Instalar" solo cuando llega `beforeinstallprompt` (Chromium); nunca un botón que no funcione (`<install>` y `navigator.install()` no tienen soporte todavía). Sin service worker en esta etapa (ver P5). Según la guía el manifiesto es Limited: se trata como mejora. Los íconos no existen y hay que diseñarlos (§ 11.1 punto 10). | Could | M |
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
| L2 | `add-quick-capture` | Must | M-03, M-07, alta en el lugar con "registrar otro", cuenta recordada (P11), acceso "＋" | M-01 (utilidad de foco al error) | M |
| L3 | `add-dark-theme` | Should | M-20, M-21, M-22, tokens de § 6, migración de los 29 hexadecimales y del bloque `.pf-home` | P1, P2 | M |
| L4 | `refine-mobile-navigation` | Should | M-11, M-12, M-13, M-08, M-27 | P4; L2 (botón ＋) | L |
| L5 | `refine-data-tables` | Should | M-16, M-17, M-18, M-10, M-19, M-30 (medición) | P1 | M |
| L6 | `add-pwa-install` | Could | M-33, M-22 | P5; dominio definitivo | M |
| L7 | `refine-perceived-performance` | Could | M-28, M-29, M-31, M-09, M-23, M-24, M-05 | P1; resultado de M-30 | M |

Deuda transversal (sin lote propio): reducir `style={{…}}` y mover estilos a clases por dominio cada vez que un lote toque ese dominio; actualizar docs/28 al as-built (sin Tailwind, shadcn ni ECharts) si el owner lo confirma (P7).

## 9. Riesgos

| Riesgo | Detalle | Mitigación |
|---|---|---|
| **CSP con nonce** | La política (`src/security/csp.ts:45-60`) permite estilos en atributo (`style-src-attr 'unsafe-inline'`) pero no `<style>` ni `<script>` en línea sin nonce. Un tema sin parpadeo suele resolverse con un script en línea en `<head>`; speculation rules también requiere script en línea. | Tema aplicado en el servidor desde una cookie espejo del perfil (M-21); nada de `<style>`/`<script>` en línea nuevos; CSS en `globals.css` u hojas de módulo; si hiciera falta un polyfill (opción A de P1), autohospedado en el bundle, nunca desde un CDN. El manifiesto queda fuera del `matcher` de `proxy.ts:73` y lo cubre `default-src 'self'`. Un service worker futuro exigiría revisar `worker-src`. |
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
| P10 | ¿Cómo cubrimos Safari/WebKit en E2E? (§ 11.1 punto 12) | A. Solo Chromium. B. Proyecto `webkit` con ≈ 5 specs dentro del job `e2e` existente, tras un spike que confirme que el login funciona en WebKit con la cookie `Secure` sobre `http` de loopback. C. Los 56 specs en WebKit. D. Job nocturno nuevo (reconstruye imágenes). | **B**: no hay E2E nocturno, C no cabe en los 40 min del job y D es caro. Si el spike falla, volver al owner (cambiar el atributo de la cookie en pruebas es una decisión de seguridad). Concreta P8=B. |
| P11 | ¿Dónde se guarda la "última cuenta usada" del alta rápida? Cada `PATCH /me` sube `Me.version` y genera un evento de auditoría. | A. `preferences` de `/me` (servidor), escrito solo si cambia. B. `localStorage` por usuario y workspace (por dispositivo, sin auditoría). C. La cuenta de la última transacción registrada (consulta, sin estado nuevo). | **B**: es una comodidad por dispositivo, no un dato del perfil, y no ensucia la auditoría ni compite por `If-Match`. Si el owner quiere que viaje entre dispositivos, A con escritura solo al cambiar. |
| P12 | ¿Migramos la navegación a `next/link` (cliente) o mantenemos documentos completos con `@view-transition`? (§ 11.1 punto 6) | A. Mantener documentos completos y, si se quiere, la transición entre documentos (M-29). B. Change aparte `adopt-client-navigation` (L: 203 enlaces, 12 `location.assign`, specs que esperan `ready`), después de medir INP y navegación (M-30). C. Migrar ahora dentro de L4. | **B**, y no construir M-29 hasta decidirlo: ambas vías son excluyentes. Mientras tanto, A sin M-29. |

## 11. Viabilidad técnica (revisada por el agente `frontend`, 2026-11-25)

> **Método:** lectura del código de `apps/web` en `origin/main` (`7a2740b4`), de `proxy.ts`, `src/security/csp.ts`, `contracts/openapi/finance-api.v1.yaml`, `docker/web.Dockerfile`, `.github/workflows/pr.yml`, `tests/e2e` y de los tipos instalados (`@types/react` 19.3.0, `react-dom` 19.3.0, TypeScript 6.0.3 `lib.dom.d.ts`). **No se levantó la app ni Docker, y el worktree no tiene `node_modules` instalado:** lo que dependía del navegador o de ejecutar código queda como supuesto con su método de verificación (§ 11.3). Stack: Next 16.4.5, React 19.3.0, next-intl 4.14.9, sin framework CSS, Playwright 1.63.0 (`pnpm-workspace.yaml:37-46`).

### 11.1 Veredicto por punto

| # | Punto | Veredicto | Evidencia | Condiciones y riesgos |
|---|---|---|---|---|
| 1 | `<dialog>` + `showModal()` y `ConfirmDialog` | **Viable con condiciones** | `ConfirmPanel` en `src/ui/common/ui.tsx:130-184` (39 usos con `<ConfirmPanel`, 33 `testId` distintos, 26 archivos). `role="alertdialog"` lo exigen 7 specs E2E (`tests/e2e/specs/a11y.spec.ts:207`, `accounts.spec.ts:97`, `lifecycle.spec.ts:62`, `month-closing.spec.ts:198`, `reconciliation.spec.ts:162`, `transactions.spec.ts:119`) y un test unitario (`src/ui/planning/closing.test.tsx:277`). Los tests unitarios usan `renderToStaticMarkup`, sin DOM. `reactStrictMode: true` (`next.config.ts:13`). | (a) `ConfirmDialog` con **la misma firma que `ConfirmPanel`** (título, descripción, etiquetas, `busy`, `confirmDisabled`, `onConfirm`, `onCancel`, `children`, `testId`): migrar cada uso es un cambio de una línea y el `data-testid` va en el `<dialog>`. (b) **Conservar `role="alertdialog"`** en el `<dialog>` (ARIA lo permite): sin él se rompen 7 specs; la regla de la guía "sin `role="dialog"`" no aplica a `alertdialog`. La propuesta no lo decía. (c) Se monta solo cuando está abierto y abre con `ref.current.showModal()` en un efecto, con guarda `if (!el.open)` (StrictMode ejecuta el efecto dos veces) y `close()` al desmontar. (d) **`autoFocus` de React no sirve:** React llama a `focus()` al montar, con el `<dialog>` aún cerrado; hay que llamar `cancelRef.current?.focus()` justo después de `showModal()`. (e) Esc dispara `cancel` y luego `close`: mapear `onCancel` y `onClose` de React a `onCancel` del componente, sin duplicar la llamada. `returnValue` no hace falta (los botones llaman a `onConfirm`/`onCancel`). (f) El foco vuelve solo al disparador al cerrar (comportamiento nativo), lo que arregla la brecha. (g) De los 39 usos, el nivel (b) de M-06 abarca ≈ 20 (anular, revertir, cerrar, eliminar, archivar, descartar, revocar); los paneles de acción de `recurring/OccurrenceActionPanel.tsx` (aprobar, vincular, omitir, editar) llevan formularios y búsquedas y siguen en línea. (h) Riesgo E2E: los locators por `testid`/rol siguen valiendo; los que usen `.first()` sobre botones del panel cambian de orden al poner "Cancelar" primero. Revisar con `grep` al migrar. (i) `overscroll-behavior` sobre contenedores sin desbordamiento es **Limited** (sin Safari): mejora progresiva (§ 11.2). (j) Test unitario del diálogo: sin DOM no se puede probar `showModal()`; la cobertura es E2E (Chromium) más el marcado estático. |
| 2 | Tipos JSX de `popover`, `command`, `enterKeyHint` | **Viable** | `@types/react` 19.3.0: `popover` (`index.d.ts:2940`), `popoverTarget`/`popoverTargetAction` (`:2941-2942`), `enterKeyHint` (`:2895`), `onToggle`/`onBeforeToggle` (`:2557-2558`), `inert` (`:2948`) están tipados. **`command` y `commandfor` no existen** en `@types/react` ni en `react-dom` 19.3.0. TS 6.0.3 `lib.dom.d.ts` sí trae `CommandEvent`, `closedBy`, `Scheduler.yield`, `PerformanceEventTiming`; **no trae `ariaNotify`**. | `command`/`commandfor`: no usarlos (con P1=B el `showModal()` por script es la vía Widely y hace falta script igual para el estado de React). Si se quisieran, módulo de aumentación (`declare module 'react' { interface ButtonHTMLAttributes<T> { command?: string; commandfor?: string } }`), en minúsculas (React 19 pasa los atributos desconocidos tal cual, pero `onCommand` no existe: habría que usar `addEventListener` desde un ref). `ariaNotify`: un `declare global` de 5 líneas con detección (`'ariaNotify' in document`). `popover` manual requiere `showPopover()` imperativo (un `popover="manual"` nace oculto). Cero dependencias. |
| 3 | Región de avisos y navegación por documento completo | **Viable con condiciones** | El alta navega con `window.location.assign(...?aviso=registrada)` (`TransactionDetail.tsx:111-114`, `TransferForm.tsx:122`, `ConversionForm.tsx:243`: 12 usos de `location.assign` en total). `AppFrame` es cliente y vive dentro de `SessionProvider` (`app/[locale]/(app)/layout.tsx:12-16`). | Con P3=B el aviso nace **en la misma página** (el formulario se limpia y no se navega), así que no hace falta persistir nada: contexto de React en `AppFrame` (vive mientras dure el documento). Los avisos que sí cruzan una navegación siguen el patrón actual `?aviso=` (ya probado en E2E). **Nada de `sessionStorage`:** un aviso "Deshacer" que reaparece tras recargar apunta a una acción vencida. "Ver" navega al detalle (documento nuevo) y descarta el aviso: es lo esperado. La región (`role="region"` con nombre) se renderiza siempre en `AppFrame` (también en estado `loading`); los textos i18n (es/en/pt) viven en el catálogo. Deshacer = el mismo comando de anulación con If-Match; si el periodo se cerró, se muestra el problema del catálogo. Con `ariaNotify` ausente (Newly 2026-09-14) queda `role="status"`. Riesgo: tests que buscan `role="status"` por `testid` no se ven afectados (los avisos nuevos llevan `testid` propio). |
| 4 | Tema en el servidor sin parpadeo y campo nuevo en `/me` | **Viable con condiciones** | `Me` ya tiene **`preferences`: objeto libre** (`contracts/openapi/finance-api.v1.yaml:16352-16355`), y `MeUpdate.preferences` lo acepta con merge-patch por clave (`:16394`; `packages/contexts/identity/src/domain/user.ts:22`, `identity-http.ts:196-206`). **No hace falta ningún campo nuevo ni cambio de contrato**: `preferences.theme` ∈ `system\|light\|dark`. El cliente carga `/me` **después** del render (`SessionProvider`, estado `loading` en `AppFrame.tsx:78`); `requireSession()` solo valida la sesión (`src/bff/require-session.ts`), no lee el perfil. El layout raíz (`app/[locale]/layout.tsx:36-41`) ya es dinámico por `connection()` pero sirve también las páginas públicas `/auth`. | Leer `/me` en el layout añadiría una llamada a la API en cada documento: no se hace. Diseño: **cookie espejo no sensible `pfos_theme=light\|dark`** (sin la clave = `system`), `Path=/; SameSite=Lax; Max-Age=1 año`, que escribe el cliente al guardar la preferencia (igual que `NEXT_LOCALE`, `AppFrame.tsx:235`) y el BFF en el callback de login, que **ya llama a `GET /me`** (`bff.ts:218`; hoy solo lee `id`) y puede emitir la cookie en la misma respuesta (`bff.ts:246-247`) sin llamada extra. El layout raíz lee `cookies()` y pone `<html data-theme>`; el `color-scheme` y `theme-color` salen de `generateViewport` (`viewport.colorScheme` y `themeColor`), sin `<script>` ni `<style>` (CSP intacta). Sin cookie = `system`: `color-scheme: light dark` y `@media (prefers-color-scheme)` resuelven sin parpadeo. Único caso con un destello: primer documento de un dispositivo nuevo cuyo override difiere del sistema y que no pasó por el login del BFF (no ocurre: toda sesión nace en el callback). Costo extra no previsto: cada `PATCH /me` sube `Me.version` y **genera un evento de auditoría** `identity.user.preferences_changed` (`identity.service.ts:164`). Tolerable para el tema (cambio raro); inadecuado para "última cuenta usada" (ver P11). Contrato: opcional documentar `preferences.theme` en la descripción del schema (aditivo, `oasdiff` limpio). |
| 5 | `light-dark()`, `color-scheme` e inventario de colores | **Viable con condiciones** | Hoja base: 24 tokens de color en `globals.css:19-47`, sombras con `rgb()` en `:77-78`. **`.pf-home` redeclara 13 tokens con hexadecimales propios** (`src/ui/dashboard/home.css:2-15`, más `--pf-track`) y 4 hexadecimales sueltos (`home.css:240-243`, `upcoming/upcoming.css:38`). TS/TSX: **29 apariciones en 10 archivos** (no 18): `accounts/AccountForm.tsx:350`, `AccountsListView.tsx:123`, `classification/fields.tsx:21,93,105`, `dashboard/styles.ts:12,21,24-27`, `fx/ConversionForm.tsx:391,397`, `lifecycle/LifecycleDiagram.tsx:4-7,72,111,120,132-133,162,177`, `LifecycleReport.tsx:143,145`, `LifecycleTab.tsx:118`, `transactions/SplitsEditor.tsx:61,203`, `TransactionsListView.tsx:128`. Los demás CSS de módulo (`cash-flow`, `forecasts`, `networth`, `report-chart`, `reports`) ya usan solo `var(--pf-*)`. | **Bloqueante para el tema oscuro:** el bloque de `.pf-home` pisa los tokens raíz y deja el Home en claro; hay que borrarlo y migrar `--pf-track`, `--pf-fin-expense` (aquí `#334155`, en raíz `#0f172a`: ¿intencional? ver 11.4) a la hoja base. Con P1=B, `light-dark()` (Newly) cae al claro sin soporte; pero **un token personalizado con `light-dark()` es válido para el parser aunque el navegador no lo soporte, y al usarlo (`background: var(--pf-bg)`) el valor queda inválido en tiempo de cómputo, sin caer en una declaración anterior** (el respaldo `--pf-bg:#fff; --pf-bg:light-dark(...)` no funciona): hay que envolver los tokens oscuros en `@supports (color: light-dark(white, black))` o usar `@media (prefers-color-scheme: dark)` + `:root[data-theme]` en lugar de `light-dark()` (Widely, mismo costo). **Recomendado el segundo:** evita el caso y no exige `color-scheme` para evaluar. El diagrama de ciclo de vida (`LifecycleDiagram.tsx`) pasa los colores como atributos SVG (`fill`/`stroke` en TSX): pasarlos a clases CSS con tokens (`--pf-chart-*`). Los 1 291 `style={{…}}` con `var(--pf-*)` heredan el tema sin tocarlos. E2E: agregar una pasada de axe con `colorScheme: 'dark'` (Playwright lo soporta) al `a11y.spec.ts`. |
| 6 | `next/link` frente a documentos completos y `@view-transition` | **Viable con condiciones, pero como change aparte (L); no sustituye a M-29** | 0 usos de `next/link`; 203 `<a href>` en `src` y 12 `location.assign`; la navegación por documento es una decisión de facto, no un bloqueo técnico. `proxy.ts:73` incluye en su `matcher` las peticiones RSC (`?_rsc=`): cada navegación del cliente volvería a pasar por `proxy`, generaría un nonce y comprobaría la cookie (barato, sin red). `layout` autenticado con `force-dynamic` y `await connection()`. `e2e` espera `getByTestId('ready')` tras el login (`tests/e2e/src/helpers.ts:32`, `finance.ts:97`). | (a) Ganancia real: se evita rehidratar y recargar `/me` en cada clic (el `SessionProvider` persiste). (b) Costo: un `AppLink` común que aplique el prefijo de locale (`localized()`), 203 anclas y 12 `assign` (los de después de mutar fuerzan recarga a propósito), más revisar estado que hoy se reinicia por la recarga. (c) **Incompatibilidad:** `@view-transition { navigation: auto }` solo actúa en navegaciones de documento; con `next/link` queda inerte (Next requeriría `experimental.viewTransition`, no evaluado). Por eso M-29 (Could, Limited) **no debe construirse si se va a migrar**. (d) El E2E `ready` queda atached entre navegaciones (el marco persiste) y deja de esperar la página nueva: los specs deben esperar contenido propio (la mayoría ya lo hace). Ver P12. |
| 7 | Cabecera fija en tablas con `overflow-x: auto` | **Viable con condiciones** | `tableWrapStyle` (`common/ui.tsx:53-61`) con `overflowX:'auto'`; `tableStyle` con `borderCollapse:'collapse'` en línea (`:62`); `thead th` ya tiene fondo (`globals.css:249-251`); no existe ningún `@media print` en `apps/web`. 96 referencias a `tableWrapStyle` en 47 archivos (importaciones incluidas; la cifra de la propuesta, 84 envoltorios, queda como orden de magnitud: no se recontó a nivel de elemento). | El `sticky` vertical solo actúa si **el propio envoltorio tiene `max-block-size`** (un `overflow-x:auto` vuelve a `overflow-y` computado `auto` y la cabecera se pega a ese contenedor, que no desplaza): clase `.pf-table-wrap--tall` con `max-block-size: min(32rem, 70dvh)`, no el envoltorio por defecto. La guía pide `border-collapse: separate; border-spacing: 0`; cambiarlo pierde los bordes colapsados: pasar las líneas a `border-block-end` por celda (cambio en `cellStyle`, `common/ui.tsx:63`). `position: sticky` sobre cada `th` de la cabecera con `z-index` y fondo opaco. **Impresión:** `@media print { max-block-size: none; overflow: visible }` o se recorta. Lectores de pantalla: el `sticky` no cambia la semántica; el foco del envoltorio (`role="region"` + `tabIndex=0`) ya existe en `PreviewTable.tsx:132` y debe extenderse al 100 %. **Vista apilada con container queries: no recomendada tal cual:** `display:block` sobre `table/tr/td` hace que Safari y Chrome pierdan la semántica de tabla; si el owner la pide, hay que restituir `role="table\|row\|cell\|columnheader"`. Se retira del alcance de M-16 (§ 5.4). Primera columna fija: solo en tablas con encabezado de fila (`th scope="row"`); muchas tablas de PFOS no lo tienen. |
| 8 | `content-visibility` en filas de tabla | **No viable tal como está redactado** (en `tr`/`tbody`); viable en otros bloques | 199 `<tr` en `src` (sin tests), 0 `content-visibility`. Sin DOM no se pudo medir. | Según la especificación de CSS Containment, la contención de tamaño y de diseño **no se aplica a los elementos internos de tabla** (`display: table-row`, `table-row-group`): `content-visibility: auto` sobre `tr` o `tbody` se ignora (supuesto de especificación, a confirmar en Chromium con un extracto de 2 000 filas). Alternativas: (1) **paginar o "mostrar más"** la vista previa del import (corta el DOM, que es lo que cuesta); (2) `content-visibility:auto` + `contain-intrinsic-size:auto <alto>` en listas hechas con `li`/`div` o en secciones fuera de pantalla (tarjetas del Home, secciones de reportes); (3) ventanear con IntersectionObserver (L, no recomendado). M-19 se ajusta a "medir primero; si se confirma, paginar" (§ 5.4). |
| 9 | Medir INP sin dependencias nuevas | **Viable** | `PerformanceObserver` con `type: 'event'` (Event Timing, Newly 2025-12-12 según `performance/identify-inp-causes`); Playwright 1.63.0 ya instalado; 0 usos de `web-vitals`/`PerformanceObserver` en el repositorio. TS trae `PerformanceEventTiming.interactionId`. | `page.addInitScript` registra el observador (`durationThreshold: 16`, `buffered: true`), agrupa por `interactionId` y toma el máximo (la métrica INP usa el percentil 98 de las interacciones, con ≤ 50 interacciones es el máximo). Solo Chromium es fiable en CI. Umbral inicial **informativo** (se imprime en el reporte; no falla): el runner compartido es lento y variable (la propia suite ya sufre por eso, `playwright.config.ts:22-25`); objetivo web.dev ≤ 200 ms, aviso en 500 ms. Pasar a gate solo tras 2-3 semanas de datos. Flujos: abrir fila de la vista previa del import, filtrar, "Aprobar", edición masiva. `web-vitals` no hace falta. Con CSP sin cambios (el observador corre desde Playwright, no desde la app). |
| 10 | Manifiesto PWA y `matcher` de `proxy.ts` | **Viable** | `proxy.ts:72-74`: el `matcher` `'/((?!api\|_next\|_vercel\|.*\\..*).*)'` **excluye todo path con punto**: `/manifest.webmanifest` y los íconos `*.png` no pasan por `proxy` (sin redirección al login ni CSP; el navegador pide el manifiesto sin credenciales). `docker/web.Dockerfile:63` copia `apps/web/public`; hoy `public/` está vacío. CSP: `manifest-src` y `img-src` caen en `default-src 'self'` / `'self' data: blob:` (`csp.ts:46,51`): sin cambios. `worker-src` no se toca (sin service worker). | `app/manifest.ts` (ruta de metadatos en la raíz de `app/`, fuera de `[locale]`) o `public/manifest.webmanifest`; enlace con `metadata.manifest` en `generateMetadata`. **Un solo manifiesto para los tres idiomas:** `lang: 'es-BO'`, `name` fijo; `start_url: '/'` (con `localePrefix: 'as-needed'` y la cookie `NEXT_LOCALE`, next-intl redirige al idioma del usuario) y un atajo "Registrar gasto" a `/transacciones/nueva` (solo en español). `id` estable y `scope: '/'`. Íconos: **no existen** y requieren diseño (192, 512 y maskable en PNG, supuesto: Chrome los pide en PNG); eso, no el código, es la tarea más lenta. Según la guía, "Web app manifest" figura como **Limited** (la instalación existe en Chromium y Safari móvil; no en Firefox de escritorio): se trata como mejora. Revisar `PFOS_ENV`/dominio definitivo antes de publicarlo (M-34). Sin service worker no hay modo sin conexión: coherente con P5=B. |
| 11 | Barra inferior, `scroll-padding` y teclado virtual | **Viable con condiciones** | `.pf-shell { min-height: 100vh }` (`globals.css:298`), barra lateral con `calc(100vh - …)` (`:690`), `scroll-padding-top` (`:602-604`); sin `viewport` exportado ni `visualViewport`/`interactive-widget` en el repositorio; `dvh` es Widely (2022-12-05). El E2E ya usa viewports de 360-375 px (`accounts.spec.ts:129`, `app-shell.spec.ts:99`). | (a) Sustituir `vh` por `dvh` en las dos reglas. (b) Barra inferior `position: fixed` con `padding-bottom: env(safe-area-inset-bottom)` (requiere `viewport-fit=cover` en `generateViewport`) y `scroll-padding-bottom` igual a su alto. (c) **Teclado virtual:** en Chrome Android (por defecto `resizes-visual`) y en iOS la barra fija queda tapada o flotando sobre el teclado; el alta rápida es justo el flujo con teclado abierto. Regla: ocultar la barra cuando hay un campo con foco (`.pf-shell:has(:is(input,select,textarea):focus) .pf-bottombar{display:none}`, `:has()` Widely 2023-12-19) y no mostrarla en `/transacciones/nueva`, que ya tiene su botón "Registrar". `interactive-widget=resizes-content` en `generateViewport` es opcional. (d) Con 5 destinos a 320 px y textos en español, etiquetas cortas con `text-overflow` y objetivo táctil ≥ 44 px. (e) `inert`/`<dialog>` modal para "Más" (Widely). (f) Verificación real solo en un teléfono o emulador: ver § 11.3. |
| 12 | Proyecto WebKit en Playwright | **Viable con condiciones** | `tests/e2e/playwright.config.ts:29-35`: 2 proyectos (`alerts`, `chromium`), `workers: 1`, 56 specs, timeout por test 90 s. Job `e2e` de `pr.yml` (timeout 40 min, instala `chromium --with-deps`, líneas 369-371); la cookie de sesión es `__Host-pfos_sid` con `Secure` (`bff.ts:107-112`) sobre `http` de loopback (el comentario `bff.ts:108` solo garantiza Chromium). `nightly.yml` **no tiene** E2E (jobs: regression, mutation, perf, fx-smoke-live). | (a) **Riesgo principal (supuesto):** WebKit (Playwright) puede rechazar cookies `Secure` sobre `http://localhost`; si es así el login no persiste y cualquier spec falla por motivos ajenos. Spike de 1 hora antes de comprometer nada: un spec de login en `--project=webkit`. Solución probable: servir el stack del E2E por HTTPS o relajar el atributo solo en el entorno de pruebas (decisión de seguridad: requiere al owner). (b) **Costo de CI:** `playwright install --with-deps chromium webkit` suma la descarga (~100-150 MB) y paquetes del sistema (~1-2 min); correr los 56 specs en WebKit prácticamente duplica el tiempo del job y no cabe en 40 min con margen (supuesto, sin medición). (c) Recomendado: proyecto `webkit` con un **subconjunto** (`testMatch`: `app-shell`, `a11y`, `transactions`, `auth`, `content-security-policy`; ≈ 5 specs, unos 5-8 min) dentro del job existente, sin dependencia de `alerts`; como no hay E2E nocturno, "nightly" exigiría un job nuevo que reconstruya imágenes (caro) o un `schedule` en `pr.yml`. Ver P10. (d) Firefox: no, hasta que WebKit esté estable. (e) Siempre con `PF_E2E_PROJECT=pfos-e2e-<nombre>` en local. |
| 13 | Esfuerzos S/M/L y orden de lotes | **Parcialmente mal estimados** (ajustes abajo) | § 5 y § 8. | Ver 11.5. El orden L1 → L2 → … se mantiene; L2 no depende de L1 salvo por `useFocusFirstError` (M-01), no por el diálogo. |

### 11.2 Fechas de Baseline contrastadas con las guías

Se cotejó cada fecha y estado de § 4 con la sección de compatibilidad de la guía correspondiente (commit `2b4aa13`, leído en local; no se consultó la red ni webstatus.dev, así que **lo que las guías no dicen sigue siendo supuesto**).

| Función | Dice el doc | Dice la guía | Resultado |
|---|---|---|---|
| `<dialog>` | Widely 2022-03-14 | Widely 2022-03-14 | Coincide |
| `:user-invalid` | Widely 2023-11-02 | Widely 2023-11-02 | Coincide |
| Container queries (tamaño) | Widely 2023-02-14 | Widely 2023-02-14 | Coincide |
| `:has()` | Widely 2023-12-19 | Widely 2023-12-19 | Coincide |
| `inert` | Widely 2023-04-11 | Widely 2023-04-11 | Coincide |
| `color-scheme` | Widely 2022-02-03 | Widely 2022-02-03 | Coincide |
| `light-dark()` | Newly 2024-05-13 | Newly 2024-05-13 | Coincide |
| `text-wrap: balance` | Newly 2024-05-13 | Newly 2024-05-13 | Coincide |
| `text-wrap: pretty` | "Newly; sin soporte no cambia" (M-23) | **Limited availability** | **Corregido** en M-23 |
| `@starting-style`, `transition-behavior` | Newly 2024-08-06 | Newly 2024-08-06 (la propiedad `transition-behavior` con `display` discreto: Limited) | Coincide; matiz agregado en M-27 |
| Popover | Newly 2025-01-27 | Newly 2025-01-27 (`popover="hint"`: Limited) | Coincide |
| `content-visibility` | Newly 2025-09-15 | Newly 2025-09-15 | Coincide |
| View transitions (mismo documento) | Newly 2025-10-14 | Newly 2025-10-14 | Coincide |
| Invoker commands | Newly 2025-12-12 | Newly 2025-12-12 | Coincide |
| `ariaNotify()` | Newly 2026-09-14 | Newly 2026-09-14 | Coincide |
| `field-sizing` | Newly 2026-06-16 | Newly 2026-06-16 | Coincide |
| Scroll-driven animations | Newly 2026-10-27 | Newly 2026-10-27 | Coincide |
| Event Timing (INP) | Newly 2025-12-12 | Newly 2025-12-12 | Coincide |
| Fetch priority | "Newly" | Newly 2024-10-29 | Coincide |
| `dvh`/`svh` | Widely | Widely 2022-12-05 | Coincide |
| `enterkeyhint` | (sin dato) | Widely 2021-11-02 | Se agrega; no requiere respaldo |
| `overscroll-behavior` (en `<dialog>` y `::backdrop`) | Presentado como regla del diálogo sin matiz | **Limited** (Chrome 144, Firefox 150; sin Safari) para contenedores sin desbordamiento | **Corregido** en M-06 |
| `KeyboardEvent.isComposing` | "ignorar Enter si `isComposing` o `keyCode === 229`" | **Limited** (la guía documenta que en Safari llega en falso) | **Corregido** en M-04: ambas comprobaciones son obligatorias |
| `scheduler.yield()` | "con respaldo `setTimeout`" | Scheduler API: **Limited** | Coincide; se aclara que el respaldo es obligatorio |
| Web app manifest / `beforeinstallprompt` | Sin estado | **Limited** | **Agregado** en M-33 |
| Transiciones entre documentos, `closedby`, `popover=hint`, interest invokers, scroll-state queries, `focusgroup`, `hidden=until-found`, `<meta name="text-scale">`, speculation rules, anchor positioning | Limited | Limited | Coincide |

### 11.3 Supuestos que quedan sin verificar y cómo comprobarlos

| Supuesto | Método |
|---|---|
| `autoFocus` de React no enfoca dentro de un `<dialog>` aún cerrado (§ 11.1 punto 1) | Spec E2E del `ConfirmDialog`: tras abrir, `expect(cancelButton).toBeFocused()`; se prueba en el primer PR del lote L1. |
| `content-visibility` no actúa sobre `tr`/`tbody` (punto 8) | Chromium con un extracto sintético de 2 000 filas; comparar el INP de § 11.1 punto 9 con y sin la regla. |
| WebKit rechaza `Secure` sobre `http://localhost` (punto 12) | `npx playwright test --project=webkit` de `auth.spec.ts` contra el stack `pfos-e2e` (con `PF_E2E_PROJECT=pfos-e2e-<nombre>` y puertos con prefijo 3 o 4). |
| El tema por cookie no parpadea en el primer documento | Playwright con `colorScheme: 'dark'` y cookie `pfos_theme=light`: capturar la primera pintura (`page.screenshot` tras `domcontentloaded`) y comprobar `html[data-theme]` en el HTML crudo (`response.text()`). |
| Barra inferior y teclado virtual (punto 11) | Dispositivo real (Android y iOS) o emulación de Chrome DevTools; Playwright no simula el teclado virtual. |
| Que `@view-transition` no se combine con `next/link` | Prueba manual en un spike si se decide P12=C. |
| Contraste de los tokens oscuros de § 6 | Ya medidos en la propuesta; sin recalcular. Repetir con axe en el modo oscuro de Playwright. |

### 11.4 Hallazgos nuevos que cambian el trabajo

1. **`.pf-home` redeclara 13 tokens** (`home.css:2-15`) y rompería el tema oscuro del Home (punto 5). Incluye `--pf-fin-expense: #334155` frente a `#0f172a` de la raíz: se unifica el valor al migrar (no se cambia en silencio: si la diferencia fue intencional, se conserva como token nuevo `--pf-fin-expense-soft`).
2. **El inventario de colores fijos era incompleto**: 29 apariciones en 10 archivos TS/TSX (la propuesta decía 18), más 4 hexadecimales en CSS de módulo.
3. **`/me` ya admite `preferences`**: el tema y cualquier preferencia de UI no necesitan cambiar el contrato (punto 4). Cada `PATCH` audita y sube `version`.
4. **Los E2E dependen del rol `alertdialog`**: el `ConfirmDialog` debe conservarlo (punto 1).
5. **`content-visibility` no sirve en filas** (punto 8).

### 11.5 Esfuerzos ajustados

| Ítem | Propuesta | Revisado | Motivo |
|---|---|---|---|
| M-06 | M | **M** (se confirma) | Firma igual a `ConfirmPanel`; ≈ 20 usos a migrar; CSS del diálogo; 7 specs a revisar. |
| M-16 | M | **M** sin la vista apilada | La vista apilada pasa a "no recomendada" (punto 7); el resto es una clase y un envoltorio común. |
| M-19 | S | **S medir + M paginar** | `tr` no admite `content-visibility`; la mejora real es paginar la vista previa. |
| M-20 | M | **M-L** | 29 sitios en 10 archivos, `.pf-home`, SVG del diagrama y una pasada de axe en oscuro. |
| M-21 | S | **M** | Cookie espejo, lectura en el layout raíz, `generateViewport`, emisión en el callback del BFF, control en Preferencias y tests. |
| M-26 | S | **S** (se confirma) | Solo hay 2 animaciones reales (`globals.css:217`, `home.css:275`; la segunda ya se desactiva en `:302`). |
| M-29 | S | **S, condicionado** | Inerte si se migra a `next/link` (punto 6). |
| L3 | M | **M-L** | Sigue a M-20 y M-21. |
| L2 | depende de L1 | **depende solo de M-01** | El diálogo no interviene en el alta rápida. |
| WebKit (P8) | "al menos nightly" | **subconjunto en el job `e2e` o job nuevo** | No existe E2E nocturno (punto 12). |

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
