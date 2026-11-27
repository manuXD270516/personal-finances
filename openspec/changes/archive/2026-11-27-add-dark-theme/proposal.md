# Propuesta: add-dark-theme

## Why

La interfaz solo tiene tema claro: `color-scheme: light` está fijo, no hay preferencia de tema y hay colores escritos a mano en los componentes. Quien usa PFOS de noche en el teléfono recibe una pantalla blanca, y NFR-USAB-103 (Must) pide el contraste «en modo claro y oscuro». docs/28 §9 ya definía el tema `system`/`light`/`dark` persistido por usuario. Es el lote L3 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (M-20, M-21 y M-22), con las condiciones de viabilidad de § 11.1 (puntos 4 y 5) y § 11.4. El owner lo aprobó el 2026-11-25 ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md), D501): el tema sigue al sistema por omisión, con override Claro u Oscuro en Preferencias y sin interruptor en la barra.

## What Changes

- **Tokens oscuros (M-20):** valores oscuros de docs/78 § 6 para los tokens de color de `globals.css`. Se declaran con `@media (prefers-color-scheme: dark)` más `:root[data-theme]`, **no** con `light-dark()`: un token con `light-dark()` queda inválido en tiempo de cómputo en un navegador sin soporte, sin caer al valor anterior (§ 11.1 punto 5). `color-scheme: light dark` por omisión.
- **Bloque `.pf-home` (bloqueante):** se borran los 13 tokens que `dashboard/home.css:2-15` redeclara y que dejarían el Home en claro. `--pf-track` pasa a la hoja base. `--pf-fin-expense` del Home (`#334155` frente a `#0f172a` de la raíz) se conserva como token propio hasta que el owner diga si la diferencia fue intencional ([docs/82](../../../docs/82-ui-lotes-l3-l5-questions.md), pregunta 1).
- **Colores fijos:** se migran a tokens las 29 apariciones en 10 archivos TS/TSX y los 4 hexadecimales de CSS de módulo (inventario de § 11.1 punto 5). El diagrama de recorrido pasa de atributos SVG a clases con tokens nuevos `--pf-chart-*`. Un test estático impide que vuelvan.
- **Preferencia (M-21):** control de 3 estados («Sistema», «Claro», «Oscuro») en Preferencias, guardado en `preferences.theme` de `/me`, **sin cambio de contrato** (`preferences` ya es un objeto libre con merge por clave). Cada guardado sube `Me.version` y genera auditoría: el tema solo se escribe cuando cambia.
- **Primera pintura sin destello:** cookie espejo no sensible `pfos_theme=light|dark` (sin cookie = sistema). La escribe el cliente al guardar y **el BFF en el callback de login**, que ya llama a `GET /me`. El layout raíz la lee con `cookies()` y pone `<html data-theme>`.
- **Navegador (M-22):** `color-scheme` y `theme-color` salen de `generateViewport` de Next, sin `<script>` ni `<style>` en línea (CSP por nonce de `apps/web/proxy.ts` intacta).
- **Pruebas:** pasada de axe en oscuro, test de contraste de los pares de tokens en los dos esquemas, HTML crudo sin destello, capturas a 360 px y en escritorio.
- **Fuera de alcance:** interruptor en la barra superior (D501), tema del inicio de sesión de Keycloak (pregunta 3 de docs/82), personalización de barras de desplazamiento, imágenes de la PWA (L6), el resto de los `style={{…}}` que ya usan `var(--pf-*)` (heredan el tema sin tocarse), navegación móvil (L4) y tablas (L5).

## Capabilities

### New Capabilities

Ninguna. `platform/web-interface` la crea el change 77 (`refine-web-accessibility-foundations`).

### Modified Capabilities
- `platform/web-interface`: 8 ADDED (1 Must, 5 Should, 2 Could): tema del sistema, preferencia en Preferencias, tema desde la primera pintura, marca del tema al iniciar sesión, contraste en los dos temas, colores solo desde el tema, barra del navegador e impresión en claro.

## Impact

**Specs impactadas:** `platform/web-interface` (8 ADDED). Lee sin modificar: `identity/authentication` (perfil y preferencias de `/me`, callback del BFF), `security/access-control` (CSP con nonce).

**Componentes/contextos impactados:** solo `apps/web` (capa interface y BFF): `app/globals.css` (tokens oscuros, `color-scheme`, impresión), `src/ui/dashboard/home.css` y `upcoming/upcoming.css` (tokens propios y hexadecimales), los 10 archivos TS/TSX del inventario, `src/ui/lifecycle/LifecycleDiagram.tsx` (clases en lugar de `fill`/`stroke`), `app/[locale]/layout.tsx` (`data-theme` y `generateViewport`), `src/bff/bff.ts` (cookie en el callback), `src/ui/forms.tsx` (`PreferencesForm`), `src/ui/` (reconciliación del tema al cargar `/me`), `messages/{es,en,pt}.json` y `tests/e2e`. Ningún contexto de dominio.

**APIs impactadas:** ninguna. `contracts/openapi` no cambia: `preferences.theme` viaja dentro del objeto libre `preferences`.

**Tablas impactadas:** ninguna (el valor se guarda en las preferencias existentes del usuario).

**Eventos impactados:** ninguno nuevo. Guardar el tema produce el evento de auditoría de cambio de preferencias que ya existe.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-THEME-001..021 (21). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** toda la UI cambia de hoja de colores aunque el tema claro conserve sus valores. Riesgos: un componente con color fijo no inventariado, el Home (bloque propio de tokens) y el diagrama de recorrido. Mitigación: test estático de colores literales, axe en claro y en oscuro y capturas en los dos anchos. El callback de login suma una cabecera `Set-Cookie`; los specs de `auth` siguen en verde.

**Riesgos introducidos:** sin RISK-id registrado. (1) Destello en el primer documento de un navegador cuya cookie no coincide con el perfil: solo pasa si el tema cambió en otro dispositivo, y se corrige al leer `/me`. (2) Valores oscuros de tokens que docs/78 § 6 no midió: los fija el test de contraste. (3) La auditoría y la versión del perfil crecen con cada cambio de tema: el tema cambia rara vez.

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX ni periodos).
