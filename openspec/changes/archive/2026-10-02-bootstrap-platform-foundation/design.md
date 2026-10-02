# Diseño

## Contexto

Repositorio greenfield. Phase 0 produjo el diseño (ver `docs/ARCHITECTURE.md` §5, §6, §10–§12; `docs/19-local-development.md`, `docs/20-container-strategy.md`, `docs/23-ci-cd.md`, `docs/16-testing-strategy.md`, `docs/17-test-traceability.md`). Este change materializa solo el andamiaje de plataforma que esos documentos describen. Motivación: ver proposal.md — Por qué. La máquina principal de desarrollo es Windows (Docker Desktop + WSL2).

## Objetivos / No objetivos

**Objetivos:**
- Skeleton del monorepo (pnpm workspaces + Turborepo) con `apps/api` vacío pero cableado (host NestJS con entrypoints `api`, `worker`, `migrate`, `seed`), `apps/web` (shell Next.js con ruta de salud), `packages/shared-kernel`, `packages/platform`.
- Stack Compose con perfiles y arranque por salud exactamente como en `docs/ARCHITECTURE.md` §10.
- Quality gate de CI (GitHub Actions) y política *build once*.
- Herramienta de trazabilidad (`scripts/traceability`) y validación del catálogo.

**No objetivos:**
- Código de dominio de cualquier bounded context, tablas o endpoints de negocio.
- Aprovisionamiento cloud (Terraform queda en diseño hasta aceptar ADR-0013).
- Workflow de despliegue a producción (aquí solo se diseña la publicación de imágenes lista para staging).

## Decisiones

1. **Una imagen backend, varios comandos** (`finance-api`: `api | worker | migrate | seed`). Alternativa — imagen de worker separada — descartada: duplica el build y rompe la paridad *build once* (ADR-0011).
2. **Perfiles de Compose** `deps`, `core`, `seed`, `observability`, `ml`; `migrate` es un servicio one-shot y `finance-api`/`finance-worker` dependen de él con `service_completed_successfully`; las dependencias usan `service_healthy`. Alternativa — múltiples archivos compose combinados con `-f` — se conserva solo para overrides locales (ADR-0012).
3. **Scripts multiplataforma en TypeScript** ejecutados vía `pnpm` (`scripts/*.ts` con `tsx`), envolviendo `docker compose`. Alternativas — Makefile / bash — descartadas por fricción en Windows.
4. **Endpoints de salud fuera de la API versionada** (`/health/live`, `/health/ready`) para que los probes nunca dependan de auth ni del versionado.
5. **Migraciones SQL-first** con dbmate (ADR-0007, pendiente de confirmación en SPIKE-02). La migración de bootstrap crea los schemas por contexto de forma incremental (ahora solo `platform`) y dos roles: `pf_migrator` (propietario) y `pf_app` (sin `BYPASSRLS`, sin DDL).
6. **Chequeos de arquitectura** con reglas de dependency-cruiser versionadas en `.dependency-cruiser.cjs`: domain → solo shared-kernel; sin internals de otros contextos; sin imports de framework en domain (ADR-0003).
7. **Script de trazabilidad** que parsea OpenSpec (`openspec show --json` cuando esté disponible; si no, Markdown de `### Requirement:` y la línea `Trace: … · Priority: …`), el front matter de `tests/cases/**/*.md` y los archivos de test (regex `\[TC-[A-Z]+-[A-Z0-9]+-\d{3}\]`), y genera `tests/traceability/matrix.{md,json}` (docs/17).
8. **CLI de OpenSpec fijada** (`@fission-ai/openspec@1.14.0` como devDependency raíz); CI ejecuta `openspec validate --all --strict --no-interactive` (flags verificados localmente el 2026-10-01).
9. **Escaneo de imágenes** con Trivy (acciones de terceros fijadas por SHA de commit); escaneo de secretos con gitleaks; actualizaciones de dependencias con Renovate (docs/23).

## Riesgos / Trade-offs

- [IO y file-watching lentos con bind mounts en Docker Desktop/Windows] → perfil `deps` + apps en el host con hot reload; repo dentro del filesystem de WSL2 recomendado (SPIKE-08).
- [Cambios de distribución/licencia de imágenes de object storage (MinIO archivado)] → storage detrás de un puerto compatible con S3; la elección de imagen queda aislada en un solo servicio de compose (SPIKE-07).
- [El arranque de Keycloak ralentiza el boot de `core`] → import del realm al iniciar y healthcheck con `start_period` generoso; aceptable en local.
- [El CLI de OpenSpec evoluciona rápido (v1.x)] → versión fijada; actualizaciones solo mediante change explícito.
- [Costo de minutos de CI con Testcontainers] → filtros por paths, caché, suites pesadas nocturnas.

## Plan de migración

No existen datos. Rollback = revertir el commit. La migración SQL de bootstrap es aditiva.

## Preguntas abiertas

- Imagen final de object storage (SPIKE-07) — no cambia las specs, solo la definición del servicio en compose.
