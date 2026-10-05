# Tareas

> Requiere aplicados: `add-budgets` y **`add-financial-periods`** (Phase 2, sibling pf-p2a), además de `add-classification`, `add-audit-trail` y `add-api-conventions`. No iniciar la implementación con preguntas abiertas de design.md sin resolver que afecten el grupo (docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `planning/budget-templates` y las preguntas abiertas 1–6 de design.md; registrar decisiones en docs/31 (Phase 2) y verificar con `openspec validate add-budget-templates --strict`
- [ ] 1.2 Revisar TC-PLANNING-TEMPLATE-001..019 contra los scenarios (fechas fijas, `FixedClock`); pasar a `ready`/`confirmed` tras la revisión; `pnpm traceability:check` sin requirements Must sin TC
- [ ] 1.3 Verificar contra `add-financial-periods` (contrato consolidado el 2026-10-05: declara e invoca `PeriodCreatedHook` en la Unit of Work de `EnsurePeriods`, expone `PeriodQuery.getPrevious` y `listPeriods(status=DRAFT)`) que el participante de este change cumple el contrato

## 2. DOMAIN (TDD)

- [ ] 2.1 `BudgetTemplate` con versiones inmutables, nombre único, concurrencia por `baseVersionNo`, archivado y predeterminado: tests primero de TC-PLANNING-TEMPLATE-001, -002, -003, -012, -018
- [ ] 2.2 `BudgetFromTemplateFactory` y `BudgetCloner` (copia, omitidas por objetivo archivado o moneda, herencia de `template_version_id`, sin cruces): tests primero de TC-PLANNING-TEMPLATE-004, -005, -007, -008
- [ ] 2.3 `PropagationPlanner` (alcance solo futuros `draft`, diff ADD/UPDATE/REMOVE/CONFLICT, token de hash): tests primero de TC-PLANNING-TEMPLATE-015, -016, -017; PBT: ninguna secuencia de propagaciones cambia un plan de periodo no `draft` ni una línea `overridden`

## 3. APPLICATION

- [ ] 3.1 Comandos `CreateTemplate`, `PublishTemplateVersion`, `CloneTemplate`, `ArchiveTemplate`/`UnarchiveTemplate`, `SetDefaultTemplate` con auditoría y roles; tests con dobles de TC-PLANNING-TEMPLATE-014 y -019
- [ ] 3.2 `CreateBudget` con orígenes `TEMPLATE`/`CLONE_PREVIOUS` y marca `overridden` en ediciones del plan (`add-budgets`): tests de TC-PLANNING-TEMPLATE-006, -009, -013
- [ ] 3.3 `PeriodCreatedHook` (predeterminado ⇒ plan, idempotente): tests de TC-PLANNING-TEMPLATE-010 y -011 integrados con la creación automática de periodos de pf-p2a
- [ ] 3.4 `PreviewPropagation`/`ConfirmPropagation` (una transacción, recomputar y comparar token, versión N+1, actualizar planes alcanzados)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand de `planning.budget_template`, `budget_template_version`, `budget_template_line` (RLS forzada, WS-RO con `forbid_mutation`, índices parciales) y FKs `NOT VALID`+`VALIDATE` hacia `planning.budget`/`budget_line`; registro en `platform.workspace_scoped_table`; tests de integración: inmutabilidad de versiones (UPDATE/DELETE fallan con `PF003`), un solo predeterminado bajo concurrencia, aislamiento entre workspaces
- [ ] 4.2 Repositorios Kysely y adapters (`PeriodQuery`, estado de objetivos de Classification)

## 5. API

- [ ] 5.1 Endpoints de design.md § Contratos (`templates`, `budget-propagations`, `source` ampliado de `createBudget`) con `Idempotency-Key` y problem+json; tests de API con TC-PLANNING-TEMPLATE-001, -004, -006, -016, -018, -019 y validación contra el OpenAPI consolidado

## 6. UI

- [ ] 6.1 Pantalla "Templates" (lista, versiones con nota de cambio, comparar versiones, clonar, archivar, predeterminado) y selector de origen al crear el plan (vacío / template y versión / clonar mes anterior) con aviso de líneas omitidas; textos vía i18n
- [ ] 6.2 Diálogo "Aplicar a meses futuros" con vista previa (cambios y conflictos por periodo) y manejo de `BUDGET_PROPAGATION_STALE` (recargar vista previa)

## 7. TESTS automatizados y E2E

- [ ] 7.1 E2E Playwright: crear "Mes estándar", marcarlo predeterminado, crear el periodo siguiente y verificar su plan; editar el plan sin afectar el template; propagar un cambio con vista previa
- [ ] 7.2 Test de integración de la creación automática de periodos con predeterminado ejecutada dos veces (TC-PLANNING-TEMPLATE-011) contra PostgreSQL real

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/04 §3.6 (`BudgetTemplate`, `TemplateLineSpec`), docs/08 §5.6 (tablas as-built, `target_kind/target_id`, sin `effective_from`), docs/10 (rutas `templates`/`budget-propagations` y errores) y docs/25 (US-103..108)
- [ ] 8.2 Actualizar estados de automatización de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict` y `pnpm traceability:check`
