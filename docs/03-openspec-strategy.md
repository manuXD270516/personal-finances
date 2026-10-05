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
| 14 | `add-budgets` | `planning/budgets` (plan mensual por periodo, tipos fixed/maximum Must, minimum/range/rollover/% de ingresos Should, base cero y tag Could; presupuesto vs real en moneda base con la valoración de flujos de Reporting, D29/D34/D53; umbrales emitidos una sola vez con `planning.BudgetThresholdReached.v1`). Requiere `add-financial-periods` | 2 |
| 15 | `add-budget-templates` | `planning/budget-templates` (templates versionados inmutables, plan desde template o clonando el periodo anterior, template predeterminado aplicado a los periodos nuevos, edición local y propagación a futuro con vista previa) | 2 |
| 16 | `add-alerts` | `notifications/alerts` (centro in-app, umbral de presupuesto y cierre pendiente, deduplicación por hecho, email vía `EmailSender` —Mailpit en local/CI— entregado una sola vez y sin montos salvo opt-in, i18n es/en/pt, preferencias y horario de silencio) | 2 |

Los changes 1–10 (más el 9b, agregado el 2026-10-02 por decisión del owner, docs/31 D29, y el 2b `add-event-outbox`, agregado el 2026-10-03, docs/31 D30; los 11 `add-lifecycle-timeline` y 12 `add-demo-data` se agregaron el 2026-10-03 por decisión del owner, docs/31 D37 y D36) se redactaron **después** de aprobar el DESIGN GATE (sección 56 del brief), reutilizando FR, invariantes y TCs ya diseñados en Phase 0. La columna **Orden** es el orden de **implementación** (cada change se aplica sobre los anteriores), fijado en [31-phase-1-consolidation-decisions.md](31-phase-1-consolidation-decisions.md) (D24).

**Phase 2 — periodos y cierre (borrador del 2026-10-05, pendiente de consolidar con los demás changes de Phase 2):**

| Orden | Change | Capabilities | Fase |
|---|---|---|---|
| 13 | `add-financial-periods` | `planning/financial-periods` (periodos mensuales según el día de inicio del mes financiero, creación automática con anticipación, ciclo `draft/active/closed/reopened`, activación por zona horaria del workspace, guard de planificación para el plan mensual) | 2 |
| 13b | `add-month-closing` | `planning/month-closing` (checklist, cierre atómico con bloqueo del ledger, snapshot inmutable y versionado, reapertura por el OWNER, reporte y exportación) + `ledger/journal-posting` (bloqueo por rango del periodo financiero, ADR-0028 propuesto) + `audit/lifecycle-timeline` (recorrido del periodo). Se aplica **después** de la reconciliación completa de Phase 2 (`transactions/reconciliation`), de la que depende el ítem de cuentas conciliadas y el criterio de salida | 2 |

Los presupuestos y templates (`planning/budgets`, `planning/budget-templates`) cuelgan su plan mensual de los periodos de `add-financial-periods`, por lo que se aplican después de él; el orden definitivo de todos los changes de Phase 2 lo fija el lead al consolidar.
**Phase 2 (2026-10-05):** los changes 14–16 (planificación de presupuestos y alertas; el 13 queda reservado para `add-financial-periods`) se redactaron en paralelo con los demás changes de Phase 2 (periodos financieros y cierre de mes; reconciliación, edición masiva, custom fields, export de workspace, evolución del patrimonio y auditoría global). Orden relativo obligatorio: `add-financial-periods` → `add-budgets` → `add-budget-templates` → `add-alerts`; `add-month-closing` va después de `add-budgets` (congela su presupuesto vs real en el snapshot) y publica el hecho de cierre pendiente que consume `add-alerts`. La numeración definitiva de Phase 2 se consolida al integrar los changes hermanos.

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
