# 03 — Estrategia Spec Driven Development con OpenSpec

> **Estado:** Propuesto · **Fecha:** 2026-10-01 · **Relacionado:** [ARCHITECTURE.md](ARCHITECTURE.md) §12–§14, [ADR-0024](adr/0024-spec-driven-development-with-openspec.md), [16-testing-strategy.md](16-testing-strategy.md), [17-test-traceability.md](17-test-traceability.md), [`openspec/config.yaml`](../openspec/config.yaml)

## 1. Herramienta y versión verificada

Verificado en el repositorio el 2026-10-01 (no asumido):

| Aspecto | Valor verificado |
|---|---|
| Paquete | `@fission-ai/openspec` **1.14.0** (última publicada en npm al 2026-09-30) |
| Inicialización | `openspec init --tools claude` → crea `openspec/config.yaml`, `openspec/specs/`, `openspec/changes/archive/` y skills/commands de Claude Code en `.claude/` (`/opsx:propose`, `/opsx:explore`, `/opsx:apply`, `/opsx:update`, `/opsx:sync`, `/opsx:archive`) |
| Schema de workflow | `spec-driven` (único incluido): artefactos **proposal → specs → design → tasks**; `apply` requiere `tasks` |
| Formato de spec (delta) | `## ADDED / MODIFIED / REMOVED / RENAMED Requirements`, `### Requirement: <nombre>`, `#### Scenario: <nombre>` con viñetas de escenario (el proyecto usa `- **CUANDO** … - **ENTONCES** … - **Y** …`, aceptadas por el validador); el texto normativo debe contener **SHALL/MUST** (el proyecto escribe `DEBE (MUST)`); `## Purpose` (≥ 50 caracteres) solo para capabilities nuevas |
| Rutas de capability | Anidadas permitidas: `specs/<context>/<capability>/spec.md` (kebab-case) |
| Validación | `openspec validate --all --strict --no-interactive` (también `--json`, `--changes`, `--specs`) |
| Cambios sin specs | `.openspec.yaml` con `skip_specs: true` (refactors/tooling/docs sin cambio de comportamiento) |
| Config de proyecto | `openspec/config.yaml`: `context` (inyectado en todo artefacto), `rules` por artefacto, `operations.apply/archive.guidance` |

> **No existe** `openspec/project.md` ni `AGENTS.md` en esta versión (eran convenciones de 0.x). El rol de `PROJECT.md` lo cumplen `openspec/config.yaml` (restricciones condensadas) + `docs/ARCHITECTURE.md` (decisiones canónicas). No inventamos sintaxis adicional.

## 2. Estructura en el repositorio

```
openspec/
├─ config.yaml                     # contexto + reglas (Impact obligatorio, invariantes, idioma)
├─ specs/                          # COMPORTAMIENTO VIGENTE (solo lo ya implementado y archivado)
│  ├─ ledger/journal-posting/spec.md
│  ├─ transactions/transfers/spec.md
│  └─ …                            # taxonomía en ARCHITECTURE.md §14
└─ changes/
   ├─ bootstrap-platform-foundation/   # archivado en changes/archive/2026-10-02-bootstrap-platform-foundation
   │  ├─ .openspec.yaml
   │  ├─ proposal.md  design.md  tasks.md
   │  └─ specs/{platform,quality}/…/spec.md
   └─ archive/                     # changes completados (historial)
```

**Regla clave:** `openspec/specs/` describe lo que el sistema **hace hoy**. Mientras una capability no esté implementada, vive como *delta* dentro de un change. Por eso en Phase 0 `specs/` está vacío y todo el diseño funcional está en `docs/` + el primer change. Las specs principales nacen al **archivar** cada change.

## 3. Mapeo de la secuencia obligatoria a OpenSpec

| Paso del proceso | Artefacto / comando OpenSpec | Evidencia |
|---|---|---|
| IDEA / REQUIREMENT | Backlog `US-NNN` / `FR-<CTX>-NNN` ([25](25-product-backlog.md), [01](01-functional-requirements.md)); `/opsx:explore` para discovery | Item de backlog |
| SPEC | `openspec new change <id>` → `proposal.md` + `specs/**/spec.md` (`/opsx:propose`) | Delta specs |
| REVIEW | Pull Request de *solo planificación* (sin código) — revisión del owner | PR aprobado |
| DESIGN | `design.md` (+ ADR si contradice/crea decisión transversal) | design.md |
| TEST CASES | `tests/cases/<ctx>/TC-*.md` creados/actualizados en el mismo PR de planificación | TC en estado `ready` |
| IMPLEMENTATION | `/opsx:apply` sobre `tasks.md` (slices en orden SPEC→TC→DOMAIN→APPLICATION→INFRA→API→UI) | Commits |
| AUTOMATED TESTS | Tests con `[TC-…]` en el nombre | CI verde |
| VALIDATION | `openspec validate --strict`, matriz de trazabilidad, DoD | Checks |
| DOCUMENTATION | docs/ y OpenAPI actualizados en el mismo change | Diff |
| SPEC STATUS UPDATE | `openspec archive <id>` → mueve deltas a `openspec/specs/`, change a `archive/` | Spec vigente |

### Estado de una spec / change

OpenSpec no tiene un campo de estado propio más allá del progreso de artefactos (`openspec status`) y de `tasks.md`. Convención del proyecto:

| Estado | Cómo se observa |
|---|---|
| `proposed` | change existe, artefactos incompletos (`openspec status`) |
| `reviewed` | PR de planificación aprobado y mergeado |
| `ready` | 4/4 artefactos + TCs en estado `ready` |
| `in-progress` | ≥ 1 tarea marcada en `tasks.md` |
| `validated` | todas las tareas `[x]`, CI verde, DoD cumplido |
| `completed` | change archivado; spec vigente en `openspec/specs/` |

## 4. Contenido obligatorio de cada change

Lo exigido por el proyecto (qué cambia, por qué, specs/componentes/APIs/tablas/eventos impactados, test cases, migraciones, riesgos) está **codificado como regla** en `openspec/config.yaml → rules.proposal`, de modo que cada `/opsx:propose` lo recibe como restricción. Sección `## Impact` de `proposal.md` con estas etiquetas en negrita:

- **Specs impactadas** · **Componentes/contextos impactados** · **APIs impactadas** · **Tablas impactadas** · **Eventos impactados** · **Migraciones requeridas** · **Test cases** (AÑADIDOS / MODIFICADOS / DEPRECADOS por TC-id) · **Impacto de regresión** · **Riesgos introducidos** · y, si toca dinero/ledger/FX/periodos/redondeo, **Invariantes afectadas (INV-NNN)**.

**Regla de cobertura del export (`add-workspace-export`):** todo change que cree una tabla de negocio con `workspace_id` DEBE, en el mismo PR, registrarla en `platform.workspace_scoped_table` y agregar su sección de portabilidad (`PortabilitySection` en `contracts/portability.ts` de su contexto, con su esquema en `contracts/export/v1/`) o una exclusión declarada con motivo; un test estático (`apps/api/src/portability/portability-coverage.test.ts`) y uno de integración contra la base real lo hacen cumplir.

Para features significativas, la spec debe permitir derivar: propósito, contexto, requerimientos, casos de uso, reglas de negocio, invariantes, escenarios, criterios de aceptación (= scenarios), contratos, modelo de datos, eventos, test cases, riesgos e impacto arquitectónico — repartidos así: *proposal* (por qué, alcance, impacto), *specs* (requerimientos, reglas, invariantes observables, escenarios), *design* (modelo, contratos, eventos, migraciones, riesgos técnicos), *tasks* (plan verificable).

## 5. Convenciones de autoría

- **Idioma: todo en español** (decisión del owner, 2026-10-01). Se mantienen en inglés solo los encabezados que el CLI parsea (`## Purpose`, `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`, `### Requirement:`, `#### Scenario:`, `**Reason**`, `**Migration**`). Texto normativo: `El sistema DEBE (MUST) …` / `NO DEBE (MUST NOT)`. Scenarios: `- **CUANDO** …`, `- **ENTONCES** …`, `- **Y** …`. Verificado el 2026-10-01: un change en español pasa `validate --strict`, se archiva y la spec principal resultante también valida. Sin el `(MUST)`, `--strict` falla con *should contain SHALL or MUST*. Los encabezados de **proposal.md** quedan en inglés (`## Why`, `## What Changes`, `## Capabilities`, `### New Capabilities`, `### Modified Capabilities`, `## Impact`): `validate` y `archive` aceptan español, pero `openspec show --json` (usado por los skills `/opsx:*` y por el script de trazabilidad) falla sin ellos — verificado el 2026-10-02. Los encabezados de design.md y tasks.md sí van en español. Regla codificada en `config.yaml → rules`.
- **Nombre del change:** `verbo-objeto` en kebab-case: `add-ledger-core`, `change-budget-rollover-rules`, `remove-legacy-csv-mapper`, `refactor-…` (este último normalmente con `skip_specs: true`).
- **Una conducta por requirement**, descripción ≤ 500 caracteres; ejemplos en scenarios.
- **Montos explícitos** con escala y moneda (`685.00 BOB`, `100.000000 USDT`) en todo requirement financiero.
- **Sin nombres de librerías, clases o tablas** en specs (van a `design.md`).
- **Prioridad y traza:** OpenSpec no tiene campo MoSCoW. Cada requirement incluye, como última línea de su descripción, `Trace: <FR-… / NFR-… ids> · Priority: Must|Should|Could` (parseado por el script de trazabilidad, [17](17-test-traceability.md)).
- **Rutas anidadas verificadas:** `openspec validate --strict` aceptó `specs/platform/local-environment/spec.md` y `specs/quality/test-traceability/spec.md` en el change `bootstrap-platform-foundation` (2026-10-01).
- **MODIFIED** copia el requirement completo; **REMOVED** exige `**Reason**` y `**Migration**`.
- Changes que afectan contratos incluyen el diff de `contracts/openapi/` o `contracts/events/` en el mismo PR.
- Un change por *vertical slice* razonable; evitar changes "paraguas".

## 6. Taxonomía de capabilities

Definida en [ARCHITECTURE.md §14](ARCHITECTURE.md). Organización por bounded context (`<context>/<capability>`), más `platform/`, `security/` y `quality/` transversales. Reutilizar rutas existentes (`openspec list --specs`) antes de crear nuevas.

## 7. Plan de changes

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 0 | `bootstrap-platform-foundation` ✅ implementado y **archivado** (2026-10-02, PRs #1–#4) | `platform/local-environment`, `platform/observability`, `platform/delivery-pipeline`, `quality/test-traceability` | Implementation Gate |
| 1 | `add-api-conventions` | `platform/api-conventions` (idempotency, problem+json, paginación) | 1 |
| 2 | `add-workspace-identity` | `identity/authentication`, `identity/workspace-membership`, `security/access-control`; incluye como **primer grupo de tareas** la migración del catálogo `fx.currency` + datos de referencia, porque `iam.workspace.base_currency` lo referencia (el comportamiento del catálogo sigue especificado en `fx/market-rates`) | 1 |
| 2b | `add-event-outbox` | `platform/event-delivery` (outbox transaccional, relay a pg-boss, inbox idempotente, orden por agregado, dead-letter y métricas; cierra la tarea 6.3 de `add-workspace-identity`; docs/31 D30) | 1 |
| 3 | `add-audit-trail` | `audit/audit-trail` | 1 |
| 4 | `add-ledger-core` | `ledger/journal-posting`, `ledger/balances` | 1 |
| 5 | `add-classification` | `classification/categories`, `classification/tags`, `classification/counterparties` | 1 |
| 6 | `add-accounts-management` | `accounts/account-management`, `accounts/institutions` | 1 |
| 7 | `add-transaction-recording` | `transactions/transaction-recording`, `transactions/splits`, `transactions/reconciliation`, `transactions/duplicate-detection` | 1 |
| 8 | `add-transfers` | `transactions/transfers` | 1 |
| 9 | `add-manual-conversions` | `transactions/conversions` (incluye `ConversionRevised.v1`; docs/31 D48), `fx/conversion-pricing`, `fx/market-rates` (manual; par sin preferencia ⇒ `PARALLEL`, D48) | 1 |
| 9b | `add-market-rate-providers` | `fx/market-rate-providers` (paralelo.bo principal, bo.dolarapi.com respaldo/oficial; docs/31 D29, ADR-0025) | 1 |
| 10 | `add-basic-dashboard` | `reporting/dashboard` (incluye FR-REPORTING-004 en el Home; docs/31 D50), `reporting/net-worth` (valoración USD/USDT con la tasa paralela del provider) | 1 |
| 11 | `add-lifecycle-timeline` | `audit/lifecycle-timeline` (máquinas de estado explícitas por agregado, `GET …/{id}/lifecycle`, reporte de recorrido en la UI) + `transactions/transfers` (`TransferRevised.v1`; docs/31 D37) | 1 |
| 12 | `add-demo-data` | `identity/demo-data` (carga y limpieza de datos de demostración por acción explícita del OWNER, en un workspace demo dedicado y purgable; docs/31 D36, ADR-0026) | 1 |

Los changes 1–10 (más el 9b, agregado el 2026-10-02 por decisión del owner, docs/31 D29, y el 2b `add-event-outbox`, agregado el 2026-10-03, docs/31 D30; los 11 `add-lifecycle-timeline` y 12 `add-demo-data` se agregaron el 2026-10-03 por decisión del owner, docs/31 D37 y D36) se redactaron **después** de aprobar el DESIGN GATE (sección 56 del brief), reutilizando FR, invariantes y TCs ya diseñados en Phase 0. La columna **Orden** es el orden de **implementación** (cada change se aplica sobre los anteriores), fijado en [31-phase-1-consolidation-decisions.md](31-phase-1-consolidation-decisions.md) (D24).

**Phase 2 (consolidado el 2026-10-05).** Los 11 changes de Phase 2 se redactaron en paralelo en tres hilos y se consolidaron en un único orden de implementación; las preguntas abiertas al owner están en [32-phase-2-consolidation-questions.md](32-phase-2-consolidation-questions.md) y el owner las resolvió el 2026-10-08 (decisiones D59–D111 en [33-phase-2-consolidation-decisions.md](33-phase-2-consolidation-decisions.md)).

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 13 | `add-financial-periods` | `planning/financial-periods` (periodos mensuales según el día de inicio del mes financiero, creación automática con anticipación, ciclo `draft/active/closed/reopened`, activación por zona horaria del workspace, guard de planificación y hook `PeriodCreatedHook` para el plan mensual) | 2 |
| 14 | `add-custom-fields` | `classification/custom-fields` (nueva) + MODIFIED `transactions/transaction-recording` (custom fields por split y filtro del listado) | 2 |
| 15 | `add-reconciliation` | `transactions/reconciliation` (completa: sesiones por cuenta con fecha y saldo de extracto, diferencia 0 para finalizar, ajuste auditado, `TransactionCleared.v1` por docs/31 D47, cobertura por cuenta `ReconciliationStatusQuery` para el cierre) + `audit/lifecycle-timeline` (máquina `RECONCILIATION_LIFECYCLE`) | 2 |
| 16 | `add-budgets` | `planning/budgets` (plan mensual por periodo, tipos fixed/maximum Must, minimum/range/rollover/% de ingresos Should, base cero y tag Could; presupuesto vs real en moneda base con la valoración de flujos de Reporting, D29/D34/D53; umbrales emitidos una sola vez con `planning.BudgetThresholdReached.v1`) | 2 |
| 17 | `add-budget-templates` | `planning/budget-templates` (templates versionados inmutables, plan desde template o clonando el periodo anterior, template predeterminado aplicado a los periodos nuevos vía `PeriodCreatedHook`, edición local y propagación a futuro con vista previa) | 2 |
| 18 | `add-month-closing` | `planning/month-closing` (checklist, cierre atómico con bloqueo del ledger, snapshot inmutable y versionado con `BudgetVsActualQuery`, reapertura por el OWNER, `planning.MonthClosePending.v1`, reporte y exportación) + `ledger/journal-posting` (bloqueo por rango del periodo financiero y alcance único de la edición en periodo cerrado, ADR-0028 propuesto) + `audit/lifecycle-timeline` (recorrido del periodo) | 2 |
| 19 | `add-alerts` | `notifications/alerts` (centro in-app, umbral de presupuesto y cierre pendiente, deduplicación por hecho, email vía `EmailSender` —Mailpit en local/CI— entregado una sola vez y sin montos salvo opt-in, i18n es/en/pt, preferencias y horario de silencio) | 2 |
| 20 | `add-bulk-edit` | `transactions/bulk-edit` (nueva: todo o nada, versión por ítem, `bulkOperationId`, rechazo en periodo cerrado según `ledger/journal-posting`, D49) | 2 |
| 21 | `add-global-audit-view` | `audit/audit-trail` (consulta global con filtros, export CSV OWNER, fallos de autorización auditados; FR-AUDIT-005/006) | 2 |
| 22 | `add-net-worth-evolution` | `reporting/net-worth` (serie mensual de patrimonio por periodo financiero, FR-REPORTING-006; usa los snapshots de `planning/month-closing`) | 2 |
| 23 | `add-workspace-export` | `identity/workspace-portability` (nueva: export completo, versionado y cifrado + import a workspace nuevo con verificación de la ida y vuelta, incluidas las tablas de todos los changes de Phase 2; FR-IDENTITY-010/017; criterio de salida de Phase 2) | 2 |
| 24 | `improve-event-throughput` | MODIFIED `platform/event-delivery` (rendimiento sostenido de los consumidores: concurrencia entre agregados y lotes configurables sin relajar el orden por agregado, backlog de 5 000 eventos drenado en ≤ 120 s, presupuesto de conexiones validado al arrancar, métricas de backlog y duración por consumidor; NFR-PERF-008; agregado el 2026-10-09, docs/33 D112) | 2 (plataforma, antes de Phase 6) |
| 25 | `fix-phase-2-gaps` | MODIFIED `identity/authentication` (`/me` tolera un locale guardado no soportado), `platform/api-conventions` (cuota de operaciones costosas 10/min; el archivo forma parte del payload idempotente en multipart), `audit/audit-trail` (nombre del actor en el CSV); agregado el 2026-10-09, docs/33 D113 | 2 (correcciones, antes de Phase 3) |

**Phase 3 (consolidado el 2026-10-09).** Los 5 changes se redactaron en paralelo en tres hilos; las preguntas abiertas al owner están en [34-phase-3-consolidation-questions.md](34-phase-3-consolidation-questions.md) y el owner las resolvió el 2026-10-10 (decisiones D114–D151 en [35-phase-3-consolidation-decisions.md](35-phase-3-consolidation-decisions.md)).

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 26 | `add-recurrence-engine` | `commitments/recurrence-engine` (nueva: definiciones, cadencias e intervalo N, RRULE subset, tipos de monto, reglas de fin de mes y fin de semana, generación idempotente con horizonte, modos de materialización, acciones sobre ocurrencias y definiciones, total comprometido; FR-COMMITMENTS-001..009, 011) + `audit/lifecycle-timeline` + `notifications/alerts`; crea el contexto `@pf/commitments` | 3 |
| 27 | `add-upcoming-payments` | `reporting/cash-flow-calendar` (nueva, versión simple: próximos pagos Q8, comprometido del periodo Q4, saldo proyectado FR-LEDGER-013, SM-07; FR-REPORTING-016) + delta MODIFIED de `reporting/dashboard` (Q4/Q8 habilitadas en el Home) | 3 |
| 28 | `add-subscriptions` | `commitments/subscriptions` (nueva: suscripciones con definición recurrente, historial de precios, detección de cambio de precio, costo mensualizado/anualizado, recordatorios; FR-COMMITMENTS-012..017) + `notifications/alerts` | 3 |
| 29 | `add-commitment-matching` | `commitments/recurrence-engine` (matching sugerido ocurrencia ↔ transacción, nunca automático; FR-COMMITMENTS-010) | 3 |
| 30 | `add-basic-csv-import` | `imports/import-pipeline` (subconjunto CSV de una cuenta, Could; FR-IMPORTS-003; condicionado a la pregunta 9 de docs/34) | 3 |

Dependencias que fijan el orden: el motor (26) crea el contexto y los contratos (`UpcomingPaymentsQuery`, `CommittedQuery`, `RecurringDefinitionPort`, `managedBy`) que usan los demás; `add-upcoming-payments` va segundo porque responde Q4/Q8 con solo el motor; `add-subscriptions` usa `RecurringDefinitionPort`; `add-commitment-matching` agrega requirements a la spec del motor ya archivada y alimenta SM-07; la importación CSV es independiente y opcional, al final.

Dependencias que fijan el orden: `add-financial-periods` es la base del plan mensual (`add-budgets`, `add-budget-templates`) y del cierre; `add-reconciliation` y `add-budgets` van antes de `add-month-closing` (ítem de cuentas conciliadas y presupuesto vs real congelado en el snapshot); `add-alerts` va después de `add-month-closing` porque consume `planning.MonthClosePending.v1` y `planning.BudgetThresholdReached.v1`; `add-bulk-edit` reutiliza el alcance de edición en periodo cerrado que fija `add-month-closing`; `add-net-worth-evolution` usa los snapshots de cierre; `add-workspace-export` va al final porque exporta e importa los datos de todos los demás. `improve-event-throughput` (agregado por el owner el 2026-10-09) va después y antes de cualquier change de Phase 6: los imports multiplican el volumen de eventos y el ritmo actual (~2 eventos/s por consumidor) incumpliría NFR-PERF-008.

## 8. Integración con CI y herramientas

- CLI fijada como devDependency raíz (`@fission-ai/openspec@1.14.0`) al crear el skeleton; actualizaciones solo vía change dedicado (riesgo de evolución rápida del CLI v1.x).
- PR gate: `openspec validate --all --strict --no-interactive` (verificado localmente: `✓ change/bootstrap-platform-foundation — 1 passed`).
- Pre-commit opcional: `openspec validate --archived` para asegurar que changes archivados tienen todas las tareas completas.
- La matriz de trazabilidad ([17](17-test-traceability.md)) consume `openspec show <spec> --type spec --json` para enumerar requirements.

## 9. Gobierno

- **Owner de specs:** Product/Tech Lead (hoy, una persona). Revisión obligatoria en PR de planificación antes de implementar.
- **Specs como contrato:** si la implementación descubre que la spec está mal, se actualiza la spec (`/opsx:update`) *antes* de cambiar el comportamiento — nunca al revés.
- **ADR vs spec:** la spec dice *qué* hace el sistema; el ADR dice *por qué así* a nivel transversal; `design.md` dice *cómo* para ese change.
- **Archivado:** nunca archivar con tareas abiertas ni TCs sin estado actualizado.

## Preguntas abiertas

1. ~~Idioma de specs~~ — resuelto: todo en español (2026-10-01).
2. ¿Activamos el perfil extendido de workflows de OpenSpec (`new`, `continue`, `ff`, `verify`, `bulk-archive`, `onboard`) vía `openspec config profile`? `verify` podría aportar al paso VALIDATION.
