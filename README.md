# Personal Finance Operating System (PFOS)

Sistema integral de finanzas personales multi-moneda (fiat + cripto) con ledger de doble entrada interno, planificación mensual, presupuestos, compromisos recurrentes, deudas, metas, imports, reportes y —en fases tardías— forecasting y un asistente IA de solo lectura.

> **Estado (2026-10-02):** DESIGN GATE aprobado (2026-10-01) · **Phase 0 bootstrap implementado y archivado** · **Phase 1 lista para implementar** (11 changes especificados) (`bootstrap-platform-foundation`: monorepo, observabilidad base, contenedores y stack local, quality gate de CI y trazabilidad de tests). Todavía no hay bounded contexts de negocio. Ver [docs/DESIGN-GATE.md](docs/DESIGN-GATE.md).

## Inicio rápido

**Prerrequisitos:** Docker Desktop (Compose v2 ≥ 2.24), Node `>=22.12 <27` (`.nvmrc`: 24), pnpm 12.4.2 vía `corepack enable`, Git. Los comandos funcionan igual en PowerShell y Git Bash.

```bash
pnpm install
pnpm setup:env                      # crea .env con secretos dev aleatorios (no sobrescribe valores existentes)

# Modo A — dependencias en contenedores, apps en el host con recarga
pnpm stack:up                       # postgres, object-storage, mailpit, keycloak
pnpm dev                            # migrate + api (28080), worker y web (23000); Ctrl+C para salir

# Modo B — producto completo en contenedores
pnpm stack:up -- --profile core

# Tests y checks
pnpm turbo run typecheck lint test
pnpm test:integration               # Testcontainers (requiere Docker)

pnpm stack:down                     # para el stack (conserva los volúmenes)
```

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm setup:env [-- --check \| --apply-ports]` | Crea/actualiza `.env` y comprueba que los puertos `PF_*` estén libres |
| `pnpm stack:up [-- --profile core]` | Levanta el stack Compose `pfos` y espera a que esté healthy |
| `pnpm dev` | Modo A: apps en el host contra el perfil `deps` |
| `pnpm stack:down` · `stack:ps` · `stack:logs -- <svc>` · `stack:reset` | Ciclo de vida del stack |
| `pnpm db:migrate` · `pnpm db:seed -- --profile=minimal` | Migraciones y seed (one-shot en contenedor) |
| `pnpm turbo run typecheck lint test` | Typecheck, lint y tests unitarios de todo el monorepo |
| `pnpm test:integration` · `pnpm test:stack` | Testcontainers · suite del stack en un proyecto desechable |
| `pnpm format:check` · `pnpm spec:validate` · `pnpm arch:check` | Prettier · OpenSpec `--strict` · reglas de arquitectura |
| `pnpm traceability:check` · `pnpm config:docs:check` | Trazabilidad de TC · referencia de configuración al día |

Referencia completa: [docs/19-local-development.md](docs/19-local-development.md) §0.5.

## Documentación clave

1. [docs/DESIGN-GATE.md](docs/DESIGN-GATE.md) — checklist de readiness y preguntas abiertas.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — decisiones canónicas (fuente de verdad transversal).
3. [docs/19-local-development.md](docs/19-local-development.md) · [docs/20-container-strategy.md](docs/20-container-strategy.md) · [docs/23-ci-cd.md](docs/23-ci-cd.md) — entorno local, contenedores y CI/CD (as-built).
4. [docs/config-reference.md](docs/config-reference.md) — variables de configuración (generado).
5. [docs/03-openspec-strategy.md](docs/03-openspec-strategy.md) — Spec Driven Development con OpenSpec.
6. [docs/09-ledger-design.md](docs/09-ledger-design.md) — modelo financiero e invariantes.
7. [docs/adr/README.md](docs/adr/README.md) — índice de ADRs.

## Estructura

```
apps/              api (NestJS: api | worker | migrate | seed), web (Next.js UI + BFF)
packages/          platform (config, logging, health, observabilidad), shared-kernel, contexts/
scripts/           stack (comandos pnpm del stack local), architecture, traceability
deploy/compose/    compose.yaml + realm de Keycloak de desarrollo
docker/            Dockerfiles de finance-api y finance-web
openspec/          specs y changes (OpenSpec 1.14.0)
docs/              00–31 + ARCHITECTURE + DESIGN-GATE, adr/
contracts/         openapi/, events/
tests/             cases/ (catálogo TC-*), traceability/ (matriz generada)
.github/           workflows pr.yml (gate de 14 checks) y main.yml (build once → GHCR)
```
