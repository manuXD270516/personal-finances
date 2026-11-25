# Tareas

> C13 de [cambios-de-codigo.md](../../../docs/despliegue/cambios-de-codigo.md), antes de los datos reales (fase 8). Decisiones D457 y D458 en [docs/74](../../../docs/74-despliegue-n1-specs-decisions.md) (ambas con la recomendación). Gates: los de `CLAUDE.md`, más `pnpm test:e2e` con `PF_E2E_PROJECT=pfos-e2e-<nombre>` (cambia la UI).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner el delta de `security/access-control` y las preguntas 1 y 2 de docs/73; registrar las decisiones en el `…-decisions.md` siguiente y ajustar spec, design y TC; `openspec validate add-web-content-security-policy --strict` (2026-11-24: D457 y D458 en docs/74 (todas con la recomendación).)
- [x] 1.2 Revisar TC-SECURITY-CSP-001..008 contra los scenarios; pasarlos a `ready` y `requirement_status: confirmed` (TC-SECURITY-CSP-006 queda `provisional` hasta la pregunta 1) (2026-11-24: TC-SECURITY-CSP-001..008 revisados contra los scenarios; -006 pasa a `confirmed` por D457.)

## 2. DOMAIN

- [x] 2.1 Sin lógica de dominio: el change es de la capa interface de `apps/web` y del borde

## 3. APPLICATION (constructor de la política, test-first)

- [x] 3.1 Función pura `buildContentSecurityPolicy({ nonce, filesOrigin, https, development })` en `apps/web/src/bff/` (o `src/security/`), test-first: directivas y orden de la decisión 3; `'unsafe-eval'` y `ws:` solo en desarrollo; `upgrade-insecure-requests` solo con HTTPS; origen de archivos reducido a esquema, host y puerto; sin origen, `connect-src 'self'`: TC-SECURITY-CSP-001, -003 (2026-11-24: `apps/web/src/security/csp.ts` y `csp.test.ts` (10 tests).)
- [x] 3.2 Generación del nonce (128 bits, `crypto.getRandomValues`, base64) con test de unicidad: TC-SECURITY-CSP-002 (2026-11-24: `generateNonce` (16 bytes) con test de 1000 nonces distintos.)
- [x] 3.3 `WEB_CSP_REPORT_ONLY` (si se acepta la pregunta 2): solo cambia el nombre de la cabecera, no la política; test unitario (2026-11-24: `cspHeaderName` y prueba en `proxy.test.ts` (D458).)

## 4. INFRASTRUCTURE (configuración y borde)

- [x] 4.1 `packages/platform/src/config/variables.ts`: `OBJECT_STORAGE_PUBLIC_ENDPOINT` en la lista de `web`, obligatoria en `web` con `PFOS_ENV=staging|production` (validación en `load.ts` y test en `load.test.ts`); `WEB_CSP_REPORT_ONLY` según la pregunta 2; `docs/config-reference.md` regenerado (`pnpm config:docs:check`) (2026-11-24: `WEB_CSP_REPORT_ONLY` y `OBJECT_STORAGE_PUBLIC_ENDPOINT` en la lista de `web`; validación en `load.ts` y test en `load.test.ts`; `config-reference.md` regenerado.)
- [x] 4.2 `deploy/compose/compose.yaml` y `compose.prod.yaml`: `OBJECT_STORAGE_PUBLIC_ENDPOINT` en el entorno de `finance-web` (en producción, el de `pfos.env`); `deploy/host/etc-pfos/pfos.env.example` sin variables nuevas obligatorias (2026-11-24: sin cambios en los compose: `finance-web` ya lee `OBJECT_STORAGE_PUBLIC_ENDPOINT` del `env_file` (`.env` en local, `/etc/pfos/pfos.env` en el host, que ya la trae); `pfos.env.example` sin variables nuevas.)
- [x] 4.3 `deploy/compose/caddy/Caddyfile`: `header ?Content-Security-Policy "default-src 'none'; frame-ancestors 'none'"` en los bloques de `PF_DOMAIN_APP` y `PF_DOMAIN_FILES` (no en el snippet común ni en `PF_DOMAIN_AUTH`); `Permissions-Policy` y `Cross-Origin-Opener-Policy` en `PF_DOMAIN_APP`; `caddy validate` con la imagen fijada: TC-SECURITY-CSP-004, -007 (2026-11-24: Caddyfile con la CSP por omisión y las cabeceras del borde; `caddy-headers.stack.test.ts` valida con la imagen fijada y prueba cada caso contra Caddy real.)

## 5. INTERFACE (`apps/web`)

- [x] 5.1 `proxy.ts`: nonce y política por petición HTML; cabecera en la petición reenviada y en la respuesta, compuesta con `next-intl` (decisión 2); las redirecciones al login sin cambios; test de integración con el servidor de Next que compara el nonce de los `<script>` con el de la cabecera: TC-SECURITY-CSP-001, -002 (2026-11-24: `proxy.ts` pasa a `next-intl` una petición ya con la política (reenvía las cabeceras al rewrite); `proxy.test.ts` comprueba `x-middleware-request-content-security-policy`; el E2E compara los nonces de los `<script>`.)
- [x] 5.2 `app/[locale]/layout.tsx`: `await connection()` y sin `generateStaticParams`; comprobar en la salida de `next build` que ninguna página queda prerenderizada (`○`) (2026-11-24: `await connection()` y sin `generateStaticParams`; `next build` solo deja `○ /_not-found`, que ya no se sirve: se agregó `app/[locale]/[...rest]/page.tsx` y `app/[locale]/not-found.tsx` (404 propio con i18n es/en/pt, renderizado por petición).)
- [x] 5.3 Pasar a hojas estáticas los `<style>` en línea de `CashFlowView`, `DashboardView`, `ForecastsView`, `LifecycleReport`, `NetWorthEvolution`, `NetWorthEvolutionView`, `ReportsPages`, `SpendablePage`, `CommitmentsHomeView`, `UpcomingFullView` y `UpcomingPage`; ajustar los tests que hoy quitan `<style>` del HTML renderizado (`cash-flow.test.tsx`, `forecast-home.test.tsx`): TC-SECURITY-CSP-006 (2026-11-24: 11 `<style>` pasan a hojas estáticas (`*.css` junto a cada vista, importadas por los componentes); tests ajustados.)
- [x] 5.4 Comprobar que ningún formulario hace un envío nativo fuera del origen (`form-action 'self'`); si alguno lo hace, anotarlo en el design y sumar el origen (2026-11-24: ningún formulario hace un envío nativo fuera del origen; `form-action 'self'` y la suite completa sin violaciones.)

## 6. AUTOMATED TESTS y E2E

- [x] 6.1 E2E `tests/e2e/specs/content-security-policy.spec.ts`: oyente de `securitypolicyviolation` y de mensajes «Refused to» con `page.addInitScript`; recorrido de todas las rutas de `NAV_ITEMS` en `es`, una en `en` y `pt` y las páginas de `auth`; subida de un documento y calendario de flujo de caja; cabecera con nonce distinto en dos cargas, `frame-ancestors 'none'` y el origen de archivos en `connect-src`; lista de violaciones vacía: TC-SECURITY-CSP-001..003, -005, -006 (2026-11-24: `tests/e2e/specs/content-security-policy.spec.ts` (8 tests).)
- [x] 6.2 E2E de enmarcado: página de prueba servida por Playwright en otro origen con un iframe del Home; el iframe no carga: TC-SECURITY-CSP-004 (2026-11-24: incluido en la misma spec (iframe desde otro origen: la frame termina en `chrome-error:`).)
- [ ] 6.3 Suite E2E completa en verde con la CSP aplicada (dos corridas), incluidas `auth.spec.ts` y `documents.spec.ts`: TC-SECURITY-CSP-008
- [x] 6.4 Automatizar todos los TC con el TC-id en el nombre del test; actualizar el front matter (2026-11-24: TC-SECURITY-CSP-001..008 con `automated_tests`; -008 queda con el login/logout de producción a mano (fase 6).)

## 7. DOCUMENTATION

- [x] 7.1 Runbook de despliegue, fase 6 (`docs/despliegue/RUNBOOK-DESPLIEGUE.md`): comprobación 9 desde afuera, `curl -sI $BASE/ | grep -i content-security-policy` muestra `nonce-`, `frame-ancestors 'none'` y el origen `$FILES` en `connect-src`, y la de `$FILES/` trae `frame-ancestors 'none'`; regla de corte si falta. Ampliar la comprobación 6 con `permissions-policy` y `cross-origin-opener-policy` (2026-11-24: comprobación 9 y comprobación 6 ampliadas.)
- [x] 7.2 `docs/runbooks/deploy-and-restore.md` §7: qué hacer ante una pantalla rota por la CSP (`WEB_CSP_REPORT_ONLY=true` y redeploy, si se aceptó la pregunta 2) (2026-11-24: fila «Pantalla rota por la CSP» en §7.)
- [x] 7.3 docs/12 §12 (política as-built, `style-src-attr` y `form-action 'self'`), ADR-0019 (pendiente de Phase 1 cerrado), ADR-0027 (nota del 2026-10-29 resuelta) y NFR-SEC-008 (verificación por E2E) (2026-11-24: docs/12 §12, ADR-0019, ADR-0027 y NFR-SEC-008 actualizados.)
- [ ] 7.4 Matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
