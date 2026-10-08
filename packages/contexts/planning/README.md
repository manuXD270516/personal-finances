# @pf/planning — bounded context PLANNING

Periodos financieros mensuales por workspace (openspec `add-financial-periods`; capability
`planning/financial-periods`). Phase 2 agrega aquí el cierre de mes (`add-month-closing`) y el plan mensual y los
presupuestos (pf-p2b).

| Capa | Contenido |
|---|---|
| `domain` | AR `FinancialPeriod`; DS `PeriodCalendar` (rangos por día de inicio 1..28, transición, cobertura) con `planCoverage`/`planReschedule`; máquina `FINANCIAL_PERIOD_LIFECYCLE`. Solo `@pf/shared-kernel`. |
| `application` | `PeriodsService` (`EnsurePeriods`, activación automática y manual, recálculo de DRAFT, consumidor de asientos; auditoría + recorrido + outbox en la unidad de trabajo) y `PeriodQueries` (`PeriodQuery`, `PlanningEditGuard`). Fakes en `application/testing`. |
| `infrastructure` | Repositorio Kysely de `planning.financial_period` (optimistic locking, `ON CONFLICT DO NOTHING`, candado consultivo por workspace). |
| `interface` | `PlanningModule` + controller REST `periods`, consumidores del worker y job `planning.ensure-periods`. |
| `contracts` | `PeriodQuery`, `PlanningEditGuard`, `PeriodCreatedHook`, payload de `planning.PeriodActivated.v1`, `PLANNING_AUDIT_POLICY`. |

Esquema de BD: `apps/api/db/migrations/20261008120000_planning_financial_period.sql`. Decisiones en
`openspec/changes/add-financial-periods/design.md`.

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios y de propiedades de dominio y aplicación (`src/**/*.test.ts`; `NIGHTLY=1` ⇒ 10 000 corridas) |
| `pnpm test:integration` | Repositorio, barreras de BD, RLS y concurrencia contra PostgreSQL 18 (Testcontainers; requiere Docker) |
