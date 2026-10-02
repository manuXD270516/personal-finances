# 07 — Arquitectura C4 (Context, Container, Component, Runtime, Deployment)

> **Estado:** Propuesto · **Fecha:** 2026-10-01 · **Relacionado:** [ARCHITECTURE.md](ARCHITECTURE.md) · [05-bounded-contexts.md](05-bounded-contexts.md) · [06-context-map.md](06-context-map.md) · [08-data-model.md](08-data-model.md) · [09-ledger-design.md](09-ledger-design.md) · [10-api-design.md](10-api-design.md) · [11-domain-events.md](11-domain-events.md) · [12-security.md](12-security.md) · [19-local-development.md](19-local-development.md) · [20-container-strategy.md](20-container-strategy.md) · [21-cloud-deployment-options.md](21-cloud-deployment-options.md) · [22-infrastructure.md](22-infrastructure.md) · [18-observability.md](18-observability.md) · [13-import-architecture.md](13-import-architecture.md) · ADR-0002, ADR-0003, ADR-0008, ADR-0009, ADR-0010, ADR-0011, ADR-0013, ADR-0019, ADR-0020, ADR-0023

Este documento describe la arquitectura de PFOS con el modelo **C4** (Level 1 Context, Level 2 Container, Level 3 Component), complementado con diagramas de **runtime** (secuencias clave), **deployment** (local y cloud) y **quality attribute scenarios**. Es consistente con [ARCHITECTURE.md](ARCHITECTURE.md): Modular Monolith (`finance-api` con procesos `api` y `worker` desde una misma imagen), contextos con schema PostgreSQL propio, outbox transaccional, Next.js como BFF, RLS como defense-in-depth.

> Nota de notación: se usa la sintaxis Mermaid `C4Context` / `C4Container` / `C4Component` / `C4Deployment` donde el renderizado es razonable; para diagramas densos se usan `flowchart` con la misma semántica (persona, sistema, contenedor, componente, relación etiquetada con tecnología).

---

## 1. Level 1 — System Context

### 1.1 Actores y sistemas externos

| Elemento | Tipo | Descripción | Fase |
|----------|------|-------------|------|
| **Owner** | Persona | Usuario principal; registra transacciones, conversiones, planifica, revisa reportes. Rol `OWNER` de su workspace. | 1 |
| **Shared user (futuro)** | Persona | Miembro invitado a un workspace (pareja, contador) con rol `EDITOR` o `VIEWER`. | 9+ (modelo listo desde 1) |
| **OIDC Identity Provider** | Sistema externo | Keycloak local; en cloud Cognito / Keycloak gestionado / otro (ADR-0013, ADR-0010). Emite tokens OIDC. | 1 |
| **Email provider** | Sistema externo | SMTP (Mailpit local; SES u otro en cloud). Alertas de presupuesto, recordatorios de compromisos. | 2 |
| **Object storage** | Sistema externo/infra | API S3 (MinIO/alternativa local, S3 en cloud). Documentos, comprobantes, archivos de import, backups. | 6 (backups antes) |
| **Market rate providers** | Sistema externo | Tasas fiat/cripto (p. ej. APIs públicas de tipo de cambio, agregadores cripto). Solo lectura. | 5 |
| **Banking / aggregator APIs** | Sistema externo | Integraciones bancarias opcionales (aggregators, open banking donde exista). El producto funciona sin ellas. | 6+ |
| **Exchange APIs** | Sistema externo | Exchanges cripto/P2P para importar historial de operaciones (solo lectura, API keys read-only). | 6+ |
| **LLM provider** | Sistema externo | Proveedor de modelo de lenguaje para el asistente de solo lectura. | 10 |

### 1.2 Diagrama

```mermaid
C4Context
  title PFOS — System Context (Level 1)

  Person(owner, "Owner", "Usuario principal; OWNER de su workspace")
  Person(shared, "Shared user (futuro)", "EDITOR / VIEWER invitado")

  System(pfos, "Personal Finance Operating System", "Ledger multi-moneda, planificación, compromisos, deudas, metas, documentos, imports, reportes")

  System_Ext(idp, "OIDC Identity Provider", "Keycloak local / Cognito u otro en cloud")
  System_Ext(mail, "Email provider", "SMTP: Mailpit local / SES cloud")
  System_Ext(s3, "Object storage", "API S3: MinIO-alt local / Amazon S3")
  System_Ext(rates, "Market rate providers", "Tasas fiat y cripto (Phase 5)")
  System_Ext(bank, "Banking / aggregator APIs", "Opcional (Phase 6+)")
  System_Ext(exch, "Exchange APIs", "Historial de trades read-only (Phase 6+)")
  System_Ext(llm, "LLM provider", "Asistente read-only (Phase 10)")

  Rel(owner, pfos, "Usa", "HTTPS / navegador")
  Rel(shared, pfos, "Usa (según rol)", "HTTPS")
  Rel(pfos, idp, "Autentica usuarios", "OIDC Auth Code + PKCE")
  Rel(owner, idp, "Inicia sesión", "HTTPS")
  Rel(pfos, mail, "Envía notificaciones", "SMTP/API")
  Rel(pfos, s3, "Guarda/lee documentos", "S3 API + presigned URLs")
  Rel(pfos, rates, "Obtiene tasas históricas", "HTTPS/JSON")
  Rel(pfos, bank, "Importa movimientos", "HTTPS/OAuth")
  Rel(pfos, exch, "Importa trades", "HTTPS, API key read-only")
  Rel(pfos, llm, "Consultas con contexto mínimo", "HTTPS")
```

**Fronteras de confianza:** el navegador solo habla con `finance-web` (mismo origen); jamás recibe access tokens ni credenciales de terceros. Todas las integraciones externas son **salientes** desde el worker (o `finance-api` para presigned URLs); no hay webhooks entrantes en esta etapa (ver [10-api-design.md](10-api-design.md) §14).

---

## 2. Level 2 — Containers

### 2.1 Inventario

| Container | Tecnología | Responsabilidad | Escala / estado | Fase |
|-----------|-----------|-----------------|-----------------|------|
| `finance-web` | Next.js (App Router), TypeScript, TanStack Query, ECharts | UI + **BFF**: flujo OIDC, sesión en cookie httpOnly, proxy autenticado a `finance-api` (agrega `Authorization: Bearer`), server components para lecturas | Stateless (sesión cifrada en cookie o store Redis) | 1 |
| `finance-api` (cmd `api`) | NestJS en composition root; módulos `@pf/<ctx>` | REST `/api/v1`, validación JWT, autorización por workspace, casos de uso, transacciones BD con RLS, escritura de outbox y audit en la misma transacción | Stateless, N réplicas | 1 |
| `finance-worker` (cmd `worker`) | Misma imagen que `finance-api` | Outbox relay → BullMQ; consumidores de eventos (projections Reporting, Notifications, Rules, Budget thresholds); jobs programados (recurrence, fx fetch, snapshots); import pipeline | Stateless, 1..N réplicas (relay con lock) | 1 |
| `migrate` (one-shot) | Misma imagen, cmd `migrate` (dbmate) | Aplica migraciones SQL-first con rol de migración | Job | 1 |
| PostgreSQL 18 | RDS en cloud | Fuente de verdad; un schema por contexto + `platform`; RLS | Stateful | 1 |
| Redis / Valkey | ElastiCache/Valkey en cloud | Colas BullMQ, rate limiting, cache efímera; **nunca** fuente de verdad | Semi-stateful (reconstruible) | 1 |
| Object storage | S3 API | Documentos, archivos de import, exports, backups | Stateful | 6 (backups 1) |
| IdP | Keycloak (local) / Cognito u otro | Identidades, login, MFA | Externo/gestionado | 1 |
| Mail | Mailpit / SES | Entrega de emails | Externo | 2 |
| `ml-forecasting` | Python + FastAPI + Polars + statsmodels | Forecasts estadísticos; consume datasets agregados, devuelve predicciones | Stateless | 8 |
| OTel collector | `grafana/otel-lgtm` local / ADOT o Grafana Cloud | Recibe traces, metrics, logs OTLP | Infra | 1 (opcional) |

### 2.2 Diagrama

```mermaid
C4Container
  title PFOS — Containers (Level 2)

  Person(owner, "Owner / Shared user")

  System_Boundary(pfos, "PFOS") {
    Container(web, "finance-web", "Next.js App Router", "UI + BFF; sesión httpOnly; proxy a API")
    Container(api, "finance-api (api)", "NestJS / TypeScript", "REST /api/v1; casos de uso; RLS; outbox")
    Container(worker, "finance-worker (worker)", "NestJS / TypeScript, BullMQ", "Outbox relay, consumers, jobs, imports")
    Container(ml, "ml-forecasting", "Python / FastAPI", "Forecasts (Phase 8)")
    ContainerDb(pg, "PostgreSQL 18", "Schemas por contexto + platform", "Fuente de verdad, RLS")
    ContainerDb(redis, "Redis / Valkey", "BullMQ, rate limit", "Efímero")
    ContainerDb(obj, "Object storage", "S3 API", "Documentos, imports, backups")
    Container(otel, "OTel collector", "OTLP", "Traces, metrics, logs")
  }

  System_Ext(idp, "OIDC IdP", "Keycloak / Cognito")
  System_Ext(mail, "Mail", "Mailpit / SES")
  System_Ext(ext, "Rate / bank / exchange APIs", "HTTPS")
  System_Ext(llm, "LLM provider", "Phase 10")

  Rel(owner, web, "HTTPS", "cookie de sesión")
  Rel(owner, obj, "PUT/GET presigned", "HTTPS")
  Rel(web, idp, "Auth Code + PKCE", "OIDC")
  Rel(web, api, "REST JSON + Bearer JWT", "HTTPS (red interna)")
  Rel(api, idp, "JWKS", "HTTPS (cache)")
  Rel(api, pg, "SQL (rol app, SET LOCAL app.workspace_id)", "TCP/TLS")
  Rel(api, redis, "Rate limiting, enqueue", "RESP")
  Rel(api, obj, "Presign, HEAD", "S3 API")
  Rel(worker, pg, "Outbox poll, inbox, projections", "TCP/TLS")
  Rel(worker, redis, "BullMQ queues", "RESP")
  Rel(worker, obj, "Leer imports/documentos", "S3 API")
  Rel(worker, mail, "Envía emails", "SMTP/API")
  Rel(worker, ext, "Fetch tasas / movimientos", "HTTPS")
  Rel(worker, ml, "Solicita forecasts", "HTTP JSON")
  Rel(api, llm, "Asistente (tools read-only)", "HTTPS")
  Rel(api, otel, "OTLP")
  Rel(worker, otel, "OTLP")
  Rel(web, otel, "OTLP")
```

### 2.3 Decisiones de nivel container

- **Un deployable de backend, dos procesos** (ARCHITECTURE §2): `api` y `worker` comparten imagen y código; se diferencian por comando (`node dist/main.api.js` / `node dist/main.worker.js`). Escalan y fallan de forma independiente.
- **El navegador no habla con `finance-api` directamente.** El BFF (`finance-web`) es el único cliente HTTP de la API en Phase 1–9. Esto evita CORS, mantiene el token fuera del JS y permite que `finance-api` no sea público (cloud: ALB interno o service discovery; ver §6.2).
- **Excepción controlada:** subida/descarga de documentos va **directo** del navegador al object storage mediante **presigned URLs** de corta vida (§4.2), para no pasar binarios por BFF ni API.
- **`ml-forecasting` no está en el camino crítico**: el worker lo invoca de forma asíncrona; si está caído, los forecasts quedan en estado `FAILED`/`STALE` y el resto del producto sigue funcionando.
- **Redis no es fuente de verdad**: si se pierde, el outbox (en PostgreSQL) re-publica lo no despachado; las colas se re-hidratan.

---

## 3. Level 3 — Components

### 3.1 `finance-api` (proceso `api`)

Cada bounded context es un paquete `@pf/<ctx>` con capas `domain → application → infrastructure / interface` y una superficie pública `contracts`. El composition root (`apps/api/src/main.api.ts`) registra los módulos Nest de **interface** e **infrastructure**; `domain` y `application` son TypeScript puro.

```mermaid
flowchart TB
  subgraph web["finance-web (BFF)"]
    BFF[Route handlers /api/bff/*]
  end

  subgraph api["finance-api — proceso api"]
    direction TB
    subgraph platform["@pf/platform (cross-cutting)"]
      MW1[Request context / correlation-id]
      AUTH[Auth guard: JWT iss/aud/exp + JWKS cache]
      WS[Workspace context guard: membership + rol]
      IDEM[Idempotency interceptor: platform.idempotency_key]
      RL[Rate limiter: Redis token bucket]
      UOW[Unit of Work: BEGIN, SET LOCAL app.workspace_id, COMMIT]
      OUTW[Outbox writer: platform.outbox en la misma tx]
      AUD[Audit writer port: audit.audit_log en la misma tx]
      PD[Problem-details mapper: DomainError → RFC 9457]
      ETAG[ETag / If-Match: version → ETag]
      OTEL[OTel instrumentation + pino]
    end

    subgraph ctx_txn["@pf/transactions"]
      T_IF[interface: TransactionsController, TransfersController, ConversionsController]
      T_APP[application: RecordTransaction, VoidTransaction, RecordTransfer, RecordConversion, BulkEdit]
      T_DOM[domain: Transaction, TransactionSplit, ConversionDetail, policies]
      T_INF[infrastructure: KyselyTransactionRepository]
    end

    subgraph ctx_ledger["@pf/ledger"]
      L_APP[application: PostJournalEntry, ReverseEntry, GetBalances]
      L_DOM[domain: JournalEntry, Posting, LedgerAccount, invariantes INV-*]
      L_INF[infrastructure: KyselyLedgerRepository]
    end

    subgraph ctx_other["@pf/accounts · @pf/classification · @pf/fx · @pf/identity · @pf/reporting · @pf/audit · ... "]
      O_IF[interface controllers]
      O_APP[application services]
      O_DOM[domain]
      O_INF[infrastructure]
    end
  end

  PG[(PostgreSQL)]
  REDIS[(Redis/Valkey)]

  BFF -->|Bearer JWT| MW1 --> AUTH --> WS --> RL --> IDEM --> T_IF
  T_IF --> T_APP --> T_DOM
  T_APP -->|LedgerPostingPort via @pf/ledger/contracts| L_APP
  L_APP --> L_DOM
  T_APP --> T_INF
  L_APP --> L_INF
  T_APP --> UOW
  T_APP --> OUTW
  T_APP --> AUD
  T_INF --> PG
  L_INF --> PG
  OUTW --> PG
  AUD --> PG
  UOW --> PG
  IDEM --> PG
  RL --> REDIS
  T_IF -. errores .-> PD
  T_IF -. version .-> ETAG
  O_IF --> O_APP --> O_DOM
  O_APP --> O_INF --> PG
```

**Componentes de plataforma (`@pf/platform`):**

| Componente | Responsabilidad | Notas |
|-----------|-----------------|-------|
| Request context | Genera/propaga `correlationId` (header `X-Request-Id` / `traceparent`), actor, workspace | `AsyncLocalStorage` |
| Auth guard | Valida JWT del IdP (firma vía JWKS cacheado, `iss`, `aud`, `exp`, `nbf`, `azp`), resuelve `userId` interno (`iam.user` por `sub`+`issuer`) | Ver [12-security.md](12-security.md) §3 |
| Workspace context guard | Lee `{workspaceId}` de la ruta, verifica membership activa y rol requerido por la operación (`@RequiresRole('EDITOR')`) | 403 `WORKSPACE_ACCESS_DENIED` si no es miembro activo (ADR-0010); 403 `INSUFFICIENT_ROLE` si el rol no alcanza |
| Rate limiter | Token bucket por usuario y por workspace en Redis; headers `RateLimit-*` | Degrada a *fail-open* con log si Redis cae (solo lectura) / *fail-closed* en endpoints de auth |
| Idempotency interceptor | Para POST financieros: reserva `(workspace_id, key)`, compara hash de request, devuelve respuesta almacenada en replays | Ver [10-api-design.md](10-api-design.md) §7 |
| Unit of Work | Abre transacción Kysely, ejecuta `SET LOCAL app.workspace_id`, `app.user_id`, `app.request_id`; commit/rollback; expone `tx` a repositorios | Una tx por comando |
| Outbox writer | Inserta eventos de dominio en `platform.outbox` dentro de la tx del UoW | Envelope de ARCHITECTURE §7 |
| Audit writer | Inserta `audit.audit_log` en la misma tx (requisito de integridad, ARCHITECTURE §7) | Puerto `AuditPort` de `@pf/audit/contracts` |
| Problem-details mapper | Exception filter Nest: `DomainError(code)` → `application/problem+json` con `type`, `code`, `status`, `errors[]` | Catálogo en [10-api-design.md](10-api-design.md) §9 |
| ETag / If-Match | `ETag: W/"<version>"`; valida `If-Match` en PATCH/acciones; 412/428 | Optimistic locking columna `version` |
| Observability | OTel SDK (HTTP, pg, ioredis, BullMQ), pino JSON con redacción | ADR-0020, [18-observability.md](18-observability.md) |

**Reglas de dependencia** (verificadas con dependency-cruiser, ARCHITECTURE §6): `interface → application → domain`; `infrastructure → application/domain` (implementa puertos); cruce entre contextos **solo** vía `@pf/<ctx>/contracts`. La llamada `Transactions → Ledger` es síncrona en la misma transacción BD porque la invariante de doble entrada lo exige (ARCHITECTURE §7).

### 3.2 `finance-worker` (proceso `worker`)

```mermaid
flowchart LR
  PG[(PostgreSQL<br/>platform.outbox)]
  REDIS[(Redis/Valkey<br/>BullMQ)]
  subgraph worker["finance-worker"]
    RELAY[Outbox relay<br/>SELECT ... FOR UPDATE SKIP LOCKED<br/>publica a BullMQ, marca published_at]
    SCHED[Scheduler<br/>BullMQ repeatable jobs]
    subgraph consumers["Consumers (idempotentes vía platform.inbox)"]
      C_REP[Reporting projections<br/>balance snapshots, monthly aggregates]
      C_NOT[Notifications<br/>budget thresholds, recordatorios]
      C_RUL[Rules<br/>sobre transacciones importadas]
      C_PLAN[Planning<br/>budget actuals]
    end
    subgraph jobs["Jobs"]
      J_REC[Recurrence engine<br/>genera occurrences idempotentes]
      J_FX[FX rate fetch<br/>Phase 5]
      J_IMP[Import pipeline<br/>parse → stage → dedupe → commit]
      J_SNAP[Snapshot rebuild / reconciliación de read models]
      J_FC[Forecast request<br/>Phase 8]
      J_MAINT[Mantenimiento<br/>purga idempotency keys, outbox publicados]
    end
    INBOX[Inbox guard<br/>INSERT platform.inbox ON CONFLICT DO NOTHING]
    UOWW[Unit of Work<br/>SET LOCAL app.workspace_id por mensaje]
  end
  PG --> RELAY --> REDIS
  REDIS --> INBOX --> consumers
  SCHED --> REDIS
  REDIS --> jobs
  consumers --> UOWW --> PG
  jobs --> UOWW
  J_FC --> ML[ml-forecasting]
  J_FX --> EXT[Rate providers]
  J_IMP --> OBJ[(Object storage)]
  C_NOT --> MAIL[Mail]
```

- El **relay** usa `FOR UPDATE SKIP LOCKED` en lotes; varias réplicas del worker pueden correr sin duplicar trabajo (y si duplican, el inbox lo absorbe — at-least-once).
- **Todo** handler abre su propio Unit of Work con `SET LOCAL app.workspace_id = <envelope.workspaceId>`; el worker usa el mismo rol de app sin `BYPASSRLS`. Los jobs de mantenimiento cross-workspace (purga de outbox/idempotency) operan solo sobre tablas `platform` sin RLS de negocio o usan un rol `pf_maintenance` restringido (ver [12-security.md](12-security.md) §6).
- **Graceful shutdown**: SIGTERM → dejar de tomar jobs, terminar en curso (timeout 25 s < `stopTimeout` de ECS 30 s), cerrar pool.
- **Dead letter**: tras N reintentos con backoff exponencial, BullMQ mueve a cola `dlq.<consumer>`; métrica + alerta.

---

## 4. Runtime — secuencias clave

### 4.1 Request autenticado: BFF → API → transacción con RLS → outbox → worker

Caso: el owner registra un gasto (`POST /api/v1/workspaces/{ws}/transactions`).

```mermaid
sequenceDiagram
  autonumber
  actor U as Owner (browser)
  participant W as finance-web (BFF)
  participant A as finance-api
  participant PG as PostgreSQL
  participant R as Redis/BullMQ
  participant WK as finance-worker

  U->>W: POST /api/bff/workspaces/{ws}/transactions (cookie httpOnly, X-CSRF-Token)
  W->>W: Valida sesión + CSRF, refresh token si access expira
  W->>A: POST /api/v1/workspaces/{ws}/transactions<br/>Authorization: Bearer JWT, Idempotency-Key, traceparent
  A->>A: Auth guard (JWKS cache, iss/aud/exp)
  A->>PG: SELECT membership (ws, user) → rol EDITOR+
  A->>R: Rate limit check
  A->>PG: INSERT platform.idempotency_key (ws, key, request_hash) ON CONFLICT
  alt clave ya completada con mismo hash
    A-->>W: Replay respuesta almacenada (201 + Idempotent-Replayed: true)
  end
  A->>PG: BEGIN
  A->>PG: SET LOCAL app.workspace_id = ws, SET LOCAL app.user_id = u
  A->>PG: INSERT txn.transaction, txn.transaction_split
  A->>PG: INSERT ledger.journal_entry, ledger.posting (vía LedgerPostingPort)
  A->>PG: INSERT audit.audit_log
  A->>PG: INSERT platform.outbox (transactions.TransactionPosted.v1)
  A->>PG: UPDATE platform.idempotency_key SET response
  A->>PG: COMMIT (constraint trigger diferido valida Σ por moneda = 0)
  A-->>W: 201 Created + ETag + Location
  W-->>U: 201 (JSON)
  loop cada ~200 ms / LISTEN-NOTIFY
    WK->>PG: SELECT outbox pendientes FOR UPDATE SKIP LOCKED
    WK->>R: queue.add(event)
    WK->>PG: UPDATE outbox SET published_at
  end
  R->>WK: job TransactionPosted
  WK->>PG: BEGIN, SET LOCAL app.workspace_id, INSERT inbox (consumer, event_id) ON CONFLICT DO NOTHING
  WK->>PG: UPSERT reporting.monthly_aggregate / balance_snapshot, COMMIT
```

Puntos clave: (1) audit, outbox e idempotency se escriben **en la misma transacción** que el cambio; (2) si el constraint trigger de balance falla, el `COMMIT` aborta todo y la API responde `422 LEDGER_UNBALANCED_ENTRY` (no debería ocurrir: el dominio valida antes; el trigger es la red de seguridad); (3) el relay puede despertar por `LISTEN/NOTIFY` además de polling.

### 4.2 Subida de documento con presigned URL (Phase 6)

```mermaid
sequenceDiagram
  autonumber
  actor U as Browser
  participant W as finance-web (BFF)
  participant A as finance-api
  participant PG as PostgreSQL
  participant S3 as Object storage
  participant WK as finance-worker

  U->>W: Solicitar subida (filename, contentType, size, sha256)
  W->>A: POST /api/v1/workspaces/{ws}/documents/uploads (Idempotency-Key)
  A->>A: Valida allowlist de extensión/MIME, tamaño ≤ límite, cuota del workspace
  A->>PG: INSERT documents.document (status=PENDING_UPLOAD, object_key=quarantine/{ws}/{docId})
  A->>S3: Presign PUT (Content-Type fijo, Content-Length exacto, x-amz-checksum-sha256, expira 5 min)
  A-->>W: 201 {documentId, uploadUrl, requiredHeaders, expiresAt}
  W-->>U: uploadUrl
  U->>S3: PUT binario (headers requeridos)
  S3-->>U: 200
  U->>W: Confirmar subida
  W->>A: POST /documents/{id}/complete
  A->>S3: HEAD object (size, checksum)
  A->>PG: UPDATE document status=UPLOADED, outbox documents.DocumentUploaded.v1
  A-->>W: 202 Accepted
  WK->>S3: GET primeros bytes → MIME sniffing (magic bytes)
  WK->>WK: (futuro) malware scan
  alt OK
    WK->>S3: Copy quarantine/ → documents/ , delete quarantine
    WK->>PG: status=AVAILABLE
  else Rechazado
    WK->>PG: status=REJECTED (motivo), borra objeto en cuarentena
  end
  U->>W: Descargar documento
  W->>A: GET /documents/{id}/download
  A-->>W: 302/200 {downloadUrl presigned GET, 60 s, Content-Disposition: attachment}
```

### 4.3 Import job (alto nivel, Phase 6; CSV básico puede adelantarse a Phase 3)

Detalle completo (máquina de estados, colas, fingerprints) en [13-import-architecture.md](13-import-architecture.md); aquí solo la vista de containers.

```mermaid
sequenceDiagram
  autonumber
  actor U as Owner
  participant W as finance-web
  participant A as finance-api
  participant PG as PostgreSQL
  participant S3 as Object storage
  participant WK as finance-worker

  U->>W: Nuevo import (cuenta destino, perfil, metadatos del archivo)
  W->>A: POST /api/v1/workspaces/{ws}/imports (Idempotency-Key)
  A->>PG: INSERT imports.import_job (CREATED) + platform.operation
  A-->>W: 201 {importJob, upload: presigned PUT (cuarentena)}
  U->>S3: PUT archivo
  W->>A: POST /imports/{id}/upload-complete
  A->>S3: HEAD (tamaño, checksum)
  A->>PG: status=UPLOADED, outbox imports.ImportFileUploaded.v1
  A-->>W: 202 Accepted + Location: /operations/{opId}
  WK->>S3: GET archivo (cola imports.pipeline)
  WK->>PG: PARSING → NORMALIZING → VALIDATING → MATCHING → CLASSIFYING<br/>INSERT imports.staged_transaction por chunks
  WK->>PG: status=AWAITING_REVIEW, outbox imports.ImportPreviewReady.v1
  W->>A: GET /imports/{id} y /imports/{id}/preview (polling)
  U->>W: Revisa / ajusta decisiones (PATCH rows con If-Match)
  W->>A: POST /imports/{id}/approve (Idempotency-Key)
  A->>PG: status=APPROVED, outbox imports.ImportApproved.v1
  A-->>W: 202
  loop lotes de 200 (cola imports.persist)
    WK->>PG: BEGIN, SET LOCAL app.workspace_id<br/>RecordImportedTransactions (txn + ledger + audit + outbox + row_link), COMMIT
  end
  WK->>PG: RECONCILING → COMPLETED, outbox imports.ImportCompleted.v1
```

Idempotencia: a nivel fila, `imports.row_link UNIQUE (workspace_id, account_id, fingerprint) WHERE status='ACTIVE'`; a nivel proveedor, `external_id` único por cuenta en `txn`; a nivel lote, `Idempotency-Key = (jobId, batchNo)` (ver [08-data-model.md](08-data-model.md) §5.12).

---

## 5. Vista de módulos por fase

| Fase | Módulos activos en `finance-api` | Consumers/jobs del worker |
|------|----------------------------------|---------------------------|
| 1 | identity, accounts, ledger, transactions, classification, fx (manual), reporting (básico), audit | outbox relay, reporting projections |
| 2 | + planning, notifications | budget actuals, budget thresholds, email |
| 3 | + commitments | recurrence engine (+ CSV import básico opcional) |
| 4 | + goals, debt | installment generation |
| 5 | fx providers | fx rate fetch |
| 6 | + documents, imports, rules | import pipeline, rules, MIME sniffing |
| 7 | reporting avanzado | net worth, cash-flow calendar projections |
| 8 | + forecasting (ACL) | forecast request → `ml-forecasting` |
| 10 | + assistant | — |

---

## 6. Deployment

### 6.1 Local (Docker Compose)

Servicios y profiles canónicos de ARCHITECTURE §10; detalle operativo en [19-local-development.md](19-local-development.md) y [20-container-strategy.md](20-container-strategy.md).

```mermaid
flowchart TB
  subgraph host["Host Windows 11 + Docker Desktop (WSL2)"]
    BROWSER[Navegador :3000]
    subgraph compose["docker compose — red pf-net"]
      direction TB
      subgraph deps["profile: deps (también en core)"]
        PGc[(postgres:18 :5432<br/>vol pg-data)]
        RDc[(valkey :6379)]
        OSc[(object-storage :9000/:9001<br/>vol object-storage-data)]
        MPc[mailpit :8025/:1025]
        KCc[keycloak :8081<br/>realm import dev]
      end
      subgraph core["profile: core"]
        MIG[migrate one-shot]
        APIc[finance-api :8080]
        WKc[finance-worker]
        WEBc[finance-web :3000]
      end
      SEED[seed one-shot<br/>profile: seed]
      LGTM[otel-lgtm :3001, 4317/4318<br/>profile: observability]
      MLc[ml-forecasting :8090<br/>profile: ml]
    end
  end
  BROWSER --> WEBc
  BROWSER -->|presigned| OSc
  BROWSER -->|login| KCc
  WEBc --> APIc
  APIc --> PGc & RDc & OSc & KCc
  WKc --> PGc & RDc & OSc & MPc
  MIG -->|depends_on healthy| PGc
  APIc -.depends_on completed.-> MIG
  SEED --> PGc
  APIc & WKc & WEBc -.OTLP.-> LGTM
  WKc --> MLc
```

Notas: los hostnames son nombres de servicio Compose (sin `localhost` hardcodeado); para que presigned URLs y redirects OIDC funcionen desde el navegador, el *public endpoint* de storage y el issuer de Keycloak se configuran con hostname alcanzable desde host y contenedores (p. ej. `*.localhost` o `host.docker.internal`) — punto a cerrar en SPIKE-06/07.

### 6.2 Cloud target — AWS ECS/Fargate (ADR-0013)

Recomendación canónica: ECS/Fargate con perfil de costo mínimo. Alternativas (Cloud Run, Lightsail/VM única, Fly.io…) y costos en [21-cloud-deployment-options.md](21-cloud-deployment-options.md); IaC en [22-infrastructure.md](22-infrastructure.md).

```mermaid
flowchart TB
  USER[Usuario] -->|HTTPS 443| CF[CloudFront opcional + AWS WAF]
  CF --> ALB[ALB público<br/>TLS ACM]
  subgraph vpc["VPC (2 AZ)"]
    subgraph pub["Subnets públicas"]
      ALB
      NAT[NAT Gateway o fck-nat / VPC endpoints]
    end
    subgraph priv["Subnets privadas (app)"]
      WEBs[ECS Service finance-web<br/>Fargate, 1-2 tasks]
      APIs[ECS Service finance-api cmd api<br/>Fargate, 1-N tasks<br/>Service Connect / ALB interno]
      WKs[ECS Service finance-worker cmd worker<br/>Fargate, 1 task]
      MIGs[ECS RunTask migrate<br/>desde pipeline]
      MLs[ECS Service ml-forecasting<br/>Phase 8]
    end
    subgraph data["Subnets privadas (data)"]
      RDS[(RDS PostgreSQL 18<br/>KMS, backups automáticos, PITR)]
      EC[(ElastiCache Valkey<br/>TLS + AUTH)]
    end
  end
  ALB -->|/ y /api/bff| WEBs
  WEBs -->|HTTP interno| APIs
  APIs --> RDS & EC
  WKs --> RDS & EC
  MIGs --> RDS
  APIs & WKs -->|VPC endpoint| S3[(S3 buckets<br/>documents, quarantine, imports, backups<br/>SSE-KMS, Block Public Access)]
  USER -->|presigned PUT/GET| S3
  APIs & WKs & WEBs -->|secrets al inicio| SM[Secrets Manager / SSM]
  APIs & WKs & WEBs -->|ADOT sidecar u OTLP| CW[CloudWatch / Grafana Cloud]
  WEBs & APIs --> IDP[IdP: Cognito / Keycloak gestionado]
  WKs --> SES[Amazon SES]
  ECR[ECR: imágenes sha-gitsha] -.pull.-> WEBs & APIs & WKs & MIGs
```

- `finance-api` **no** se expone a Internet: solo `finance-web` es público (ALB). Si en el futuro hay clientes móviles, se agrega una ruta `/api/*` en el ALB con el mismo JWT (decisión diferida).
- Costo mínimo: 1 task por servicio, Fargate Spot para worker en staging, RDS `db.t4g.micro/small` single-AZ en staging, Multi-AZ opcional en prod; NAT gateway es el costo fijo más alto → evaluar `fck-nat` o VPC endpoints (SPIKE-09).
- Misma imagen en todos los entornos (tag inmutable por digest), configuración vía env + Secrets Manager (ARCHITECTURE §11).

---

## 7. Quality attribute scenarios

| ID | Atributo | Estímulo | Entorno | Respuesta | Medida |
|----|----------|----------|---------|-----------|--------|
| QAS-01 | Integridad (NFR-DATA) | Bug en caso de uso intenta persistir una entry desbalanceada en USDT | Producción | Constraint trigger diferido aborta el `COMMIT`; API responde 500/422 con `LEDGER_UNBALANCED_ENTRY`; alerta | 0 entries desbalanceadas en BD (query de verificación diaria = 0 filas) |
| QAS-02 | Seguridad / aislamiento (NFR-SEC) | Usuario autenticado manipula `workspaceId` en la URL a uno ajeno | Normal | Guard responde 403 `WORKSPACE_ACCESS_DENIED`; aunque el guard fallara, RLS devuelve 0 filas | 0 filas filtradas en suite de tests cross-workspace; 100 % de tablas de negocio con RLS (test automático sobre `pg_class.relrowsecurity`) |
| QAS-03 | Fiabilidad (NFR-REL) | Cliente reintenta `POST /transactions` por timeout de red | Red inestable | Mismo `Idempotency-Key` → replay de la respuesta original | 0 transacciones duplicadas; replay < 100 ms p95 |
| QAS-04 | Fiabilidad | Redis cae 10 minutos | Producción | API sigue aceptando escrituras (outbox en PG); relay reintenta; read models se ponen al día al volver | 0 eventos perdidos; lag de projections < 2 min tras recuperación |
| QAS-05 | Rendimiento (NFR-PERF) | Dashboard con 50 000 transacciones / 5 años | Carga normal | Lecturas desde read models `reporting.*` | p95 < 300 ms API, LCP < 2.5 s |
| QAS-06 | Rendimiento | Registrar transacción con 10 splits | Carga normal | Una tx BD con ~25 inserts | p95 < 150 ms API |
| QAS-07 | Modificabilidad (NFR-MAINT) | Extraer `imports` a un servicio | Futuro | Solo cambian adapters (contracts→HTTP/cola); no se toca dominio | Sin FKs cross-schema; dependency-cruiser 0 violaciones |
| QAS-08 | Portabilidad (NFR-PORT) | Mover de ECS/Fargate a Cloud Run | Decisión de costo | Cambio en `infra/terraform` y config; misma imagen | 0 cambios en código de aplicación |
| QAS-09 | Observabilidad (NFR-OBS) | Error en consumer de projections | Producción | Trace correlacionado BFF→API→outbox→worker vía `correlationId`/`traceparent`; job en DLQ; alerta | MTTD < 5 min; trace completo en 100 % de errores muestreados |
| QAS-10 | Recuperabilidad (NFR-REL) | Corrupción de read model `reporting.*` | Producción | Job `rebuild` reconstruye desde ledger | Rebuild 5 años < 10 min; RPO de datos primarios ≤ 5 min (PITR), RTO ≤ 4 h |
| QAS-11 | Disponibilidad | `ml-forecasting` caído | Phase 8 | Forecast en estado `FAILED`; UI muestra último forecast válido | Core sin degradación |
| QAS-12 | Seguridad | Archivo malicioso renombrado `.pdf` | Phase 6 | MIME sniffing en worker lo rechaza; nunca sale de cuarentena | 0 objetos no verificados en bucket `documents/` |

---

## 8. Preguntas abiertas

1. **Sesión del BFF**: ¿cookie cifrada sin estado (iron-session/JWE) o store en Redis con session id? Afecta revocación y tamaño de cookie (tokens de Keycloak pueden superar 4 KB). Propuesta: store en Redis (`sid` en cookie). Cerrar en SPIKE-06.
2. **Relay trigger**: ¿polling puro o `LISTEN/NOTIFY` + polling de respaldo? Propuesta: ambos; validar en SPIKE-05.
3. **Exposición pública de `finance-api`**: hoy solo vía BFF. ¿Se anticipa cliente móvil/CLI que requiera ALB público para la API?
4. **Hostname de presigned URLs en local** (navegador vs red Compose) y del issuer OIDC (mismo `iss` visto por navegador y API). Cerrar en SPIKE-06/07.
5. **Notificaciones en tiempo real** (import progress): ¿polling suficiente o SSE desde BFF? Propuesta: polling en Phase 6.
6. **Worker único vs colas segregadas** por tipo (imports pesados vs projections) para evitar *head-of-line blocking*: propuesta de colas separadas con concurrencia distinta desde Phase 6.
7. **NAT Gateway** en cloud: costo vs `fck-nat`/VPC endpoints; depende de proveedores externos de tasas (Phase 5) que requieren salida a Internet.
