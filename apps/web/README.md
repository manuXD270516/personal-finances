# @pf/web — finance-web

Shell Next.js 16 (App Router, `output: 'standalone'`) con next-intl: español por defecto (`/`), catálogos
`en` y `pt` (`/en`, `/pt`) en `messages/*.json` (mismas claves; lo verifica `src/i18n.test.ts`).

- Salud: `GET /api/health/live` y `GET /api/health/ready` (503 si la configuración es inválida o el almacén de
  sesiones `iam.bff_session` no responde).
- BFF (ADR-0010 enmienda, ADR-0019; `src/bff/`): login OIDC Authorization Code + PKCE con `openid-client`
  (`/api/bff/auth/login`, `/callback`, `/logout`), sesión server-side en `iam.bff_session` (rol `pf_bff`, tokens
  AES-256-GCM, cookie opaca `__Host-pfos_sid`), refresh de un solo vuelo con `pg_advisory_xact_lock`, CSRF
  (Origin + `X-CSRF-Token` HMAC) y proxy `/api/bff/v1/*` → finance-api con el bearer. El navegador nunca ve
  tokens OAuth. Detalle en docs/12 §3.
- Páginas autenticadas en `app/[locale]/(app)` (inicio, `/configuracion`, `/preferencias`, `/workspaces/nuevo`);
  pública `/auth/error`.
- Tests: `pnpm test` (unidad) y `pnpm test:integration` (BFF contra PostgreSQL con Testcontainers); E2E en
  `tests/e2e` (`pnpm test:e2e`).
- Configuración validada al arrancar (`instrumentation.ts` → `@pf/platform/config`, exit 78 si falta algo).
- `pnpm --filter @pf/web build` genera `.next/standalone/apps/web/server.js`. Ejecutarlo con
  `HOSTNAME=0.0.0.0` (como en el contenedor): con `HOSTNAME=127.0.0.1` el rewrite de locale de next-intl
  entra en un bucle de redirecciones en `/`.
- `@swc/core` se fija en 1.15.47 (override en `pnpm-workspace.yaml`): 1.16.x no carga en Windows con las ACL
  de `%LOCALAPPDATA%\swc` (SPIKE-04 R2) y el plugin de next-intl lo requiere al cargarse.
