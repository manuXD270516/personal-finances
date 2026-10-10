# Tareas

> Requiere aplicados (Phase 1–2, archivados): `add-transaction-recording`, `add-transfers`, `add-accounts-management`, `add-classification`, `add-financial-periods`, `add-month-closing`, `add-budgets` (`FlowValuation`), `add-lifecycle-timeline`, `add-alerts`, `add-event-outbox`, `improve-event-throughput`, `add-audit-trail`, `add-api-conventions`, `add-workspace-export`. Habilita `add-commitment-matching`, `add-subscriptions` (`commitments/subscriptions`) y el de `reporting/cash-flow-calendar`. No iniciar un grupo con preguntas abiertas **[B]** de design.md sin resolver que lo afecten (docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner la spec `commitments/recurrence-engine`, los requirements ADDED de `audit/lifecycle-timeline` y `notifications/alerts` y las preguntas abiertas 1–12 de design.md; verificar con `openspec validate add-recurrence-engine --strict`
- [x] 1.2 Revisar TC-COMMITMENTS-RECUR-001..052 contra los scenarios (cifras a mano, fechas fijas, `FixedClock` en America/La_Paz); pasar a `ready` y `requirement_status: confirmed` tras la revisión; `pnpm traceability:check` sin errores (todo requirement Must con ≥ 1 TC)
- [x] 1.3 Coordinar con los changes hermanos de Phase 3: `add-commitment-matching` (`OccurrenceLinkPort`, columnas de tolerancia), `commitments/subscriptions` (`RecurringDefinitionPort`, `managedBy = SUBSCRIPTION`, consumo de `RecurringOccurrenceMaterialized.v1`) y `reporting/cash-flow-calendar` (`CommittedQuery`, `UpcomingPaymentsQuery`, `ResolvedOccurrencesQuery`, `DefinitionStatsQuery`)

## 2. DOMAIN (TDD, lógica financiera y de fechas crítica)

- [x] 2.1 `@pf/shared-kernel/recurrence`: `RecurrenceRule` (cadencias predefinidas → regla, intervalo N, semimensual), `expand(rule, window)` con clamp de día 29–31 y bisiesto, `WeekendAdjustment`: tests primero de TC-COMMITMENTS-RECUR-005, -006, -012, -013; PBT de expansión TC-COMMITMENTS-RECUR-045 (100 corridas en PR, 10 000 nightly; `TZ=UTC`, `America/La_Paz` y una zona con DST)
- [x] 2.2 `RRuleSubset.parse/format` (FREQ, INTERVAL, BYDAY con ordinal, BYMONTHDAY, BYSETPOS, COUNT, UNTIL; rechazos `INVALID_RRULE`): tests primero de TC-COMMITMENTS-RECUR-007, -008 (Should; puede posponerse sin tocar el modelo)
- [x] 2.3 `RecurringDefinition` + `DefinitionVersion` + `AmountSpec` + `MaterializationMode` (validaciones de tipo, montos, modo permitido, tipos reservados, transferencias): tests primero de TC-COMMITMENTS-RECUR-001, -003, -004, -010, -011, -020
- [x] 2.4 `OccurrenceGenerator` (candidatos por ventana sobre versiones, `COUNT` acumulado, `until`) y PBT de idempotencia: tests primero de TC-COMMITMENTS-RECUR-014 (∀ regla, ∀ ventanas solapadas: sin duplicados; dos veces = una vez) y -016
- [x] 2.5 `RecurringOccurrence` + máquina `RECURRING_OCCURRENCE_LIFECYCLE` (transiciones, guardas, anotación de edición) y `OccurrenceClock` (próxima/atrasada/materializable con `today` en la zona del workspace): tests primero de TC-COMMITMENTS-RECUR-009, -018, -027, -028, -042
- [x] 2.6 `RevisionPlanner` (pausa, reanudación, fin, `COUNT`, revisión "esta y las siguientes", descarte de ediciones, guarda de fecha efectiva) y máquina `RECURRING_DEFINITION_LIFECYCLE`: tests primero de TC-COMMITMENTS-RECUR-032, -033, -034, -035, -047, -048, -041
- [x] 2.7 `CommittedCalculator` (ocurrencias no resueltas + pendientes sin doble conteo, `MIN_MAX` por máximo, `VARIABLE` contado aparte, criterio de transferencias líquida → no líquida, ingresos esperados aparte; Decimal 40, HALF_EVEN al presentar): tests primero de TC-COMMITMENTS-RECUR-036, -037, -052

## 3. APPLICATION

- [x] 3.1 Puertos (`RecurringTransactionPort`, `TransactionLinkQuery`, `PendingFlowQuery`, `AccountCatalogQuery`, `CategoryCatalogQuery`, `FxValuationPort`, `WorkspaceCalendarQuery`, `FinancialPeriodPort`, `AuditPort`, `LifecyclePort`, `OutboxPort`, `UnitOfWork`, `Clock`) y dobles en `application/testing`
- [x] 3.2 `CreateDefinition`, `UpdateDefinitionDetails`, `ReviseDefinition`, `PauseDefinition`, `ResumeDefinition`, `EndDefinition` con generación síncrona, `FOR UPDATE` de la definición, auditoría + recorrido + outbox en la UoW y roles: tests con dobles de TC-COMMITMENTS-RECUR-001, -002, -032, -034, -039, -041
- [x] 3.3 `MaterializeOccurrence` (monto y fecha por tipo, `min(dueDate, today)`, errores de Transactions propagados), `EditOccurrence`, `SkipOccurrence`, `LinkOccurrence` (compatibilidad, `TRANSACTION_ALREADY_LINKED`): tests de TC-COMMITMENTS-RECUR-023, -024, -025, -026, -029, -030, -046, -049
- [x] 3.4 Job `GenerateOccurrences(workspace)`: extensión de ventana, `BECOME_DUE`/`MARK_OVERDUE`, creación automática (`lastAutoCreateError` ante rechazo), lote de eventos: tests de TC-COMMITMENTS-RECUR-016, -018, -019, -021, -022, -050, -051
- [x] 3.5 Consumidor `commitments.transaction-voided` (`RELEASE`, inbox): tests de TC-COMMITMENTS-RECUR-031
- [x] 3.6 Queries `ListDefinitions`, `GetDefinition`, `ListOccurrences`, `ListUpcoming`, `GetCommitted`, lifecycle de definición y ocurrencia; contratos públicos `CommittedQuery`, `UpcomingPaymentsQuery`, `ResolvedOccurrencesQuery`, `DefinitionStatsQuery`, `OccurrenceLinkPort`: tests de TC-COMMITMENTS-RECUR-036, -038

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand: schema `commitments`, tres tablas, RLS forzada, grants, `forbid_mutation` en versiones, `workspace_scoped_table`; migración separada con `CREATE UNIQUE INDEX CONCURRENTLY` sobre `txn.transaction`; test de migración (TC-COMMITMENTS-RECUR-015 usa el UNIQUE nominal)
- [x] 4.2 Repositorios Kysely (`INSERT … ON CONFLICT DO NOTHING RETURNING`, `FOR UPDATE`, índices del scheduler) y test de concurrencia con dos generaciones en paralelo sobre Postgres real: TC-COMMITMENTS-RECUR-015
- [x] 4.3 Transactions: adapter de `RecurringTransactionPort` sobre `TransactionsService` (`source = RECURRING`, `externalRef`, UoW del llamador), `TransactionLinkQuery`, `PendingFlowQuery`; `origin.refId` en `TransactionCreated.v1`; test de contrato del puerto y regresión TC-TRANSACTIONS-* en verde
- [x] 4.4 Adapter `FinancialPeriodPort` en la composición de `apps/api` sobre `PeriodQuery`; `pnpm arch:check` sin ciclos ni imports prohibidos
- [x] 4.5 Schemas de eventos `contracts/events/commitments/*.v1.schema.json` y test de contrato de eventos: TC-COMMITMENTS-RECUR-040
- [x] 4.6 Worker: cron `commitments.generate-occurrences` (`COMMITMENTS_SCHEDULER_CRON`, `COMMITMENTS_HORIZON_DAYS` en `api` y `worker`, validación de config), `singletonKey` por workspace, métricas; benchmark NFR-PERF-009 en la suite `perf`: TC-COMMITMENTS-RECUR-017
- [x] 4.7 Audit: `LIFECYCLE_AGGREGATE_TYPES` + `RecurringDefinition`, `RecurringOccurrence` y política de campos auditables (`money` para montos)
- [x] 4.8 Portabilidad: secciones `recurring-definitions`, `recurring-definition-versions`, `recurring-occurrences` (orden 750) y esquemas `contracts/export/v1/`; test de cobertura de `workspace_scoped_table` y de ida y vuelta del export

## 5. API

- [x] 5.1 OpenAPI aditivo (tag `recurring`, schemas, errores nuevos en `ErrorCode` `x-extensible-enum`, `x-reserved` en `RecurringKind`); `oasdiff` sin breaking changes
- [x] 5.2 Controller `recurring` (roles, `Idempotency-Key`, `If-Match`, RFC 9457) y tests de API de TC-COMMITMENTS-RECUR-002, -003, -023, -025, -030, -035, -039; lifecycle y export CSV/PDF del recorrido

## 6. NOTIFICATIONS

- [x] 6.1 Tipos `RECURRING_PAYMENT_UPCOMING` y `RECURRING_APPROVAL_REQUIRED` (preferencias, plantillas es/en/pt sin montos salvo opt-in) y consumidor `notifications.occurrence-due` con clave `occurrence-due:<occurrenceId>`: tests de TC-COMMITMENTS-RECUR-043, -044

## 7. UI

- [x] 7.1 Pantalla `/recurring`: pestañas Próximos (7/30/60/90), Por aprobar (contador en la sidebar), Definiciones; formulario con vista previa de 6 fechas y aviso de fin de mes; acciones Aprobar/Vincular/Omitir/Editar; tarjeta "Comprometido del periodo" con desglose; detalle con versiones y recorrido; i18n es/en/pt; accesibilidad (axe sin violaciones serias)
- [x] 7.2 Tests de componentes (estados con texto + icono, montos con escala de la moneda, rango `MIN_MAX`)

## 8. TESTS / E2E

- [x] 8.1 E2E: crear "Internet" mensual en aprobación pendiente, ver la ocurrencia en Por aprobar, aprobarla con monto real, anular el gasto y verla liberada; crear "Alquiler", revisarlo "desde enero" y verificar el comprometido del periodo (TC-COMMITMENTS-RECUR-023, -031, -034, -036)
- [x] 8.2 (Opcional) Dataset demo: 6 definiciones con 6 meses de historia (docs/29), cargadas solo por la acción explícita de demo (D36)

## 9. DOCS

- [x] 9.1 Aplicar la lista "Cambios a docs compartidos" de design.md (docs/01, 02, 03, 04, 05, 08, 10, 11, 26, 28, config-reference) cuando el lead la consolide
- [x] 9.2 Actualizar estados de TC-COMMITMENTS-RECUR-* (`automated`, `automated_tests`), matriz de trazabilidad (`pnpm traceability:matrix`), `pnpm traceability:check` y `openspec validate add-recurrence-engine --strict`

## Notas de implementación (2026-10-10)

Todas las tareas quedaron marcadas; estas son las desviaciones y decisiones propias respecto de design.md (el lead las revisa):

- **1.1 / 1.3:** la revisión con el owner ya está en `docs/35` (D114–D131); la coordinación con los changes hermanos quedó en los contratos (`CommittedQuery`, `UpcomingPaymentsQuery`, `ResolvedOccurrencesQuery`, `DefinitionStatsQuery`, `OccurrenceLinkPort`, `RecurringDefinitionPort` solo como tipo).
- **Fin de una definición:** `end_date date` en `recurring_definition` (no estaba en el modelo): "terminar" con fecha futura fija el cierre de la serie y el job la pasa a `ENDED` cuando la última fecha ya pasó; sin fecha (o hoy) pasa a `ENDED` al instante.
- **Columnas adicionales:** `recurring_occurrence.last_auto_create_on` (día del último intento de creación automática: no se reintenta el mismo día, D129) y `recurring_definition_version.month_days jsonb` (días del mes de la cadencia; el export solo soporta arreglos de uuid/text/numeric). No se creó `recurring_definition.last_auto_create_error` (el error vive en la ocurrencia).
- **Job:** un único job cron `commitments.generate-occurrences` recorre los workspaces activos en serie (en vez de un job por workspace con `singletonKey`); la unidad de trabajo es por definición, y la creación automática por ocurrencia. Fallos de una definición o workspace no detienen a los demás.
- **Versión de la definición:** cada hecho publicado sube `version` (el outbox exige versión distinta por tipo de evento); el avance del high-water mark `generated_through` sin hechos no la sube.
- **Revisión:** una cadencia, intervalo o RRULE nuevos reinician el ancla en la fecha efectiva y el máximo restante descuenta las fechas ya producidas; la fecha efectiva viaja como `reason` del paso `REVISE` del recorrido (`detailRefs` solo admite UUID o enteros) junto con `revisionFrom/To`.
- **Recorrido de la ocurrencia en revisiones:** reescribir una ocurrencia (descartar ediciones) se registra como anotación; cancelar/reinstaurar, como transición.
- **API:** `GET W/recurring/occurrences/{occurrenceId}` (aditivo, para el enlace de las notificaciones); `details.reasons` de `OCCURRENCE_LINK_MISMATCH` se publica como extensión `details` del problem; lista de ocurrencias con `days` incluye ingresos (el criterio D127 aplica a `UpcomingPaymentsQuery` y al comprometido). `reviseRecurringDefinition` lleva `x-rate-limit: costly` (D113).
- **Notificaciones:** `NotificationLink` conserva `periodId`/`periodLabel` obligatorios (aditivo para oasdiff): para `RECURRING_OCCURRENCE` son el periodo financiero del vencimiento (`RecurringOccurrenceDue.v1` agrega `periodId`) o el id de la ocurrencia, y el mes del vencimiento; el email "básico" no lleva el nombre ni el monto (docs/12).
- **Sin categoría:** una transacción creada sin categoría nace en *Uncategorized* y no aplica los tags de la plantilla.
- **4.3:** `RecurringTransactionPort` aplica el origen de auditoría `recurring` con un envoltorio en la composición del módulo (no en la capa de aplicación).
- **4.6:** el benchmark contra PostgreSQL está en `apps/api/test/perf/commitments.perf.ts` (nightly `perf`); el marcador del TC-017 que lee la trazabilidad es el test con dobles en memoria.
- **8.2 (opcional):** el dataset demo (6 definiciones con 6 meses de historia) no se implementó; queda pendiente para un change posterior de datos demo.
- **TC:** los 52 quedaron `automated` y `confirmed`; TC-009/-045 corren sin depender de `TZ` (aritmética pura de `LocalDate`); las propiedades usan 100 corridas en PR y `NIGHTLY=1` ⇒ 10 000.

