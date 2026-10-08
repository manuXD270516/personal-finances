# @pf/planning — bounded context PLANNING

Periodos financieros mensuales por workspace (openspec `add-financial-periods`; capability
`planning/financial-periods`) y presupuestos (openspec `add-budgets`; capability `planning/budgets`): el plan mensual de
cada periodo, el presupuesto vs real derivado de las transacciones y los umbrales con emisión única; y templates
versionados (openspec `add-budget-templates`; capability `planning/budget-templates`): versiones inmutables, plan desde
template o clonando el mes anterior, predeterminado para los periodos nuevos y propagación a meses futuros. Phase 2
agrega aquí además el cierre de mes (`add-month-closing`).

| Capa | Contenido |
|---|---|
| `domain` | AR `FinancialPeriod`; DS `PeriodCalendar` (rangos por día de inicio 1..28, transición, cobertura) con `planCoverage`/`planReschedule`; máquina `FINANCIAL_PERIOD_LIFECYCLE`. AR `Budget` con `BudgetLine` (tipos `FIXED`/`MAXIMUM`/`MINIMUM`/`RANGE`/`PERCENT_OF_INCOME`, rollover, modo base cero) y DS puros `BudgetProgressCalculator`, `ThresholdEvaluator`, `RolloverCalculator`, `TargetOverlapPolicy`. Solo `@pf/shared-kernel`. |
| `application` | `PeriodsService` (`EnsurePeriods`, activación automática y manual, recálculo de DRAFT, consumidor de asientos; auditoría + recorrido + outbox en la unidad de trabajo) y `PeriodQueries` (`PeriodQuery`, `PlanningEditGuard`). Presupuestos: `BudgetsService` (comandos del plan y sus líneas), `BudgetQueries` (`GetBudget`, `GetBudgetByPeriod`, `ListBudgets`, historial y `BudgetVsActualQuery`), `BudgetCalculator` (gastado derivado en cada lectura con `FlowValuation`), `BudgetThresholdService` (cruces con emisión única) y `RolloverService` (`planning.rollover-finalizer`). Templates: `TemplatesService` (crear, versionar, clonar, archivar, predeterminado), `TemplateQueries`, `PropagationService` (vista previa sin estado con token y confirmación en una transacción), `TemplatePeriodHook` (el predeterminado se aplica a cada periodo nuevo dentro de la unidad de trabajo de `EnsurePeriods`) y `createBudget` con orígenes `TEMPLATE`/`CLONE_PREVIOUS`. Fakes en `application/testing`. |
| `infrastructure` | Repositorios Kysely/SQL de `planning.financial_period` (optimistic locking, `ON CONFLICT DO NOTHING`, candado consultivo por workspace), `planning.budget`, `planning.budget_line` y `planning.budget_threshold_crossing` (append-only); `planning.budget_template` y sus versiones y líneas (solo `INSERT`, WS-RO). |
| `interface` | `PlanningModule` + controllers REST `periods`, `budgets` y `templates` (incluye `budget-propagations`), consumidores del worker (`planning.budget-thresholds`, `planning.rollover-finalizer`, periodos) y job `planning.ensure-periods`. |
| `contracts` | `PeriodQuery`, `PlanningEditGuard`, `PeriodCreatedHook`, `BudgetVsActualQuery`, payloads de `planning.PeriodActivated.v1`, `planning.BudgetCreated.v1` y `planning.BudgetThresholdReached.v1`, `PLANNING_AUDIT_POLICY`. |

Esquema de BD: `apps/api/db/migrations/20261008120000_planning_financial_period.sql` y
`20261008150000_planning_budgets.sql` y `20261008160000_planning_budget_templates.sql`. Decisiones en
`openspec/changes/add-financial-periods/design.md`, `openspec/changes/add-budgets/design.md` y
`openspec/changes/add-budget-templates/design.md`.

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios y de propiedades de dominio y aplicación (`src/**/*.test.ts`; `NIGHTLY=1` ⇒ 10 000 corridas) |
| `pnpm test:integration` | Repositorio, barreras de BD, RLS y concurrencia contra PostgreSQL 18 (Testcontainers; requiere Docker) |
