## Why

Por segunda vez (2026-10-08 y 2026-11-27) un agente borró datos del stack de desarrollo del owner. El 2026-11-27 ejecutó `PF_E2E_PROJECT=pfos-e2e-pwa PF_ENV_FILE=<.env temporal> pnpm stack:down --volumes --yes` y se perdieron los volúmenes `pfos_pg-data` y `pfos_object-storage-data`. Causa raíz: `composeProject()` (`scripts/stack/src/lib/paths.ts`) solo leía `PF_COMPOSE_PROJECT` y caía en `pfos`; `PF_E2E_PROJECT` solo lo usa el harness E2E. `CLAUDE.md` decía que bastaba con `PF_E2E_PROJECT`, y eso era falso para `pnpm stack:*`.

## What Changes

- `composeProject()` toma `PF_COMPOSE_PROJECT`, si no `PF_E2E_PROJECT` (debe empezar con `pfos-e2e`) y recién después `pfos`; si las dos difieren, error.
- Guarda: `stack:down --volumes`, `stack:reset` y `restore:local` sobre `pfos` se niegan sin terminal interactiva aunque se pase `--yes`, salvo `PF_ALLOW_DEV_STACK_WIPE=pfos`.
- `CLAUDE.md` y `.claude/agents/implementador.md` corregidos y con el incidente citado.

## Impact

Solo `scripts/stack` y documentación. Sin migraciones ni contratos. En una terminal interactiva el owner sigue igual; `test:stack` usa `pfos-test` y no cambia.
