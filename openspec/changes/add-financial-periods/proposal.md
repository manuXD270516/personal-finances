# Propuesta: add-financial-periods

## Why

Phase 2 (docs/24 §5.2) necesita un calendario financiero explícito sobre el que planificar, presupuestar y cerrar meses. Hoy el ledger ya rechaza asientos en periodos bloqueados (`PERIOD_CLOSED`, `PF004`, INV-015) y expone `LedgerPeriodLockPort`, pero en Phase 1 nadie es dueño de los periodos: no existe el agregado `FinancialPeriod` de PLANNING (docs/04 §3.6, §4.2), ni la regla que convierte el día de inicio del mes financiero del workspace (`fiscalMonthStartDay`, FR-IDENTITY-005, ya configurable desde Phase 1) en rangos de fechas, ni el ciclo de vida `draft → active → closed → reopened`. Este change crea la capability `planning/financial-periods`: periodos mensuales contiguos por workspace, creados automáticamente y de forma idempotente con anticipación, activados según la fecha de hoy en la zona horaria del workspace (RISK-020), y el contrato que usan `add-month-closing` (cerrar/reabrir) y los changes de presupuestos de Phase 2 (plan mensual por periodo). Es el primer change de Phase 2 en el orden de docs/03 §7 y bloquea a `add-month-closing` y al plan mensual de `add-budgets` (pf-p2b).

## What Changes

- Se introduce el agregado **periodo financiero** (`FinancialPeriod`): rango de fechas inclusivo calculado a partir del día de inicio del mes financiero del workspace (1–28), etiqueta `YYYY-MM` única (mes de la fecha de inicio), periodos contiguos y sin solapamiento.
- Se introduce la **creación automática e idempotente** de periodos: siempre existen el periodo que contiene la fecha de hoy y, como mínimo, el siguiente (anticipación configurable, por defecto 3 periodos futuros en `draft`), más la **cobertura retroactiva** desde la fecha de negocio más antigua del ledger mientras no haya ningún periodo cerrado.
- Se introduce el **ciclo de vida** declarado `draft → active → closed → reopened → closed`: creación en `draft` (futuro) o `active` (contiene hoy o ya terminó), activación automática al llegar la fecha de inicio en la zona horaria del workspace y activación manual de un `draft` ya iniciado. Las transiciones `close`/`reopen` las implementa `add-month-closing`; aquí se declaran y se rechazan las inválidas con `INVALID_STATUS_TRANSITION`.
- Se fija que el periodo de un hecho económico lo determina **su fecha de negocio** en la zona horaria del workspace (nunca el instante UTC), con casos borde de medianoche, fin de mes y febrero (RISK-020, NFR-USAB-004).
- Se introduce el **cambio del día de inicio** con efecto solo hacia adelante: los periodos no-`draft` no cambian; los `draft` se recalculan conservando su identidad; un **periodo de transición** absorbe el desfase.
- Se introducen las **consultas** de periodos (listar, obtener, periodo que contiene una fecha) y el **guard de planificación**: el plan mensual de un periodo `closed` es de solo lectura (`PERIOD_CLOSED`); su contenido lo especifica `planning/budgets` (pf-p2b).
- Se publica `planning.PeriodActivated.v1`; toda creación, activación y recálculo se audita (INV-029) y queda en el recorrido del periodo (`add-month-closing` agrega el requirement de recorrido).
- **Fuera de alcance:** checklist, cierre, snapshot, reapertura y escritura del bloqueo del ledger (`add-month-closing`); contenido del plan mensual, presupuestos y templates (`add-budgets`/`add-budget-templates`, pf-p2b); notificaciones (pf-p2b); reconciliación (pf-p2c); `reportingPeriodMode = FINANCIAL_PERIOD` en reportes (docs/14 §2, Phase 7); periodos no mensuales (semanales, quincenales) y años fiscales.

## Capabilities

### New Capabilities
- `planning/financial-periods`: periodos financieros mensuales por workspace según el día de inicio configurado, contiguos y sin solapamiento, creados automáticamente con anticipación y cobertura retroactiva, con ciclo de vida `draft/active/closed/reopened`, activación por fecha en la zona horaria del workspace, cambio del día de inicio solo hacia adelante, consultas y guard de edición de la planificación por estado.

### Modified Capabilities
- Ninguna. (La interacción con el bloqueo del ledger y el recorrido del periodo se especifican en `add-month-closing`, que modifica `ledger/journal-posting` y agrega un requirement a `audit/lifecycle-timeline`.)

## Impact

**Specs impactadas:** crea `planning/financial-periods` (15 requirements). Consumida por `planning/month-closing` (`add-month-closing`), `planning/budgets` y `planning/budget-templates` (pf-p2b: plan por periodo, propagación solo a periodos `draft`), y en fases posteriores por COMMITMENTS, GOALS y REPORTING.

**Componentes/contextos impactados:** nuevo módulo `@pf/planning` (domain/application/infrastructure/interface/contracts) con el AR `FinancialPeriod` y el servicio de dominio `PeriodCalendar`; IDENTITY (consumo de `identity.WorkspaceCreated.v1` y `identity.WorkspaceSettingsChanged.v1`; lectura de `timeZone`/`fiscalMonthStartDay` vía query pública); LEDGER (query pública nueva `LedgerActivityRangeQuery`: fecha de negocio mínima y máxima de asientos del workspace); AUDIT (`AuditPort`, transiciones de recorrido); worker (job `planning.ensure-periods`); `apps/web` (pantalla de periodos y selector de periodo). Detalle en design.md.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — operaciones nuevas `listPeriods`, `getPeriod`, `ensurePeriods`, `activatePeriod`; schemas `FinancialPeriod`, `FinancialPeriodStatus`, `FinancialPeriodList`, `EnsurePeriodsRequest`; códigos nuevos `PERIOD_NOT_STARTED`. Lista exacta en design.md §Contratos.

**Tablas impactadas:** `planning.financial_period` (nueva; schema `planning` nuevo). Lectura de `iam.workspace` (vía query de IDENTITY) y de `ledger.journal_entry` (vía query de LEDGER). Uso de `platform.outbox`, `platform.inbox`, `audit.audit_log` y `audit.lifecycle_transition` existentes.

**Eventos impactados:** produce `planning.PeriodActivated.v1` (nuevo schema en `contracts/events/planning/`). Consume `identity.WorkspaceCreated.v1`, `identity.WorkspaceSettingsChanged.v1` y `ledger.JournalEntryPosted.v1` (solo para cobertura de fechas fuera del rango cubierto), todos existentes, con inbox idempotente (INV-028).

**Migraciones requeridas:** solo *expand*: `CREATE SCHEMA planning`, tabla `planning.financial_period` con exclusión gist de rangos (`btree_gist` ya instalado), trigger de rango inmutable fuera de `DRAFT`, RLS `ENABLE` + `FORCE`, grants sin `DELETE`. No destructiva.

**Test cases:** AÑADIDOS — TC-PLANNING-PERIOD-001, TC-PLANNING-PERIOD-002, TC-PLANNING-AUTOCREATE-001, TC-PLANNING-AUTOCREATE-002, TC-PLANNING-AUTOCREATE-003, TC-PLANNING-COVERAGE-001, TC-PLANNING-STATE-001, TC-PLANNING-ACTIVATION-001, TC-PLANNING-ACTIVATION-002, TC-PLANNING-TZ-001, TC-PLANNING-FISCALDAY-001, TC-PLANNING-FISCALDAY-002, TC-PLANNING-QUERY-001, TC-PLANNING-PLANGUARD-001, TC-PLANNING-AUDIT-001, TC-PLANNING-EVENT-001, TC-PLANNING-ISOLATION-001, TC-PLANNING-ROLE-001. MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** ninguno sobre comportamiento existente: en este change ningún periodo se cierra, por lo que el ledger sigue sin bloqueos (TC-LEDGER-PERIOD-001/002 y TC-CLASSIFICATION-RECATEGORIZE-002 siguen usando el puerto del ledger directamente). El cambio de `fiscalMonthStartDay` (ya existente) pasa a tener efecto sobre los periodos; la validación 1–28 de IDENTITY no cambia.

**Riesgos introducidos:** RISK-020 (bordes de fecha y zona horaria: activación a medianoche de La Paz, fin de mes, febrero, cambio de zona horaria) mitigado con fechas de negocio `date`, `Clock.today(tz)` y tests con TZ forzada; desalineación entre periodos financieros con día de inicio ≠ 1 y el bloqueo **mensual calendario** de `ledger.period_lock` (docs/31 D10) — se resuelve en `add-month-closing` con el ADR-0028 propuesto (bloqueo por el rango del periodo); recálculo de periodos `draft` ya referenciados por planes (pf-p2b) mitigado conservando la identidad del periodo. Sin RISK-ids nuevos.

**Invariantes afectadas:** INV-015 (solo como precondición: todo día cubierto pertenece a exactamente un periodo, base del bloqueo por periodo), INV-028 (consumidores idempotentes), INV-029 (auditoría síncrona). No se toca dinero, FX ni redondeo.
