# Propuesta: add-budget-templates

## Why

Rearmar el presupuesto cada mes desde cero es la fricción que hace abandonar la planificación (RISK-025). docs/24 §5.2 incluye en Phase 2 los "templates versionados" y FR-PLANNING-009..014 (docs/01 §8.2) piden: templates cuya modificación crea versiones inmutables, planes creados desde una versión o clonando el mes anterior, edición local del plan sin tocar el template y propagación a meses futuros en borrador con vista previa, nunca a meses cerrados. Este change especifica la capability `planning/budget-templates` sobre el plan mensual de `add-budgets` y los periodos de `add-financial-periods`, de modo que cada periodo nuevo nace con su plan desde el template predeterminado ("templates aplicados a los periodos nuevos") y queda trazable a la versión de la que se originó.

## What Changes

- **Templates versionados** (`BudgetTemplate` + `BudgetTemplateVersion` inmutable): crear (versión 1), modificar = nueva versión completa con nota de cambio y control de concurrencia (`CONCURRENCY_CONFLICT`), nombre único entre activos (`NAME_TAKEN`), archivar (nunca borrar; `BUDGET_TEMPLATE_ARCHIVED` al aplicar uno archivado), clonar como template independiente (Should).
- **Crear el plan de un periodo** desde una versión de template (por defecto la última) o **clonando el plan del periodo anterior**; el plan guarda template y versión de origen (o el plan de origen). Líneas con objetivos archivados se omiten y se informan.
- **Template predeterminado** (a lo sumo uno): al crearse un periodo nuevo (creación automática de `add-financial-periods`) se crea su plan desde la última versión del predeterminado, una sola vez.
- **Modificar solo el plan actual:** las ediciones del plan no tocan el template ni otros periodos; la línea queda marcada como modificada.
- **Aplicar a futuro** (Should): vista previa con diferencias por periodo y línea, confirmación que crea una versión nueva del template y actualiza solo planes de periodos **futuros en borrador**, sin sobrescribir líneas modificadas a mano (conflictos informados); `BUDGET_PROPAGATION_STALE` si algo cambió entre vista previa y confirmación.
- Permisos (VIEWER lee; EDITOR/OWNER escriben) y auditoría síncrona.
- **Fuera de alcance:** el plan, tipos de línea, progreso y umbrales (`add-budgets`); periodos y su creación automática (`add-financial-periods`); crear un template a partir de un plan existente ("guardar como template", pregunta 2); templates multi-moneda; recorrido de ciclo de vida de templates (pregunta 5); aportes a metas/deudas/compromisos en templates (Phases 3–4).

## Capabilities

### New Capabilities
- `planning/budget-templates`: templates versionados, creación del plan desde template o clonado, template predeterminado para periodos nuevos, edición local y propagación a futuro con vista previa (12 requirements: 8 Must, 4 Should).

### Modified Capabilities
- Ninguna. (Usa el plan de `planning/budgets` — change `add-budgets`, aún no archivado — agregando los orígenes `TEMPLATE`/`CLONE_PREVIOUS` a la creación de planes y la marca de línea modificada; ver design.md.)

## Impact

**Specs impactadas:** crea `planning/budget-templates`. Depende de `planning/budgets` (`add-budgets`) y `planning/financial-periods` (`add-financial-periods`, sibling pf-p2a); lee `classification/categories` y `classification/tags` (objetivos archivados), `audit/audit-trail`, `security/access-control`.

**Componentes/contextos impactados:** Planning (`@pf/planning`): domain AR `BudgetTemplate` con versiones inmutables, VO `TemplateLineSpec` (mismo formato que `BudgetLine`), DS `BudgetFromTemplateFactory`, `BudgetCloner`, `PropagationPlanner` (diff + conflictos + token); application `CreateTemplate`, `PublishTemplateVersion`, `CloneTemplate`, `ArchiveTemplate`/`UnarchiveTemplate`, `SetDefaultTemplate`, `CreateBudget` ampliado (`TEMPLATE`, `CLONE_PREVIOUS`), `PreviewPropagation`, `ConfirmPropagation`, hook `PeriodCreatedHook` (aplicación del predeterminado); infrastructure repositorios Kysely. `apps/api` (controller `templates`, `budget-propagations`), `apps/web` (pantalla Templates, selector de origen al crear plan, diálogo de vista previa).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — nuevas `GET/POST W/templates`, `GET W/templates/{templateId}`, `GET W/templates/{templateId}/versions/{versionNo}`, `POST W/templates/{templateId}/versions`, `POST W/templates/{templateId}/clone`, `POST W/templates/{templateId}/archive|unarchive|set-default`, `POST W/templates/{templateId}/apply`, `POST W/budget-propagations/preview`, `POST W/budget-propagations/confirm`; `POST W/budgets` acepta `source.kind` `TEMPLATE` y `CLONE_PREVIOUS`; códigos `BUDGET_TEMPLATE_ARCHIVED`, `BUDGET_PROPAGATION_STALE`, `BUDGET_NO_TEMPLATE_ORIGIN`. Detalle en design.md § Contratos.

**Tablas impactadas:** nuevas `planning.budget_template`, `planning.budget_template_version`, `planning.budget_template_line` (versiones y líneas inmutables, WS-RO); FKs nuevas `planning.budget.template_version_id` y `planning.budget_line.template_line_id`; escritura de `planning.budget`/`budget_line` (de `add-budgets`).

**Eventos impactados:** ninguno nuevo. `planning.BudgetCreated.v1` (de `add-budgets`) se emite con `origin` `TEMPLATE`/`CLONE` y `templateId`/`templateVersionNo`/`clonedFromBudgetId`.

**Migraciones requeridas:** expand, no destructiva: tres tablas nuevas con RLS forzada y grants (`budget_template_version` y `budget_template_line` solo `SELECT, INSERT` + `platform.forbid_mutation()`); índice único parcial de predeterminado; FKs nuevas `NOT VALID` + `VALIDATE` sobre columnas nulas de `add-budgets`; registro en `platform.workspace_scoped_table`.

**Test cases:** AÑADIDOS — TC-PLANNING-TEMPLATE-001..019 (19). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** `CreateBudget` gana dos orígenes; los TC de `add-budgets` (origen `EMPTY`) no cambian. `UpdateBudgetLine` marca `overridden` en líneas originadas en template o clonado (campo nuevo, aditivo). La creación automática de periodos (pf-p2a) pasa a crear planes cuando hay predeterminado: su test de idempotencia debe seguir en verde.

**Riesgos introducidos:** RISK-005 (propagación con conflictos es la parte más compleja: Should, implementable al final y desactivable), RISK-020 (periodo "anterior" y "futuro" según el rango de periodos con día de inicio configurable), RISK-004 (alcance: Should separados en su propio grupo de tareas).

**Invariantes afectadas:** INV-001, INV-002, INV-003, INV-015 (nunca se modifican planes de periodos cerrados), INV-025, INV-029. Ninguna escritura en el ledger.
