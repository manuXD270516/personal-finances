# Tareas

> Change 79, lote L3 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md); decisiones D500, D501, D505 y D512 en [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md); preguntas en [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md) (ninguna bloquea este change). **Lo implementa el agente `frontend` (D512).** Depende del change 77 (capability `platform/web-interface`). Gates: los de `CLAUDE.md`, más `pnpm test:e2e` con `PF_E2E_PROJECT=pfos-e2e-<nombre>` y puertos con prefijo 3 o 4 (cambia la UI). Reglas comunes a todas las tareas: claves i18n nuevas en `messages/{es,en,pt}.json` en el mismo commit (`src/i18n.test.ts` en verde); ningún `<style>` ni `<script>` en línea ni dependencia nueva (CSP de `apps/web/proxy.ts`); estilos nuevos como clases en `app/globals.css`; `content-security-policy.spec.ts` y `a11y.spec.ts` en verde; política de navegadores de D500 (`CLAUDE.md`); capturas a 360 × 800 y a 1280 × 800 con `testInfo.outputPath` en cada spec de UI nuevo.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `platform/web-interface` contra D501 y docs/78 § 11.1 (puntos 4 y 5) y § 11.4; `openspec validate add-dark-theme --strict`
- [ ] 1.2 Revisar TC-PLATFORM-THEME-001..021 contra los scenarios y pasarlos a `ready`

## 2. DOMAIN

- [ ] 2.1 Sin lógica de dominio: el change es de la capa interface de `apps/web` (incluido el BFF)

## 3. APPLICATION (utilidades de la UI, test-first)

- [ ] 3.1 `src/ui/common/theme.ts`: tipo `ThemePreference = 'system' | 'light' | 'dark'`, `parseThemePreference(unknown)` (desconocido → `system`), `themeCookieValue(pref)` (`light`/`dark` o `undefined`), `THEME_COLOR` (valores de `--pf-bg` por esquema) y `themeCookieHeader(pref, secure)`. Criterio: test unitario de los tres valores, de un valor desconocido y de los atributos de la cookie: TC-PLATFORM-THEME-012, -013 (parte unitaria)
- [ ] 3.2 Test de contraste `src/ui/common/contrast.test.ts` (design, decisión 9) con la tabla de pares y umbrales, y la comprobación de que los dos bloques oscuros coinciden. Criterio: falla sobre `origin/main` (no hay bloque oscuro) y pasa tras 5.1: TC-PLATFORM-THEME-014
- [ ] 3.3 Test estático de colores `src/ui/common/colors.test.ts` (decisión 8): literales de color fuera de `app/globals.css` y redeclaraciones de tokens `--pf-*` de color fuera de `:root`. Criterio: falla sobre `origin/main` con el inventario completo (anotar la cuenta real en esta tarea) y pasa tras 5.3: TC-PLATFORM-THEME-018

## 4. INFRASTRUCTURE (BFF)

- [ ] 4.1 `src/bff/bff.ts`, `callback()`: leer `preferences.theme` del mismo cuerpo de `GET /api/v1/me` que ya se lee para el `id`, y agregar a la respuesta `303` el `Set-Cookie` de `pfos_theme` (o su borrado) con `themeCookieHeader` (decisión 6). Un error al leer el tema no impide el login. Criterio: test unitario del BFF con perfil `dark`, `system`, sin tema y con valor desconocido, y E2E de 7.4: TC-PLATFORM-THEME-012, -013

## 5. UI (`apps/web`)

- [ ] 5.1 Tokens oscuros en `app/globals.css` (decisiones 1 y 2): `color-scheme: light dark`, bloque `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {…} }`, bloque `:root[data-theme='dark']` y `:root[data-theme='light'] { color-scheme: light }`; valores de la tabla de la decisión 2 y los demás fijados con el test 3.2; tokens nuevos `--pf-track`, `--pf-card-border`, `--pf-chart-on`, `--pf-chart-off`, `--pf-chart-visited` y `--pf-fin-expense-soft`; sombras casi nulas en oscuro. Anotar en la tarea los valores oscuros fijados que no estaban en docs/78 § 6. Criterio: 3.2 en verde
- [ ] 5.2 Bloque `.pf-home` (decisión 3): borrar las redeclaraciones de `src/ui/dashboard/home.css:2-15`, usar `--pf-fin-expense-soft` en el Home y migrar a tokens los hexadecimales de `home.css:240-243` y `upcoming/upcoming.css:38`. Criterio: captura del Home en claro a 1280 px sin diferencias visibles con `origin/main` y E2E de 7.6
- [ ] 5.3 Migrar a tokens los colores fijos de los 10 archivos TS/TSX del inventario (decisión 4); `LifecycleDiagram.tsx` pasa de `fill`/`stroke` a clases con `--pf-chart-*` en `globals.css`. Criterio: 3.3 en verde y E2E de 7.6
- [ ] 5.4 Layout raíz `app/[locale]/layout.tsx` (decisión 7): leer `pfos_theme` con `cookies()` y poner `data-theme` en `<html>` solo con un valor válido; `generateViewport` con `colorScheme` y `themeColor` desde `THEME_COLOR`. Criterio: E2E de 7.3 y 7.7 sobre el HTML crudo
- [ ] 5.5 `PreferencesForm` (`src/ui/forms.tsx`, decisión 5): grupo de 3 radios con `fieldset`/`legend`; el `PATCH /me` solo incluye `preferences.theme` si cambió; tras `200`, escribir o borrar la cookie y actualizar `document.documentElement.dataset.theme` sin recargar. Claves `Preferences.theme.*` en es/en/pt. Criterio: test de marcado estático del grupo y E2E de 7.2
- [ ] 5.6 Reconciliación al cargar `/me` (decisión 6): si el tema del perfil difiere de la cookie, actualizar cookie y `data-theme`. Ubicarla en `SessionProvider` o en un efecto de `AppFrame`, una sola vez por documento. Criterio: E2E de 7.3 (otro dispositivo)
- [ ] 5.7 Impresión en claro (decisión 10): `@media print` con los tokens claros y `color-scheme: light`. Criterio: E2E de 7.8

## 6. AUTOMATED TESTS de componentes

- [ ] 6.1 Tests unitarios de 3.1, 3.2, 3.3 y 4.1 con el TC-id al inicio del nombre (`it('[TC-PLATFORM-THEME-014] …')`); test de marcado de `PreferencesForm` (radios, leyenda y valor por omisión `system`)

## 7. E2E (Playwright, Chromium)

Spec nuevo `tests/e2e/specs/dark-theme.spec.ts`, con el TC-id al inicio de cada `test(...)`:

- [ ] 7.1 Tema del sistema: Inicio en oscuro sin preferencia, cambio en vivo con `page.emulateMedia({ colorScheme })` conservando la búsqueda, y página pública `/auth/error` en oscuro con axe: TC-PLATFORM-THEME-001, -002, -003
- [ ] 7.2 Preferencia: elegir «Oscuro» (sin navegación, `/me` con versión nueva, registro de auditoría de preferencias y cookie `dark`), volver a «Sistema» (cookie borrada), barra superior sin control de tema en es/en/pt, VIEWER que guarda «Claro» y guardado de la zona horaria sin escribir el tema (un único `PATCH` interceptado con `page.on('request')`): TC-PLATFORM-THEME-004..008
- [ ] 7.3 Primera pintura: HTML crudo de `/reportes` con `data-theme="light"` y `color-scheme` claro con el sistema en oscuro, más captura tras `domcontentloaded`; recorrido en oscuro sin eventos `securitypolicyviolation`; cookie `light` con perfil `dark` que se corrige al cargar `/me` y documento siguiente en oscuro: TC-PLATFORM-THEME-009, -010, -011
- [ ] 7.4 Callback de login: `Set-Cookie` de `pfos_theme=dark` con valor exacto y primera página en oscuro; borrado de la cookie con un perfil `system`: TC-PLATFORM-THEME-012, -013
- [ ] 7.5 axe en oscuro en `a11y.spec.ts` (Inicio, Transacciones, alta, detalle de un gasto de 60.00 BOB, Presupuestos, Reportes, recorrido y Preferencias) sin violaciones `serious` ni `critical`, con capturas a 360 y 1280 px: TC-PLATFORM-THEME-015
- [ ] 7.6 Home en oscuro sin tarjetas con fondo blanco y recorrido en oscuro con contraste ≥ 3:1 de los estados (calculado con `getComputedStyle`): TC-PLATFORM-THEME-016, -017
- [ ] 7.7 `meta` de `color-scheme` y `theme-color` en el HTML crudo con «Oscuro» y con «Sistema»: TC-PLATFORM-THEME-019, -020
- [ ] 7.8 Impresión en claro con `page.emulateMedia({ media: 'print' })` y la cookie `dark`: TC-PLATFORM-THEME-021
- [ ] 7.9 Suite E2E completa en verde dos veces con `PF_E2E_PROJECT=pfos-e2e-<nombre>` (los specs existentes corren en claro y no deben cambiar); actualizar el front matter de los TC automatizados (`automated_tests`, `status: automated`, `automation_status: automated`)

## 8. DOCUMENTATION

- [ ] 8.1 docs/28 §5.1 y §9 al as-built: tokens oscuros con su origen, cookie espejo, `generateViewport`, sin interruptor (D501) y tokens nuevos (`--pf-chart-*`, `--pf-card-border`, `--pf-fin-expense-soft`)
- [ ] 8.2 NFR-USAB-103 en docs/02: verificación con el test de contraste de tokens y la pasada de axe en oscuro
- [ ] 8.3 Si el owner contestó las preguntas 1 a 3 de docs/82, aplicar la respuesta (p. ej. borrar `--pf-fin-expense-soft`) o anotar que siguen abiertas
- [ ] 8.4 `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; docs/38 y la fila 79 de docs/03 §7 con el estado del change
