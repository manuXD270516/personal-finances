# @pf/api — finance-api

Composition root NestJS 12 (ESM). Una imagen, cuatro comandos (ADR-0011):

| Entrypoint | Comando (tras `pnpm build`) | Comportamiento actual |
|---|---|---|
| `src/main.api.ts` | `pnpm --filter @pf/api start:api` | HTTP: `/health/live`, `/health/ready` (fuera de `/api/v1`); `POST /internal/platform/ping` solo con `PFOS_ENV=local\|ci` |
| `src/main.worker.ts` | `pnpm --filter @pf/api start:worker` | Consume `platform.ping` (pg-boss) |
| `src/main.migrate.ts` | `pnpm --filter @pf/api migrate` | Placeholder: loguea `sin migraciones` y sale con 0 (tarea 4.5) |
| `src/main.seed.ts` | `pnpm --filter @pf/api seed` | Placeholder: `sin seeds`; rechaza staging/production |

- Convenciones de `/api/v1` (`platform/api-conventions`): `src/api/api-conventions.ts` arma contrato, idempotencia (PostgreSQL), cursores y límite de tasa; el contrato se lee de `contracts/openapi` en el repo y de `contract/` (copia que deja `pnpm build`) en la imagen. El worker purga claves de idempotencia vencidas cada 15 min.
- Configuración: `@pf/platform/config` (ver `docs/config-reference.md`). Variable faltante → exit 78.
- OTel: `start:*` cargan `--import @pf/platform/otel/register`; activo solo con `OTEL_ENABLED=true`.
- Apagado ordenado: SIGTERM/SIGINT → deja de aceptar trabajo, espera lo activo, cierra recursos, exit 0.
- Tests: `pnpm --filter @pf/api test:integration` (Testcontainers: postgres:18 + SeaweedFS; requiere Docker).
