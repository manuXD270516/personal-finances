# Propuesta: add-pwa-install

## Why

PFOS no se puede instalar en el teléfono: no hay manifiesto (`apps/web/public/` está vacío) ni íconos, así que registrar un gasto exige abrir el navegador, buscar la pestaña y esperar la barra de direcciones. docs/00 (pregunta 6) y docs/28 §11 dejaban la PWA como Could. Es el lote L6 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (M-33 y M-22), con la viabilidad de § 11.1 punto 10. El owner eligió el 2026-11-25 ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md), D504) **solo instalable**: manifiesto e íconos, sin service worker ni funcionamiento sin conexión. El `theme-color` por esquema ya existe desde el change 79 (`add-dark-theme`, requirement «Barra del navegador acorde al tema»), así que M-22 queda reducido a los colores del manifiesto.

## What Changes

- **Manifiesto (M-33):** ruta de metadatos `app/manifest.ts` de Next (servida en `/manifest.webmanifest`, fuera del `matcher` de `proxy.ts`), con `id: '/'`, `start_url: '/'`, `scope: '/'`, `display: 'standalone'`, `lang: 'es-BO'`, nombre «PFOS — Finanzas personales», nombre corto «PFOS», íconos y un atajo «Registrar gasto» a `/transacciones/nueva`. Un solo manifiesto para los tres idiomas: next-intl redirige `/` al idioma del usuario. Todas las rutas son relativas, así que el código no depende del dominio (M-34).
- **Íconos:** PNG de 192, 512 y 512 adaptable, más `apple-icon` de 180 px, generados desde una fuente SVG en el repositorio. **Su diseño espera al owner** (pregunta 1 de [docs/85](../../../docs/85-ui-lotes-l6-l7-questions.md)).
- **Botón «Instalar la aplicación»** en Mis preferencias, que aparece solo al recibir `beforeinstallprompt` (Chromium) y desaparece con `appinstalled` o en `display-mode: standalone`. Nunca un botón que no funcione: `<install>` y `navigator.install()` no tienen soporte todavía. Política de navegadores de D500: el manifiesto y `beforeinstallprompt` son Limited, así que todo es mejora progresiva.
- **Sin service worker** (D504): `worker-src` y el resto de la CSP no cambian; sin conexión no se muestra ningún dato guardado.
- **Colores del manifiesto (M-22):** `theme_color` y `background_color` del tema claro como respaldo; dentro de la app manda el `theme-color` por esquema que ya emite `generateViewport`.
- **Fuera de alcance:** funcionamiento sin conexión y cola de altas sin conexión (change aparte, D504), notificaciones push, `<install>` y `navigator.install()`, `share_target`, migración de origen (M-34 no aplica mientras no cambie el dominio), capturas de pantalla del manifiesto para la tienda, ayuda de instalación en iOS salvo que el owner la pida (pregunta 3 de docs/85) y tema del inicio de sesión de Keycloak.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities
- `platform/web-interface`: 6 ADDED (1 Must, 5 Could): manifiesto instalable, íconos, botón «Instalar» solo cuando el navegador lo ofrece, instalación sin funcionamiento sin conexión, sesión en la aplicación instalada y barra de la aplicación acorde al tema.

## Impact

**Specs impactadas:** `platform/web-interface` (6 ADDED). Lee sin modificar: `identity/authentication` (inicio de sesión del BFF y cookie de sesión) y `security/access-control` (CSP con nonce).

**Componentes/contextos impactados:** solo `apps/web` (capa interface): `app/manifest.ts` (nuevo), `app/icon.png` y `app/apple-icon.png` o `public/icons/*` (nuevos), fuente SVG de los íconos, `src/ui/forms.tsx` o el componente de Mis preferencias (botón), `src/ui/common/install.ts` (nuevo, lógica pura del aviso de instalación), `messages/{es,en,pt}.json` y `tests/e2e`. Ningún contexto de dominio.

**APIs impactadas:** ninguna (`contracts/openapi` no cambia).

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-PWA-001..016 (16). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** bajo. El manifiesto y los íconos son archivos nuevos fuera del `matcher` de `proxy.ts`; el layout raíz gana el enlace al manifiesto y al ícono de iOS. `content-security-policy.spec.ts`, `auth.spec.ts` y `app-shell.spec.ts` deben seguir en verde sin cambios.

**Riesgos introducidos:** sin RISK-id registrado. (1) Instalar desde un origen provisional obligaría a migrar de origen (M-34): el owner instala solo desde el dominio definitivo de D452 (pregunta 2 de docs/85). (2) En iOS la aplicación instalada no comparte cookies con Safari: hay que iniciar sesión otra vez dentro de ella (comportamiento del sistema, documentado). (3) El inicio de sesión sale del alcance de la aplicación (otro hostname para Keycloak): Android lo muestra en una pestaña con barra y vuelve al alcance; se verifica en un dispositivo real.

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX ni periodos).
