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
| 28 | `add-subscriptions` | `commitments/subscriptions` (nueva: suscripciones con definición recurrente, historial de precios, detección de cambio de precio, costo mensualizado/anualizado, recordatorios; FR-COMMITMENTS-012..017) + `notifications/alerts`; va después de `add-recurrence-engine` (la implementa sobre su `RecurringDefinitionPort`) y antes o en paralelo con `add-commitment-matching` | 3 |
| 29 | `add-commitment-matching` | `commitments/recurrence-engine` (matching sugerido ocurrencia ↔ transacción, nunca automático; FR-COMMITMENTS-010); requiere `add-recurrence-engine` archivado (agrega requirements a su spec) | 3 |
| 30 | `add-basic-csv-import` | `imports/import-pipeline` (subconjunto CSV de una cuenta, Could; FR-IMPORTS-003; último change de Phase 3: el owner lo incluyó en docs/35 D122; implementado, crea el contexto `@pf/imports`) | 3 |

Dependencias que fijan el orden: el motor (26) crea el contexto y los contratos (`UpcomingPaymentsQuery`, `CommittedQuery`, `RecurringDefinitionPort`, `managedBy`) que usan los demás; `add-upcoming-payments` va segundo porque responde Q4/Q8 con solo el motor; `add-subscriptions` usa `RecurringDefinitionPort`; `add-commitment-matching` agrega requirements a la spec del motor ya archivada y alimenta SM-07; la importación CSV es independiente y opcional, al final.

**Phase 4 (consolidado el 2026-10-10).** Los 6 changes se redactaron en paralelo en tres hilos; las preguntas abiertas al owner están en [36-phase-4-consolidation-questions.md](36-phase-4-consolidation-questions.md) y el owner las resolvió el 2026-10-10 (decisiones D153–D218 en [37-phase-4-consolidation-decisions.md](37-phase-4-consolidation-decisions.md)).

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 31 | `add-loans` | `debt/loans` y `debt/amortization` (nuevas: préstamo, desembolso y pago como transacciones `LOAN_DISBURSEMENT`/`LOAN_PAYMENT`, cronograma French al centavo, cuotas como compromisos `LOAN_PAYMENT` administrados, comparación con la tabla del banco; FR-DEBT-001..003, 006, 007, 011) + `commitments/recurrence-engine` + `transactions/transaction-recording`; crea el contexto `@pf/debt` y el `RecurringDefinitionPort` público | 4 |
| 32 | `add-credit-cards` | `debt/credit-cards` (nueva: términos, ciclos y estados de cuenta, pago como transferencia, plan `CARD_PAYMENT`, utilización 30/80 %, bimoneda, cuotas; FR-DEBT-012..017) + `commitments/recurrence-engine` + `reporting/cash-flow-calendar` + `notifications/alerts` | 4 |
| 33 | `add-savings-goals` | `goals/savings-goals` (nueva: metas, aportes reales y reservas, cálculos, simulación, multi-moneda, hitos y meta alcanzada, aporte recurrente `managedBy = GOAL`; FR-GOALS-001..010) + `notifications/alerts`, `planning/budgets`, `reporting/dashboard` (Q9), `transactions/transfers`; crea `@pf/goals` | 4 |
| 34 | `add-loan-amortization-advanced` | `debt/amortization` y `debt/loans` (alemán, capital fijo, custom, prepagos, tasa variable, simulador; FR-DEBT-004, 005, 008..010) | 4 |
| 35 | `add-debt-summary` | `debt/loans` + `reporting/dashboard` (resumen de deudas: total por moneda y en base, interés del año, fecha libre de deudas; FR-DEBT-018) | 4 |
| 36 | `add-spendable-amount` | `reporting/dashboard` (Q5 "¿cuánto puedo gastar?": líquido − reservado − comprometido − aportes planificados − reserva mínima; FR-PLANNING-024) | 4 |

Dependencias que fijan el orden: `add-loans` crea `@pf/debt`, el `RecurringDefinitionPort` público y las guardas del motor por `kind = LOAN_PAYMENT`; `add-credit-cards` reutiliza contexto y puerto; `add-savings-goals` agrega `GOAL` al puerto; la amortización avanzada requiere el núcleo de préstamos; el resumen de deudas lee préstamos y tarjetas; Q5 va al final porque compone metas, compromisos, tarjetas y préstamos y modifica el mismo requirement del Home que `add-savings-goals`.

**As-built de `add-spendable-amount`.** Último change de Phase 4: sin contexto, tablas, migraciones ni eventos nuevos. Reporting compone por contratos públicos Commitments (`CommittedQuery.listForSpendable`, aditivo), Goals (`GoalReservationsQuery`, `GoalPlansQuery`), Identity (`WorkspaceSettingsQuery.getMinimumLiquidityReserve`, aditivo) y Planning (`BudgetVsActualQuery`) en el DS puro `SpendableCalculator`; expone `GET W/reports/spendable` (`getSpendable`) y el bloque `spendable` del resumen del Home (Q5 pasa a `AVAILABLE`/`NO_DATA`; ya no queda ninguna pregunta no disponible por fase). Implementado el 2026-10-12.

**As-built de `add-savings-goals`.** Se implementa después de `add-loans` y `add-credit-cards` (reutiliza el `RecurringDefinitionPort`, al que agrega `reviseManaged`, `pauseManaged` y `resumeManaged` para `managedBy = GOAL`) y antes de `add-spendable-amount`, que consume sus consultas públicas `GoalReservationsQuery` y `GoalPlansQuery`. Crea el contexto `@pf/goals` (schema `goals`, 7 tablas, órdenes de portabilidad 772–778), extiende TRANSACTIONS (`GoalTransferPort`, `source = GOAL`, `revision` en `TransactionLinkDto`), COMMITMENTS (`GOAL` en `managedBy`), PLANNING (`GoalPlanPort`, sección "Aportes a metas"), REPORTING (Q9 y Q6 con aportes netos) y NOTIFY (`GOAL_OVER_ALLOCATED`, `GOAL_REACHED`, `GOAL_MILESTONE`); el calendario financiero puro se extrajo de PLANNING al shared-kernel. Job `goals.daily-evaluation` (`GOALS_DAILY_CRON`) y cuatro consumidores propios.

**As-built de `add-credit-cards`.** Se implementa después de `add-loans` (reutiliza `@pf/debt` y el `RecurringDefinitionPort`, que amplía de forma aditiva: regla mensual, `setExpected` con `FIXED|ESTIMATED|NONE`, `skip`, `listOccurrences`, `revise` de días y modo, y `RecurringDefinitionQuery.listActiveTransfersTo`) y antes de `add-debt-summary`. Habilita `CARD_PAYMENT` solo para definiciones `managedBy = DEBT`, agrega `AccountMovementsQuery` a TRANSACTIONS y los tipos `CARD_PAYMENT_DUE`/`CARD_UTILIZATION` a NOTIFY. Schema `debt` con 9 tablas nuevas (órdenes de portabilidad 788–796), job `debt.card-daily` (`DEBT_CARDS_CRON`) y consumidor `debt.card-activity`.

**As-built de `add-loan-amortization-advanced`.** Último change de deudas de Phase 4; se aplica después de `add-loans` (y de `add-credit-cards`, `add-savings-goals`). Habilita `GERMAN`, `FIXED_PRINCIPAL` y `CUSTOM` en `@pf/debt` (`ScheduleRecalculator`, `PayoffSimulator`, `CustomScheduleValidator`, motor de filas compartido con el calculador), agrega `RecurringDefinitionPort.replaceSchedule` a COMMITMENTS (reemplazo del calendario explícito: una versión nueva de la definición que reescribe, cancela con `SUPERSEDED` o crea las ocurrencias no resueltas), la tabla `debt.loan_rate_change` (sección de portabilidad 797) y columnas en `debt.loan`, `debt.loan_schedule_version` y `debt.loan_payment`. Sin consumidores de eventos nuevos y sin conexiones adicionales al pool.

**As-built de `add-loans`.** Se implementa antes que `add-loan-amortization-advanced` y en paralelo con `add-credit-cards` (que reutiliza el contexto `@pf/debt` y el puerto). Crea el contexto `@pf/debt` (schema `debt`, 8 tablas, órdenes de portabilidad 780–787), extiende TRANSACTIONS (kinds administrados `LOAN_DISBURSEMENT`/`LOAN_PAYMENT`, `LoanTransactionsPort`) y ACCOUNTS (`AccountProvisioningPort`) y publica el `RecurringDefinitionPort` (`createManaged`, `settle`, `unsettle`, `setExpected`, `end`, `revise`) con las guardas del motor por `kind = LOAN_PAYMENT`. `replaceSchedule` NO se implementó: lo agrega `add-loan-amortization-advanced`.

Dependencias que fijan el orden: `add-financial-periods` es la base del plan mensual (`add-budgets`, `add-budget-templates`) y del cierre; `add-reconciliation` y `add-budgets` van antes de `add-month-closing` (ítem de cuentas conciliadas y presupuesto vs real congelado en el snapshot); `add-alerts` va después de `add-month-closing` porque consume `planning.MonthClosePending.v1` y `planning.BudgetThresholdReached.v1`; `add-bulk-edit` reutiliza el alcance de edición en periodo cerrado que fija `add-month-closing`; `add-net-worth-evolution` usa los snapshots de cierre; `add-workspace-export` va al final porque exporta e importa los datos de todos los demás. `improve-event-throughput` (agregado por el owner el 2026-10-09) va después y antes de cualquier change de Phase 6: los imports multiplican el volumen de eventos y el ritmo actual (~2 eventos/s por consumidor) incumpliría NFR-PERF-008.

**Phase 5 y seguridad.** Los changes 37 a 49 (Phase 5, nightly y rendimiento) y su estado se siguen en [docs/38](38-estado-y-pendientes.md) §1.2. El 50 es el change de seguridad que D296 ([docs/48](48-perf-and-rls-owner-decisions.md)) pide para el hueco de fail-closed que encontró TC-SECURITY-RLS-007; respeta D298 ([docs/49](49-rls-no-migration-decision.md)) y sus preguntas están en [docs/55](55-rls-fail-closed-questions.md).

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 50 | `fix-rls-fail-closed-gaps` | `security/access-control` (2 ADDED: fail-closed sin contexto de las claves de idempotencia, con su alcance de usuario, y de las exportaciones del workspace, con el barrido de retención por el rol de mantenimiento; 1 MODIFIED: la matriz tabla por tabla falla ante un vacío sin `PF002`, recorre también el rol del worker y limita la variante tolerante del contexto). Migración expand con dos `ALTER POLICY`, sin reescribir las políticas que ya cumplen | 5 |

**Phase 6 (consolidado el 2026-10-29).** Seis changes redactados en paralelo en tres hilos; preguntas al owner en [56-phase-6-consolidation-questions.md](56-phase-6-consolidation-questions.md).

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 51 | `optimize-consumer-throughput` | `platform/event-delivery` y `platform/delivery-pipeline` (medición E6–E10b y entrega agrupada por workspace con la configuración del host; D300, D301, D307) | 6 |
| 52 | `add-bulk-imported-transactions` | `transactions/transaction-recording` e `imports/import-pipeline` (escritura por conjunto de `recordBatch`; persistencia ≤ 20 s para 5 000 filas, D152, NFR-PERF-007) | 6 |
| 53 | `add-document-attachments` | `documents/attachments` y `security/file-upload-security` (nuevas: subida presignada con cuarentena, verificación de tipo real, cifrado de la aplicación, adjuntos N:M, cuotas, retención, suite de uploads maliciosos) + `identity/workspace-portability`, `audit/lifecycle-timeline` | 6 |
| 54 | `add-import-pipeline` | `imports/import-pipeline` y `transactions/duplicate-detection` (CSV, OFX, QIF, JSON; XLSX Could; perfiles por institución, duplicados con puntaje, compromisos, conversiones, reconciliación del extracto, deshacer) + `audit/lifecycle-timeline` | 6 |
| 55 | `add-rule-engine` | `rules/rule-engine` (nueva: WHEN/THEN, primer escritor por campo con `stopProcessing`, versiones, dry-run, cobertura del 70 %) + `transactions/transaction-recording`, `identity/workspace-portability` | 6 |
| 56 | `add-banking-providers` | `imports/banking-providers` (nueva: puerto `BankingProvider`, proveedor simulado, credenciales con sobre X25519, sincronización por cursor; el grupo 9 con exchanges reales depende del owner) + `identity/workspace-portability` | 6 |
| 57 | `add-pdf-statement-parser` | `imports/import-pipeline` (1 MODIFIED: el PDF con texto pasa a ser formato importable; 13 ADDED: extracción con posiciones en un `worker_thread` aislado, rechazo de escaneados, diseños por institución versionados, reconstrucción por columnas, páginas, montos exactos, coherencia de saldos con falla cerrada, cuenta y moneda, huella con fragmentos variables, fixtures generados por código; D324) | 6 |

**Phase 7 (consolidado el 2026-11-04).** Cinco changes redactados en paralelo en tres hilos; preguntas al owner en [61-phase-7-consolidation-questions.md](61-phase-7-consolidation-questions.md).

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 58 | `add-financial-reports` **(implementado, 2026-11-05; va antes que el 59)** | `reporting/financial-reports` (nueva: catálogo de 16 reportes, reportes Must 1, 2, 3, 7, 8 y 15, comparativas MoM/YoY/rango/móvil, drill-down, conversión declarada, export CSV, reconciliación reporte↔ledger en tres niveles, NFR-PERF-006) + `reporting/net-worth`, `reporting/dashboard` | 7 |
| 59 | `add-financial-reports-extended` | `reporting/financial-reports` (reportes Should 4–6 y 9–14, vistas guardadas, PDF Could) | 7 |
| 60 | `add-cash-flow-forecast` **(implementado, 2026-11-05)** | `reporting/cash-flow-calendar` (saldo proyectado 7/30/60/90, mínimo esperado y riesgo de déficit, NFR-PERF-010) + `reporting/dashboard` (Q5 hasta el próximo ingreso, esenciales, Q7, SM-05) + `notifications/alerts` (alerta de déficit y digest) | 7 |
| 61 | `add-historical-budgets` | `planning/budgets` (sugerencia por promedio o año anterior con exclusión de atípicos, confirmación explícita) | 7 |
| 62 | `add-rule-suggestions` | `rules/rule-engine` (reglas sugeridas desde clasificaciones manuales, vista previa con el motor del dry-run, aceptación explícita) | 7 |

Dependencias que fijan el orden: el núcleo de reportes fija contratos y esquemas que usa el ampliado; el forecast y los reportes coordinan `PERF_THRESHOLDS` y el delta de `reporting/dashboard`; las sugerencias de reglas se archivan después de `add-rule-engine`.

**Estabilización del nightly (2026-11-09).** El owner decidió tratar en un change aparte el fallo recurrente de la persistencia del import de 5 000 filas, sin tocar el umbral (NFR-PERF-007, D152); preguntas en [63-import-persist-perf-questions.md](63-import-persist-perf-questions.md) y decisiones D403–D409 en [64-import-persist-perf-decisions.md](64-import-persist-perf-decisions.md).

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 63 | `stabilize-import-persist-perf` | `platform/delivery-pipeline` (4 ADDED: desglose de la persistencia del benchmark del import, huella del runner, suite informativa que no decide el veredicto aunque su preparación no termine, benchmark del import sin trabajos programados ajenos); experimentos P1–P8 y arreglos según el resultado (tamaño de lote, relay, trabajos programados, estado de la base), con `throughput.perf.ts` en el alcance | 6 |

**Phase 8 (consolidado el 2026-11-12).** Cuatro changes redactados en una sesión de diseño; preguntas al owner en [65-phase-8-consolidation-questions.md](65-phase-8-consolidation-questions.md) (33, 6 bloqueantes) y ADR-0033 propuesto (servicio Python en N1). Ningún change agrega consumidores ni conexiones (D249).

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 64 | `add-ml-forecasting-service` | `forecast/expense-forecasting` (nueva: corrida con ciclo de vida, series por periodo financiero, preparación de datos, minimización, validación, consulta, degradación; pronósticos de referencia) + `audit/lifecycle-timeline`, `platform/local-environment` (perfil `ml`), `platform/delivery-pipeline` (gate, imagen y despliegue opcional del servicio Python), `quality/test-traceability` (tests de Python); crea el contexto `@pf/forecasting` y el servicio `ml-forecasting` (ADR-0033) | 8 |
| 65 | `add-expense-forecasts` | `forecast/expense-forecasting` (conocidos frente a variables predichos, ETS y selección por backtesting, publicación solo si supera a la referencia, motivos, confianza, ingreso total, vista `/pronosticos`) | 8 |
| 66 | `add-predicted-cash-flow-band` | `forecast/expense-forecasting` (gasto variable líquido por moneda) + `reporting/cash-flow-calendar` (banda de gasto predicho y probabilidad de déficit, sin cambiar riesgo ni alerta) + `reporting/dashboard` (Q3 con el gasto esperado y Q8 con la probabilidad) | 8 |
| 67 | `add-forecast-accuracy` | `forecast/expense-forecasting` (evaluación frente al real, indicadores, pérdida de precisión) + `reporting/financial-reports` (reporte 16 «Pronóstico vs real»; catálogo 16 de 16) | 8 |

Dependencias que fijan el orden: el 64 crea el contexto, el servicio, las corridas y la capability; el 65 agrega los modelos y la descomposición sobre ese camino; el 66 usa la serie por moneda y la proyección de compromisos del 65 y es el primero en que REPORTING lee FORECAST; el 67 necesita las corridas conservadas por periodo y conviene implementarlo con al menos 3 periodos de pronóstico real (pregunta 2). Se archivan en el mismo orden (todos agregan requirements a `forecast/expense-forecasting`). Las anomalías (FR-FORECAST-010) quedan propuestas para Phase 9 (pregunta 33).

**Despliegue N1, fase 0 (redactado el 2026-11-24).** Changes de los cambios de código del despliegue que cambian comportamiento ([cambios-de-codigo.md](despliegue/cambios-de-codigo.md)); preguntas al owner en [73-despliegue-n1-specs-questions.md](73-despliegue-n1-specs-questions.md) (3, ninguna bloquea el orden).

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 68 | `add-web-content-security-policy` | `security/access-control` (CSP con nonce por petición en `proxy.ts`, orígenes permitidos con el hostname de archivos, anti-clickjacking en todas las respuestas, estilos bajo la CSP, cabeceras complementarias en Caddy) — C13 | 9 |
| 69 | `add-host-restore-drill` | `platform/delivery-pipeline` (drill de restore mensual con aviso por heartbeat y su aislamiento, RPO y RTO del drill, verificación semanal de los repositorios, drill trimestral fuera del host, limpieza de imágenes, alerta de disco, clave privada de las conexiones solo en el worker) — C5, C6 y C10 | 9 |

Los dos van antes de los datos reales (fase 8 del runbook) y son independientes entre sí. El 69 depende de C3 (D455) solo en que la clave de B2 de solo lectura lea también el bucket de los mensuales.

**Phase 9 de producto (aprobada por D472 el 2026-11-25, [docs/77](77-phase-9-and-card-interest-decisions.md); preguntas en [docs/76](76-phase-9-and-card-interest-questions.md)).** Automatización avanzada e insights (docs/24 §5.9, EPIC-26) más la deuda que no depende de datos reales. En la columna «Fase», 9 es la Phase 9 del roadmap (los changes 68 y 69 llevan el 9 de la fase del runbook de despliegue). 70 a 76 y el 85 están redactados (70 a 73 ya fusionados; 70 archivado). Ninguno agrega consumidores ni conexiones (D249).

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 70 | `add-card-interest-ledger-portions` **(redactado)** | `debt/credit-cards` (7 ADDED: registro, anulación y adopción de intereses y cargos de tarjeta como gasto administrado con una porción por componente, propuesta desde la diferencia con el banco, permisos y export) + `transactions/transaction-recording` (1 ADDED: cargos administrados por la tarjeta) + `reporting/financial-reports` (3 MODIFIED: tipo «Tarjetas» en comisiones, interés cargado en deudas, identidad de reconciliación). Cierra el hallazgo de D372. Preguntas 1–5 (la 1 bloquea la implementación) | 9 |
| 71 | `fix-import-proposed-field-schema` **(redactado)** | `imports/import-pipeline` (1 ADDED: un esquema por tipo de campo en la propuesta de la vista previa; `oasdiff` limpio, verificado). Pregunta 6 | 9 |
| 72 | `add-spending-anomaly-detection` **(redactado)** | `forecast/anomaly-detection` (nueva, 13 ADDED: gastos atípicos por categoría y contraparte con mediana y MAD, contraparte nueva con monto alto, lista, marca y descarte, paso diario dentro de `forecasting.schedule` aun con los pronósticos deshabilitados, evaluación con el Large Seed en el nightly; FR-FORECAST-010, US-246) + `notifications/alerts` (2 ADDED: aviso apagado por omisión, emails sin montos). D473, D474, D475 y D483 | 9 |
| 73 | `add-category-suggestions` **(redactado)** | `classification/auto-classification` (nueva, 13 ADDED, implementada en RULES: sugerencia por historial con la `DescriptionKey` y por contraparte, confianza ≥ 0.70, en el alta manual y en la vista previa del import después de las reglas, aceptación explícita, tasa de aceptación y backtesting temporal en el nightly; FR-CLASSIFICATION-014, US-248) + `classification/counterparties` (1 MODIFIED: reemplaza a la última usada). D471, D476 y D477 | 9 |
| 74 | `add-budget-overrun-risk` **(redactado)** | `reporting/predictive-insights` (nueva, 10 ADDED: riesgo por línea con el ritmo del periodo, los pagos conocidos y la banda del pronóstico, fecha estimada, en el plan; evaluado en `reporting.cash-flow-watch`; FR-REPORTING-020, US-249) + `reporting/dashboard` (1 ADDED: Q5) + `notifications/alerts` (2 ADDED: aviso apagado por omisión). `planning/budgets` no cambia. D471 y D478 | 9 |
| 75 | `fix-phase-4-debt-followups` **(redactado)** | `transactions/transaction-recording` (1 ADDED: edición descriptiva de las administradas desde la pantalla), `reporting/cash-flow-calendar` (1 MODIFIED: rótulo «cuotas» con el origen del esperado, `expected.basis`), `reporting/dashboard` (2 ADDED: Q5 sin periodo y aviso de tarjetas sin pago programado, D491) e `imports/import-pipeline` (2 ADDED: muestra y mapeo sugerido al retomar, D492). `nextDueDate` y `overdueStatements[]` ya estaban resueltos. D481, respuestas del owner del 2026-11-25 y D489–D493 | 9 |
| 76 | `add-category-and-counterparty-merge` (Could) **(redactado)** | `classification/categories` (7 ADDED, con la continuidad de la historia en los análisis, D496), `classification/counterparties` (4 ADDED) y `audit/lifecycle-timeline` (1 ADDED): fusión síncrona con participantes por puerto, vista previa y periodos cerrados respetados (FR-CLASSIFICATION-007 y -013). D480 (pregunta 16, por omisión) y D494–D499 | 9 |
| 85 | `refine-spending-anomaly-calibration` **(implementado)** | `forecast/anomaly-detection` (5 MODIFIED: contraparte comparada dentro de su categoría principal, puntaje robusto 15 y percentil 99.5 por omisión, criterio de salida con el Large Seed a escala completa con precisión ≥ 0.80 y recall ≥ 0.85, rejilla con umbrales por argumento). Seguimiento del 72; se archiva después de él. D488; preguntas de [docs/80](80-anomaly-calibration-questions.md) contestadas en [docs/81](81-anomaly-calibration-decisions.md) (D513–D515) | 9 |

Dependencias que fijan el orden: 70 y 71 no dependen de datos reales ni entre sí (71 se archiva después de `add-import-pipeline`; 70 después de que `add-financial-reports-extended` esté archivado, como ya lo está). 72 usa las series por periodo de FORECAST (change 64) y se evalúa con las anomalías etiquetadas del Large Seed; 73 reutiliza la `DescriptionKey` de `add-rule-suggestions` y se archiva después de `add-rule-engine`; 74 lee el plan (PLANNING), los compromisos y, si está habilitada, la banda del change 66. Quedan en el backlog: automatizaciones encadenadas (US-251, D479), split por porcentajes (D398), commodities y valoración (D221) y MFA, retención y cadena de hashes de la auditoría, que pasan al Hito H (D482). 73 y 74 no dependen de 72 salvo en el valor por omisión por tipo de notificación, que introduce el primero que se implemente.

**Bloque de UI/UX (Modern Web Guidance; decidido por D500–D512 el 2026-11-25, [docs/79](79-ui-ux-modern-web-decisions.md); propuesta y viabilidad en [docs/78](78-propuesta-mejora-ui-ux-modern-web.md)).** Lotes L1–L7 de docs/78 § 8 más el change de navegación del cliente (P12). Solo tocan la capa interface de `apps/web`: sin migraciones, contratos, consumidores ni conexiones. Los implementa el agente `frontend` (D512). Es un bloque paralelo a Phase 9 de producto: la columna «Fase» dice «UI». Capability nueva `platform/web-interface` (ARCHITECTURE §14). 77 y 78 están redactados; los demás se redactan cuando toque implementarlos.

| Orden | Change | Capabilities y alcance | Depende de | Fase |
|---|---|---|---|---|
| 77 | `refine-web-accessibility-foundations` (L1, Must) **(redactado)** | `platform/web-interface` (nueva, 10 ADDED): foco al primer error y resumen de errores (M-01), validación de montos al salir (M-02), `ConfirmDialog` con `<dialog>` y `role="alertdialog"` (M-06), confirmaciones en línea con foco devuelto, movimiento reducido por componente (M-26), colores forzados (M-14), pestañas en una fila (M-15), Enter con composición (M-04) y WebKit en E2E condicionado al spike de la cookie (D509) | — | UI |
| 78 | `add-quick-capture` (L2, Must) **(redactado)** | `transactions/transaction-recording` (5 ADDED: monto primero, registrar y seguir, deshacer = anular, cuenta recordada por dispositivo, acceso «＋ Registrar») + `platform/web-interface` (1 ADDED: región de avisos). D502, D508, D510 | 77 (`useFocusFirstError`); se archiva después del 77 | UI |
| 79 | `add-dark-theme` (L3, Should) **(implementado, sin archivar hasta el 77)** | `platform/web-interface` (8 ADDED: tema del sistema, preferencia en Preferencias, primera pintura sin destello, marca al iniciar sesión, contraste en los dos temas, colores solo desde el tema, `theme-color` e impresión en claro): tokens oscuros con `@media (prefers-color-scheme)` + `:root[data-theme]` (sin `light-dark()`), `preferences.theme` de `/me` sin cambio de contrato, cookie espejo `pfos_theme` emitida también por el BFF en el callback de login, `generateViewport`, migración de los 29 hexadecimales y del bloque `.pf-home` (M-20, M-21, M-22). D501; preguntas 1 a 3 de [docs/82](82-ui-lotes-l3-l5-questions.md) (no bloquean) | 77 | UI |
| 80 | `refine-mobile-navigation` (L4, Should) **(redactado)** | `platform/web-interface` (8 ADDED): barra inferior de 5 destinos y cajón «Más» en `<dialog>` con los grupos de docs/28 (M-11), barra lateral agrupada, `dvh`, `safe-area` y `scroll-padding-bottom` (M-12), barra oculta con `:has()` al escribir y en `/transacciones/nueva`, barra superior de una fila (M-13), menú de usuario con popover (M-08), entrada y salida de la capa superior (M-27). D503; preguntas 4 a 6 de [docs/82](82-ui-lotes-l3-l5-questions.md) (la 4 y la 5 bloquean tareas de este change) | 78 (botón ＋) | UI |
| 81 | `refine-data-tables` (L5, Should) **(redactado)** | `platform/web-interface` (12 ADDED): región con nombre y foco en todas las tablas y cabecera fija solo con `max-block-size`, `border-collapse: separate` e impresión (M-16), sin vista apilada, pista de desplazamiento (M-17), orden por columna (M-18), `<meter>`/`<progress>` (M-10), medición de INP (M-30) y vista previa del import por páginas si la medición lo confirma (M-19; sin `content-visibility` en filas) y el desbordamiento de ~250 px del detalle de préstamo a 360 px (`loan-balances`, hallazgo del 77). Pregunta 7 de [docs/82](82-ui-lotes-l3-l5-questions.md) (no bloquea) | 77 | UI |
| 82 | `add-pwa-install` (L6, Could) | `platform/web-interface`: manifiesto, íconos y botón «Instalar» solo con `beforeinstallprompt`, sin service worker (M-33, M-22). D504 | 79 (`theme-color` por esquema); dominio público definitivo (M-34) e íconos diseñados | UI |
| 83 | `refine-perceived-performance` (L7, Could) | `platform/web-interface`: transiciones en el mismo documento (M-28), pausa de sondeos en segundo plano (M-31), toggletips (M-09), tipografía (M-23, M-24) y `field-sizing` (M-05). **Sin M-29** mientras no se resuelva el 84 (D511) | 81 (resultado de M-30) | UI |
| 84 | `adopt-client-navigation` (P12) | `platform/web-interface`: `next/link` con un `AppLink` común (203 anclas, 12 `location.assign`) y specs E2E que esperan contenido propio en vez de `ready`. Al cerrarlo se decide si M-29 aplica. D511 | 81 (medición de INP y navegación) | UI |
| 86 | `add-e2e-https` **(implementado 2026-11-27)** | `platform/local-environment` (3 ADDED: stack de E2E por HTTPS con autoridad efímera, aislamiento de la corrida con prefijo 3 o 4, stack de desarrollo sin cambios) y `platform/delivery-pipeline` (1 ADDED: WebKit dentro del job `e2e` sin check obligatorio nuevo). Proxy TLS con Caddy delante de la web, Keycloak y la subida de archivos; la cookie no cambia. Automatiza TC-PLATFORM-WEBUI-019 y -020 del 77. D516 ([docs/84](84-webkit-e2e-questions.md)) | 77 | UI |

Dependencias que fijan el orden: 77 va primero porque crea la capability y las utilidades comunes (foco al error, `ConfirmDialog`); 78 solo necesita `useFocusFirstError`. 79 y 81 dependen solo de 77 y pueden ir en paralelo con 78. 80 necesita el botón ＋ de 78. 82 espera el tema (79), el dominio definitivo y los íconos. 83 y 84 esperan la medición de M-30 del 81; 84 puede adelantarse a 82 y 83 si la medición muestra que la recarga por documento es el cuello de botella. 86 (D516) solo depende del 77 y puede ir en paralelo con los demás; cierra las tareas de WebKit que el 77 dejó abiertas.


Dependencias que fijan el orden: el throughput va primero porque cambia el perfil de eventos de los imports; la escritura por lote antes del pipeline (NFR-PERF-007); los documentos antes de la etapa de subida del pipeline (sus parsers pueden avanzar con fixtures); el motor de reglas (55, `add-rule-engine`: contexto `@pf/rules` sin consumidores de eventos nuevos) expone `RuleEvaluationQuery` a la etapa de clasificación y puede implementarse antes o en paralelo del pipeline, pero la medición del 70 % de Phase 6 requiere ambos (D334); los proveedores bancarios entran por la normalización del pipeline. El parser de PDF (57, D324) entra por la etapa de lectura del pipeline: requiere aplicados `add-document-attachments` y `add-import-pipeline` y se archiva después de este (su delta modifica un requirement que agrega el 54).

**`add-banking-providers` (56, implementado 2026-11-04).** El núcleo (puerto, conexiones, cifrado de sobre, solo lectura, revocación, sincronización) y su integración con el pipeline están probados con el proveedor simulado; los adapters reales de Binance y Bybit (archivo y API) esperan la puerta del owner (grupo 9, ADR-0031 propuesto).

Orden de implementación de Phase 6: `optimize-consumer-throughput` → `add-bulk-imported-transactions` → `add-document-attachments` y `add-rule-engine` → `add-import-pipeline` → `add-banking-providers` → parser de PDF. `add-import-pipeline` se archiva después de `add-bulk-imported-transactions` (ambos tocan `imports/import-pipeline`, con requirements distintos).


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
