# Tareas

> Change 80, lote L4 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md); decisiones D500, D503 y D512 en [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md); preguntas en [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md): **la 4 bloquea las tareas 5.2 y 5.3 y la 5 bloquea la 5.6**; las demás no bloquean. **Lo implementa el agente `frontend` (D512).** Depende del change 78 (acceso «＋ Registrar»); usa el `ConfirmDialog` del 77 y la región de avisos del 78 en la tarea 5.8. Gates: los de `CLAUDE.md`, más `pnpm test:e2e` con `PF_E2E_PROJECT=pfos-e2e-<nombre>` y puertos con prefijo 3 o 4 (cambia la UI). Reglas comunes a todas las tareas: claves i18n nuevas en `messages/{es,en,pt}.json` en el mismo commit (`src/i18n.test.ts` en verde) y probadas a 320, 360 y 375 px; ningún `<style>` ni `<script>` en línea ni dependencia nueva (CSP de `apps/web/proxy.ts`); estilos nuevos como clases en `app/globals.css`; `content-security-policy.spec.ts` y `a11y.spec.ts` en verde; política de navegadores de D500 (`CLAUDE.md`); capturas a 360 × 800 y a 1280 × 800 con `testInfo.outputPath` en cada spec de UI nuevo.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `platform/web-interface` contra D503 y docs/78 § 11.1 punto 11; `openspec validate refine-mobile-navigation --strict`
- [ ] 1.2 Revisar TC-PLATFORM-MOBNAV-001..020 contra los scenarios y pasarlos a `ready` (006 a 009, 015 y 016 siguen en `draft` hasta que el owner conteste las preguntas 4 y 5 de docs/82)

## 2. DOMAIN

- [ ] 2.1 Sin lógica de dominio: el change es de la capa interface de `apps/web`

## 3. APPLICATION (lógica pura de navegación, test-first)

- [ ] 3.1 `shell/nav.ts` (design, decisión 1): `BOTTOM_BAR`, `NavGroupKey`, `NAV_GROUPS` y `groupOf(key)`; `isBottomBarSection(key)` para la marca de «Más». Criterio: test en `nav.test.ts` de que cada `NavKey` está en exactamente un grupo, del orden de los grupos y de la sección actual dentro de «Más» para `/reportes`. Los tests llevan los TC-id de los E2E que dependen de esta lógica: TC-PLATFORM-MOBNAV-005, -009

## 4. INFRASTRUCTURE

- [ ] 4.1 `generateViewport` en `app/[locale]/layout.tsx` con `viewportFit: 'cover'` (si el change 79 ya la creó, extenderla). Criterio: HTML crudo con `viewport-fit=cover`: TC-PLATFORM-MOBNAV-012

## 5. UI (`apps/web`)

- [ ] 5.1 Barra inferior (decisión 2) en `AppFrame.tsx`: `nav` con nombre, 5 destinos en orden, «＋ Registrar» solo con `ctx.canEdit` y no en `/transacciones/nueva`, `aria-current`, «Más» como botón con marca y nombre accesible con la sección actual; visible solo bajo 768 px; quitar `.pf-nav-toggle` y el panel en flujo. Claves `BottomBar.*`. Criterio: E2E de 7.1
- [ ] 5.2 **(espera la pregunta 4 de docs/82)** Cajón «Más» (decisión 3): `<dialog class="pf-drawer">` con `showModal()`, guarda `if (!el.open)`, foco en «Cerrar» tras `showModal()`, `onCancel` con `preventDefault()`, cierre por clic en el fondo, grupos con `<h2>` y enlaces con `aria-current`. Claves `Drawer.*` y `Nav.groups.*`. Criterio: E2E de 7.2
- [ ] 5.3 **(espera la pregunta 4 de docs/82)** Barra lateral agrupada desde 768 px (decisión 4), con los mismos `NAV_GROUPS`. Criterio: E2E de 7.3 y captura a 1280 px
- [ ] 5.4 Alto dinámico y área segura (decisión 5): `100dvh` en `.pf-shell` y en la barra lateral, token `--pf-bottombar-h`, `env(safe-area-inset-bottom)` en la barra, `scroll-padding-bottom` y `padding-block-end` de `main` bajo 768 px, `safe-area-inset-top` en la barra superior. Criterio: E2E de 7.4 y verificación manual de 7.6
- [ ] 5.5 Barra oculta al escribir (decisión 7): regla `:has()` en `globals.css` y sin barra en `/transacciones/nueva`. Criterio: E2E de 7.5
- [ ] 5.6 **(espera la pregunta 5 de docs/82)** Barra superior de una fila bajo 640 px (decisión 6): selector de workspace dentro del cajón «Más» con el mismo comportamiento. Criterio: E2E de 7.7
- [ ] 5.7 Menú de usuario con `popover="auto"` y `popoverTarget` (decisión 8); quitar las escuchas de documento; `aria-expanded` con `onToggle`; respaldo con `hidden` si no hay soporte de `popover` (≤ 20 líneas). Criterio: E2E de 7.8 y test de marcado estático
- [ ] 5.8 Transiciones de la capa superior (decisión 8) para `.pf-drawer`, `.pf-confirm-dialog` y los avisos, dentro de `prefers-reduced-motion: no-preference`, con `@starting-style`. Criterio: `styles.test.ts` del change 77 en verde y E2E de 7.9

## 6. AUTOMATED TESTS de componentes

- [ ] 6.1 Tests unitarios de 3.1 y de marcado estático de la barra inferior (orden, nombres, sin «Registrar» para un VIEWER) y del menú de usuario, con el TC-id al inicio del nombre

## 7. E2E (Playwright, Chromium)

Spec nuevo `tests/e2e/specs/mobile-navigation.spec.ts`, con el TC-id al inicio de cada `test(...)`; `app-shell.spec.ts` (bloque móvil) se reescribe para la barra inferior:

- [ ] 7.1 Barra inferior: EDITOR a 360 px en Presupuestos (orden, `aria-current` en Plan, `boundingBox()` ≥ 44 × 44, `scrollWidth` ≤ 360, es/en/pt), VIEWER sin «Registrar», escritorio sin barra a 768 y 1280 px, «＋ Registrar» con foco en el monto y «Más» con la sección actual en Reportes: TC-PLATFORM-MOBNAV-001..005
- [ ] 7.2 Cajón: apertura modal con grupos, 30 Tab sin salir del cajón y axe sin `serious` ni `critical`; Escape con foco en «Más»; elegir Reportes: TC-PLATFORM-MOBNAV-006, -007, -008
- [ ] 7.3 Barra lateral agrupada a 1280 px: TC-PLATFORM-MOBNAV-009
- [ ] 7.4 Foco no tapado a 360 × 640 con al menos 20 transacciones, cambio de alto de 640 a 720 px y HTML crudo con `viewport-fit=cover`: TC-PLATFORM-MOBNAV-010, -011, -012
- [ ] 7.5 Barra oculta con la búsqueda enfocada y visible al salir; sin barra en `/transacciones/nueva`: TC-PLATFORM-MOBNAV-013, -014
- [ ] 7.6 Verificación manual en un teléfono Android y uno iOS (o emulación de Chrome DevTools): la barra no queda sobre el teclado virtual y respeta el área de gestos. Anotar dispositivo, navegador y resultado en esta tarea (sin datos personales)
- [ ] 7.7 Barra superior de una fila a 360 px y cambio a "W2 Other Demo" desde «Más»: TC-PLATFORM-MOBNAV-015, -016
- [ ] 7.8 Menú de usuario: Escape con foco devuelto y clic fuera: TC-PLATFORM-MOBNAV-017, -018
- [ ] 7.9 Transiciones con `reducedMotion` `no-preference` y `reduce` (propiedades calculadas del cajón): TC-PLATFORM-MOBNAV-019, -020
- [ ] 7.10 Suite E2E completa en verde dos veces con `PF_E2E_PROJECT=pfos-e2e-<nombre>`; revisar con `grep -rn "nav-toggle\|setViewportSize" tests/e2e` los specs que trabajan a 360–375 px; actualizar el front matter de los TC automatizados

## 8. DOCUMENTATION

- [ ] 8.1 docs/28 §2.1 y §11 al as-built: barra inferior, cajón «Más», grupos con la respuesta de la pregunta 4 y selector de workspace (pregunta 5); quitar la «sheet» de alta rápida (el ＋ abre la página de alta)
- [ ] 8.2 NFR-USAB-006 en docs/02: verificación con `mobile-navigation.spec.ts` a 360 px y la prueba manual en teléfono
- [ ] 8.3 `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; docs/38 y la fila 80 de docs/03 §7 con el estado del change
