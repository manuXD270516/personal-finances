# DESIGN GATE — Phase 0

> **Estado:** ✅ **Aprobado** por el owner el 2026-10-01 — Implementation Gate abierto · **Fecha:** 2026-10-01 · **Relacionado:** [ARCHITECTURE.md](ARCHITECTURE.md), [24-roadmap.md](24-roadmap.md), [adr/README.md](adr/README.md), [03-openspec-strategy.md](03-openspec-strategy.md)

Este documento cierra el bloque de diseño de Phase 0. **No se escribe código productivo** (controllers, repositories, migraciones, frontend funcional, servicios) hasta que el owner apruebe este gate y responda las preguntas marcadas como bloqueantes. **Gate aprobado el 2026-10-01**; Q3–Q9 siguen abiertas y se resuelven en los spikes o antes del change que dependa de ellas.

## 1. Inventario de entregables

| Entregable exigido | Dónde | Volumen |
|---|---|---|
| OpenSpec foundation | `openspec/config.yaml` (contexto + reglas que exigen Impact/TC/INV en cada change), change `bootstrap-platform-foundation` (4 capabilities, `validate --strict` ✓), [03](03-openspec-strategy.md) | 1 change, 4 delta specs |
| Architecture summary | [ARCHITECTURE.md](ARCHITECTURE.md) (canónico) | 16 secciones |
| Product vision / FR / NFR | [00](00-product-vision.md), [01](01-functional-requirements.md), [02](02-non-functional-requirements.md) | 265 FR, 121 NFR |
| Domain model, bounded contexts, context map | [04](04-domain-model.md), [05](05-bounded-contexts.md), [06](06-context-map.md) | 18 contextos, 28 relaciones |
| Ledger + invariantes financieras | [09](09-ledger-design.md) | INV-001..034 con estrategia de test |
| ERD / data model | [08](08-data-model.md) | ERD por schema, DDL ilustrativo, RLS |
| C4 (context, container, component), secuencias, deployment | [07](07-c4-architecture.md) | 39 diagramas Mermaid validados |
| API proposal | [10](10-api-design.md), [`contracts/openapi/finance-api.v1.yaml`](../contracts/openapi/finance-api.v1.yaml) | Phase 1 completo, Redocly lint 0/0 |
| Event catalog | [11](11-domain-events.md), [`contracts/events/`](../contracts/events/README.md) | 10 JSON Schemas (envelope + 9 eventos Phase 1) |
| Security model | [12](12-security.md) | STRIDE, OIDC/BFF, RBAC, RLS |
| Imports, reporting, observabilidad | [13](13-import-architecture.md), [14](14-reporting.md), [18](18-observability.md) | — |
| ML architecture / AI roadmap | [15](15-ml-architecture.md), [27](27-ai-assistant-roadmap.md) | — |
| Testing strategy / traceability | [16](16-testing-strategy.md), [17](17-test-traceability.md), [`tests/cases/`](../tests/cases/README.md) | 50 TCs (draft) |
| Local dev / containers / cloud / IaC / CI-CD / backup-DR | [19](19-local-development.md), [20](20-container-strategy.md), [21](21-cloud-deployment-options.md), [22](22-infrastructure.md), [23](23-ci-cd.md), [30](30-backup-and-disaster-recovery.md) | — |
| UI/UX & design system, seeds | [28](28-ui-ux-design-system.md), [29](29-seed-datasets.md) | — |
| ADRs | [adr/](adr/README.md) | 24 (0001 aceptado, resto propuestos) |
| Roadmap / backlog / riesgos | [24](24-roadmap.md), [25](25-product-backlog.md), [26](26-risk-register.md) | 27 épicas, 182 US, 31 riesgos |

## 2. DESIGN READINESS CHECKLIST

**READY** = completo y coherente; solo requiere aprobación. **PARTIAL** = completo, pero una decisión depende de un spike o de una respuesta del owner (no bloquea iniciar el Implementation Gate). **BLOCKED** = no se puede avanzar sin respuesta del owner.

| # | Área | Estado | Pendiente |
|---|------|--------|-----------|
| 1 | OpenSpec foundation (CLI 1.14.0 verificada, config, convenciones, primer change validado) | **READY** | — |
| 2 | Architecture summary / estilo (modular monolith + DDD + hexagonal + outbox) | **READY** | Aprobar ADR-0002/0003 tras SPIKE-04 |
| 3 | Domain model y bounded contexts / context map | **READY** | — |
| 4 | Ledger model e invariantes financieras | **READY** | Validar redondeo y round-trip en SPIKE-03 |
| 5 | Modelo de datos / ERD | **PARTIAL** | Herramienta de acceso a datos (Kysely vs Prisma 7 vs Drizzle) → SPIKE-02; ADR de purga de workspace (`pf_purge`) |
| 6 | C4 y diagramas de secuencia / estado | **READY** | — |
| 7 | API proposal (OpenAPI 3.1 Phase 1) | **READY** | — |
| 8 | Event catalog + JSON Schemas | **READY** | Confirmar renombres (`OccurrencesGenerated`, `LoanScheduleGenerated`; `ForecastRequested` eliminado) |
| 9 | Security model | **PARTIAL** | Flujo Keycloak + Next.js BFF + JWT → SPIKE-06 |
| 10 | Testing strategy y traceability | **READY** | — |
| 11 | Test case catalog Phase 0/1 | **PARTIAL** | 50 TCs en `draft`; se completan al redactar los changes de Phase 1 (Implementation Gate) |
| 12 | Local container architecture / stack local | **PARTIAL** | Object storage (SeaweedFS vs Garage, MinIO descartado) → SPIKE-07; Compose en Windows/WSL2 → SPIKE-08; ¿Redis opcional? → SPIKE-05 |
| 13 | Technology ADRs | **PARTIAL** | 23 en *Propuesto*; cada uno se acepta al cerrar su spike (SPIKE-01..10) |
| 14 | Deployment architecture (cloud) | **PARTIAL** | Presupuesto mensual del owner → ECS/Fargate (~120–195 USD/mes) vs Cloud Run (~60–110 USD/mes), SPIKE-09. No bloquea Phase 1 (local-first). **2026-10-03:** SPIKE-09 completado (investigación) → ADR-0027 propone VPS + Compose por niveles (default ≈ USD 27–30/mes); falta Q3 |
| 15 | IaC / CI-CD | **READY** | Terraform vs OpenTofu como binario por defecto (menor) |
| 16 | Observability | **READY** | — |
| 17 | Backup / restore / DR | **READY** | — |
| 18 | ML architecture | **READY** | (Phase 8; gate de datos definido) |
| 19 | AI roadmap + AI FEATURE GATE | **READY** | 10b/10c (sugerencias/acciones) requieren enmendar ADR-0021 cuando lleguen |
| 20 | UI/UX y design system | **PARTIAL** | Wireframes en texto; validación visual con el owner en el primer slice de UI |
| 21 | Product backlog | **READY** | Phase 0/1 detallados; Phases 2–11 a nivel épica/feature |
| 22 | Roadmap | **PARTIAL** | Aprobar ajustes A1–A9 (multi-moneda y conversiones en Phase 1, Hito H paralelo, track de Colaboración) |
| 23 | Risk register | **READY** | RISK-006 (MinIO) ya materializado y mitigado en diseño |
| 24 | Seeds / datasets ficticios | **READY** | — |
| 25 | Parámetros de producto (moneda base, zona horaria, idioma) | **READY** | Resuelto 2026-10-01: BOB, America/La_Paz, UI español con i18n en/pt; todo en español (Q1–Q2) |

**Veredicto propuesto:** el diseño está listo para aprobación. Q1–Q2 ya están resueltas: no quedan áreas BLOCKED. Al aprobar se puede abrir el **Implementation Gate**: ejecutar spikes → aceptar ADRs → redactar changes OpenSpec de Phase 1 → aplicar `bootstrap-platform-foundation`.

## 3. Preguntas abiertas para el owner

### Resueltas (2026-10-01)

- **Q1. Parámetros base:** ✅ moneda de reporte **BOB**, zona horaria **America/La_Paz**, UI en **español** con i18n preparado para **inglés y portugués**.
- **Q2. Idioma:** ✅ **todo en español** por ahora (docs, ADRs, specs OpenSpec, test cases, nombres de tests). Excepción técnica: encabezados que el CLI de OpenSpec parsea y `DEBE (MUST)` en el texto normativo; identificadores de código en inglés según el glosario de [04](04-domain-model.md).

### Decisiones que cambian el diseño (antes de los spikes correspondientes)

- **Q3. Presupuesto cloud** mensual máximo y si se acepta operar **local-only** hasta el Hito H (o un despliegue mínimo al final de Phase 2). Decide ECS/Fargate vs Cloud Run (ADR-0013).
  - **Nota 2026-10-03 — [SPIKE-09](../spikes/SPIKE-09-deploy-costs/README.md):** propone [ADR-0027](adr/0027-destino-de-despliegue-inicial-vps-compose.md) con niveles **N1 ≈ USD 10–15/mes** (Hetzner + Compose), **N2 ≈ USD 27–30/mes** (AWS Lightsail 4 GB São Paulo + Compose, **default recomendado**), **N3 ≈ USD 50–60/mes** (N2 + Neon PG gestionado) y **N4 ≥ USD 110/mes** (ECS/Fargate + RDS, ADR-0013). **Pendiente: confirmación del presupuesto por el owner**; sin respuesta se planifica N2.
  - **Respuesta del owner 2026-10-05 ([docs/31 D51](31-phase-1-consolidation-decisions.md)):** presupuesto cloud **USD 10–20/mes**. El host concreto dentro de ese rango lo elige el change de despliegue, que actualiza ADR-0027.
- **Q4. Object storage local:** ¿aceptas reemplazar MinIO (archivado, sin imágenes desde oct-2025) por SeaweedFS o Garage?
- **Q5. Redis:** ¿preferís minimizar dependencias usando la cola sobre PostgreSQL (BullMQ v6 backend PG o pg-boss) si SPIKE-05 lo valida?
- **Q6. Frontend:** ¿confirmas Next.js como UI + BFF (tokens fuera del navegador) frente a una SPA Vite + BFF separado?
- **Q7. Cuentas multi-activo:** una cuenta = una moneda (Binance con USDT+BTC = 2 cuentas). ¿Querés además una agrupación visual por proveedor/institución?
- **Q8. Roadmap:** ¿apruebas los ajustes A1–A9 de [24](24-roadmap.md) §2, en especial conversiones manuales USDT↔BOB en Phase 1 y el hardening como Hito H paralelo?
- **Q9. Histórico:** ¿empiezas desde saldos iniciales o querés adelantar el CSV import básico (Phase 3, Could) para cargar meses anteriores?

### Para más adelante (no bloquean)

- **Q10.** ¿Qué bancos/billeteras usás y en qué formato exportan (CSV, XLS, PDF)? Define prioridades de adapters en Phase 6/11.
- **Q11.** ADR de purga de workspace (excepción al no-hard-delete) — redactar cuando llegue el track de Colaboración.
- **Q12.** Terraform u OpenTofu como binario por defecto.
- **Q13.** Workflows extendidos de OpenSpec (`verify`, `ff`, `onboard`…) vía `openspec config profile`.

Cada documento contiene además su propia sección "Preguntas abiertas" con detalle técnico.

## 4. Siguientes pasos al aprobar

1. Responder Q3–Q9 en lo posible y actualizar ARCHITECTURE.md con las respuestas (Q1–Q2 ya incorporadas).
2. Ejecutar SPIKE-01..10 en ramas descartables; aceptar o ajustar ADRs.
3. Redactar los changes OpenSpec de Phase 1 ([03](03-openspec-strategy.md) §7) con sus TCs (`draft → ready`).
4. Aplicar `bootstrap-platform-foundation`: skeleton, containers, stack local, CI, traceability.
5. Primer vertical slice: *crear cuenta con saldo inicial* (SPEC → TC → DOMAIN → APPLICATION → INFRA → API → UI → TESTS → E2E → DOCS → ARCHIVE).

## 5. Aprobación

| Rol | Nombre | Decisión | Fecha |
|-----|--------|----------|-------|
| Owner (Product/Tech Lead) | Owner | ☑ Aprobado ☐ Aprobado con cambios ☐ Rechazado | 2026-10-01 |
