# Tareas

> Requiere aplicados: `add-budgets` y **`add-financial-periods`** (Phase 2, sibling pf-p2a), además de `add-classification`, `add-audit-trail` y `add-api-conventions`. No iniciar la implementación con preguntas abiertas de design.md sin resolver que afecten el grupo (docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner la spec `planning/budget-templates` y las preguntas abiertas 1–6 de design.md (resueltas por el owner el 2026-10-08, docs/33); verificar con `openspec validate add-budget-templates --strict`
  - 2026-10-08: preguntas abiertas 1–6 resueltas por el owner (docs/33: D84 propagar desde un plan sin template ⇒ `BUDGET_NO_TEMPLATE_ORIGIN` y "crear template con estas líneas"; D79 líneas de otra moneda omitidas con `CURRENCY_MISMATCH`; D85 líneas quitadas del template solo si no se editaron; D86 solo periodos `DRAFT` con inicio posterior a hoy; D110 sin recorrido de ciclo de vida; pregunta 1: `PeriodCreatedHook` síncrono, sin decisión adicional); `openspec validate add-budget-templates --strict` verde (`pnpm spec:validate`).
- [x] 1.2 Revisar TC-PLANNING-TEMPLATE-001..019 contra los scenarios (fechas fijas, `FixedClock`); pasar a `ready`/`confirmed` tras la revisión; `pnpm traceability:check` sin requirements Must sin TC
  - 2026-10-08: TC-PLANNING-TEMPLATE-001..019 revisados contra los scenarios (cifras a mano: 2800.00 / 1500.00 → 1600.00 / 8000.00; 600.00 → 650.00 con 700.00 conservado; 2800.00 → 2900.00 solo en borrador) con `FixedClock`; pasan a `automated` con sus tests; `pnpm traceability:check` verde.
- [x] 1.3 Verificar contra `add-financial-periods` (contrato consolidado el 2026-10-05: declara e invoca `PeriodCreatedHook` en la Unit of Work de `EnsurePeriods`, expone `PeriodQuery.getPrevious` y `listPeriods(status=DRAFT)`) que el participante de este change cumple el contrato
  - 2026-10-08: verificado contra `add-financial-periods` (archivado): `PeriodsService.ensurePeriods` invoca `PeriodCreatedHook` por cada periodo insertado, dentro de su unidad de trabajo (una excepción revierte la creación); `PeriodQuery.getPrevious`/`listPeriods(status=DRAFT)` existen. El participante (`TemplatePeriodHook`) se registra en `createPlanningRuntime` junto con los presupuestos y es idempotente (TC-PLANNING-TEMPLATE-010/-011 con PG real en `apps/api/test/api/templates.api.test.ts`).

## 2. DOMAIN (TDD)

- [x] 2.1 `BudgetTemplate` con versiones inmutables, nombre único, concurrencia por `baseVersionNo`, archivado y predeterminado: tests primero de TC-PLANNING-TEMPLATE-001, -002, -003, -012, -018
  - 2026-10-08: AR `BudgetTemplate` + `buildTemplateLines` (domain/budget-template.ts): versión = instantánea completa, nombre único, `CONCURRENCY_CONFLICT`, archivar/predeterminado; las líneas idénticas a la versión base se conservan aunque su objetivo se archive después (solo las nuevas o cambiadas rechazan objetivos archivados). Tests TC-001/-002/-003/-012/-018 en `templates.service.test.ts` (dobles) y `pg-templates.int.test.ts` (inmutabilidad, un solo predeterminado bajo concurrencia).
- [x] 2.2 `BudgetFromTemplateFactory` y `BudgetCloner` (copia, omitidas por objetivo archivado o moneda, herencia de `template_version_id`, sin cruces): tests primero de TC-PLANNING-TEMPLATE-004, -005, -007, -008
  - 2026-10-08: `BudgetFromTemplateFactory` y `BudgetCloner` (domain/budget-from-template.ts): copia, omitidas `TARGET_ARCHIVED`/`CURRENCY_MISMATCH`, herencia de `templateVersionId`, sin cruces ni remanente; `Budget.create` acepta origen y `seedLines`. Tests TC-004/-005/-007/-008 en `templates.service.test.ts`.
- [x] 2.3 `PropagationPlanner` (alcance solo futuros `draft`, diff ADD/UPDATE/REMOVE/CONFLICT, token de hash): tests primero de TC-PLANNING-TEMPLATE-015, -016, -017; PBT: ninguna secuencia de propagaciones cambia un plan de periodo no `draft` ni una línea `overridden`
  - 2026-10-08: `diffTemplates` + `PropagationPlanner` (domain/propagation-planner.ts): `ADD`/`UPDATE`/`REMOVE` y conflictos (`OVERRIDDEN`, `MANUAL_LINE`, `TARGET_OVERLAP`, `CURRENCY_MISMATCH`); token sha256 en `PropagationService`. TC-015/-016/-017 y PBT (fast-check, secuencias de propagaciones con periodos en estados aleatorios: ningún plan no `DRAFT` ni línea modificada cambia) en `propagation.service.test.ts`.

## 3. APPLICATION

- [x] 3.1 Comandos `CreateTemplate`, `PublishTemplateVersion`, `CloneTemplate`, `ArchiveTemplate`/`UnarchiveTemplate`, `SetDefaultTemplate` con auditoría y roles; tests con dobles de TC-PLANNING-TEMPLATE-014 y -019
  - 2026-10-08: `TemplatesService` (`createTemplate`, `publishVersion`, `cloneTemplate`, `archive`/`unarchive`, `setDefault` con candado consultivo) con auditoría `BudgetTemplate` en la misma transacción; roles por contrato (`x-required-role`). Tests TC-014 y TC-019 (dobles y API).
- [x] 3.2 `CreateBudget` con orígenes `TEMPLATE`/`CLONE_PREVIOUS` y marca `overridden` en ediciones del plan (`add-budgets`): tests de TC-PLANNING-TEMPLATE-006, -009, -013
  - 2026-10-08: `BudgetsService.createBudget` con `source` `EMPTY`/`TEMPLATE {templateId, versionNo?}`/`CLONE_PREVIOUS` (`omittedLines`, `BUDGET_TEMPLATE_ARCHIVED`, `REFERENCE_NOT_FOUND`); `BudgetLine.withSpec` ya marcaba `overridden` en líneas de origen template/clon (add-budgets). Tests TC-006/-009/-013.
- [x] 3.3 `PeriodCreatedHook` (predeterminado ⇒ plan, idempotente): tests de TC-PLANNING-TEMPLATE-010 y -011 integrados con la creación automática de periodos de pf-p2a
  - 2026-10-08: `TemplatePeriodHook` → `BudgetsService.applyDefaultTemplate` (predeterminado activo y periodo sin plan ⇒ plan `TEMPLATE` con la última versión; idempotente). Tests TC-010/-011 con `PeriodsService` y dobles (`period-created.hook.test.ts`) y con PG real y el rol del worker (`templates.api.test.ts`; la migración da `SELECT (base_currency)` a `pf_workspace_directory` y `identityWorkspaceSettingsDirectory` lo lee).
- [x] 3.4 `PreviewPropagation`/`ConfirmPropagation` (una transacción, recomputar y comparar token, versión N+1, actualizar planes alcanzados)
  - 2026-10-08: `PropagationService.preview`/`confirm`: vista previa sin estado con token sha256 (versión vigente, planes alcanzados con su versión, instantánea nueva); `confirm` en una transacción: bloquea template y planes (periodo → plan), recalcula, compara el token (`BUDGET_PROPAGATION_STALE`), publica N+1 y actualiza los planes alcanzados (también su `template_version_id`).

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand de `planning.budget_template`, `budget_template_version`, `budget_template_line` (RLS forzada, WS-RO con `forbid_mutation`, índices parciales) y FKs `NOT VALID`+`VALIDATE` hacia `planning.budget`/`budget_line`; registro en `platform.workspace_scoped_table`; tests de integración: inmutabilidad de versiones (UPDATE/DELETE fallan con `PF003`), un solo predeterminado bajo concurrencia, aislamiento entre workspaces
  - 2026-10-08: migración `20261008160000_planning_budget_templates.sql` (expand): `budget_template` (únicos parciales de nombre activo y de predeterminado), `budget_template_version` y `budget_template_line` WS-RO con `forbid_mutation`, FKs `NOT VALID` + `VALIDATE` desde `budget.template_version_id` y `budget_line.template_line_id`, registro en `platform.workspace_scoped_table` (151–153). Integración (`pg-templates.int.test.ts`): UPDATE/DELETE/TRUNCATE (42501 para `pf_app`, PF003 para el owner), un solo predeterminado bajo concurrencia, aislamiento entre workspaces.
- [x] 4.2 Repositorios Kysely y adapters (`PeriodQuery`, estado de objetivos de Classification)
  - 2026-10-08: `PgBudgetTemplateRepository` (infrastructure/pg-templates.ts), `PgBudgetRepository.listByTemplate` y persistencia de `template_version_id`; adapters existentes de `PeriodQuery`/estado de objetivos (`CategoryCatalogQuery.categoryTree`).

## 5. API

- [x] 5.1 Endpoints de design.md § Contratos (`templates`, `budget-propagations`, `source` ampliado de `createBudget`) con `Idempotency-Key` y problem+json; tests de API con TC-PLANNING-TEMPLATE-001, -004, -006, -016, -018, -019 y validación contra el OpenAPI consolidado
  - 2026-10-08: controller `templates` + `budget-propagations` (`templates-http.ts`, `DELETE` ⇒ 405) y contrato consolidado en `contracts/openapi/finance-api.v1.yaml` (aditivo): Spectral 0 errores, Redocly válido y `pnpm contract:breaking` sin rupturas; códigos `BUDGET_TEMPLATE_ARCHIVED`, `BUDGET_PROPAGATION_STALE`, `BUDGET_NO_TEMPLATE_ORIGIN` en `ErrorCode`; `BudgetCreated.v1` con ejemplos `TEMPLATE` y `CLONE`. Tests de API con PG real (`templates.api.test.ts`): TC-001/-003/-004/-006/-010/-011/-014/-015/-016/-018/-019 validados contra el OpenAPI.

## 6. UI

- [x] 6.1 Pantalla "Templates" (lista, versiones con nota de cambio, comparar versiones, clonar, archivar, predeterminado) y selector de origen al crear el plan (vacío / template y versión / clonar mes anterior) con aviso de líneas omitidas; textos vía i18n
  - 2026-10-08: pantalla `/planificacion/templates` (`TemplatesPage`: lista con predeterminado en texto, versiones con nota de cambio, comparación de versiones, borrador de versión nueva reutilizando `BudgetLineForm`, clonar, archivar con confirmación, predeterminado) y selector de origen del plan (`PlanOriginPanel`: vacío / template y versión / clonar mes anterior) con aviso de líneas omitidas (`OmittedLinesNotice`) y origen del plan. Textos en `Templates` y `Budgets` (es/en/pt).
- [x] 6.2 Diálogo "Aplicar a meses futuros" con vista previa (cambios y conflictos por periodo) y manejo de `BUDGET_PROPAGATION_STALE` (recargar vista previa)
  - 2026-10-08: `PropagationPanel` (vista previa por periodo con cambios y conflictos, `BUDGET_PROPAGATION_STALE` ⇒ "Actualizar la vista previa") desde el borrador del template y desde un plan con origen (`PlanTemplateActions`); sin origen ofrece "Crear template con estas líneas" (D84, `createTemplate`).

## 7. TESTS automatizados y E2E

- [x] 7.1 E2E Playwright: crear "Mes estándar", marcarlo predeterminado, crear el periodo siguiente y verificar su plan; editar el plan sin afectar el template; propagar un cambio con vista previa
  - 2026-10-08: `tests/e2e/specs/templates.spec.ts` (PF_E2E_PROJECT=pfos-e2e-tpl, puertos 4xxxx): crea "Mes estándar" con dos líneas y publica la versión 2 con nota "Inflación", lo marca predeterminado, crea periodos nuevos y verifica que nacen con su plan (origen "Mes estándar, versión 2"), edita el plan sin tocar el template (línea `overridden`), propaga un cambio con vista previa (un conflicto y un cambio por plan futuro en borrador) y confirma (versión 3); clonar y archivar en un segundo test. Axe sin violaciones serias (también en a11y.spec.ts) y 360 px sin scroll horizontal. Suite completa: 51 pruebas verdes.
- [x] 7.2 Test de integración de la creación automática de periodos con predeterminado ejecutada dos veces (TC-PLANNING-TEMPLATE-011) contra PostgreSQL real
  - 2026-10-08: TC-PLANNING-TEMPLATE-010/-011 contra PostgreSQL real con el rol del worker (`apps/api/test/api/templates.api.test.ts`: el job crea "2027-03" con el plan del predeterminado y la segunda ejecución no crea nada ni duplica el plan) y con dobles (`period-created.hook.test.ts`).

## 8. DOCUMENTACIÓN y cierre

- [x] 8.1 Actualizar docs/04 §3.6 (`BudgetTemplate`, `TemplateLineSpec`), docs/08 §5.6 (tablas as-built, `target_kind/target_id`, sin `effective_from`), docs/10 (rutas `templates`/`budget-propagations` y errores) y docs/25 (US-103..108)
  - 2026-10-08: docs/04 §3.6 (`BudgetTemplate`, `TemplateLineSpec`, orígenes del plan, propagación), docs/08 §5.6 (tablas as-built con `target_kind/target_id`, sin `effective_from`, grants), docs/10 (rutas `templates`/`budget-propagations` y errores `BUDGET_TEMPLATE_ARCHIVED`/`BUDGET_PROPAGATION_STALE`/`BUDGET_NO_TEMPLATE_ORIGIN`), docs/11 y docs/25 (US-103..108 as-built); README de `@pf/planning`.
- [x] 8.2 Actualizar estados de automatización de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict` y `pnpm traceability:check`
  - 2026-10-08: estados de los 19 TC pasados a `automated` con sus tests; `pnpm traceability:check` verde (569 TC, 482 requirements); `pnpm spec:validate` (`openspec validate --all --strict`) 40/40 verde; `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm test:integration`, `pnpm arch:check`, `pnpm config:docs:check`, `pnpm contract:breaking` (sin rupturas) y Spectral (0 errores) verdes.
