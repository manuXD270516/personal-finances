# Diseño

## Contexto

Lote L3 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (change 79 de docs/03 §7). Reúne M-20, M-21 y M-22 con las condiciones de viabilidad de docs/78 § 11.1 (puntos 4 y 5), § 11.3 (supuesto del destello) y § 11.4 (hallazgos 1 a 3). Decisiones del owner ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md)): D500 (Baseline Widely como piso, Newly solo con mejora progresiva), D501 (sistema por omisión, override en Preferencias, sin interruptor en la barra), D505 (fuentes del sistema) y D512 (lo implementa el agente `frontend`).

Stack as-built: Next 16.4.5, React 19.3.0, next-intl 4.14.9, hoja propia `app/globals.css` con 27 tokens de color `--pf-*` y `color-scheme: light` fijo (`globals.css:15`), sin `generateViewport`. El layout raíz (`app/[locale]/layout.tsx`) ya es dinámico por `connection()` y sirve también las páginas públicas `/auth`. La CSP por nonce (`apps/web/proxy.ts`, `src/security/csp.ts`, D457) no admite `<script>` ni `<style>` en línea sin nonce. El perfil (`GET/PATCH /api/v1/me`) ya tiene `preferences`, un objeto libre con merge por clave (`contracts/openapi/finance-api.v1.yaml`, `packages/contexts/identity/src/domain/user.ts:22`), y cada `PATCH` sube `Me.version` y genera el evento de auditoría `identity.user.preferences_changed`. El callback del BFF (`src/bff/bff.ts`, `callback()`) ya llama a `GET /api/v1/me` para provisionar al usuario.

Depende del change 77 (crea `platform/web-interface`). No depende de 78. Puede ir en paralelo con 78 y 81 (docs/03 §7).

Capa afectada: solo **interface** de `apps/web` (incluido el BFF de Next). Sin contextos de dominio, agregados, puertos, tablas, eventos nuevos ni contratos.

## Objetivos / No objetivos

**Objetivos**
- Tema oscuro completo, con contraste medido, para todas las pantallas, incluido el Home y el diagrama de recorrido.
- Preferencia personal de 3 estados guardada en el perfil, sin tocar el contrato.
- Primera pintura con el tema correcto, sin destello y sin scripts en línea.
- Cero colores literales fuera de la hoja de tokens, garantizado por un test.

**No objetivos**
- Interruptor de tema en la barra superior (D501).
- Tema del inicio de sesión de Keycloak (pregunta 3 de [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md)).
- Barras de desplazamiento personalizadas (M-22 las deja nativas).
- Migrar los `style={{…}}` que ya usan `var(--pf-*)`: heredan el tema sin cambios.
- Manifiesto e íconos de la PWA (L6, que usará el `theme-color` de este change).

## Decisiones

1. **Tokens oscuros con `@media` y `:root[data-theme]`, no con `light-dark()`.** `light-dark()` es Newly (2024-05-13). Un token personalizado con `light-dark()` pasa el parser aunque el navegador no lo soporte, y al usarlo (`background: var(--pf-bg)`) el valor queda inválido en tiempo de cómputo sin caer en una declaración anterior (docs/78 § 11.1 punto 5). La hoja queda así:

   ```css
   :root { color-scheme: light dark; /* tokens claros, como hoy */ }
   @media (prefers-color-scheme: dark) {
     :root:not([data-theme='light']) { /* tokens oscuros */ }
   }
   :root[data-theme='dark'] { color-scheme: dark; /* tokens oscuros */ }
   :root[data-theme='light'] { color-scheme: light; }
   ```

   Los dos bloques oscuros llevan los mismos valores. El test de contraste (decisión 9) también comprueba que coinciden, para que no diverjan. *Alternativa descartada:* `light-dark()` dentro de `@supports (color: light-dark(white, black))`. Funciona, pero exige `color-scheme` para evaluar y duplica igual los valores en el respaldo.

2. **Valores oscuros.** Los de docs/78 § 6 (medidos con WCAG 2.2) y docs/28 §5.1:

   | Token | Claro (hoy) | Oscuro | Origen |
   |---|---|---|---|
   | `--pf-bg` / `--pf-surface` / `--pf-surface-raised` | `#ffffff` / `#f8fafc` / `#ffffff` | `#0b0f14` / `#121821` / `#1a2230` | § 6 |
   | `--pf-fg` / `--pf-fg-muted` | `#0f172a` / `#475569` | `#e2e8f0` / `#94a3b8` | § 6 |
   | `--pf-control-border` | `#64748b` | `#7c8aa0` | § 6 |
   | `--pf-border` | `#e2e8f0` | `#273244` | § 6 (decorativo) |
   | `--pf-primary` / `--pf-primary-fg` | `#1d4ed8` / `#ffffff` | `#60a5fa` / `#0b0f14` | § 6 |
   | `--pf-focus` | `#2563eb` | `#93c5fd` | § 6 |
   | `--pf-destructive` / `--pf-error` | `#b91c1c` | `#f87171` | docs/28 §5.1 |
   | `--pf-fin-income` / `-warning` / `-over-budget` / `-ok` / `-conversion` | ver `globals.css` | `#34d399` / `#fbbf24` / `#f87171` / `#4ade80` / `#a78bfa` | § 6 |

   Los tokens que § 6 no midió (`--pf-surface-sunken`, `--pf-border-strong`, `--pf-primary-hover`, `--pf-primary-soft`, `--pf-fin-expense`, `--pf-fin-transfer`, `--pf-fin-neutral`, `--pf-warning-bg`, `--pf-warning-border`, `--pf-warning-fg` y los nuevos de la decisión 4) los fija `frontend` con el test de contraste como criterio: si un par no alcanza su umbral, el test falla. Las sombras en oscuro pasan a `none` o casi nulas: la elevación se expresa con la diferencia de superficie (docs/28 §5.4).

3. **Bloque de `.pf-home` (bloqueante, § 11.4 hallazgo 1).** Se borran las 13 redeclaraciones de `dashboard/home.css:2-15`. `--pf-track` pasa a `globals.css` con su valor oscuro. `--pf-fin-expense` del Home vale `#334155` y el de la raíz `#0f172a`. No se unifica en silencio: se crea `--pf-fin-expense-soft` (`#334155` en claro, valor oscuro fijado por el test) y el Home lo usa. Así no cambia nada visible hasta que el owner conteste la pregunta 1 de docs/82. Si dice que la diferencia no fue intencional, se borra el token y el Home usa `--pf-fin-expense`. Los 4 hexadecimales sueltos (`home.css:240-243`, `upcoming/upcoming.css:38`) pasan a tokens.

4. **Colores fijos en TS/TSX (29 apariciones en 10 archivos, § 11.1 punto 5).** Inventario de partida: `accounts/AccountForm.tsx:350`, `AccountsListView.tsx:123`, `classification/fields.tsx:21,93,105`, `dashboard/styles.ts:12,21,24-27`, `fx/ConversionForm.tsx:391,397`, `lifecycle/LifecycleDiagram.tsx:4-7,72,111,120,132-133,162,177`, `LifecycleReport.tsx:143,145`, `LifecycleTab.tsx:118`, `transactions/SplitsEditor.tsx:61,203`, `TransactionsListView.tsx:128`. `frontend` lo recuenta con el test de la decisión 8 antes de migrar y anota las diferencias en la tarea. Tokens nuevos: `--pf-chart-on`, `--pf-chart-off`, `--pf-chart-visited` (diagrama de recorrido) y `--pf-card-border` (borde de tarjetas del Home, hoy `#d0d7de`). El diagrama de recorrido deja de pasar `fill`/`stroke` como atributos SVG y usa clases (`.pf-lifecycle-node--visited`, etc.) en `globals.css`. Los colores de usuario que no son de la interfaz (por ejemplo, el color elegido para una categoría, si lo hubiera como dato) no son literales del código y quedan fuera del test.

5. **Preferencia en `/me` (M-21), sin cambio de contrato.** `PreferencesForm` (`src/ui/forms.tsx`) gana un grupo de 3 radios («Sistema», «Claro», «Oscuro», i18n es/en/pt) con `fieldset` y `legend`. Valor guardado: `preferences.theme ∈ {system, light, dark}`; ausencia = `system`. Al guardar:
   - Si el tema no cambió, el `PATCH /me` no incluye `preferences.theme` (y si nada cambió, no hay `PATCH`). Motivo: cada `PATCH` sube la versión y audita (§ 11.1 punto 4).
   - Si cambió, el `PATCH` usa el `If-Match` de la versión vigente, como hoy. Con `200`, el cliente escribe la cookie `pfos_theme` (o la borra con «Sistema») y actualiza `document.documentElement.dataset.theme` en el mismo tick, así la página cambia sin recargar.
   - Un valor de `preferences.theme` desconocido se trata como `system` (el objeto es libre y otro cliente podría escribir otra cosa).
   *Alternativa descartada:* `localStorage` (como la última cuenta de D510). D501 pide que la preferencia sea del usuario y viaje entre dispositivos.

6. **Cookie espejo `pfos_theme`.** Valores `light` o `dark`; sin la cookie = `system`. Atributos: `Path=/; SameSite=Lax; Max-Age=31536000`; **sin** `HttpOnly` (la escribe el cliente, igual que `NEXT_LOCALE`) y con `Secure` cuando el origen es HTTPS. No lleva identificadores, ni tokens, ni datos del usuario: solo una de dos palabras. Las escrituras:
   - **Cliente, al guardar** (decisión 5).
   - **BFF, en el callback de login** (`bff.ts`, `callback()`): ya lee la respuesta de `GET /api/v1/me` para el `id`; se lee también `preferences.theme` del mismo cuerpo, sin llamada extra, y se agrega `Set-Cookie: pfos_theme=…` o su borrado a la respuesta `303`. Un error al leer el tema no impide el login (se omite la cabecera).
   - **Cliente, al reconciliar**: cuando `SessionProvider` carga `/me` y el tema del perfil difiere del de la cookie (otro dispositivo lo cambió), actualiza la cookie y `data-theme`. Es el único caso con un destello, y solo en ese documento.
   La cookie no se borra al cerrar sesión (pregunta 2 de docs/82: recomendación, conservarla). *Alternativa descartada:* leer `/me` en el layout raíz. Agrega una llamada a la API en cada documento, también en las páginas públicas.

7. **Tema en el servidor: `data-theme` y `generateViewport`.** El layout raíz lee `cookies().get('pfos_theme')` y pone `<html lang data-theme="light|dark">` solo si la cookie tiene un valor válido. `generateViewport` (exportación de Next, sin script) devuelve:
   - con `light` o `dark`: `colorScheme: 'light'|'dark'` y `themeColor` con el valor de `--pf-bg` de ese esquema;
   - sin cookie: `colorScheme: 'light dark'` y `themeColor: [{ media: '(prefers-color-scheme: light)', color: '#ffffff' }, { media: '(prefers-color-scheme: dark)', color: '#0b0f14' }]`.
   Los valores de `themeColor` se leen de una constante TS común con el test de contraste, no se duplican a mano. El change 80 (L4) agrega `viewportFit: 'cover'` a la misma exportación; si L4 se implementa antes, crea `generateViewport` y este change lo extiende.

8. **Test estático de colores (TC-PLATFORM-THEME-018).** `apps/web/src/ui/common/colors.test.ts` (con `node:fs`, sin dependencias) recorre `src/**/*.{ts,tsx}` y `src/**/*.css` y falla si encuentra `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(`, `rgba(`, `hsl(` o `hsla(` literales. `app/globals.css` es la única hoja permitida. Excepciones: archivos `*.test.*` y comentarios. También falla si un selector distinto de `:root` redeclara un token `--pf-*` de color.

9. **Test de contraste de tokens (TC-PLATFORM-THEME-014).** `apps/web/src/ui/common/contrast.test.ts` extrae los tokens claros y oscuros de `globals.css` y calcula la luminancia relativa de WCAG 2.2. Pares y umbrales:

   | Par | Umbral |
   |---|---|
   | `--pf-fg` sobre `--pf-bg`, `--pf-surface`, `--pf-surface-raised` | 4.5 |
   | `--pf-fg-muted` sobre `--pf-surface` y `--pf-surface-raised` | 4.5 |
   | `--pf-primary-fg` sobre `--pf-primary`; `--pf-primary` sobre `--pf-primary-soft` | 4.5 |
   | `--pf-fin-*` (cada uno) y `--pf-error` sobre `--pf-surface` | 4.5 |
   | `--pf-warning-fg` sobre `--pf-warning-bg` | 4.5 |
   | `--pf-control-border` sobre `--pf-surface-raised`; `--pf-focus` sobre `--pf-surface` | 3 |
   | `--pf-chart-on`, `--pf-chart-visited` sobre `--pf-surface` | 3 |

   `--pf-border` y `--pf-chart-off` quedan como decorativos (sin umbral), como en § 3.3: el estado que representan también va en texto.

10. **Impresión.** `@media print { :root { color-scheme: light; /* tokens claros */ } }` al final de `globals.css`, para que un tema oscuro no salga en la impresión. La regla de impresión de tablas es del change 81.

11. **Pruebas E2E.** Spec nuevo `tests/e2e/specs/dark-theme.spec.ts` con `test.use({ colorScheme: 'dark' })` donde corresponda y la cookie puesta con `context.addCookies`. El HTML crudo se lee con `page.request.get(url)` (o `response.text()`) para comprobar `data-theme` y las `meta` antes de cualquier script. La «primera pintura» se aproxima con una captura tras `domcontentloaded` (§ 11.3). `a11y.spec.ts` gana una pasada en oscuro sobre las pantallas de TC-PLATFORM-THEME-015. Capturas a 360 × 800 y a 1280 × 800 con `testInfo.outputPath`, como hace `app-shell.spec.ts`. Los specs de `auth` comprueban el `Set-Cookie` del callback. `content-security-policy.spec.ts` sigue en verde.

12. **i18n.** Claves nuevas en `Preferences.theme.*` (leyenda, «Sistema», «Claro», «Oscuro» y una ayuda corta) en es, en y pt en el mismo commit; `src/i18n.test.ts` comprueba la paridad. Textos probados a 360 px.

## Riesgos / Trade-offs

- **Colores fijos no inventariados.** El test estático los detecta en TS, TSX y CSS. Los que vengan de datos (no del código) no se cubren, pero hoy no hay.
- **Contraste de los tokens no medidos.** Lo fija el test con umbrales; si un valor de § 6 no alcanza con el resto de los pares, prevalece el test y se anota en la tarea.
- **Duplicación de los valores oscuros** en dos bloques. El test exige que coincidan.
- **Destello entre dispositivos.** Un solo documento por cambio en otro dispositivo; aceptable (§ 11.1 punto 4).
- **Auditoría de preferencias.** Un registro por cambio de tema; el cambio es raro y queda en la historia del usuario.
- **Cookie sin `HttpOnly`.** Es intencional: no es sensible y la escribe el cliente. La decisión 6 la limita a dos valores; el layout ignora cualquier otro.

## Plan de migración

Sin migraciones de datos ni de contratos. El tema claro conserva sus valores, así que el cambio visible solo aparece con el sistema en oscuro o con la preferencia «Oscuro». Vuelta atrás: revertir el PR (la cookie queda inerte y `preferences.theme` queda guardado sin efecto). Se puede partir en dos PR dentro de la rama del change: (1) tokens, `.pf-home`, colores fijos y tests estáticos; (2) preferencia, cookie, BFF, `generateViewport` y E2E.

## Preguntas abiertas

En [docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md); ninguna bloquea este change:

1. `--pf-fin-expense` del Home: ¿diferencia intencional? (por omisión, se conserva como `--pf-fin-expense-soft`).
2. ¿La cookie `pfos_theme` se borra al cerrar sesión? (por omisión, se conserva).
3. ¿Tema oscuro en el inicio de sesión de Keycloak? (por omisión, fuera de alcance).
