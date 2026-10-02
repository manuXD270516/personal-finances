# Architecture Decision Records (ADRs)

Registro de decisiones de arquitectura de PFOS. Formato MADR adaptado (ver [ADR-0001](0001-record-architecture-decisions.md)). **`docs/ARCHITECTURE.md` es canónico**: los ADRs formalizan y justifican sus decisiones; nunca lo contradicen en silencio.

## Índice

| # | Título | Estado | Fecha | Resumen |
|---|--------|--------|-------|---------|
| [0001](0001-record-architecture-decisions.md) | Registrar decisiones de arquitectura | Aceptado | 2026-10-01 | ADRs MADR en `docs/adr/`, español, numeración inmutable; ARCHITECTURE.md canónico; reemplazo en lugar de reescritura. |
| [0002](0002-architecture-style-modular-monolith.md) | Estilo arquitectónico: Modular Monolith | Aceptado | 2026-10-02 | Modular Monolith + DDD + Hexagonal + Clean; un deployable con procesos `api` y `worker`; microservicios rechazados por ahora. |
| [0003](0003-module-boundaries-and-extraction-criteria.md) | Fronteras de módulos y criterios de extracción | Aceptado | 2026-10-02 | Paquete por contexto con `exports` = contracts, schema PG por contexto sin FKs cruzadas, sync solo por invariante; ≥ 2 criterios para extraer. |
| [0004](0004-ledger-model-double-entry.md) | Modelo de ledger | Aceptado | 2026-10-02 | Doble entrada simplificada, multi-moneda, append-only; Σ=0 por moneda; FX_TRADING para conversiones; clasificación fuera del ledger. |
| [0005](0005-database-postgresql.md) | Base de datos: PostgreSQL 18 | Aceptado | 2026-10-02 | PG 18 como único almacén del core: NUMERIC exacto, RLS, constraint triggers diferidos, schemas por contexto. |
| [0006](0006-money-representation.md) | Representación de dinero | Aceptado | 2026-10-02 | decimal.js (40 dígitos) + `NUMERIC(38,18)` + string decimal en API; HALF_EVEN; largest remainder; BIGINT descartado (ETH). |
| [0007](0007-data-access-and-migrations.md) | Acceso a datos y migraciones | Aceptado | 2026-10-02 | Kysely + migraciones SQL-first con dbmate; Prisma 7, Drizzle, MikroORM, TypeORM evaluados; confirmar en SPIKE-02. |
| [0008](0008-async-jobs-and-domain-events.md) | Jobs asíncronos y eventos de dominio | Aceptado | 2026-10-02 | Transactional Outbox + relay → **pg-boss** (PostgreSQL) tras puerto `JobQueue` + inbox idempotente; at-least-once; orden por agregado (`key_strict_fifo`); Redis/Valkey opcional. |
| [0009](0009-object-storage.md) | Object storage | Aceptado | 2026-10-02 | Puerto `ObjectStorage` (API S3); S3 en cloud; local **SeaweedFS `mini`** (SPIKE-07; RustFS plan B, Garage sin versioning, MinIO archivado); checksums `WHEN_REQUIRED`; presigned POST para rangos de tamaño. |
| [0010](0010-authentication-and-authorization.md) | Autenticación y autorización | Aceptado | 2026-10-02 | OIDC Code+PKCE vía BFF, cookie httpOnly; Keycloak local; IdP cloud según ADR-0013; RBAC por workspace + RLS; BFF con `openid-client`, sesiones en PostgreSQL, refresh con lock; auth propia rechazada. |
| [0011](0011-container-strategy.md) | Estrategia de contenedores | Aceptado | 2026-10-02 | Una imagen por deployable, multi-stage, non-root, digest pinning, Trivy; procesos por comando. |
| [0012](0012-local-development-environment.md) | Entorno local | Aceptado | 2026-10-02 | Repo en `D:`; modo A (deps en contenedores + apps en Windows) y modo B (todo en contenedores, imagen de prod); contrato único de configuración; puertos `PF_*` en 127.0.0.1; scripts TS vía pnpm. |
| [0013](0013-cloud-deployment-strategy.md) | Despliegue cloud | Propuesto (owner/presupuesto) | 2026-10-01 | AWS ECS/Fargate con perfil de costo mínimo; Cloud Run plan B; EKS rechazado; detalle en docs/21. |
| [0014](0014-infrastructure-as-code.md) | Infrastructure as Code | Propuesto | 2026-10-01 | Terraform compatible con OpenTofu, módulos por capa, state remoto S3 cifrado, OIDC en CI. |
| [0015](0015-ci-cd-and-release-strategy.md) | CI/CD y release | Propuesto | 2026-10-01 | GitHub Actions, trunk-based, Conventional Commits, release-please, imagen inmutable promovida staging → prod con aprobación. |
| [0016](0016-testing-strategy.md) | Estrategia de testing | Aceptado | 2026-10-02 | Vitest, fast-check, Testcontainers, Playwright, contract y architecture tests; TC-ID en nombres de test. |
| [0017](0017-ml-service-separation.md) | Separación de ML | Propuesto | 2026-10-01 | Servicio Python/FastAPI separado (Phase 8) con ACL en el monolito; nunca en el camino crítico. |
| [0018](0018-monorepo-and-build-tooling.md) | Monorepo y build tooling | Aceptado | 2026-10-02 | pnpm workspaces + Turborepo, TypeScript estricto; Nx y polyrepo descartados. |
| [0019](0019-frontend-architecture-nextjs-bff.md) | Frontend: Next.js + BFF | Aceptado | 2026-10-02 | Next.js App Router como UI y BFF (tokens server-side); TanStack Query, shadcn/ui, ECharts; cliente generado de OpenAPI. |
| [0020](0020-observability.md) | Observabilidad | Aceptado | 2026-10-02 | OpenTelemetry + pino con redacción; trace continuo vía outbox; otel-lgtm local; CloudWatch/ADOT o Grafana Cloud. |
| [0021](0021-ai-assistant-integration.md) | Asistente IA | Propuesto | 2026-10-01 | Phase 10, solo lectura, tools autorizadas sobre queries públicas; SQL directo rechazado. |
| [0022](0022-api-style-and-versioning.md) | Estilo de API y versionado | Propuesto | 2026-10-01 | REST `/api/v1` contract-first OpenAPI 3.1, RFC 9457, Idempotency-Key, ETag/If-Match, cursor pagination. |
| [0023](0023-multi-tenancy-and-row-level-security.md) | Multi-tenancy y RLS | Aceptado | 2026-10-02 | `workspace_id` en toda tabla + RLS forzado con `SET LOCAL`; rol app sin BYPASSRLS; test SQL de cobertura RLS. |
| [0024](0024-spec-driven-development-with-openspec.md) | Spec Driven Development con OpenSpec | Aceptado | 2026-10-02 | OpenSpec 1.14.0 `spec-driven`, deltas, `validate --strict` en CI, Impact obligatorio, trazabilidad FR→Scenario→TC→test. |

"Propuesto (spike)" indica que la aceptación depende del spike citado en la sección *Validación* del ADR (ver ARCHITECTURE §15).

## Estados

`Propuesto` → `Aceptado` → `Deprecado` | `Reemplazado por ADR-NNNN`. También `Rechazado` (se conserva para no reabrir la discusión).

## Cómo proponer un ADR

1. Tomar el siguiente número libre (4 dígitos; **nunca** reutilizar números, ni siquiera de ADRs rechazados).
2. Crear `docs/adr/NNNN-titulo-en-kebab-case.md` con la plantilla:
   ```
   # ADR-NNNN: Título
   - Estado: Propuesto
   - Fecha: YYYY-MM-DD
   - Decisores: Owner (Product/Tech Lead)
   - Relacionado: docs/…, ADR-…, OpenSpec capability …
   ## Contexto y problema
   ## Drivers de decisión
   ## Opciones consideradas
   ## Decisión
   ## Análisis de opciones   (por opción: pros, contras, costo, complejidad operativa)
   ## Consecuencias          (positivas / negativas / riesgos)
   ## Validación             (spike, architecture test o métrica)
   ## Notas                  (hechos verificados con fecha; "a verificar en SPIKE-NN")
   ```
3. Para decisiones tecnológicas, comparar **al menos dos alternativas reales** con pros, contras, costo y complejidad operativa.
4. Si el ADR cambia algo de `docs/ARCHITECTURE.md`, actualizarlo **en el mismo PR**.
5. Si la decisión nace de un cambio OpenSpec, referenciar el ADR desde `openspec/changes/<id>/design.md` (ADR-0024).
6. Añadir la fila al índice de este README en el mismo PR.
7. Revisión y merge; el estado pasa a `Aceptado` cuando se cumple su criterio de Validación (o en el DESIGN GATE para decisiones sin spike).

## Cómo reemplazar (supersede) un ADR

1. Crear un ADR nuevo con `Relacionado: Reemplaza ADR-NNNN` y el razonamiento de por qué cambia la decisión (evidencia: spike, métricas, cambio externo como licencias o precios).
2. En el ADR antiguo cambiar **solo** el estado a `Reemplazado por ADR-MMMM` y añadir una Nota fechada; no reescribir su contenido.
3. Actualizar `docs/ARCHITECTURE.md` y este índice en el mismo PR.
4. Si afecta comportamiento observable, acompañarlo de un cambio OpenSpec.

Correcciones editoriales (typos, enlaces) y Notas fechadas con hechos nuevos se permiten sin reemplazar el ADR.
