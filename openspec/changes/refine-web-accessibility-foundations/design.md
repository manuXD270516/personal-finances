# Diseño

## Contexto

Lote L1 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (change 77 de docs/03 §7), aprobado por el owner el 2026-11-25 ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md)). Reúne M-01, M-02, M-04, M-06, M-14, M-15 y M-26 con las condiciones de viabilidad que el agente `frontend` fijó en docs/78 § 11.

Stack as-built: Next 16.4.5, React 19.3.0 (`reactStrictMode: true`), next-intl 4.14.9 con catálogos `apps/web/messages/{es,en,pt}.json`, sin framework CSS (hoja propia `app/globals.css` con tokens `--pf-*` y estilos base en `:where()`), Playwright 1.63.0 con 2 proyectos (`alerts`, `chromium`) y `@axe-core/playwright`. La CSP por nonce de `apps/web/proxy.ts` y `src/security/csp.ts` (D457) permite `style-src 'self' 'nonce-…'` y `style-src-attr 'unsafe-inline'`, pero no `<style>` ni `<script>` en línea sin nonce.

Decisiones que aplican: D500 (política de navegadores B), D505 y D506 (docs/28 al as-built y fuentes del sistema), D508 («Deshacer» persistente, se corrige en docs/28), D509 (WebKit con spike y excepción del owner) y D512 (lo implementa el agente `frontend`).

Capa afectada: solo **interface** (`apps/web`). Sin contextos, agregados, puertos, tablas, eventos ni contratos.

## Objetivos / No objetivos

**Objetivos**
- Un único patrón de foco al error y de resumen de errores para todos los formularios con validación propia.
- Validación temprana de los montos, que son el error más frecuente.
- Confirmaciones irreversibles en `<dialog>` nativo, sin trampa de foco manual y con el foco devuelto.
- Movimiento reducido declarado por componente; navegación y pestañas legibles en colores forzados y a 360 px.
- WebKit en E2E si la sesión funciona sin tocar la cookie.

**No objetivos**
- Región de avisos y alta rápida (L2), tema oscuro (L3), navegación móvil y menú con popover (L4), tablas (L5), PWA (L6), transiciones y toggletips (L7).
- Migrar `style={{…}}` en masa: solo se mueven a clases los estilos de los componentes que este change toca.
- Firefox en E2E (docs/78 § 11.1 punto 12, d).
- Cualquier cambio en los atributos de la cookie de sesión o en la configuración de producción.

## Decisiones

1. **Capability nueva `platform/web-interface`.** No existe ninguna capability de UI transversal, y NFR-USAB-101..108 no tienen dónde trazarse fuera de los flujos de negocio. Se agrega a ARCHITECTURE §14 (fila `platform`). Lo propio de un flujo de negocio sigue en su contexto: por ejemplo, el alta rápida de L2 va en `transactions/transaction-recording`. *Alternativa descartada:* repartir los requirements entre las capabilities de cada pantalla (≈ 15). Duplicaría el mismo requirement y su TC en cada contexto.

2. **Foco al primer error: `useFocusFirstError` en `src/ui/common/forms.ts`.** Firma: `useFocusFirstError(formRef: RefObject<HTMLFormElement | null>, attempt: number)`. El formulario incrementa `attempt` en cada envío rechazado por la validación. Un efecto posterior al render busca, en orden del DOM, el primer elemento enfocable con `aria-invalid="true"` dentro del formulario y lo enfoca (en un formulario con resumen, enfoca el resumen). El orden del DOM es el orden visual, y no se usa CSS `order` ni `grid-area` para reordenar campos. Es independiente de cómo cada formulario guarda sus errores: se apoya en el `aria-invalid` que `Field` ya pone. `Field` (`src/ui/common/ui.tsx:87-124`) no cambia su contrato: error y pista en `aria-describedby`, `aria-invalid`, y el error no es región viva. El hook se aplica a los formularios con `noValidate` (55 según docs/78; se recuentan con `grep -rn "noValidate" apps/web/src`). `debt/ComparePage.tsx` y `debt/LoanForm.tsx`, que ya enfocan el error, pasan al hook común. *Alternativa descartada:* validación nativa con `reportValidity()`. Los mensajes son i18n propios y el burbujeo nativo no se puede estilizar ni traducir con el catálogo.

3. **Resumen de errores: `ErrorSummary` en `src/ui/common/forms.tsx`.** Es un contenedor con `tabIndex={-1}`, encabezado con el conteo (clave i18n con plural ICU: `forms.errorSummary.title`, «Hay {count, plural, one {# error} other {# errores}}»), y una lista de enlaces `<a href="#<id-del-campo>">` con la etiqueta del campo. El clic se intercepta para enfocar el campo con `focus()`, porque el salto por ancla no siempre mueve el foco en Safari. Se usa solo en `LoanForm`, en el alta y la edición de tarjeta (`debt/cards/`) y en el mapeo de columnas del import. El resumen no es región viva: se anuncia porque recibe el foco.

4. **Validación al salir del campo (M-02).** Solo en los montos de `TransactionForm`, `TransferForm` y `ConversionForm`, con la lógica de parseo existente (`transactions/logic.ts` y su equivalente de FX). Matriz de tiempos de `forms/forms`: el error se calcula en `blur` si el campo fue modificado (`dirty`); en `input`, si el campo ya mostraba un error, se recalcula y se limpia en cuanto el valor es válido (nunca aparece un error nuevo mientras se escribe). Un obligatorio vacío y no modificado no muestra error al salir. El estilo de error puede usar `:user-invalid` (Widely) solo como refuerzo visual; la fuente de verdad sigue siendo `aria-invalid`, porque el formulario mantiene `noValidate`.

5. **`ConfirmDialog` con `<dialog>` + `showModal()` (M-06 nivel b), condiciones de docs/78 § 11.1 punto 1.**
   - **Firma idéntica a `ConfirmPanel`:** `title`, `description?`, `confirmLabel`, `cancelLabel`, `busy?`, `confirmDisabled?`, `onConfirm`, `onCancel`, `children?`, `testId?`. Migrar un uso es cambiar el nombre del componente. `data-testid` va en el `<dialog>` (por omisión `confirm-dialog`; los usos que hoy no pasan `testId` y caen en `confirm-panel`, como el de `TransactionDetail`, pasan a uno explícito y se ajustan sus specs).
   - **`role="alertdialog"` explícito en el `<dialog>`** (ARIA lo permite). Sin él se rompen 7 specs E2E (`a11y`, `accounts`, `lifecycle`, `month-closing`, `reconciliation`, `transactions`) y `planning/closing.test.tsx:277`. Sin `aria-modal` (lo da `showModal()`) y sin trampa de foco manual. Nombre con `aria-labelledby` al título y descripción con `aria-describedby` si existe.
   - **Montaje y apertura:** se monta solo cuando está abierto. Un `useEffect` llama a `ref.current.showModal()` con la guarda `if (!el.open)` (StrictMode ejecuta el efecto dos veces) y, en la misma función, `cancelRef.current?.focus()`. **No se usa `autoFocus`:** React llama a `focus()` al montar, con el `<dialog>` aún cerrado. La limpieza del efecto llama a `el.close()` si sigue abierto.
   - **Cierre:** Escape dispara `cancel` y luego `close`. Se escucha `onCancel` del elemento (con `preventDefault()` para que el cierre lo decida React) y se llama una sola vez al `onCancel` del componente. Los botones llaman a `onConfirm`/`onCancel`; `returnValue` no se usa. El foco vuelve al disparador al cerrarse, que es el comportamiento nativo.
   - **Orden:** «Cancelar» primero y luego la acción de confirmar, en el DOM y en lo visual. Lo mismo vale para `ConfirmPanel` (decisión 6).
   - **Estilos** en `globals.css` (clase `.pf-confirm-dialog` y su `::backdrop`), sin `<style>` en línea ni `style={{…}}` nuevos. `overscroll-behavior: contain` va como mejora progresiva (Limited en contenedores sin desbordamiento, D500). Entrada y salida sin animación en este change (M-27 es de L4).
   - **Pruebas:** los tests unitarios usan `renderToStaticMarkup`, sin DOM: cubren solo el marcado (rol, nombre, orden de botones). `showModal()`, el foco y Escape se prueban por E2E en Chromium (y en WebKit si D509 lo habilita).

6. **Qué usos pasan a diálogo.** Criterio de la spec: irreversible o con efecto contable. Inventario inicial sobre `origin/main` (39 usos en 26 archivos); `frontend` lo confirma al migrar y anota los cambios en la tarea:

   | Pasa a `ConfirmDialog` | Sigue en línea (`ConfirmPanel`) |
   |---|---|
   | Anular transacción y sus otras confirmaciones de estado (`transactions/TransactionDetail.tsx`), confirmaciones de `accounts/AccountDetail.tsx` (archivar o cerrar), anular cargo (`charge-void-panel`), archivar tarjeta (`archive-panel`), cancelar cuotas (`installment-cancel-panel`), desactivar plan de cuotas (`plan-disable-panel`), paneles de `debt/LoanPanels.tsx` (anular pago, archivar), borrar datos demo (`demo-cleanup-confirm`), quitar adjunto (`attachment-remove-confirm`), eliminar documento (`document-delete-confirm`), cerrar, cancelar o archivar una meta y quitar su plan (`goal-*-confirm`), revocar conexión (`connection-revoke-confirm`), cancelar import (`import-cancel-confirm`), archivar perfil (`profile-archive-confirm`), revertir import (`revert-confirm`), aprobar import (`import-approve-confirm`), quitar línea de presupuesto (`confirm-remove-line`), reabrir periodo (`confirm-reopen`), archivar plantilla (`confirm-archive-template`), descartar export (`export-discard-confirm`), ajuste y cancelación de conciliación (`adjustment-panel` y `reconciliation/ReconciliationPage.tsx`), terminar recurrencia (`end-panel`), archivar regla (`rule-archive-confirm`), cancelar suscripción (`cancel-panel`) | Pausar y reanudar recurrencia o suscripción (`pause-panel`, `resume-panel`), deshacer la cancelación de una suscripción (`undo-panel`), aprobar, omitir, editar y vincular ocurrencias (`recurring/OccurrenceActionPanel.tsx`: llevan formularios y búsquedas), cargar datos demo (`demo-load-confirm`), solicitar export (`export-request-confirm`) |

   Los diálogos que llevan campos (motivo de anulación, ajuste de conciliación) los conservan como `children`: el foco inicial sigue en «Cancelar» y el campo es el siguiente en el orden de tabulación. *Riesgo E2E:* los locators con `.first()` sobre botones del panel cambian de orden. Se revisan con `grep -rn "first()" tests/e2e/specs` al migrar cada archivo.

7. **`ConfirmPanel` en línea (M-06 nivel a).** Mantiene su firma y `role="alertdialog"`. Cambios: foco inicial en «Cancelar» (por ref, no en el contenedor), «Cancelar» antes de confirmar y devolución del foco al disparador al cancelar. Para devolverlo, el panel guarda `document.activeElement` al montarse (antes de mover el foco) y, al cancelar, lo enfoca si sigue conectado al DOM. Si el disparador desapareció, el foco va al encabezado de la sección. Así no hay que tocar a los 26 llamadores.

8. **Movimiento (M-26).** Se borra el bloque `@media (prefers-reduced-motion: reduce) { *, *::before, *::after {…} }` de `globals.css:701-711`. Hay 2 animaciones reales (`globals.css:217` y `home.css:275`, la segunda ya desactivada en `home.css:302`). Cada una pasa a declararse dentro de `@media (prefers-reduced-motion: no-preference)`; con `reduce`, el esqueleto queda estático. Las transiciones de `:hover` y `:focus` existentes (color, fondo) se mantienen: no mueven elementos. Un test unitario (`apps/web/src/ui/common/styles.test.ts`, con `node:fs`) recorre `app/globals.css` y `src/**/*.css` y falla si encuentra una regla universal con `animation-duration` o `transition-duration` con `!important`, o una `animation`/`@keyframes` con `transform` fuera de una consulta `no-preference`. *Alternativa descartada:* stylelint con un plugin. Suma una dependencia para una sola regla.

9. **Colores forzados (M-14).** `.pf-nav-link[aria-current='page']` gana `border-inline-start: 0.25rem solid currentColor` (con el padding compensado en los demás ítems para que no salte el texto) y conserva el fondo y la sombra actuales como adorno. El borde con `currentColor` sobrevive a `forced-colors: active` sin regla aparte. E2E con `page.emulateMedia({ forcedColors: 'active' })`.

10. **Pestañas (M-15).** En `common/Tabs.tsx`: lista con `display: flex; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin`, clases en `globals.css` (`.pf-tabs`, `.pf-tab`) en lugar de los estilos en línea de `Tabs.tsx:30` y `:42`. El peso de la fuente es constante y el indicador de la seleccionada es `border-block-end: 0.1875rem solid var(--pf-primary)`, no `box-shadow`. Al cambiar el foco con el teclado se llama a `scrollIntoView({ block: 'nearest', inline: 'nearest' })`. Se quita `aria-controls` de cada pestaña (`Tabs.tsx:93`), como pide `ui-components/tabs`; `aria-labelledby` del panel se mantiene. La pista visual de desplazamiento (M-17) es de L5.

11. **Enter con composición (M-04).** En `OccurrenceActionPanel.tsx:402-406`, y en cualquier otro manejador de Enter propio que se encuentre con `grep -rn "key === 'Enter'" apps/web/src`, se ignora Enter si `e.nativeEvent.isComposing || e.keyCode === 229`. Van las dos comprobaciones porque `isComposing` es Limited y en Safari llega en falso. Es una utilidad `isImeEnter(e)` en `src/ui/common/forms.ts`, con test unitario.

12. **WebKit en E2E (D509), condicionado.**
    - **Spike (time-box 1 h):** `PF_E2E_PROJECT=pfos-e2e-webkit pnpm test:e2e -- --project=webkit auth.spec.ts`, con un proyecto `webkit` temporal y puertos con prefijo 3 o 4. Se mira si la cookie `__Host-pfos_sid` (`Secure`, `bff.ts:107-112`) persiste sobre `http://localhost`.
    - **Si pasa:** proyecto `webkit` en `tests/e2e/playwright.config.ts` con `testMatch` para `app-shell`, `a11y`, `transactions`, `auth` y `content-security-policy`, sin dependencia de `alerts`. En `.github/workflows/pr.yml`, `playwright install --with-deps chromium webkit` en el job `e2e`, sin cambiar su `timeout-minutes` (40). Se mide la duración del job en el PR y se anota.
    - **Si falla:** no se cambia ningún atributo de la cookie, ni `bff.ts`, ni se sirve el stack por HTTPS. Se registra el resultado en la tarea, se abre la pregunta en un `docs/NN-…-questions.md` (opciones: stack de E2E por HTTPS, atributo relajado solo en pruebas, o posponer WebKit) y se marca la tarea con la nota de que espera al owner. Los TC de WebKit quedan en `draft`. El resto del change no depende de esto.

13. **i18n y CSP.** Toda clave nueva (`forms.errorSummary.*`, textos del diálogo si hacen falta) va en `es`, `en` y `pt` en el mismo PR. Los textos en español son ≈ 25 % más largos: se prueban a 360 px. No se agregan `<style>` ni `<script>` en línea ni dependencias nuevas. Los estilos nuevos van en `globals.css` y el E2E `content-security-policy.spec.ts` sigue en verde sin violaciones.

## Riesgos / Trade-offs

- **Orden de botones y locators.** Poner «Cancelar» primero rompe los specs que eligen por posición. Mitigación: revisión con `grep` por archivo migrado y suite completa en verde antes de fusionar.
- **Diálogo y StrictMode.** El doble efecto puede abrir dos veces o cerrar de más. Mitigación: la guarda `if (!el.open)` y `close()` solo en la limpieza.
- **Formularios con orden visual distinto del DOM.** Si alguno usa `order` o `grid-area`, el primer error en el DOM no es el primero visual. Mitigación: se revisa al aplicar el hook y, si aparece uno, se corrige el orden del DOM.
- **WebKit alarga el job `e2e`.** Estimado: 5–8 minutos sobre el límite de 40. Si la medición supera los 35 minutos totales, se reduce el subconjunto y se anota en la tarea.
- **Alcance de la migración (≈ 30 usos a diálogo).** Más que los ≈ 20 de docs/78, porque el criterio de la spec es estricto. El costo por uso es de una línea más la revisión de su spec E2E.

## Plan de migración

Sin migraciones de datos ni de contratos. El despliegue es el de la web, y la vuelta atrás es revertir el PR. Se puede partir en varios PR dentro de la misma rama de change si el diff crece: (1) utilidades, `ConfirmDialog`, `ConfirmPanel` y movimiento; (2) migración de usos; (3) formularios; (4) WebKit.

## Preguntas abiertas

Ninguna bloquea el change. La única decisión que puede volver al owner es la del spike de WebKit si falla (D509). Esa pregunta se abre en ese momento, no antes.
