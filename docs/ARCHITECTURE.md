# ARCHITECTURE — Resumen canónico de decisiones (Phase 0)

> **Estado:** Propuesto para DESIGN GATE · **Fecha:** 2026-10-01 · **Owner:** Principal Architect
>
> Este documento es la **fuente canónica** de decisiones transversales. Todo documento en `docs/`, todo ADR en `docs/adr/` y toda spec en `openspec/` DEBE ser consistente con él. Si un documento necesita contradecirlo, se abre un cambio OpenSpec + ADR que lo modifique; no se diverge en silencio.

---

## 1. Naturaleza del producto

**Personal Finance Operating System (PFOS)**: sistema integral de finanzas personales multi-moneda (fiat + cripto), con ledger de doble entrada interno invisible para el usuario, planificación mensual, presupuestos, compromisos recurrentes, deudas, metas, documentos, imports, reglas, reportes y —tardíamente— forecasting estadístico y un asistente IA de solo lectura.

- Uso inicial: **un usuario**, un workspace. Arquitectura: **multi-usuario / multi-workspace desde el modelo de datos** (`workspace_id` en toda tabla de negocio).
- Contexto de referencia del primer usuario: Bolivia — moneda base sugerida **BOB**, uso habitual de **USD** y **USDT** (conversiones P2P). Zona horaria por defecto `America/La_Paz`. **Confirmado por el owner (2026-10-01):** moneda de reporte BOB, zona horaria America/La_Paz, UI en español con i18n preparado para **inglés y portugués**.
- El producto es **completamente útil sin IA, sin ML y sin integraciones bancarias**.

## 2. Estilo arquitectónico (ADR-0002, ADR-0003)

**Modular Monolith + DDD + Hexagonal (Ports & Adapters) + Clean Architecture + eventos de dominio internos vía Transactional Outbox.**

- Un único deployable de backend (`finance-api`) con **dos procesos** desde la misma imagen: `api` (HTTP) y `worker` (jobs/eventos). *Build once, run with different command.*
- Cada **bounded context** es un módulo aislado (paquete del workspace pnpm) con capas `domain → application → infrastructure/interface`. Solo expone su **API pública** (`contracts`: commands, queries, DTOs, eventos). Prohibido importar internals de otro contexto (verificado por architecture tests).
- Cada contexto posee su **schema PostgreSQL** propio. Referencias entre contextos solo por **ID** (sin FKs cross-schema, salvo `workspace_id` → `iam.workspace` y `currency` → `fx.currency`; el catálogo de monedas es propiedad de FX). Esto permite extraer un contexto a microservicio sin reescribir el dominio.
- Forecasting/ML: servicio Python separado (**Phase 8**), nunca en el camino crítico del core.
- Microservicios: **rechazados** por ahora (complejidad operativa, costo, consistencia transaccional del ledger, equipo de 1 persona). Criterios de extracción documentados en ADR-0003.

## 3. Bounded contexts (nombres canónicos)

| # | Contexto | Código | Schema PG | Paquete | Tipo DDD | Fase |
|---|----------|--------|-----------|---------|----------|------|
| 1 | Identity & Workspace | `IDENTITY` | `iam` | `@pf/identity` | Generic | 1 |
| 2 | Accounts (incl. Institutions) | `ACCOUNTS` | `accounts` | `@pf/accounts` | Core | 1 |
| 3 | Financial Ledger | `LEDGER` | `ledger` | `@pf/ledger` | Core | 1 |
| 4 | Transactions (splits, transfers, conversions como transacción, reconciliación, duplicados) | `TRANSACTIONS` | `txn` | `@pf/transactions` | Core | 1 |
| 5 | Classification (categories, category groups, tags, custom fields, counterparties/payees/providers) | `CLASSIFICATION` | `classification` | `@pf/classification` | Supporting | 1 |
| 6 | Planning & Budgeting (financial periods, budgets, templates versionados, month closing) | `PLANNING` | `planning` | `@pf/planning` | Core | 2 |
| 7 | Commitments (recurrence engine, recurring definitions, subscriptions) | `COMMITMENTS` | `commitments` | `@pf/commitments` | Core | 3 |
| 8 | Savings Goals | `GOALS` | `goals` | `@pf/goals` | Supporting | 4 |
| 9 | Debt & Credit (loans, amortization, credit cards) | `DEBT` | `debt` | `@pf/debt` | Core | 4 |
| 10 | FX & Market Data (rates históricos, MarketRateProvider, pricing de conversiones) | `FX` | `fx` | `@pf/fx` | Supporting | 1 (manual + providers de tasa paralela paralelo.bo / bo.dolarapi.com, ADR-0025) / 5 (más providers, cripto, commodities) |
| 11 | Documents & Attachments | `DOCUMENTS` | `documents` | `@pf/documents` | Generic | 6 |
| 12 | Imports & Banking Integrations | `IMPORTS` | `imports` | `@pf/imports` | Supporting | 6 |
| 13 | Rules Engine | `RULES` | `rules` | `@pf/rules` | Supporting | 6 |
| 14 | Reporting & Analytics (read models, dashboard, net worth, cash-flow calendar) | `REPORTING` | `reporting` | `@pf/reporting` | Supporting | 1 (básico) / 7 |
| 15 | Forecasting | `FORECAST` | `forecasting` | `services/ml-forecasting` + `@pf/forecasting` (ACL) | Supporting | 8 |
| 16 | Notifications | `NOTIFY` | `notifications` | `@pf/notifications` | Generic | 2 |
| 17 | Audit | `AUDIT` | `audit` | `@pf/audit` | Generic | 1 |
| 18 | AI Assistant | `ASSISTANT` | `assistant` (solo conversaciones/auditoría de tool calls) | `@pf/assistant` | Supporting | 10 |

Fusiones respecto a la lista original (justificadas en `docs/05-bounded-contexts.md`): *Budget Templates* → Planning; *Recurring Payments* + *Subscriptions* → Commitments; *Merchants/Providers* → Classification (`Counterparty`); *Banking Integrations* → Imports; *FX & Crypto Conversion* → FX (pricing/rates) + Transactions (el movimiento de dinero).

**Infraestructura compartida (no es un contexto de dominio):** `@pf/shared-kernel` (Money, Currency, IDs UUIDv7, Clock, Result, DomainEvent base, errores), `@pf/platform` (outbox, inbox, idempotency keys, unit of work, auth context, observabilidad). Schema PG `platform`.

## 4. Modelo financiero (ADR-0004, ADR-0006) — decisiones clave

1. **Ledger de doble entrada simplificado, multi-moneda, append-only.**
   - `LedgerAccount` de tipo `ASSET | LIABILITY | EQUITY | INCOME | EXPENSE`, **una sola moneda** por ledger account.
   - Cada `Account` del usuario (Accounts context) ↔ exactamente un `LedgerAccount` ASSET o LIABILITY. `Account` lleva atributo `liquidity` (`LIQUID | SEMI_LIQUID | ILLIQUID`) usado por *safe to spend* y cash-flow calendar.
   - Cuentas de sistema por workspace y moneda, creadas bajo demanda: `INCOME:<CCY>`, `EXPENSE:<CCY>`, `EQUITY:OPENING_BALANCE:<CCY>`, `EQUITY:FX_TRADING:<CCY>`, `EQUITY:ADJUSTMENTS:<CCY>`.
   - `JournalEntry` con `Posting[]`. Convención de signo: **débito positivo, crédito negativo**.
   - **Invariante:** para cada `JournalEntry` y **para cada moneda**, `Σ posting.amount = 0`. Validado en dominio y reforzado en BD (constraint trigger diferido).
   - Inmutabilidad: nunca se hace UPDATE/DELETE de postings. Correcciones = **entry de reversa + entry nueva**, enlazadas (`reverses_entry_id`). `void` = reversa.
   - **Clasificación fuera del ledger:** categorías, tags y custom fields viven en `TransactionSplit` (Transactions/Classification). Cada posting nominal referencia `split_id`. Recategorizar **no** toca el ledger.
   - Solo transacciones en estado `posted | cleared | reconciled` tienen JournalEntry. `pending` no impacta el ledger (sí las proyecciones de "saldo disponible/proyectado").
   - Periodos cerrados: no se aceptan entries con `entry_date` en periodo `closed`. Corrección = reabrir (auditado) o ajuste en periodo abierto.
   - Saldos = Σ postings. `AccountBalanceSnapshot` es **derivado y reconstruible** (optimización), nunca fuente de verdad.
2. **Conversiones** (fiat↔fiat, fiat↔crypto, crypto↔crypto): una sola JournalEntry con patas en cada moneda balanceadas vía `EQUITY:FX_TRADING:<CCY>`; fees como postings a `EXPENSE:<CCY>` con split categoría *Fees*. Ejemplo USDT→BOB:
   ```
   USDT Wallet            -100.000000 USDT
   FX_TRADING:USDT        +100.000000 USDT
   FX_TRADING:BOB         -690.00 BOB
   Bank BOB               +685.00 BOB
   EXPENSE:BOB (Fees)       +5.00 BOB
   ```
   Metadatos de pricing (`ConversionDetail`: quoted rate, effective rate, fees por tipo, spread, provider, timestamp, documentos) guardados **inmutables** junto a la transacción; FX context guarda la tasa de referencia histórica usada. **Nunca** se recalcula una operación histórica con tasas actuales.
3. **Refund** = crédito a `EXPENSE:<CCY>` con la misma categoría (reduce gasto). **Tarjeta de crédito** = cuenta LIABILITY; pago = transferencia ASSET→LIABILITY. **Préstamo**: desembolso (+ASSET/−LIABILITY); pago se divide en principal (LIABILITY), interés, fees, seguro, impuestos (EXPENSE con categorías de sistema).
4. **Savings goals**: contribución = transferencia real a cuenta vinculada **o** asignación virtual (earmark) sin movimiento de ledger. Ambas reconciliables.
5. **Inversiones / activos no monetarios**: modelados como "commodities" en la tabla `currency` (`kind = FIAT | CRYPTO | COMMODITY | CUSTOM`). Valoración y ganancias no realizadas = asunto de Reporting, no entries.
6. **Money** (Value Object, `@pf/shared-kernel`): `amount: Decimal` (decimal.js, precisión interna 40 dígitos) + `currency`. Prohibido `number`/float para dinero (lint rule + architecture test). Operaciones solo entre misma moneda. Redondeo **HALF_EVEN** a la escala de la moneda en puntos de materialización (posting, installment, allocation). Reparto (splits, cuotas) con **largest remainder** determinista.
7. **Persistencia de montos:** `NUMERIC(38,18)` para montos y `NUMERIC(38,18)` para tasas; la escala válida por moneda (`currency.scale`: BOB 2, USD 2, JPY 0, BTC 8, USDT 6, ETH 18) se valida en dominio. API transmite montos como **string decimal** (`{"amount":"685.00","currency":"BOB"}`).

## 5. Stack tecnológico (propuesto; cada punto con ADR)

| Área | Decisión | ADR | Estado |
|------|----------|-----|--------|
| Monorepo | pnpm workspaces + Turborepo; TypeScript estricto | ADR-0018 | Aceptado |
| Frontend | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Query + ECharts. Next.js actúa también como **BFF** (OIDC, cookie httpOnly; el token nunca llega al JS del navegador) | ADR-0019 | Aceptado |
| Backend | NestJS + TypeScript; Nest solo en la capa `interface`/composition root, **nunca en `domain`** | ADR-0002 | Aceptado |
| Base de datos | PostgreSQL 18 (versión menor fijada en implementación) | ADR-0005 | Aceptado |
| Acceso a datos | **Kysely** (query builder type-safe) + migraciones **SQL-first** (dbmate) — **confirmado por SPIKE-02** (27/27 tests en las 3 herramientas; Kysely: montos como string, errores `pg` con SQLSTATE, 3.8 MB). Prisma 7 descartado (transacción interactiva hasta para lecturas, acepta `number` en dinero, 77 MB; Prisma 8 en RC). Drizzle 1.0 RC como fallback (sus errores incluyen parámetros → montos en logs). `kysely-codegen` requiere override NUMERIC→string; `schema.sql` se vuelca con la imagen de dbmate (el paquete npm en Windows no trae `pg_dump`) | ADR-0007 | Aceptado |
| Money | decimal.js + `NUMERIC(38,18)` | ADR-0006 | Aceptado |
| Async | Transactional Outbox en PostgreSQL + relay → cola + inbox para idempotencia. **Aceptado (2026-10-02, Q5):** cola por defecto **pg-boss** sobre PostgreSQL (orden por agregado nativo con `key_strict_fifo`, encolado dentro de la transacción del relay), detrás de un puerto `JobQueue` en `@pf/platform`; BullMQ/Valkey como adapter opcional → **Redis/Valkey deja de ser dependencia obligatoria** | ADR-0008 | Aceptado |
| Object storage | Puerto `ObjectStorage` (API S3). Local: **SeaweedFS** (Apache-2.0, modo `mini`, versión fijada por digest) — recomendado por SPIKE-07 (23/23 checks, incl. versioning, presigned, CORS, checksums); RustFS 1.0 plan B; Garage descartado (sin versioning). MinIO archivado. El adapter S3 DEBE usar `requestChecksumCalculation/responseChecksumValidation = WHEN_REQUIRED`; límites de tamaño por rango requieren **presigned POST**. Cloud: S3 | ADR-0009 | Aceptado |
| AuthN/AuthZ | OIDC/OAuth2 (Authorization Code + PKCE vía BFF). Local: Keycloak. Cloud: Cognito vs Keycloak gestionado vs otros → depende de ADR-0013. RBAC por workspace (`OWNER`, `EDITOR`, `VIEWER`). PostgreSQL **RLS** como defense-in-depth. Validado en SPIKE-06 (Keycloak 26.8 + Next.js 16 BFF con `openid-client` 6 + Nest 12 con `jose` 6): token nunca expuesto al navegador, CSRF con SameSite + Origin + HMAC, refresh rotado con **lock distribuido** (reusar un refresh rotado mata la sesión en Keycloak). Session store del BFF: Valkey en el spike; **sesiones en PostgreSQL** (Redis opcional, Q5 aceptada). Keycloak local necesita ≥ 1 GiB | ADR-0010 | Aceptado |
| Contenedores | Docker multi-stage, imágenes non-root, healthchecks, una imagen por deployable (`finance-web`, `finance-api`, `finance-ml`) | ADR-0011 | Aceptado |
| Local | Docker Compose con **profiles**; scripts cross-platform (Node/tsx vía `pnpm`) — el entorno principal del owner es Windows; nada de scripts solo-bash | ADR-0012 | Aceptado |
| Cloud | Recomendación: **AWS ECS/Fargate** (paridad, Terraform maduro, learning value) con perfil de costo mínimo; **Cloud Run** como plan B documentado; **Kubernetes/EKS rechazado** por ahora. **SPIKE-09 (2026-10-03)** propone en su lugar un despliegue por niveles: default **VPS único con Docker Compose en AWS Lightsail 4 GB São Paulo (≈ USD 27–30/mes)**, N1 Hetzner (≈ 10–15), N3 con Neon (≈ 50–60) y ECS/Fargate + RDS como N4 (≥ 110) | ADR-0027 (reemplaza a ADR-0013) | **Aceptado 2026-10-05** (D51, USD 10–20/mes): Lightsail 2 GB São Paulo + Compose (≈ USD 14/mes), fallback Oracle A1 Santiago; IaC en `infra/` |
| IaC | Terraform (compatible OpenTofu), módulos por capa, state remoto | ADR-0014 | Propuesto |
| CI/CD | GitHub Actions; trunk-based con PRs cortos; Conventional Commits; release-please; imágenes tag `sha-<git-sha>` + semver | ADR-0015 | Propuesto |
| Testing | **Vitest** (unit/domain/app), Testcontainers (PG/Redis/S3), Playwright (E2E), fast-check (PBT), Spectral/Redocly (OpenAPI lint), JSON Schema (event contracts), dependency-cruiser (arquitectura) | ADR-0016 | Aceptado |
| Observabilidad | OpenTelemetry SDK (traces, metrics, logs) + pino JSON; local opcional `grafana/otel-lgtm`; cloud CloudWatch/ADOT o Grafana Cloud. Validado en SPIKE-10: bootstrap ESM con `node --import`, interceptor propio para `http.route` (Nest 12), instrumentaciones express/router desactivadas, y **`OTEL_NODE_RESOURCE_DETECTORS=env,os,serviceinstance` obligatorio** (los detectores por defecto filtran usuario de SO, hostname y argumentos del proceso) | ADR-0020 | Aceptado |
| ML | Python + FastAPI + Polars + statsmodels/scikit-learn/Prophet; servicio separado; MLflow futuro | ADR-0017 | Propuesto |
| IA | Asistente tardío (Phase 10), solo lectura, vía capa de *tools* autorizadas sobre casos de uso; jamás acceso directo a BD | ADR-0021 | Propuesto |
| API | REST `/api/v1`, OpenAPI 3.1 **contract-first** en `contracts/openapi/`, errores RFC 9457, `Idempotency-Key` en POST financieros, ETag/If-Match | ADR-0022 | Propuesto |
| Tasas de mercado (FX) | Puerto `MarketRateProvider`; principal **paralelo.bo** (mediana P2P USDT/BOB, CC BY 4.0, histórico diario), respaldo y oficial **bo.dolarapi.com** (MIT); polling pg-boss cada 15 min; parseo JSON lossless; atribución visible; fallback a tasa manual | ADR-0025 | Aceptado |

### Lista canónica de ADRs (`docs/adr/NNNN-titulo.md`, formato MADR)

0001 Record architecture decisions · 0002 Architecture style (Modular Monolith + DDD + Hexagonal) · 0003 Module boundaries & extraction criteria · 0004 Ledger model · 0005 Database · 0006 Money representation · 0007 Data access & migrations (ORM) · 0008 Async jobs & domain events (outbox) · 0009 Object storage · 0010 Authentication & authorization · 0011 Container strategy · 0012 Local development environment · 0013 Cloud deployment strategy · 0014 Infrastructure as Code · 0015 CI/CD & release strategy · 0016 Testing strategy · 0017 ML separation · 0018 Monorepo & build tooling · 0019 Frontend architecture (Next.js + BFF) · 0020 Observability · 0021 AI assistant integration · 0022 API style & versioning · 0023 Multi-tenancy & Row-Level Security · 0024 Spec Driven Development with OpenSpec & test traceability · 0025 Fuentes de tipo de cambio para Bolivia (paralelo.bo + bo.dolarapi.com) · 0026 Datos de demostración en workspace dedicado (aceptado 2026-10-04) · 0027 Destino de despliegue inicial (VPS + Compose por niveles, propuesto).

## 6. Estructura del repositorio (objetivo; en Phase 0 solo existen `docs/`, `openspec/`, `contracts/` borrador y `tests/cases/`)

```
personal-finances/
├─ openspec/                 # Fuente de verdad de comportamiento (specs + changes)
│  ├─ config.yaml
│  ├─ specs/<context>/<capability>/spec.md
│  └─ changes/<change-id>/{proposal.md,design.md,tasks.md,specs/…}
├─ docs/                     # 00..30 + ARCHITECTURE.md + DESIGN-GATE.md
│  ├─ adr/                   # ADRs MADR
│  └─ diagrams/              # Mermaid fuente cuando no esté inline
├─ contracts/
│  ├─ openapi/finance-api.v1.yaml
│  └─ events/<context>/<EventName>.v<N>.schema.json
├─ apps/
│  ├─ web/                   # Next.js (UI + BFF)
│  └─ api/                   # NestJS composition root: src/main.api.ts, src/main.worker.ts
├─ packages/
│  ├─ shared-kernel/
│  ├─ platform/
│  └─ contexts/<context>/src/{domain,application,infrastructure,interface,contracts}/
├─ services/ml-forecasting/  # Python (Phase 8)
├─ db/migrations/            # SQL-first, por schema/contexto
├─ seeds/{minimal,demo,large}/
├─ tests/
│  ├─ cases/<context>/TC-*.md   # Catálogo de test cases versionado
│  ├─ e2e/                      # Playwright
│  └─ traceability/             # matriz generada
├─ deploy/compose/            # compose.yaml + overrides
├─ docker/                    # Dockerfiles
├─ infra/terraform/{bootstrap,global,modules,environments/{dev,staging,prod}}  # dev = sandbox efímero opcional
├─ scripts/                   # TS cross-platform (stack, seed, backup…)
└─ .github/workflows/
```

**Regla de capas (ejecutable con dependency-cruiser):**
- `domain` → solo `@pf/shared-kernel`. Sin Nest, sin Kysely, sin Node I/O.
- `application` → `domain`, puertos propios, `contracts` de otros contextos.
- `infrastructure` → adapters (Kysely, BullMQ, S3, HTTP clients) que implementan puertos.
- `interface` → controllers Nest, DTO HTTP, mapping OpenAPI.
- Otro contexto solo vía `@pf/<ctx>/contracts`.

## 7. Integración entre contextos

- **Síncrono en la misma transacción BD** (solo donde una invariante lo exige): `Transactions → Ledger` (port `LedgerPostingPort`), `Debt/Goals/Commitments → Transactions` (crean transacciones vía application service público de Transactions). También: `Planning → Ledger` (`LedgerPeriodLockPort`, cierre de mes escribe `ledger.period_lock`), `Imports → Transactions` (persistencia de filas importadas + marca de fila en la misma transacción, para idempotencia). Apertura de cuenta con saldo inicial = orquestación en `apps/api` (unit of work que invoca Accounts y Transactions; ledger accounts get-or-create al postear) para evitar ciclo Accounts↔Transactions.
- **Evaluación síncrona sin efectos (dry-run)**: `Imports → Rules` para mostrar sugerencias en el preview antes de aprobar; la aplicación definitiva de reglas a transacciones persistidas sigue siendo asíncrona.
- **Asíncrono vía outbox** (eventual): todo lo demás (Reporting projections, Notifications, Rules sobre transacciones importadas, Audit, Budget thresholds).
- Nombres de eventos: `<context>.<EventName>.v<N>` (ej. `transactions.TransactionPosted.v1`). En el envelope: `eventType = "transactions.TransactionPosted"` y `eventVersion = 1` por separado. Envelope estándar: `eventId (UUIDv7), eventType, eventVersion, occurredAt, workspaceId, aggregateType, aggregateId, aggregateVersion, correlationId, causationId, actor, payload`.
- Entrega **at-least-once**; consumidores **idempotentes** (tabla `platform.inbox` por `(consumer, event_id)`); orden garantizado solo por agregado.
- **Audit**: todo comando que muta datos financieros escribe `AuditLog` en la **misma transacción** (no eventual) — requisito de integridad.

## 8. API (ADR-0022)

- Base: `/api/v1/workspaces/{workspaceId}/<resource>` (workspace explícito en la ruta; validado contra membership + RLS). Endpoints de usuario: `/api/v1/me`, `/api/v1/workspaces`.
- Recursos: `accounts, institutions, transactions, transfers, conversions, categories, category-groups, tags, custom-fields, counterparties, periods, budgets, templates, goals, recurring, subscriptions, loans, fx-rates, documents, imports, rules, reports, forecasts, notifications, audit-log, operations, exports` (`operations` = recurso de operaciones asíncronas 202; `exports` = export de workspace).
- JSON camelCase; montos string decimal; fechas `YYYY-MM-DD` (fecha de negocio) y RFC 3339 UTC (instantes).
- Paginación por cursor (`limit`, `cursor`), filtros explícitos, `sort`.
- Errores: RFC 9457 `application/problem+json` con `type` URI estable y `code` de dominio (`LEDGER_UNBALANCED_ENTRY`, `PERIOD_CLOSED`, …).
- `Idempotency-Key` obligatorio en POST que crean registros financieros; ETag/`If-Match` para updates.
- Breaking changes → `/api/v2` o versionado de recurso documentado; deprecación con `Deprecation`/`Sunset` headers.

## 9. Datos (ADR-0005, ADR-0023)

- IDs **UUIDv7** generados en la app. `created_at/updated_at timestamptz` UTC. Fecha de negocio `date` + timezone del workspace.
- Toda tabla de negocio: `workspace_id NOT NULL` + política RLS `workspace_id = current_setting('app.workspace_id')::uuid`. Rol de app sin `BYPASSRLS` y no owner de tablas; rol de migración separado.
- Optimistic locking: columna `version int` en agregados.
- Soft-archive (no delete) para catálogos referenciados (categories, tags, accounts, counterparties). Hard delete prohibido en datos financieros, **con una única excepción**: purga completa de un workspace a pedido de su OWNER (privacidad), ejecutada por un rol dedicado `pf_purge`, con export previo ofrecido y registro de la purga fuera del workspace; requiere ADR propio antes de implementarse.
- Migraciones: expand → migrate → contract; destructivas requieren aprobación manual en pipeline.

## 10. Plataforma local (ADR-0011, ADR-0012)

Servicios Compose (nombres canónicos) y profiles:

| Servicio | Imagen | Puerto host (`PF_<SVC>_PORT`, default) | Profiles |
|----------|--------|----------------------|----------|
| `postgres` | postgres:18 | 25432 | deps, core |
| `redis` | valkey/valkey — **opcional** (solo con `JOB_QUEUE_DRIVER=bullmq` o `SESSION_STORE=valkey`) | 26379 | valkey |
| `object-storage` | SeaweedFS `mini` (S3 API; RustFS plan B) | 29000 / 29001 | deps, core |
| `mailpit` | axllent/mailpit | 28025 (UI) / 21025 (SMTP) | deps, core |
| `keycloak` | quay.io/keycloak/keycloak (realm import dev) | 28081 | deps, core |
| `migrate` | finance-api (cmd migrate) — one-shot | — | core |
| `finance-api` | finance-api (cmd api) | 28080 | core |
| `finance-worker` | finance-api (cmd worker) | — | core |
| `finance-web` | finance-web | 23000 | core |
| `seed` | finance-api (cmd seed) — one-shot | — | seed |
| `otel-lgtm` | grafana/otel-lgtm | 23001 (Grafana), 24317/24318 | observability |
| `ml-forecasting` | finance-ml | 28090 | ml |

- `deps` = solo dependencias (para correr apps en el host con hot reload). `core` = todo el producto.
- **Estrategia de dockerización y parametrización (aceptada 2026-10-02):** un solo contrato de configuración validado al arrancar, modo A (deps en contenedores + apps en Windows) y modo B (todo en contenedores, misma imagen que prod); ver [19 §0](19-local-development.md).
- **Variables de Commitments (`add-recurrence-engine`, docs/35 D125):** `COMMITMENTS_HORIZON_DAYS` (14..366, por omisión 90; la leen `api` y `worker`, por entorno y no por workspace) y `COMMITMENTS_SCHEDULER_CRON` (cron de 5 campos u `off`, por omisión `10 * * * *`; solo `worker`) y, con `add-subscriptions`, `COMMITMENTS_SUBSCRIPTIONS_CRON` (job `commitments.subscription-daily`: fin de trial, cancelación programada y recordatorios; por omisión `20 * * * *`; solo `worker`). Referencia completa en [config-reference.md](config-reference.md).
- **Puertos (SPIKE-08):** todos los puertos de host son configurables (`PF_<SVC>_PORT`) con defaults "2 + puerto canónico" y se publican en `PF_BIND_ADDR=127.0.0.1`; dentro de la red Compose se usan los puertos canónicos. **Modo de desarrollo principal:** `deps` en contenedores + apps en el host Windows con `node --watch`. Contenedores de app con `init: true`, entrypoint exec y handler de SIGTERM. `db:seed` = `compose run --rm seed`.
- `finance-api` healthy solo si PG, Redis y storage responden (`/health/ready`); `/health/live` separado.
- Volúmenes nombrados: `pg-data`, `object-storage-data`, `redis-data` (opcional); Keycloak usa una base `keycloak` dentro del mismo `postgres` (no volumen propio).
- Config vía env vars (12-factor), `.env.example` sin secretos. Sin `localhost` hardcodeado: hostnames de servicio Compose.
- Comandos: `pnpm stack:up`, `stack:down`, `stack:restart`, `stack:logs`, `stack:reset`, `db:migrate`, `db:seed -- --profile=minimal|demo|large`, `test`, `test:integration`, `backup:local`, `restore:local`.

## 11. Entornos y entrega

`local → CI → staging → production` con **la misma imagen** (tag inmutable por digest). Diferencias solo por config/secretos. Pipeline (ADR-0015):

PR: format → lint → typecheck → OpenSpec validate → architecture tests → unit/domain → integration (Testcontainers) → build images → container scan (Trivy) + dependency scan → (E2E smoke compose). Merge a `main`: publicar imágenes → deploy staging (migraciones expand) → smoke → aprobación manual → producción.

## 12. Calidad: Spec → Test traceability (ADR-0016, ADR-0024)

- Cadena: **FR (docs/01) → OpenSpec Requirement (`### Requirement:`) → Scenario (`#### Scenario:`) → Test Case (`tests/cases`) → Automated test**.
- IDs:
  - Requerimientos funcionales: `FR-<CONTEXT>-NNN` (ej. `FR-LEDGER-001`). No funcionales: `NFR-<CAT>-NNN` (`SEC, PERF, REL, OBS, PORT, MAINT, USAB, DATA, COMP`).
  - Test cases: `TC-<CONTEXT>-<FEATURE>-NNN` (ej. `TC-LEDGER-TRANSFER-001`), `CONTEXT` = código de la tabla §3, más los transversales `PLATFORM`, `SECURITY`, `QUALITY` y `KERNEL` (shared-kernel; los casos de Money pueden usar `TC-LEDGER-MONEY-*` mientras no exista `KERNEL`).
  - Invariantes financieras: `INV-NNN` (catálogo en `docs/09-ledger-design.md`).
  - Riesgos: `RISK-NNN`. Spikes: `SPIKE-NN`. Épicas: `EPIC-NN`, features `FEAT-NN.M`, historias `US-NNN`, técnicas `TS-NNN`.
- Tests automatizados incluyen el TC-ID en el nombre: `it('[TC-LEDGER-TRANSFER-001] transfer preserves net worth', …)`. La matriz se genera escaneando test files + `tests/cases` + specs.
- **Idioma (decisión del owner, 2026-10-01):** **todo en español** — documentación, ADRs, specs OpenSpec, test cases, nombres de tests automatizados y UI copy. Excepciones técnicas: (a) encabezados estructurales que el CLI de OpenSpec parsea (`## Purpose`, `## ADDED Requirements`, `### Requirement:`, `#### Scenario:`…) y la palabra normativa entre paréntesis (`DEBE (MUST)`, `NO DEBE (MUST NOT)`), porque `openspec validate --strict` exige SHALL/MUST — verificado con validate y archive en OpenSpec 1.14.0; (b) identificadores de código fuente en inglés según el glosario de lenguaje ubicuo ([04](04-domain-model.md)); (c) IDs (`TC-LEDGER-…`, `FR-…`) y códigos de error se mantienen como códigos. Scenarios: `- **CUANDO** …`, `- **ENTONCES** …`, `- **Y** …`.

## 13. Roadmap (ajustes justificados respecto a la propuesta)

Se conserva la secuencia propuesta con estos cambios por dependencias:
1. **Multi-moneda en el ledger desde Phase 1** (el modelo de posting por moneda no puede retro-adaptarse barato) y **conversiones manuales (USDT↔BOB↔USD) en Phase 1** — caso de uso diario del owner. **Providers automáticos de tasa paralela también en Phase 1** (decisión del owner 2026-10-02, docs/31 D29, ADR-0025): paralelo.bo principal, bo.dolarapi.com respaldo/oficial, con degradación a tasas manuales; Phase 5 conserva más providers, precios cripto/commodities y análisis de costo.
2. **Audit trail base en Phase 1** (prerrequisito de integridad para transacciones editables).
3. **Reporting básico incremental** desde Phase 1 (saldos, ingresos/gastos del mes); avanzado en Phase 7.
4. **Notifications base en Phase 2** (alertas de presupuesto).
5. **CSV import básico** puede adelantarse a Phase 3 (Could) para cargar histórico real temprano; pipeline completo en Phase 6.

## 14. Taxonomía de capabilities OpenSpec (`openspec/specs/<context>/<capability>/spec.md`)

| Contexto | Capabilities |
|----------|--------------|
| identity | `identity/authentication`, `identity/workspace-membership`, `identity/demo-data`, `identity/workspace-portability` (Phase 2, `add-workspace-export`; aceptada por el owner, docs/33 D108) |
| accounts | `accounts/account-management`, `accounts/institutions` |
| ledger | `ledger/journal-posting`, `ledger/balances` |
| transactions | `transactions/transaction-recording`, `transactions/transfers`, `transactions/conversions`, `transactions/splits`, `transactions/reconciliation`, `transactions/duplicate-detection`, `transactions/bulk-edit` |
| classification | `classification/categories`, `classification/tags`, `classification/custom-fields`, `classification/counterparties` |
| planning | `planning/financial-periods`, `planning/budgets`, `planning/budget-templates`, `planning/month-closing` |
| commitments | `commitments/recurrence-engine`, `commitments/subscriptions` |
| goals | `goals/savings-goals` |
| debt | `debt/loans`, `debt/amortization`, `debt/credit-cards` |
| fx | `fx/market-rates`, `fx/market-rate-providers`, `fx/conversion-pricing` |
| documents | `documents/attachments` |
| imports | `imports/import-pipeline`, `imports/banking-providers` |
| rules | `rules/rule-engine` |
| reporting | `reporting/dashboard`, `reporting/financial-reports`, `reporting/net-worth`, `reporting/cash-flow-calendar` (versión simple en Phase 3: `add-upcoming-payments`; calendario completo en Phase 7) |
| forecast | `forecast/expense-forecasting` |
| notify | `notifications/alerts` |
| audit | `audit/audit-trail`, `audit/lifecycle-timeline` |
| assistant | `assistant/read-only-assistant` |
| platform | `platform/local-environment`, `platform/delivery-pipeline`, `platform/observability`, `platform/api-conventions`, `platform/event-delivery` |
| security | `security/access-control`, `security/file-upload-security` |
| quality | `quality/test-traceability` |

Las specs principales (`openspec/specs/`) describen **comportamiento vigente**; mientras una capability no esté implementada vive como *change* en `openspec/changes/` y se archiva al completarse.

## 15. Spikes tecnológicos de Phase 0 / inicio de Phase 1

| ID | Spike | Pregunta que responde | Time-box | Estado |
|----|-------|-----------------------|----------|--------|
| SPIKE-01 | OpenSpec workflow + validación en CI | ¿`openspec validate --strict` integrado en CI y flujo propose→apply→archive funciona para el equipo? | 0.5 d | Completado (CI real pendiente de remoto) |
| SPIKE-02 | Data access: Kysely vs Prisma vs Drizzle | RLS con `SET LOCAL`, NUMERIC sin pérdida, constraint triggers, mapping de agregados, DX de migraciones | 2 d | Completado — Kysely + dbmate |
| SPIKE-03 | Money & rounding | decimal.js + HALF_EVEN + largest remainder + fast-check; round-trip NUMERIC ↔ string ↔ Decimal | 1 d | Completado |
| SPIKE-04 | Modular monolith en NestJS | Módulos por contexto, dependency-cruiser, composición sin filtrar Nest al dominio | 1.5 d | Completado |
| SPIKE-05 | Outbox + cola de jobs | Outbox relay, at-least-once, inbox idempotente, graceful shutdown; comparar BullMQ/Valkey vs BullMQ v6 backend PostgreSQL vs pg-boss (¿Redis opcional?) | 1.5 d | Completado — pg-boss, Redis opcional |
| SPIKE-06 | Auth: Keycloak + Next.js BFF + API JWT | Flujo PKCE, cookie httpOnly, validación JWT en Nest, mapping a workspace roles | 2 d | Completado |
| SPIKE-07 | Object storage local | SeaweedFS vs Garage; presigned URLs compatibles con S3 (MinIO archivado) | 0.5 d | Completado — SeaweedFS |
| SPIKE-08 | Compose en Windows/WSL2 | Profiles, healthchecks, bind mounts + hot reload, rendimiento de FS | 1 d | Completado |
| SPIKE-09 | Cloud cost PoC | Costo mensual real mínimo ECS/Fargate vs Cloud Run para staging+prod (ampliado a VPS + Compose, PaaS, Postgres gestionado, object storage, IdP y observabilidad de bajo costo) | 1 d | Completado (investigación, 2026-10-03) — [informe](../spikes/SPIKE-09-deploy-costs/README.md), ADR-0027 **Aceptado (2026-10-05)** con presupuesto USD 10–20/mes (D51); PoC de 48 h (RAM real, restore y costo facturado) pendiente del owner. **Anexo A (2026-10-04, D42):** [PaaS](../spikes/SPIKE-09-deploy-costs/anexo-a-paas.md) — ninguna supera a N2/N1; variantes P1 Railway (≈ USD 25–30) y P2 Fly.io `gru` (≈ USD 38–48) |
| SPIKE-10 | Observabilidad local | OTel SDK Nest/Next + `otel-lgtm`; correlación trace-log | 1 d | Completado |

Informes, evidencia y ADRs afectados de cada spike: [spikes/README.md](../spikes/README.md).

## 16. Fuera de alcance de Phase 0 (DESIGN GATE)

No se crean: controllers, repositories, migraciones productivas, frontend funcional, Dockerfiles/compose ejecutables de la app, microservicios. Sí se crean: documentos, ADRs, specs OpenSpec, borrador de contratos (OpenAPI / JSON Schema), catálogo de test cases y fragmentos de configuración **ilustrativos dentro de documentos**.
