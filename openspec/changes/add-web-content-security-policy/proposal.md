# Propuesta: add-web-content-security-policy

## Why

La web (`finance-web`) no declara Content-Security-Policy: Caddy solo agrega HSTS, `nosniff` y `Referrer-Policy` (nota del 2026-10-29 en ADR-0027). NFR-SEC-008 exige una CSP estricta, sin `unsafe-inline` en scripts y con nonces, y `frame-ancestors 'none'`; docs/12 §12 y ADR-0019 ya fijaron que el nonce se genera por petición en `proxy.ts`. Es la brecha B14 del runbook de despliegue (C13 de [cambios-de-codigo.md](../../../docs/despliegue/cambios-de-codigo.md)) y tiene que estar antes de los datos reales: la web maneja datos financieros y la sesión del BFF.

## What Changes

- **CSP con nonce por petición en `apps/web/proxy.ts`:** cada página HTML sale con `script-src 'self' 'nonce-…' 'strict-dynamic'`, sin `unsafe-inline` ni `unsafe-eval` en producción. Next.js aplica el nonce a sus propios scripts al renderizar; todas las páginas pasan a renderizado dinámico.
- **Orígenes cerrados:** `default-src 'self'`; `connect-src 'self'` más el origen público de subida de documentos (`PF_DOMAIN_FILES`, que la web lee de `OBJECT_STORAGE_PUBLIC_ENDPOINT`); `img-src 'self' data: blob:`; `font-src 'self'`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`; `upgrade-insecure-requests` solo con origen HTTPS.
- **Estilos:** los elementos `<style>` y hojas solo desde `'self'` o con nonce; los 11 `<style>` en línea de componentes pasan a hojas estáticas. Los atributos `style` que React emite en el HTML del servidor se permiten con `style-src-attr 'unsafe-inline'` (pregunta 1 de [docs/73](../../../docs/73-despliegue-n1-specs-questions.md)).
- **Caddy como red de seguridad:** en los hostnames `PF_DOMAIN_APP` y `PF_DOMAIN_FILES`, una CSP por omisión (`default-src 'none'; frame-ancestors 'none'`) que solo se escribe si la respuesta no trae la suya, más `Permissions-Policy` y `Cross-Origin-Opener-Policy` en la web.
- **Verificación:** E2E que recorre todas las pantallas de la navegación y la subida de un documento sin ninguna violación de CSP, y una comprobación nueva en la fase 6 del runbook de despliegue.
- **Fuera de alcance:** la CSP de Keycloak (`PF_DOMAIN_AUTH`, la gestiona Keycloak con su propia cabecera), endpoint de reportes de violaciones (`report-to`), HSTS `preload` y los dos años de docs/12 §12, escaneo ZAP/Observatory (Hito H), y cambiar los estilos en línea de los componentes a clases.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities
- `security/access-control`: 5 ADDED (4 Must, 1 Should): CSP con nonce por petición, orígenes permitidos, anti-clickjacking en todas las respuestas, estilos bajo la CSP y cabeceras complementarias del borde. FEAT-24.3 / TS-106 ya mapean «TLS/HSTS/CSP endurecidos» a esta capability (docs/25).

## Impact

**Specs impactadas:** `security/access-control` (5 ADDED). Lee sin modificar: `security/file-upload-security` (la subida directa al hostname de archivos y la descarga con su CSP `sandbox` propia), `identity/authentication` (redirecciones del login y el logout).

**Componentes/contextos impactados:** `apps/web` (capa interface): `proxy.ts` (nonce y cabecera), `app/[locale]/layout.tsx` (renderizado dinámico), los 11 componentes con `<style>` en línea (`CashFlowView`, `DashboardView`, `ForecastsView`, `LifecycleReport`, `NetWorthEvolution`, `NetWorthEvolutionView`, `ReportsPages`, `SpendablePage`, `CommitmentsHomeView`, `UpcomingFullView`, `UpcomingPage`). `packages/platform/src/config` (variable de la web). `deploy/compose/caddy/Caddyfile`, `deploy/compose/compose.yaml` y `compose.prod.yaml` (entorno de `finance-web`). Ningún contexto de dominio.

**APIs impactadas:** ninguna. `contracts/openapi` no cambia (las cabeceras son de las páginas HTML de la web, no de la API).

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-SECURITY-CSP-001..008 (8). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** toda la UI. Un script o estilo sin nonce queda bloqueado y la pantalla se rompe en silencio: la suite E2E completa corre con la CSP aplicada y la spec nueva falla ante cualquier violación. Las páginas que hoy se prerenderizan (las de `auth`) pasan a renderizado por petición: costo despreciable con un usuario. Sin cambios en la API, el ledger ni los datos.

**Riesgos introducidos:** sin RISK-id registrado. Una violación no cubierta por los E2E rompe una pantalla en producción; mitigación: recorrido de todas las rutas de la navegación y modo `Report-Only` de emergencia, pregunta 2); `style-src-attr 'unsafe-inline'` deja abierta la inyección de estilos por atributo (bajo: React escapa los atributos y no hay `dangerouslySetInnerHTML`).

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX ni periodos).
