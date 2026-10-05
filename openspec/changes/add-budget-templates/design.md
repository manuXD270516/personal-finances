# Diseño

## Contexto

docs/05 §3 (fusiones de ARCHITECTURE §3) ubica los templates **dentro de PLANNING** ("una plantilla solo tiene sentido como origen de un `Budget`; comparten lenguaje y ciclo"). docs/04 §3.6 define el AR `BudgetTemplate {id, name, currentVersionNo, versions: BudgetTemplateVersion[] (inmutables)}` y el DS `BudgetFromTemplateFactory`; docs/08 §5.6 las tablas `budget_template`, `budget_template_version` (WS-RO) y `budget_template_line` (WS-RO), con `budget.template_version_id` para trazabilidad. Este change las implementa sobre el plan de `add-budgets` y los periodos de `add-financial-periods`. Motivación: proposal.md — Why.

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Planning | AR `BudgetTemplate {id, workspaceId, name, description?, isDefault, status (ACTIVE\|ARCHIVED), currentVersionNo, version}`; entidad inmutable `BudgetTemplateVersion {versionNo, basedOnVersionNo?, changeNote?, createdAt, createdBy, lines: TemplateLineSpec[]}`; VO `TemplateLineSpec` (objetivo, naturaleza, tipo, montos, %, base de ingresos, rollover, umbrales, moneda — el mismo valor que valida `BudgetLine` en `add-budgets`) | domain | Nuevo |
| Planning | DS `BudgetFromTemplateFactory` (copia + omitidas), `BudgetCloner` (copia del plan anterior), `PropagationPlanner` (diff por periodo/línea, conflictos por `overridden`, token de vista previa) | domain | Nuevo |
| Planning | `CreateTemplate`, `PublishTemplateVersion`, `CloneTemplate`, `ArchiveTemplate`, `UnarchiveTemplate`, `SetDefaultTemplate`, `CreateBudget` (orígenes `TEMPLATE`/`CLONE_PREVIOUS`), `PreviewPropagation`, `ConfirmPropagation`; `PeriodCreatedHook`; queries `ListTemplates`, `GetTemplate`, `GetTemplateVersion` | application | Nuevo / ampliado |
| Planning | Puertos `PeriodCatalog` (periodo anterior y periodos futuros en borrador; `add-financial-periods`), `CategoryTreeQuery`/`TagCatalogQuery` (estado de objetivos; Classification), `AuditPort`, `Clock`, `UnitOfWork` | application/infrastructure | Adapters |

## Objetivos / No objetivos

**Objetivos:** versionado inmutable verificable; creación de planes desde template/clonado trazable al origen; aplicación automática del predeterminado a periodos nuevos, idempotente; propagación segura (solo futuros en borrador, sin pisar ediciones manuales, con vista previa y detección de cambios).

**No objetivos:** "guardar plan como template" (pregunta 2), templates multi-moneda, merge de versiones, recorrido de ciclo de vida de templates (pregunta 5).

## Decisiones

1. **Versión = instantánea completa.** `PublishTemplateVersion(templateId, baseVersionNo, lines[], changeNote?)` crea `versionNo = currentVersionNo + 1` con el conjunto completo de líneas (no un diff), validado con las mismas reglas de `add-budgets` (montos, moneda base, escala, tipos, umbrales, objetivos no duplicados ni solapados; objetivos archivados se rechazan al **crear** una versión con `CATEGORY_ARCHIVED`). `baseVersionNo ≠ currentVersionNo` ⇒ `CONCURRENCY_CONFLICT` (409). Versiones y líneas son WS-RO (sin `UPDATE`/`DELETE`; `platform.forbid_mutation()`), así que la inmutabilidad la garantiza la BD.
2. **Origen del plan.** `POST W/budgets` acepta `source: {kind: EMPTY} | {kind: TEMPLATE, templateId, versionNo?} | {kind: CLONE_PREVIOUS}` (y `POST W/templates/{id}/apply {periodId, versionNo?}` como atajo). `TEMPLATE` sin versión ⇒ `currentVersionNo` leído en la misma transacción. El plan guarda `origin`, `template_version_id`; cada línea guarda `source` (`TEMPLATE|CLONE|MANUAL`) y `template_line_id`. Template archivado ⇒ `BUDGET_TEMPLATE_ARCHIVED` (409); periodo con plan ⇒ `BUDGET_ALREADY_EXISTS` (regla de `add-budgets`).
3. **Omitidas.** Al copiar (template o clonado), una línea cuyo objetivo está archivado — o cuya moneda ya no es la del plan (cambio de moneda base, pregunta 3) — se omite y se devuelve en `omittedLines[] {target, reason: TARGET_ARCHIVED|CURRENCY_MISMATCH}`; la operación no falla y el origen no cambia. Las omisiones van al audit log.
4. **Clonado del periodo anterior.** "Anterior" = el periodo cuyo `period_end` es el día previo al `period_start` del destino (`PeriodCatalog.previousOf`), respetando el día de inicio configurable. Se copian objetivo, tipo, montos, umbrales, rollover, `overridden` y `template_line_id`; el plan nuevo hereda `template_version_id` del anterior (para que la propagación lo alcance) y registra `cloned_from_budget_id`. No se copian cruces (son por periodo) ni gastado (derivado); `rolloverIn` se recalcula (decisión 10 de `add-budgets`). Sin plan anterior ⇒ `REFERENCE_NOT_FOUND` (422).
5. **Predeterminado y periodos nuevos.** Índice único parcial `(workspace_id) WHERE is_default AND status = 'ACTIVE'`; `SetDefaultTemplate` desmarca el anterior en la misma transacción; archivar desmarca. `PeriodCreatedHook.onPeriodCreated(period, uow)` es invocado **síncronamente** por el comando de creación de periodos de `add-financial-periods` dentro de su unidad de trabajo (mismo bounded context; mismo patrón que la provisión síncrona del catálogo, docs/31 D54): si hay predeterminado activo y el periodo no tiene plan, crea el plan `TEMPLATE` con la última versión. La unicidad `(workspace_id, period_id)` de `planning.budget` + "si ya existe, no hacer nada" lo hacen idempotente ante reintentos. Alternativa: consumir un evento `planning.PeriodCreated.v1` (pregunta 1).
6. **Edición local.** `UpdateBudgetLine`/`RemoveBudgetLine`/`AddBudgetLine` de `add-budgets` nunca tocan templates; editar una línea con `source ∈ {TEMPLATE, CLONE}` pone `overridden = true` (una línea agregada a mano es `MANUAL`).
7. **Propagación (Should).** `PreviewPropagation({source: {kind: TEMPLATE, templateId, baseVersionNo, lines[]} | {kind: BUDGET, budgetId, lineIds[]}})`: el origen `BUDGET` toma de ese plan las líneas indicadas y su template de origen (si el plan no tiene template de origen ⇒ `BUDGET_NO_TEMPLATE_ORIGIN` 422). Alcance = planes con `template_version_id` de ese template cuyos periodos son **posteriores** al periodo del plan origen (o a "hoy" si el origen es el template) y están en estado `draft`. Por cada plan y objetivo: `ADD`, `UPDATE` (de → a), `REMOVE` o `CONFLICT` (línea `overridden`, no se toca). Respuesta: `{changes[], conflicts[], newVersionPreview, token}` con `token = hash(templateId, currentVersionNo, [(budgetId, budget.version)…], lines)`; nada se persiste. `ConfirmPropagation({…mismo cuerpo…, token})` recalcula en una transacción y, si el hash difiere, responde `BUDGET_PROPAGATION_STALE` (409) sin cambios; si coincide, publica la versión N+1 del template y aplica los cambios a los planes alcanzados (actualizando su `template_version_id`). Periodos `active`, `reopened` y `closed` nunca se alcanzan (INV-015).
8. **Archivado.** `status = ARCHIVED` (no se borra; `DELETE` ⇒ `METHOD_NOT_ALLOWED`, D7 por analogía); se puede desarchivar; las versiones y las referencias de los planes quedan intactas.
9. **Autorización, idempotencia y auditoría.** Lectura VIEWER+; escritura EDITOR/OWNER. `POST` de creación (template, versión, clon, apply, confirm) exige `Idempotency-Key`. Cada comando audita en la misma transacción (`AuditPort`): template/versión creados, origen y omitidas de cada plan creado, cambios de propagación por plan.
10. **Eventos.** Ninguno nuevo: no hay consumidores de "versión publicada" en Phase 2 (RISK-005). `planning.BudgetCreated.v1` lleva el origen.

### Modelo de datos (expand-only)

| Tabla | Columnas principales | Unique / Check | RLS / grants |
|---|---|---|---|
| `planning.budget_template` | `id`, `workspace_id`, `name`, `description`, `is_default`, `status` (`ACTIVE\|ARCHIVED`), `archived_at`, `current_version_no`, `version`, `created_at/by` | UNIQUE `(workspace_id, lower(name)) WHERE status='ACTIVE'`; UNIQUE parcial `(workspace_id) WHERE is_default AND status='ACTIVE'` | WS; SELECT/INSERT/UPDATE |
| `planning.budget_template_version` | `id`, `workspace_id`, `template_id` FK, `version_no`, `based_on_version_no`, `change_note`, `created_at`, `created_by` | UNIQUE `(template_id, version_no)`; CHECK `version_no >= 1` | **WS-RO**: SELECT, INSERT; `forbid_mutation()` |
| `planning.budget_template_line` | `id`, `workspace_id`, `template_version_id` FK, `target_kind`, `target_id`, `nature`, `kind`, `planned_amount`, `min_amount`, `max_amount`, `percent`, `income_basis`, `rollover_policy`, `rollover_cap`, `thresholds numeric(7,2)[]`, `currency` FK | UNIQUE `(template_version_id, target_kind, target_id)`; CHECK montos ≥ 0, `min ≤ max` | **WS-RO**: SELECT, INSERT; `forbid_mutation()` |
| `planning.budget` (de `add-budgets`) | FK `template_version_id → budget_template_version(id)` | — | sin cambio |
| `planning.budget_line` (de `add-budgets`) | FK `template_line_id → budget_template_line(id)` | — | sin cambio |

docs/08 §5.6 nombraba `budget_template_line.category_id` y `effective_from`: se generaliza a `target_kind/target_id` (grupos y tags) y se elimina `effective_from` (la versión se elige al aplicar; no hay vigencias por fecha).

## Contratos

**`contracts/openapi/finance-api.v1.yaml`** (tag `templates`, `x-openspec-capability: planning/budget-templates`):

| Operación | Método y ruta | Rol | Notas |
|---|---|---|---|
| `listTemplates` | `GET W/templates?status=` | VIEWER | Cursor |
| `createTemplate` | `POST W/templates` | EDITOR | `{name, description?, lines[]}` ⇒ 201 con versión 1; 409 `NAME_TAKEN` |
| `getTemplate` | `GET W/templates/{templateId}` | VIEWER | Última versión + lista de versiones |
| `getTemplateVersion` | `GET W/templates/{templateId}/versions/{versionNo}` | VIEWER | Líneas de esa versión |
| `publishTemplateVersion` | `POST W/templates/{templateId}/versions` | EDITOR | `{baseVersionNo, lines[], changeNote?}`; 409 `CONCURRENCY_CONFLICT`, `BUDGET_TEMPLATE_ARCHIVED` |
| `cloneTemplate` | `POST W/templates/{templateId}/clone` | EDITOR | `{name, versionNo?}` |
| `archiveTemplate` / `unarchiveTemplate` / `setDefaultTemplate` | `POST W/templates/{templateId}/archive\|unarchive\|set-default` | EDITOR | `set-default` sobre archivado ⇒ `BUDGET_TEMPLATE_ARCHIVED` |
| `applyTemplate` | `POST W/templates/{templateId}/apply` | EDITOR | `{periodId, versionNo?}` ⇒ 201 `Budget` + `omittedLines[]` |
| `previewBudgetPropagation` | `POST W/budget-propagations/preview` | EDITOR | Sin efectos; `{changes[], conflicts[], newVersionPreview, token}` |
| `confirmBudgetPropagation` | `POST W/budget-propagations/confirm` | EDITOR | `{…, token}`; 409 `BUDGET_PROPAGATION_STALE`; 422 `BUDGET_NO_TEMPLATE_ORIGIN` |

`createBudget` (de `add-budgets`) amplía `source` con `TEMPLATE {templateId, versionNo?}` y `CLONE_PREVIOUS`, y la respuesta con `origin`, `templateVersion {templateId, versionNo, name}`, `clonedFromBudgetId`, `omittedLines[]`; `BudgetLine` agrega `source`, `overridden`. Errores nuevos en docs/10 §8: `BUDGET_TEMPLATE_ARCHIVED` 409, `BUDGET_PROPAGATION_STALE` 409, `BUDGET_NO_TEMPLATE_ORIGIN` 422.

**Contratos entre módulos:** `@pf/planning/contracts` exporta `PeriodCreatedHook` (interfaz que invoca `add-financial-periods`); se coordina con pf-p2a dónde se registra (composición del módulo Planning).

## Riesgos / Trade-offs

- [Propagación compleja (RISK-005)] → stateless con token de hash, sin tabla de previews; Should en grupo de tareas propio, implementable al final.
- [Plantillas que referencian objetivos archivados] → omitidas e informadas al aplicar (nunca fallar la creación automática de un periodo).
- [Hook síncrono acopla la creación de periodos a templates] → mismo contexto y misma UoW; si falla la copia, falla la creación del periodo (consistente) — se cubre con test de idempotencia del job de creación de periodos.
- [Versiones como instantáneas completas ocupan más filas] → volumen despreciable (decenas de líneas × pocas versiones al año).

## Plan de migración

Expand-only: crear las tres tablas (RLS forzada, grants, `forbid_mutation` en versiones y líneas, índices parciales), luego `ALTER TABLE planning.budget ADD CONSTRAINT … FOREIGN KEY (template_version_id) … NOT VALID` + `VALIDATE CONSTRAINT` (columna nula en `add-budgets`), ídem `budget_line.template_line_id`; registro en `platform.workspace_scoped_table` en orden de FKs (líneas → versiones → templates). Sin datos que migrar. Rollback: revertir despliegue; las FKs y tablas pueden quedar.

**Dependencias:** requiere `add-budgets` (plan, líneas, validaciones, `CreateBudget`) y `add-financial-periods` (sibling pf-p2a: `PeriodCatalog.previousOf`, periodos futuros en borrador, invocación de `PeriodCreatedHook` en la creación automática idempotente); `add-classification` (estado de objetivos), `add-audit-trail`, `add-api-conventions`. Habilita: el export de workspace (sibling pf-p2c) debe incluir `planning.budget_template*` (FR-IDENTITY-010, "planes").

## Preguntas abiertas

1. **Cómo se entera Planning de un periodo nuevo.** **Recomendación:** hook síncrono `PeriodCreatedHook` en la misma unidad de trabajo de la creación del periodo (mismo contexto; idempotente por la unicidad del plan). Alternativa: evento `planning.PeriodCreated.v1` + consumidor (eventual; exige que pf-p2a lo publique). A coordinar con `add-financial-periods`.
2. **"Guardar plan como template" y propagación desde un plan sin template.** **Recomendación:** en Phase 2 rechazar con `BUDGET_NO_TEMPLATE_ORIGIN` y ofrecer en la UI "crear template con estas líneas" (que es `createTemplate` con las líneas del plan, sin endpoint nuevo).
3. **Template en una moneda que ya no es la base.** **Recomendación:** omitir esas líneas al aplicar con motivo `CURRENCY_MISMATCH` (no convertir montos planificados con una tasa) y sugerir publicar una versión nueva en la nueva moneda.
4. **Líneas quitadas en el template al propagar.** **Recomendación:** quitarlas de los planes futuros en borrador solo si no están modificadas a mano (si lo están, conflicto).
5. **Recorrido de ciclo de vida (D37) de templates.** **Recomendación:** no incluirlo en este change; si el owner lo quiere, un change pequeño que modifique `audit/lifecycle-timeline` con la máquina `ACTIVE ↔ ARCHIVED` y las versiones como anotaciones.
6. **Periodo de referencia al propagar desde el template.** **Recomendación:** alcanzar periodos en borrador cuyo inicio sea posterior a "hoy" en la TZ del workspace (los borradores son futuros por construcción en `add-financial-periods`).
