# Propuesta: add-e2e-https

## Why

D509 ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md)) pidió cubrir Safari con un subconjunto de specs en WebKit dentro del job `e2e`, sin relajar la cookie de sesión. El spike del change `refine-web-accessibility-foundations` (77) falló: WebKit guarda la cookie `Secure` (`__Host-pfos_login`, `__Host-pfos_sid`) pero no la envía sobre `http://localhost`, así que el login termina en `/auth/error?reason=state`. El spike se repitió en Linux, el motor del job `e2e`, y dio lo mismo sobre `http`. Sobre HTTPS con un certificado autofirmado la cookie viaja, también en un flujo con redirección al proveedor de identidad ([docs/84](../../../docs/84-webkit-e2e-questions.md)). El owner eligió servir el E2E por HTTPS sin tocar la cookie (D516). Este change lo implementa y cierra así la cobertura de WebKit que quedó abierta en el 77 (tareas 6.1 a 6.3, TC-PLATFORM-WEBUI-019 y -020).

## What Changes

- **Proxy TLS del stack de E2E:** un servicio nuevo del stack (perfil `tls`) termina TLS delante de los tres orígenes que usa el navegador: la web (BFF), el proveedor de identidad y la subida directa de archivos. Usa la misma imagen de Caddy que producción, fijada por digest, con su autoridad interna: el certificado se genera al levantar el stack, vive solo en el contenedor y desaparece al bajarlo. No se versiona ninguna clave ni certificado.
- **Esquema del stack de E2E:** el harness de E2E levanta el perfil `tls` y fija las URL públicas por `https://localhost:<puerto>`: `WEB_PUBLIC_URL`, `OIDC_PUBLIC_BASE_URL` (y por lo tanto el issuer y los redirect URIs del realm), `OBJECT_STORAGE_PUBLIC_ENDPOINT` y los orígenes CORS del almacenamiento. Las direcciones internas (BFF → Keycloak, BFF → API) siguen por la red de Compose sin TLS. Toda la suite pasa a HTTPS, Chromium incluido: con un origen público `https`, la CSP agrega `upgrade-insecure-requests` y un origen `http` mezclado rompería la subida de archivos.
- **Confianza en el certificado:** Playwright usa `ignoreHTTPSErrors` en los navegadores; los llamados de Node de los tests (administración de Keycloak, revocación del refresh token) confían en la autoridad efímera que el harness extrae del proxy y pasa con `NODE_EXTRA_CA_CERTS` a los workers. Ningún contenedor de la aplicación necesita confiar en ella.
- **Puertos y proyecto:** tres puertos nuevos (`PF_WEB_TLS_PORT`, `PF_KEYCLOAK_TLS_PORT`, `PF_OBJECT_STORAGE_TLS_PORT`) que siguen el prefijo de la corrida. `PF_E2E_PORT_PREFIX` pasa a aceptar solo 3 o 4, como pide `CLAUDE.md` (hoy acepta 5, que choca con otro stack). `PF_E2E_PROJECT` no cambia.
- **WebKit en el job `e2e`:** proyecto `webkit` de Playwright con `app-shell`, `a11y`, `transactions`, `auth` y `content-security-policy` (D509), instalación de WebKit en el job y medición de la duración. Corre dentro del job `e2e` existente: **ningún check obligatorio nuevo** y el límite de 40 minutos no cambia.
- **Cierre del change 77:** automatiza TC-PLATFORM-WEBUI-019 y -020, que siguen trazados al requirement «Cobertura de la interfaz en WebKit» del 77. Cómo se archiva el 77 (ya, con 6.1 a 6.3 diferidas a este change, o después de este change) queda como pregunta P2 de docs/84.
- **Fuera de alcance:** cualquier cambio en la cookie de sesión, sus atributos o `apps/web/src/bff/bff.ts` (D516); HTTPS en el stack de desarrollo por omisión (el perfil `tls` queda disponible, pero `pnpm stack:up` sin él no cambia); Firefox en E2E; la configuración de TLS de producción (Caddy con ACME, ADR-0027); los checks obligatorios de `main`.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities
- `platform/local-environment`: 3 ADDED (stack de E2E servido por HTTPS con autoridad efímera, aislamiento de la corrida por proyecto y prefijo de puertos, stack de desarrollo sin cambios si no se pide TLS).
- `platform/delivery-pipeline`: 1 ADDED (WebKit dentro del job de E2E, sin check obligatorio nuevo y dentro de su límite de tiempo).

## Impact

**Specs impactadas:** `platform/local-environment` (3 ADDED) y `platform/delivery-pipeline` (1 ADDED). Lee sin modificar: `platform/web-interface` del change 77 (requirement «Cobertura de la interfaz en WebKit», cuyos TC automatiza), `identity/authentication` (cookie de sesión y flujo OIDC) y `security/access-control` (CSP con nonce).

**Componentes/contextos impactados:** ningún contexto de dominio. Cambian `deploy/compose/compose.yaml` (servicio `tls-proxy`, perfil `tls`), un `deploy/compose/caddy/Caddyfile.e2e` nuevo, `.env.example` (tres puertos), `tests/e2e/src/stack.ts` y `global-setup.ts` (perfil, URL públicas, prefijo y autoridad), `tests/e2e/playwright.config.ts` (proyecto `webkit` e `ignoreHTTPSErrors`), `.github/workflows/pr.yml` (instalación de WebKit en el job `e2e`) y `docs/config-reference.md`. `apps/web` no cambia.

**APIs impactadas:** ninguna. `contracts/openapi` no cambia.

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-STACK-009..013 y TC-PLATFORM-PIPELINE-044 (6). MODIFICADOS — TC-PLATFORM-WEBUI-019 y -020 (precondiciones: el stack por HTTPS de D516 en lugar del spike de D509; se automatizan aquí). DEPRECADOS — ninguno.

**Impacto de regresión:** toda la suite E2E cambia de esquema. Los specs que comparan URL o leen cookies por origen (`auth`, `content-security-policy`, `api-conventions`, `documents`) se revisan, y la suite completa corre en verde dos veces con `PF_E2E_PROJECT` antes de fusionar. El stack de desarrollo del owner no cambia si no se pide el perfil `tls`.

**Riesgos introducidos:** sin RISK-id registrado. (1) Una URL `http` olvidada rompe la subida de archivos por `upgrade-insecure-requests`. (2) Keycloak detrás del proxy necesita el hostname público `https`; si toma el esquema de la petición interna, el issuer no coincide. (3) El job `e2e` crece de ≈ 16 a ≈ 25 minutos (estimado), dentro de su límite de 40. (4) WebKit en Windows sobre HTTPS no se probó: el spike de HTTPS corrió solo en Linux.

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX ni periodos).
