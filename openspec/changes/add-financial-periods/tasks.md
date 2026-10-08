# Tareas

> Requiere los changes de Phase 1 archivados (`add-workspace-identity`, `add-event-outbox`, `add-audit-trail`, `add-ledger-core`, `add-lifecycle-timeline`). No iniciar la implementación con las preguntas abiertas P-A1..P-A6 de design.md sin respuesta del owner (o aceptación explícita de las recomendaciones). El cálculo de rangos (`PeriodCalendar`) es lógica de dominio crítica para INV-015 y se implementa **test-first (TDD)**: primero el test rojo nombrado con su TC-id, luego el código.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar `specs/planning/financial-periods/spec.md` con el owner (P-A1..P-A6 resueltas el 2026-10-08, docs/33 D59–D64); verificar con `pnpm spec:validate`
  - 2026-10-08: resuelta por docs/33 D59 (etiqueta = mes de inicio), D60 (varios ACTIVE pendientes de cierre), D61 (recálculo de DRAFT conservando identidad y plan), D62 (cobertura desde el asiento más antiguo), D63 (lookahead 3 por `PLANNING_PERIOD_LOOKAHEAD`) y D64 (provisión asíncrona). Único ajuste del scenario "Fecha sin periodo": `404 RESOURCE_NOT_FOUND` (design.md decisión 16). `pnpm spec:validate` en verde.
- [x] 1.2 Confirmar los 19 TC AÑADIDOS de proposal.md en `tests/cases/planning/` (`requirement_status: confirmed`, `status: ready`); verificar con `pnpm traceability:check` que todo requirement Must tiene ≥ 1 TC no deprecado
  - 2026-10-08: los 19 TC quedan `confirmed` y, al automatizarse, `status: automated`; `pnpm traceability:check` en verde (569 TC, 0 advertencias).
- [x] 1.3 Consolidar en `contracts/` los cambios de design.md §Contratos (OpenAPI y `contracts/events/planning/PeriodActivated.v1.schema.json`); verificar Spectral y `oasdiff` sin cambios incompatibles
  - 2026-10-08: `listPeriods`, `ensurePeriods`, `getPeriod`, `activatePeriod`; schemas `FinancialPeriodStatus`, `FinancialPeriod`, `FinancialPeriodPage`, `FinancialPeriodList`, `EnsurePeriodsRequest`; parámetro `PeriodId`; `PERIOD_NOT_STARTED` (409) en `ErrorCode`; `FinancialPeriod` en `LifecycleAggregateType(Input)`; tag Planning a Phase 2; la regla Spectral `pfos-operation-capability` admite `planning/*`. Spectral 0 errores, Redocly válido, `pnpm contract:breaking` contra `origin/main` sin cambios incompatibles. Schema del evento con ejemplo validado (Ajv strict).

## 2. DOMAIN (TDD)

- [x] 2.1 TDD: `PeriodCalendar.rangeFor(label, startDay)` y `periodContaining(date, startDay)` con escenarios de día 1, 25, 28, febrero y año bisiesto; tests `[TC-PLANNING-PERIOD-001]`, `[TC-PLANNING-TZ-001]` (parte de dominio)
  - 2026-10-08: `packages/contexts/planning/src/domain/period-calendar.ts` (+ `planCoverage`, `planReschedule`, `plusDays`, `horizonOf`).
- [x] 2.2 TDD: propiedad de contigüidad, unicidad de etiqueta y cobertura (∀ startDay ∈ 1..28, ∀ secuencia de cambios de día de inicio y ∀ ventana de fechas: sin huecos ni solapes, cada fecha en exactamente un periodo); test `[TC-PLANNING-PERIOD-002]` (fast-check, 100 runs en PR, 10 000 nightly)
  - 2026-10-08: `period-calendar.properties.test.ts` (semilla fija en PR; `NIGHTLY=1` ⇒ 10 000 corridas, verificado localmente en ~44 s).
- [x] 2.3 TDD: regla del periodo de transición y recálculo de `DRAFT` conservando identidad; tests `[TC-PLANNING-FISCALDAY-001]`, `[TC-PLANNING-FISCALDAY-002]` (dominio)
- [x] 2.4 TDD: AR `FinancialPeriod` y máquina `FINANCIAL_PERIOD_LIFECYCLE` (transiciones declaradas, `INVALID_STATUS_TRANSITION`, `PERIOD_NOT_STARTED`); tests `[TC-PLANNING-STATE-001]`, `[TC-PLANNING-ACTIVATION-002]` (dominio)
  - 2026-10-08: `CLOSE`/`REOPEN` declaradas y con métodos de dominio mínimos (estado y contadores); comandos, guardas y eventos en `add-month-closing`.

## 3. APPLICATION

- [x] 3.1 `EnsurePeriods` (cobertura retroactiva mientras no haya cierres, lookahead `PLANNING_PERIOD_LOOKAHEAD`, tope de 24 meses) con `LedgerActivityRangeQuery` y `WorkspaceCalendarQuery`; tests de aplicación con fakes `[TC-PLANNING-AUTOCREATE-001]`, `[TC-PLANNING-COVERAGE-001]`, `[TC-PLANNING-AUTOCREATE-003]`
  - 2026-10-08: `PeriodsService.ensurePeriods` — orden activar → recalcular → crear en una transacción con candado consultivo (design.md decisión 19).
- [x] 3.1b Puerto `PeriodCreatedHook.onPeriodCreated(period, uow)` en `@pf/planning/contracts` con registro de participantes (vacío por defecto) e invocación síncrona por cada periodo insertado por `EnsurePeriods`, dentro de su Unit of Work; test `[TC-PLANNING-AUTOCREATE-004]`
  - 2026-10-08: firma `onPeriodCreated({ workspaceId, period })`; la unidad de trabajo es la transacción ambiental de la plataforma (`requireSqlExecutor`/`unitOfWorkKysely`), no un parámetro. Registro en `createPlanningRuntime({ onPeriodCreated })`.
- [x] 3.2 `ActivateDuePeriods` y `ActivatePeriod` con `Clock.today(tz)`, `AuditPort`, `LifecycleTransitionPort` y outbox de `planning.PeriodActivated.v1`; tests `[TC-PLANNING-ACTIVATION-001]`, `[TC-PLANNING-AUDIT-001]`
  - 2026-10-08: "hoy" = `LocalDate.ofInstant(clock.now(), timeZone)`; auditoría + transición con `LifecyclePort` (tipo de agregado `FinancialPeriod`, decisión 18).
- [x] 3.3 `RescheduleDraftPeriods` (consumidor de `identity.WorkspaceSettingsChanged.v1`, inbox idempotente) con auditoría `before/after`; tests `[TC-PLANNING-FISCALDAY-001]` (aplicación)
  - 2026-10-08: parte de `EnsurePeriods`; auditoría `planning.period.rescheduled` con `periodStart`/`periodEnd`/`startDay`/`isTransition` planos y `range` como JSON canónico + anotación del recorrido.
- [x] 3.4 Queries `GetPeriod`, `ListPeriods`, `GetPeriodContaining` y contrato público `PeriodQuery` (`getPeriod`, `getPeriodContaining`, `listPeriods`, `getPrevious`) + `PlanningEditGuard` en `@pf/planning/contracts`; tests `[TC-PLANNING-QUERY-001]`, `[TC-PLANNING-PLANGUARD-001]` (contra el guard)

## 4. INFRASTRUCTURE

- [x] 4.1 Migración *expand* del schema `planning` y `planning.financial_period` (exclusión gist diferible, uniques, trigger de rango congelado, RLS `ENABLE/FORCE`, grants sin `DELETE`); test de migración sobre PG vacío y test de catálogo RLS
  - 2026-10-08: `apps/api/db/migrations/20261008120000_planning_financial_period.sql` (+ `btree_gist`, CHECK de etiqueta, `pf_workspace_directory` lee `fiscal_month_start_day`, `audit.lifecycle_state_divergences()` con `FinancialPeriod`, registro en `platform.workspace_scoped_table`). Migración aplicada sobre PG vacío por el global setup de Testcontainers; catálogo RLS (TC-SECURITY-RLS-004) en verde.
- [x] 4.2 Repositorio Kysely con optimistic locking, `ON CONFLICT DO NOTHING` y candado consultivo por workspace; tests de integración `[TC-PLANNING-AUTOCREATE-002]` (concurrencia), `[TC-PLANNING-PERIOD-002]` (barrera de solapamiento en BD), `[TC-PLANNING-ISOLATION-001]`
  - 2026-10-08: `packages/contexts/planning/test/integration/pg-planning.int.test.ts` (también rango congelado, sin DELETE, recálculo en sitio con exclusión diferible, `FOR SHARE` del guard y activación con reloj fijo).
- [x] 4.3 `LedgerActivityRangeQuery` en `@pf/ledger/contracts` (índice `(workspace_id, entry_date)`) y `WorkspaceCalendarQuery` en `@pf/identity/contracts` si no existe; tests de integración
  - 2026-10-08: `ledger.activityRange` / `ledgerActivityRange()`; `identityWorkspaceCalendar` (API, membresía) e `identityWorkspaceCalendarDirectory` (worker, rol de directorio; decisión 21). Tests en `pg-ledger.int.test.ts` y `pg-identity.int.test.ts`.
- [x] 4.4 Job cron `planning.ensure-periods` (`PLANNING_PERIODS_CRON`, default `5 * * * *`, `off` lo desactiva), consumidores de `WorkspaceCreated`, `WorkspaceSettingsChanged` y `JournalEntryPosted` (solo fuera de rango), encolado al arrancar el worker; config en `docs/config-reference.md`; test `[TC-PLANNING-ACTIVATION-001]` (integración con reloj fijo)
  - 2026-10-08: `apps/api/src/worker/planning-jobs.ts` + `planningEventConsumers` en `create-worker-runtime.ts`; `PLANNING_PERIOD_LOOKAHEAD`/`PLANNING_PERIODS_CRON` en el contrato de config, `.env.example`, `deploy/host/etc-pfos/pfos.env.example` y `docs/config-reference.md`. Consumidores y job probados contra PG real en `apps/api/test/api/periods.api.test.ts`.
- [x] 4.5 Incluir `planning.financial_period` en la purga del workspace demo (ADR-0026) y en `restore:local` (sin cambios si el restore es por BD completa); verificar con TC-IDENTITY-DEMO-005
  - 2026-10-08: registrada con orden 160 (hoja); `restore:local` restaura la BD completa (sin cambios). TC-IDENTITY-DEMO-005 (catálogo de purga) en verde en `pnpm test:integration`.

## 5. API

- [x] 5.1 Controlador `periods` (`listPeriods`, `getPeriod`, `ensurePeriods`, `activatePeriod`) según el contrato consolidado, con `If-Match`/`ETag` y roles; tests de API `[TC-PLANNING-QUERY-001]`, `[TC-PLANNING-ROLE-001]`, `[TC-PLANNING-ACTIVATION-002]`
- [x] 5.2 Mapeo de `PERIOD_NOT_STARTED` a problem+json 409 y mensajes i18n es/en/pt; tests de contrato (respuestas validan contra el OpenAPI)
  - 2026-10-08: `ErrorCatalog` (TC-PLATFORM-API-005) y `apps/web/messages/errors.{es,en,pt}.json`; respuestas validadas con `ApiContract.validateResponse`.
- [x] 5.3 Test de contrato del productor `planning.PeriodActivated.v1` contra su schema; test `[TC-PLANNING-EVENT-001]`

## 6. UI

- [x] 6.1 Pantalla "Periodos" (`/planificacion/periodos`): lista con etiqueta, rango en `dd/MM/yyyy`, estado, marca "pendiente de cierre" y "transición", activación manual para EDITOR/OWNER; textos i18n es/en/pt; tests de componentes
  - 2026-10-08: `apps/web/src/ui/planning/` (+ entrada "Planificación" en la navegación principal, tokens de `globals.css`, tabla con `caption`/`scope`, `aria-current` en el periodo de hoy). Sin periodos aún (provisión asíncrona), un EDITOR puede pedirlos.
- [x] 6.2 Componente `PeriodSelector` reutilizable (para pf-p2b y `add-month-closing`), por defecto el periodo que contiene hoy en la zona del workspace; tests de componentes con TZ forzada

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Completar los tests de todos los TC del change y marcar `automation_status: automated`; `[TC-PLANNING-PLANGUARD-001]` se completa de punta a punta cuando exista el plan mensual de pf-p2b (si este change se aplica antes, queda automatizado contra el guard y se re-verifica en `add-budgets`)
  - 2026-10-08: 19/19 TC automatizados; TC-PLANNING-PLANGUARD-001 contra el guard (pendiente la re-verificación de punta a punta en `add-budgets`).
- [x] 7.2 Tests con TZ forzada (`TZ=UTC` y `TZ=America/La_Paz`) del job de activación y de `GetPeriodContaining` (RISK-020, NFR-USAB-004); verificar en CI
  - 2026-10-08: la TZ del proceso se fuerza dentro de los tests (`process.env.TZ` por caso) en `periods.service.test.ts` y `period-selector.test.ts`, así que corren en el job `unit` de CI sin configuración extra; verificado localmente.
- [x] 7.3 E2E (Playwright): workspace nuevo → periodos visibles (actual `active`, 3 `draft`); cambiar el día de inicio a 25 en configuración → periodo de transición visible; verificar en CI y en `a11y.spec.ts`
  - 2026-10-08: `tests/e2e/specs/periods.spec.ts` y `/planificacion/periodos` en `a11y.spec.ts`; suite completa en verde localmente (40/40, stack `pfos-e2e-periods`). Pendiente la corrida de CI.

## 8. DOCUMENTACIÓN y cierre

- [x] 8.1 Actualizar docs/08 §5.6 (`financial_period` con estados `DRAFT/ACTIVE/CLOSED/REOPENED`, `label`, `start_day`, `is_transition`), docs/04 §3.6/§4.2 (creación en `active` para periodos iniciados, transición), docs/05 §2.6 (consumidores y job), docs/10 (recurso `periods`, `PERIOD_NOT_STARTED`), docs/11 (`planning.PeriodActivated.v1` y consumos), docs/26 RISK-020 (mitigaciones de este change) y `docs/config-reference.md`
- [x] 8.2 Actualizar estados de los TC, regenerar la matriz (`pnpm traceability:matrix`) y ejecutar `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; verificar que pasan antes de archivar
  - 2026-10-08: en verde los tres; matriz regenerada (569 TC, 371 automatizados).
