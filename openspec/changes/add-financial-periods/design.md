# Diseño

## Contexto

Bounded context **PLANNING** (`planning`, `@pf/planning`, Core, Phase 2; docs/05 §2.6, docs/04 §3.6 y §4.2, docs/08 §5.6). Este change crea el módulo y su primer agregado, `FinancialPeriod`; `add-month-closing` agrega el cierre, el snapshot y la reapertura sobre el mismo agregado, y los changes de presupuestos de pf-p2b (`add-budgets`, `add-budget-templates`) cuelgan el plan mensual de cada periodo. Fuentes: docs/01 FR-PLANNING-001/002/008/014, FR-IDENTITY-005; docs/02 NFR-USAB-004, NFR-SEC-003/004, NFR-REL-008; docs/09 §10 e INV-015; docs/14 §2 (periodo financiero ≠ mes calendario, p. ej. del 25 al 24); docs/26 RISK-020; docs/31 D10, D23, D37, D49, D54. Motivación y alcance: proposal.md.

Capas afectadas:

| Capa | Cambio |
|---|---|
| planning/domain | AR `FinancialPeriod {id, workspaceId, label: YearMonth, range: DateRange, status: DRAFT\|ACTIVE\|CLOSED\|REOPENED, startDay: 1..28, isTransition, closeCount, reopenCount, version}`; VO `PeriodLabel` (= `YearMonth` del inicio); DS `PeriodCalendar` (cálculo puro de rangos, transición y cobertura); máquina declarada `FINANCIAL_PERIOD_LIFECYCLE` (docs/31 D37). Sin dependencias de framework. |
| planning/application | Comandos `EnsurePeriods(through?)`, `ActivatePeriod(periodId, version)`, `ActivateDuePeriods` (job), `RescheduleDraftPeriods(newStartDay)` (consumidor); queries `GetPeriod`, `ListPeriods`, `GetPeriodContaining(date)`. Puertos de salida: `FinancialPeriodRepository`, `WorkspaceCalendarQuery` (IDENTITY: `timeZone`, `fiscalMonthStartDay`), `LedgerActivityRangeQuery` (LEDGER), `AuditPort`, `LifecycleTransitionPort`, `OutboxPort`, `Clock`, `IdGenerator`. |
| planning/contracts (API pública) | `PeriodQuery` (`getPeriodContaining(date)`, `getPeriod(id)`, `listPeriods({status?})`, `getPrevious(periodId)`), `PlanningEditGuard.assertPlanEditable(periodId)` y el puerto `PeriodCreatedHook` (decisión 15) para `add-budgets`/`add-budget-templates`. `PeriodQuery` es el único nombre del catálogo de periodos (los borradores de pf-p2b lo llamaban `PeriodCatalog`). Ningún otro contexto importa internals de PLANNING (ADR-0003). |
| planning/infrastructure | Repositorio Kysely sobre la Unit of Work, migración del schema `planning`, consumidores pg-boss, job cron `planning.ensure-periods`. |
| planning/interface | Controlador REST `periods` (Nest) y módulo de composición. |
| ledger/contracts | Query pública nueva `LedgerActivityRangeQuery.getActivityRange(workspaceId) → {minEntryDate, maxEntryDate} \| null` (lectura de `ledger.journal_entry` por el índice `(workspace_id, entry_date)`). Aditiva. |
| identity/contracts | Query pública `WorkspaceCalendarQuery.get(workspaceId) → {timeZone, fiscalMonthStartDay}` si aún no existe (los datos ya están en `iam.workspace`, D23). Aditiva. |
| apps/web | Pantalla "Periodos" (lista con estado, pendiente de cierre, transición) y selector de periodo reutilizable para pf-p2b. |

## Objetivos / No objetivos

**Objetivos:**
- Cálculo determinista y puro de rangos por día de inicio, verificable con tests de propiedades (contigüidad, unicidad de etiqueta, cobertura) y con TZ forzada (`America/La_Paz`, UTC, una zona con DST como `America/Sao_Paulo` histórica) — RISK-020.
- Creación idempotente y concurrente sin duplicados ni huecos (constraints de BD + `ON CONFLICT DO NOTHING`).
- Contratos estables para `add-month-closing` y pf-p2b (`PeriodQuery`, `PlanningEditGuard`, eventos).

**No objetivos:**
- Cierre, snapshot, reapertura y bloqueo del ledger (`add-month-closing`).
- Contenido del plan mensual, presupuestos, templates y propagación a futuro (pf-p2b).
- Modo de reporte por periodo financiero en REPORTING (docs/14 §2, Phase 7) y periodos no mensuales.

## Decisiones

1. **Etiqueta = año y mes de la fecha de inicio.** Con día de inicio ≤ 28 cada mes calendario contiene exactamente un inicio de periodo, así que la etiqueta `YYYY-MM` es única y estable. Para día de inicio 1 coincide con el mes calendario (todo lo existente en Phase 1, que usa día 1, sigue igual). Alternativa — etiqueta por el mes de la fecha de fin (del 25-oct al 24-nov sería "noviembre", el mes que "financia" el salario) — también es única en régimen estable; se deja como **Pregunta abierta 1** porque es una decisión de producto, no técnica.

2. **Rango inclusivo `[inicio, fin]`** con `fin = inicio + 1 mes − 1 día` (aritmética de `LocalDate`, nunca de instantes). Día de inicio 1..28 (validación ya existente en IDENTITY, D23), por eso no hay "29/30/31 que no existe en febrero".

3. **Estados `DRAFT | ACTIVE | CLOSED | REOPENED`** (FR-PLANNING-001, docs/04 §4.2). docs/08 §5.6 decía `OPEN CLOSING CLOSED`; se adopta la lista del FR y se corrige docs/08 (tarea 9.x). Reglas de creación: el periodo se crea `ACTIVE` si `inicio ≤ hoy(tz)` (contiene hoy o ya terminó) y `DRAFT` si es futuro. Un periodo terminado y no cerrado es `ACTIVE` con la marca derivada `pendingClosure = fin < hoy(tz)` (no se persiste: depende de hoy). Interpretación de FR-PLANNING-002 "solo puede haber un periodo active que contenga la fecha actual": como los periodos no se solapan, a lo sumo uno contiene hoy; la regla operativa es que el periodo que contiene hoy **nunca** queda `DRAFT` tras el job (puede haber varios `ACTIVE` pendientes de cierre). Ver **Pregunta abierta 2**.

4. **Máquina declarada** `FINANCIAL_PERIOD_LIFECYCLE` (docs/31 D37) con transiciones `CREATE` (∅ → `DRAFT`|`ACTIVE`), `ACTIVATE` (`DRAFT` → `ACTIVE`), `CLOSE` (`ACTIVE`|`REOPENED` → `CLOSED`), `REOPEN` (`CLOSED` → `REOPENED`). Sin estado terminal. `CLOSE`/`REOPEN` se declaran aquí pero su comando, guardas (checklist, orden, rol OWNER) y eventos los implementa `add-month-closing`; hasta entonces el endpoint no existe. El recálculo de rango (`RESCHEDULE`) es una **anotación** del recorrido, no una transición.

5. **`EnsurePeriods`** (job + comando): calcula el intervalo objetivo `[min(inicioCobertura, hoy), max(hoy + lookahead, maxEntryDate acotado a hoy + 24 meses)]` y crea, en orden y en una transacción por workspace, los periodos que falten con `INSERT … ON CONFLICT (workspace_id, label) DO NOTHING`. `lookahead` = `PLANNING_PERIOD_LOOKAHEAD` (default **3** periodos futuros, mínimo 1; contrato de config, `docs/config-reference.md`). `inicioCobertura` = `minEntryDate` del ledger **solo mientras no exista ningún periodo `CLOSED`/`REOPENED`**; después, el primer periodo queda fijo (las fechas anteriores quedan protegidas por el bloqueo del primer cierre, ver `add-month-closing` decisión 6). Concurrencia: `pg_advisory_xact_lock(hashtext('planning.periods:' || workspace_id))` por workspace serializa job, comando y consumidores.

6. **Disparadores de `EnsurePeriods`:** (a) job cron `planning.ensure-periods` cada hora (`PLANNING_PERIODS_CRON`, default `5 * * * *` UTC) que recorre los workspaces activos con el rol `pf_worker` (`SET LOCAL app.workspace_id` por workspace) y también ejecuta `ActivateDuePeriods`; (b) consumidor de `identity.WorkspaceCreated.v1` (periodos iniciales sin esperar al cron); (c) consumidor de `ledger.JournalEntryPosted.v1` que solo actúa si `entryDate` cae fuera del rango cubierto (comparación barata contra el primer y último periodo cacheados por workspace); (d) comando `POST …/periods` (`ensurePeriods`, Should). Todos idempotentes; los consumidores usan `platform.inbox` (INV-028). La provisión **no** es síncrona con la creación del workspace (a diferencia de D54): ningún comando de Phase 1 depende de que existan periodos, y el ledger no los exige (solo mira `ledger.period_lock`).

7. **Activación por zona horaria** (`ActivateDuePeriods`): `hoy = Clock.today(workspace.timeZone)`; todo `DRAFT` con `inicio ≤ hoy` pasa a `ACTIVE` con auditoría (actor = proceso `planning.ensure-periods`, `actor_process`), transición `ACTIVATE` y `planning.PeriodActivated.v1`. Idempotencia: la actualización es condicional (`WHERE status = 'DRAFT' AND version = :v`), así que una segunda ejecución no encuentra filas y no emite nada. Latencia máxima de activación = periodo del cron (≤ 1 h) más el relay; la activación manual (`POST …/periods/{id}/activate`, `If-Match`) cubre el hueco.

8. **Fecha de negocio manda** (RISK-020): ningún cálculo usa instantes; el periodo de un hecho es `periodContaining(businessDate)`. Cambiar `timeZone` solo cambia `hoy` (activación y, en `add-month-closing`, "periodo terminado"), nunca rangos ni pertenencias.

9. **Cambio del día de inicio** (`RescheduleDraftPeriods`, consumidor de `identity.WorkspaceSettingsChanged.v1` cuando `changes[].field = 'fiscalMonthStartDay'`, más el job como red): se toma el último periodo no-`DRAFT` `L`; el primer `DRAFT` pasa a ser el **periodo de transición** `[L.fin + 1, día anterior al nuevo día de inicio del mes calendario siguiente al de L.fin + 1]` (6 a 58 días; etiqueta = mes de su inicio, única porque el siguiente inicio cae en el mes calendario siguiente) y los demás `DRAFT` se recalculan con el nuevo día **conservando `id` y `label`** (los planes de pf-p2b siguen colgando del mismo periodo); los `DRAFT` sobrantes no se borran: el job reasigna rangos a todos los `DRAFT` existentes en orden y crea los que falten. Como el rango de los `DRAFT` se actualiza en sitio, la exclusión gist se declara `DEFERRABLE INITIALLY DEFERRED` para permitir reordenar rangos dentro de la misma transacción. Rangos de periodos no-`DRAFT` inmutables (trigger, decisión 11). Alternativa descartada: prohibir el cambio del día de inicio si hay periodos — rompería FR-IDENTITY-005 vigente desde Phase 1.

10. **Guard de planificación para pf-p2b** (`PlanningEditGuard.assertPlanEditable(periodId)`, misma transacción del llamador): `CLOSED` ⇒ `DomainError('PERIOD_CLOSED')`; `DRAFT|ACTIVE|REOPENED` ⇒ ok; periodo inexistente ⇒ `REFERENCE_NOT_FOUND`. Para cerrar la carrera "editar plan ↔ cerrar mes", el guard toma `SELECT … FOR SHARE` sobre la fila del periodo y el cierre (`add-month-closing`) la actualiza con `FOR UPDATE`. El requirement "Planificación de solo lectura en periodos cerrados" se verifica de punta a punta cuando exista el plan mensual de pf-p2b; hasta entonces su TC se automatiza contra el guard (ver tasks 4.4 y 7.1).

11. **Barreras de BD** en `planning.financial_period`: exclusión gist `(workspace_id WITH =, daterange(period_start, period_end, '[]') WITH &&)` (no solapamiento); `UNIQUE (workspace_id, label)` y `UNIQUE (workspace_id, period_start)`; `CHECK (period_end >= period_start)`, `CHECK (start_day BETWEEN 1 AND 28)`, `CHECK (status IN (...))`; trigger `planning.assert_period_range_frozen()` `BEFORE UPDATE` que rechaza (`23514`, constraint lógico `financial_period_range_frozen`) cambiar `period_start`/`period_end` si `OLD.status <> 'DRAFT'`. La contigüidad no es expresable como constraint simple: la garantiza `PeriodCalendar` y la verifica el job (`planning_period_gaps_total` métrica + log `error`), y un test de propiedades.

12. **Auditoría y recorrido** (INV-029, D37): `planning.period.created`, `planning.period.activated`, `planning.period.rescheduled` (con `before/after` de rango) vía `AuditPort` en la misma Unit of Work; transiciones `CREATE`/`ACTIVATE` en `audit.lifecycle_transition` con `aggregate_type = 'FINANCIAL_PERIOD'`. El requirement de recorrido del periodo se agrega en `add-month-closing` (`audit/lifecycle-timeline`), que es donde la máquina queda completa.

13. **RLS y grants** (ADR-0023): `planning.financial_period` = **WS** con `ENABLE` + `FORCE`, política `workspace_id = platform.current_workspace_id()` (fail-closed `PF002`); `pf_app`: `SELECT, INSERT, UPDATE` (sin `DELETE`; los periodos nunca se borran); `pf_worker` hereda de `pf_app` y opera por workspace con `SET LOCAL`.

14. **Autorización:** lectura con rol mínimo `VIEWER` (docs/10 §10 "Leer cualquier recurso de negocio"); `ensurePeriods` y `activatePeriod` con `EDITOR` (mismo nivel que "Presupuestos, templates…"). La reapertura (OWNER) la define `add-month-closing`.

15. **`PeriodCreatedHook`** (contrato con `add-budget-templates`, consolidación 2026-10-05): `EnsurePeriods` invoca `PeriodCreatedHook.onPeriodCreated(period, uow)` de forma **síncrona**, dentro de su misma Unit of Work, por cada fila efectivamente insertada (las que `ON CONFLICT DO NOTHING` descarta no se notifican). Los participantes se registran en la composición del módulo PLANNING (lista vacía por defecto; `add-budget-templates` registra la aplicación del template predeterminado). Una excepción de un participante revierte la creación (la ejecución siguiente la reintenta); los participantes deben ser idempotentes. Alternativa descartada: evento `planning.PeriodCreated.v1` + consumidor (eventual; un periodo podría quedar visible sin su plan). Requirement "Participantes de la creación de periodos en la misma transacción".

## Contratos

Cambios EXACTOS requeridos (este change no edita `contracts/`; los consolida el lead):

**`contracts/openapi/finance-api.v1.yaml`**

1. Tag `planning` (ya existe como "LATER (Phase 2)"): cambiar la descripción a "Phase 2: financial periods, monthly plan, budgets, templates and month closing."
2. Operaciones nuevas (todas con `x-openspec-capability: [planning/financial-periods]`, seguridad estándar, parámetro `workspaceId`):
   - `GET /workspaces/{workspaceId}/periods` — `operationId: listPeriods`, `x-required-role: VIEWER`; query `status` (`FinancialPeriodStatus`, opcional, repetible), `containsDate` (`LocalDate`, opcional; excluyente con `status`), `cursor`, `limit` (1–100, default 24). Orden por `periodStart` descendente. `200` → `FinancialPeriodList`; con `containsDate` sin periodo ⇒ `404 REFERENCE_NOT_FOUND`. `401`, `403` (`WORKSPACE_ACCESS_DENIED`), `400` (`VALIDATION_FAILED`).
   - `POST /workspaces/{workspaceId}/periods` — `operationId: ensurePeriods`, `x-required-role: EDITOR`; `Idempotency-Key` opcional (la operación es idempotente por naturaleza); body `EnsurePeriodsRequest`; `200` → `FinancialPeriodList` (periodos del rango pedido); `400 VALIDATION_FAILED` (`through` > hoy + 24 meses), `403 INSUFFICIENT_ROLE`.
   - `GET /workspaces/{workspaceId}/periods/{periodId}` — `operationId: getPeriod`, `VIEWER`; `200` → `FinancialPeriod` con `ETag`; `404`.
   - `POST /workspaces/{workspaceId}/periods/{periodId}/activate` — `operationId: activatePeriod`, `EDITOR`; `If-Match` obligatorio; sin body; `200` → `FinancialPeriod`; `409` (`PERIOD_NOT_STARTED`, `INVALID_STATUS_TRANSITION`), `412`, `428`, `403`, `404`.
3. Schemas nuevos:
   - `FinancialPeriodStatus`: `enum [DRAFT, ACTIVE, CLOSED, REOPENED]`.
   - `FinancialPeriod`: `{ id: Uuid, label: string (pattern ^[0-9]{4}-(0[1-9]|1[0-2])$), periodStart: LocalDate, periodEnd: LocalDate, status: FinancialPeriodStatus, startDay: integer 1..28, isTransition: boolean, pendingClosure: boolean, closeCount: integer ≥ 0, reopenCount: integer ≥ 0, latestCloseNo: integer|null, version: integer, createdAt: Instant, activatedAt: Instant|null }` (todos required salvo los `|null`, que son required y nullable). `closeCount`, `reopenCount` y `latestCloseNo` los alimenta `add-month-closing` (en este change siempre 0/0/null).
   - `FinancialPeriodList`: `{ items: FinancialPeriod[], nextCursor: string|null }`.
   - `EnsurePeriodsRequest`: `{ through: LocalDate }` (required).
4. `ErrorCode` — agregar `PERIOD_NOT_STARTED` (409). Se usan existentes: `INVALID_STATUS_TRANSITION`, `PERIOD_CLOSED`, `REFERENCE_NOT_FOUND`, `VALIDATION_FAILED`, `INSUFFICIENT_ROLE`, `WORKSPACE_ACCESS_DENIED`, `PRECONDITION_FAILED`, `PRECONDITION_REQUIRED`.
5. `AuditEntityType`/`LifecycleAggregateType` (si el contrato de `audit/lifecycle-timeline` enumera agregados): agregar `FINANCIAL_PERIOD` (lo usa `add-month-closing` para `GET …/periods/{id}/lifecycle`).

**`contracts/events/planning/`** (carpeta nueva)

- `PeriodActivated.v1.schema.json` — `eventType: planning.PeriodActivated`, `aggregateType: FinancialPeriod`; payload `{ workspaceId, periodId, label, periodStart, periodEnd, startDay, isTransition, activatedAt, activation: 'AUTOMATIC'|'MANUAL' }` (`additionalProperties: false`). Productor PLANNING; consumidores: REPORTING (rótulo del periodo en curso; opcional), NOTIFY (pf-p2b, opcional "empezó el mes"). Idempotencia natural `(periodId, 'ACTIVATED')`: un periodo se activa una sola vez en su vida. PII: ninguna.

**Eventos consumidos** (sin cambios de schema): `identity.WorkspaceCreated.v1`, `identity.WorkspaceSettingsChanged.v1` (`field = fiscalMonthStartDay`; también `timeZone` dispara `ActivateDuePeriods`), `ledger.JournalEntryPosted.v1` (`entryDate`). Se documenta a PLANNING como consumidor en sus schemas/README (descripción) y en docs/11.

## Modelo de datos

`planning.financial_period` (schema nuevo `planning`; docs/08 §5.6 se actualiza):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | generado en la app (UUIDv7) |
| `workspace_id` | `uuid` NOT NULL FK `iam.workspace` | RLS |
| `label` | `char(7)` NOT NULL | `YYYY-MM` del inicio; `UNIQUE (workspace_id, label)` |
| `period_start`, `period_end` | `date` NOT NULL | inclusivos; `UNIQUE (workspace_id, period_start)`; exclusión gist diferible |
| `start_day` | `smallint` NOT NULL | día de inicio usado al calcular el rango (1..28) |
| `is_transition` | `boolean` NOT NULL DEFAULT false | |
| `status` | `text` NOT NULL | `DRAFT \| ACTIVE \| CLOSED \| REOPENED` |
| `close_count`, `reopen_count` | `int` NOT NULL DEFAULT 0 | los incrementa `add-month-closing` |
| `latest_close_no` | `int` NULL | idem |
| `created_at`, `activated_at` | `timestamptz` | |
| `version` | `int` NOT NULL | optimistic locking (`If-Match`) |

Índices: `(workspace_id, status)`, `(workspace_id, period_start DESC)`. RLS **WS**; grants `pf_app` `SELECT, INSERT, UPDATE`.

## Dependencias con otros changes

- **Requiere (Phase 1, ya archivados):** `add-workspace-identity` (`timeZone`, `fiscalMonthStartDay`, roles), `add-event-outbox` (outbox/inbox/jobs), `add-audit-trail`, `add-ledger-core` (rango de actividad del ledger), `add-lifecycle-timeline` (registro de transiciones).
- **Habilita:** `add-month-closing` (este mismo bloque pf-p2a; usa `FinancialPeriod`, la máquina y `PeriodQuery`), y en pf-p2b `add-budgets` / `add-budget-templates` (plan mensual por `periodId`, `PlanningEditGuard`, `PeriodCreatedHook`, periodo anterior con `PeriodQuery.getPrevious`, propagación "a futuro" solo a periodos `DRAFT` — FR-PLANNING-014 — consultando `listPeriods(status=DRAFT)`), `notifications/alerts` (umbral "una sola vez por periodo": la clave de dedup usa `periodId`/`label` de este change).
- **Contrato con `add-budget-templates`:** implementa y registra un participante de `PeriodCreatedHook` (decisión 15).
- **Contrato que pf-p2b debe respetar:** el plan mensual (FR-PLANNING-008) se asocia a `periodId` (no a un `YearMonth` calendario) y antes de toda mutación llama a `PlanningEditGuard.assertPlanEditable(periodId)` en su Unit of Work. Si pf-p2b modela el presupuesto por `(periodId, currency)` (docs/08 `planning.budget`), sus FKs apuntan a `planning.financial_period(id)`.
- **Sin dependencia** de pf-p2c en este change.

## Riesgos / Trade-offs

- [RISK-020: activación o "hoy" calculado en UTC] → `Clock.today(tz)` obligatorio en dominio (lint existente contra `new Date()`), tests con TZ del proceso forzada a `UTC` y `America/La_Paz` (`TZ=` en vitest) y escenarios de 23:30/00:05 La Paz.
- [Recalcular `DRAFT` referenciados por planes] → se conserva la identidad y la etiqueta; el plan sigue siendo del "mismo" periodo con otro rango. Confirmado por el owner (docs/33 D61, pregunta abierta 3).
- [Periodos creados por un asiento con fecha errónea muy antigua (p. ej. 2016)] → mientras no haya cierres se crearían ~120 periodos `ACTIVE` "pendientes de cierre". Mitigación: la cobertura retroactiva solo crea periodos, no obliga a cerrarlos en orden hasta que el owner cierre el primero; el owner confirmó la cobertura automática desde el asiento más antiguo en Phase 2 (docs/33 D62, pregunta abierta 4).
- [Job horario por workspace] → costo despreciable (un workspace hoy); cuando existan muchos, el job pagina workspaces y usa `pg-boss` con `singletonKey` por workspace.
- [Trade-off: periodos persistidos vs calculados al vuelo] → persistirlos da identidad estable a planes, cierres y snapshots y permite constraints de BD; a cambio requiere el recálculo de `DRAFT`.

## Plan de migración

Fase *expand* únicamente, en `apps/api/db/migrations/` (layout real del repo), migración `YYYYMMDDHHMMSS_planning_financial_period.sql`:
1. `CREATE SCHEMA planning` con grants de uso a `pf_app`/`pf_worker`.
2. `planning.financial_period` con constraints, exclusión gist `DEFERRABLE INITIALLY DEFERRED`, índices y trigger `planning.assert_period_range_frozen()`.
3. RLS `ENABLE` + `FORCE`, política `ws_isolation`, grants (`SELECT, INSERT, UPDATE` a `pf_app`).
4. Sin backfill en la migración: los periodos los crea `EnsurePeriods` al arrancar el worker (consumidor de arranque) y en la primera ejecución del cron para cada workspace existente (incluidos los demo de ADR-0026, que se purgan junto con el workspace: la función de purga de demo debe incluir `planning.financial_period` — tarea 5.4).
Rollback local: `down` de la migración (sin datos productivos). En entornos con datos: *roll-forward*. Test de migración sobre PG vacío (Testcontainers) + test de catálogo RLS (RISK-021).

## Preguntas abiertas

**Todas resueltas por el owner el 2026-10-08** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md), decisiones D59–D111); cada pregunta indica su decisión. Se conserva el texto original.

Numeradas para que el lead las consolide (P-A = bloque pf-p2a). Cada una con la recomendación del autor.

- **P-A1. Etiqueta del periodo con día de inicio ≠ 1.** ¿El periodo del 2026-10-25 al 2026-11-24 se llama "2026-10" (mes de inicio) o "2026-11" (mes de fin, el que "financia" el salario del 25)? *Recomendación:* mes de inicio (implementado así en las specs); es determinista, coincide con el mes calendario para día 1 y facilita la regla de transición. Cambiarlo más adelante es solo de presentación si se guarda `period_start`. → **Resuelta por el owner (2026-10-08): D59** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
- **P-A2. Varios periodos `active` pendientes de cierre.** FR-PLANNING-002 dice "solo puede haber un periodo active que contenga la fecha actual". *Recomendación:* interpretarlo como "el periodo que contiene hoy nunca queda en `draft`" y permitir varios `active` terminados (pendientes de cierre, marcados como tales), porque el cierre es manual y puede atrasarse. Alternativa: un estado extra `ended`/`pending_close`, que agrega transiciones sin aportar reglas nuevas. → **Resuelta por el owner (2026-10-08): D60** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
- **P-A3. Cambio del día de inicio con planes ya creados en periodos futuros.** *Recomendación:* recalcular los `draft` conservando su identidad y su plan (especificado). Alternativa: bloquear el cambio si algún `draft` tiene plan (más conservador, peor UX). → **Resuelta por el owner (2026-10-08): D61** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
- **P-A4. Fecha mínima de planificación.** Mientras no haya cierres, un asiento muy antiguo crea periodos hacia atrás. ¿Se fija un "inicio de planificación" explícito (p. ej. el mes del primer cierre que hará el owner) para no listar decenas de meses "pendientes de cierre"? *Recomendación:* sí, como setting opcional del workspace `planningStartDate` en `add-month-closing` o en un change pequeño posterior; para Phase 2 basta con la cobertura automática desde el asiento más antiguo (el owner tiene datos desde 2026). → **Resuelta por el owner (2026-10-08): D62** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
- **P-A5. Lookahead por defecto.** *Recomendación:* 3 periodos futuros en `draft` (FR-PLANNING-002 pide "al menos 1"); configurable por entorno con `PLANNING_PERIOD_LOOKAHEAD`, no por workspace en Phase 2. → **Resuelta por el owner (2026-10-08): D63** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
- **P-A6. Provisión síncrona vs asíncrona de los periodos iniciales.** D54 hizo síncrona la provisión del catálogo de categorías. *Recomendación:* asíncrona (consumidor de `WorkspaceCreated` + cron), porque ningún comando depende de que existan periodos; si el owner prefiere simetría con D54, se puede invocar `EnsurePeriods` desde el `WorkspaceCreatedHook` sin cambiar las specs. → **Resuelta por el owner (2026-10-08): D64** ([docs/33](../../../docs/33-phase-2-consolidation-decisions.md)).
