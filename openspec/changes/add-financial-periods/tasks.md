# Tareas

> Requiere los changes de Phase 1 archivados (`add-workspace-identity`, `add-event-outbox`, `add-audit-trail`, `add-ledger-core`, `add-lifecycle-timeline`). No iniciar la implementación con las preguntas abiertas P-A1..P-A6 de design.md sin respuesta del owner (o aceptación explícita de las recomendaciones). El cálculo de rangos (`PeriodCalendar`) es lógica de dominio crítica para INV-015 y se implementa **test-first (TDD)**: primero el test rojo nombrado con su TC-id, luego el código.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar `specs/planning/financial-periods/spec.md` con el owner (P-A1..P-A6 resueltas el 2026-10-08, docs/33 D59–D64); verificar con `pnpm spec:validate`
- [ ] 1.2 Confirmar los 19 TC AÑADIDOS de proposal.md en `tests/cases/planning/` (`requirement_status: confirmed`, `status: ready`); verificar con `pnpm traceability:check` que todo requirement Must tiene ≥ 1 TC no deprecado
- [ ] 1.3 Consolidar en `contracts/` los cambios de design.md §Contratos (OpenAPI y `contracts/events/planning/PeriodActivated.v1.schema.json`); verificar Spectral y `oasdiff` sin cambios incompatibles

## 2. DOMAIN (TDD)

- [ ] 2.1 TDD: `PeriodCalendar.rangeFor(label, startDay)` y `periodContaining(date, startDay)` con escenarios de día 1, 25, 28, febrero y año bisiesto; tests `[TC-PLANNING-PERIOD-001]`, `[TC-PLANNING-TZ-001]` (parte de dominio)
- [ ] 2.2 TDD: propiedad de contigüidad, unicidad de etiqueta y cobertura (∀ startDay ∈ 1..28, ∀ secuencia de cambios de día de inicio y ∀ ventana de fechas: sin huecos ni solapes, cada fecha en exactamente un periodo); test `[TC-PLANNING-PERIOD-002]` (fast-check, 100 runs en PR, 10 000 nightly)
- [ ] 2.3 TDD: regla del periodo de transición y recálculo de `DRAFT` conservando identidad; tests `[TC-PLANNING-FISCALDAY-001]`, `[TC-PLANNING-FISCALDAY-002]` (dominio)
- [ ] 2.4 TDD: AR `FinancialPeriod` y máquina `FINANCIAL_PERIOD_LIFECYCLE` (transiciones declaradas, `INVALID_STATUS_TRANSITION`, `PERIOD_NOT_STARTED`); tests `[TC-PLANNING-STATE-001]`, `[TC-PLANNING-ACTIVATION-002]` (dominio)

## 3. APPLICATION

- [ ] 3.1 `EnsurePeriods` (cobertura retroactiva mientras no haya cierres, lookahead `PLANNING_PERIOD_LOOKAHEAD`, tope de 24 meses) con `LedgerActivityRangeQuery` y `WorkspaceCalendarQuery`; tests de aplicación con fakes `[TC-PLANNING-AUTOCREATE-001]`, `[TC-PLANNING-COVERAGE-001]`, `[TC-PLANNING-AUTOCREATE-003]`
- [ ] 3.1b Puerto `PeriodCreatedHook.onPeriodCreated(period, uow)` en `@pf/planning/contracts` con registro de participantes (vacío por defecto) e invocación síncrona por cada periodo insertado por `EnsurePeriods`, dentro de su Unit of Work; test `[TC-PLANNING-AUTOCREATE-004]`
- [ ] 3.2 `ActivateDuePeriods` y `ActivatePeriod` con `Clock.today(tz)`, `AuditPort`, `LifecycleTransitionPort` y outbox de `planning.PeriodActivated.v1`; tests `[TC-PLANNING-ACTIVATION-001]`, `[TC-PLANNING-AUDIT-001]`
- [ ] 3.3 `RescheduleDraftPeriods` (consumidor de `identity.WorkspaceSettingsChanged.v1`, inbox idempotente) con auditoría `before/after`; tests `[TC-PLANNING-FISCALDAY-001]` (aplicación)
- [ ] 3.4 Queries `GetPeriod`, `ListPeriods`, `GetPeriodContaining` y contrato público `PeriodQuery` (`getPeriod`, `getPeriodContaining`, `listPeriods`, `getPrevious`) + `PlanningEditGuard` en `@pf/planning/contracts`; tests `[TC-PLANNING-QUERY-001]`, `[TC-PLANNING-PLANGUARD-001]` (contra el guard)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración *expand* del schema `planning` y `planning.financial_period` (exclusión gist diferible, uniques, trigger de rango congelado, RLS `ENABLE/FORCE`, grants sin `DELETE`); test de migración sobre PG vacío y test de catálogo RLS
- [ ] 4.2 Repositorio Kysely con optimistic locking, `ON CONFLICT DO NOTHING` y candado consultivo por workspace; tests de integración `[TC-PLANNING-AUTOCREATE-002]` (concurrencia), `[TC-PLANNING-PERIOD-002]` (barrera de solapamiento en BD), `[TC-PLANNING-ISOLATION-001]`
- [ ] 4.3 `LedgerActivityRangeQuery` en `@pf/ledger/contracts` (índice `(workspace_id, entry_date)`) y `WorkspaceCalendarQuery` en `@pf/identity/contracts` si no existe; tests de integración
- [ ] 4.4 Job cron `planning.ensure-periods` (`PLANNING_PERIODS_CRON`, default `5 * * * *`, `off` lo desactiva), consumidores de `WorkspaceCreated`, `WorkspaceSettingsChanged` y `JournalEntryPosted` (solo fuera de rango), encolado al arrancar el worker; config en `docs/config-reference.md`; test `[TC-PLANNING-ACTIVATION-001]` (integración con reloj fijo)
- [ ] 4.5 Incluir `planning.financial_period` en la purga del workspace demo (ADR-0026) y en `restore:local` (sin cambios si el restore es por BD completa); verificar con TC-IDENTITY-DEMO-005

## 5. API

- [ ] 5.1 Controlador `periods` (`listPeriods`, `getPeriod`, `ensurePeriods`, `activatePeriod`) según el contrato consolidado, con `If-Match`/`ETag` y roles; tests de API `[TC-PLANNING-QUERY-001]`, `[TC-PLANNING-ROLE-001]`, `[TC-PLANNING-ACTIVATION-002]`
- [ ] 5.2 Mapeo de `PERIOD_NOT_STARTED` a problem+json 409 y mensajes i18n es/en/pt; tests de contrato (respuestas validan contra el OpenAPI)
- [ ] 5.3 Test de contrato del productor `planning.PeriodActivated.v1` contra su schema; test `[TC-PLANNING-EVENT-001]`

## 6. UI

- [ ] 6.1 Pantalla "Periodos" (`/planificacion/periodos`): lista con etiqueta, rango en `dd/MM/yyyy`, estado, marca "pendiente de cierre" y "transición", activación manual para EDITOR/OWNER; textos i18n es/en/pt; tests de componentes
- [ ] 6.2 Componente `PeriodSelector` reutilizable (para pf-p2b y `add-month-closing`), por defecto el periodo que contiene hoy en la zona del workspace; tests de componentes con TZ forzada

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Completar los tests de todos los TC del change y marcar `automation_status: automated`; `[TC-PLANNING-PLANGUARD-001]` se completa de punta a punta cuando exista el plan mensual de pf-p2b (si este change se aplica antes, queda automatizado contra el guard y se re-verifica en `add-budgets`)
- [ ] 7.2 Tests con TZ forzada (`TZ=UTC` y `TZ=America/La_Paz`) del job de activación y de `GetPeriodContaining` (RISK-020, NFR-USAB-004); verificar en CI
- [ ] 7.3 E2E (Playwright): workspace nuevo → periodos visibles (actual `active`, 3 `draft`); cambiar el día de inicio a 25 en configuración → periodo de transición visible; verificar en CI y en `a11y.spec.ts`

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/08 §5.6 (`financial_period` con estados `DRAFT/ACTIVE/CLOSED/REOPENED`, `label`, `start_day`, `is_transition`), docs/04 §3.6/§4.2 (creación en `active` para periodos iniciados, transición), docs/05 §2.6 (consumidores y job), docs/10 (recurso `periods`, `PERIOD_NOT_STARTED`), docs/11 (`planning.PeriodActivated.v1` y consumos), docs/26 RISK-020 (mitigaciones de este change) y `docs/config-reference.md`
- [ ] 8.2 Actualizar estados de los TC, regenerar la matriz (`pnpm traceability:matrix`) y ejecutar `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; verificar que pasan antes de archivar
