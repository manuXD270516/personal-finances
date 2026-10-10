# Tareas

> Requiere aplicados (Phase 1–2, archivados): `add-transaction-recording`, `add-transfers`, `add-accounts-management`, `add-classification`, `add-financial-periods`, `add-month-closing`, `add-budgets` (`FlowValuation`), `add-lifecycle-timeline`, `add-alerts`, `add-event-outbox`, `improve-event-throughput`, `add-audit-trail`, `add-api-conventions`, `add-workspace-export`. Habilita `add-commitment-matching`, `add-subscriptions` (`commitments/subscriptions`) y el de `reporting/cash-flow-calendar`. No iniciar un grupo con preguntas abiertas **[B]** de design.md sin resolver que lo afecten (docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `commitments/recurrence-engine`, los requirements ADDED de `audit/lifecycle-timeline` y `notifications/alerts` y las preguntas abiertas 1–12 de design.md; verificar con `openspec validate add-recurrence-engine --strict`
- [ ] 1.2 Revisar TC-COMMITMENTS-RECUR-001..052 contra los scenarios (cifras a mano, fechas fijas, `FixedClock` en America/La_Paz); pasar a `ready` y `requirement_status: confirmed` tras la revisión; `pnpm traceability:check` sin errores (todo requirement Must con ≥ 1 TC)
- [ ] 1.3 Coordinar con los changes hermanos de Phase 3: `add-commitment-matching` (`OccurrenceLinkPort`, columnas de tolerancia), `commitments/subscriptions` (`RecurringDefinitionPort`, `managedBy = SUBSCRIPTION`, consumo de `RecurringOccurrenceMaterialized.v1`) y `reporting/cash-flow-calendar` (`CommittedQuery`, `UpcomingPaymentsQuery`, `ResolvedOccurrencesQuery`, `DefinitionStatsQuery`)

## 2. DOMAIN (TDD, lógica financiera y de fechas crítica)

- [ ] 2.1 `@pf/shared-kernel/recurrence`: `RecurrenceRule` (cadencias predefinidas → regla, intervalo N, semimensual), `expand(rule, window)` con clamp de día 29–31 y bisiesto, `WeekendAdjustment`: tests primero de TC-COMMITMENTS-RECUR-005, -006, -012, -013; PBT de expansión TC-COMMITMENTS-RECUR-045 (100 corridas en PR, 10 000 nightly; `TZ=UTC`, `America/La_Paz` y una zona con DST)
- [ ] 2.2 `RRuleSubset.parse/format` (FREQ, INTERVAL, BYDAY con ordinal, BYMONTHDAY, BYSETPOS, COUNT, UNTIL; rechazos `INVALID_RRULE`): tests primero de TC-COMMITMENTS-RECUR-007, -008 (Should; puede posponerse sin tocar el modelo)
- [ ] 2.3 `RecurringDefinition` + `DefinitionVersion` + `AmountSpec` + `MaterializationMode` (validaciones de tipo, montos, modo permitido, tipos reservados, transferencias): tests primero de TC-COMMITMENTS-RECUR-001, -003, -004, -010, -011, -020
- [ ] 2.4 `OccurrenceGenerator` (candidatos por ventana sobre versiones, `COUNT` acumulado, `until`) y PBT de idempotencia: tests primero de TC-COMMITMENTS-RECUR-014 (∀ regla, ∀ ventanas solapadas: sin duplicados; dos veces = una vez) y -016
- [ ] 2.5 `RecurringOccurrence` + máquina `RECURRING_OCCURRENCE_LIFECYCLE` (transiciones, guardas, anotación de edición) y `OccurrenceClock` (próxima/atrasada/materializable con `today` en la zona del workspace): tests primero de TC-COMMITMENTS-RECUR-009, -018, -027, -028, -042
- [ ] 2.6 `RevisionPlanner` (pausa, reanudación, fin, `COUNT`, revisión "esta y las siguientes", descarte de ediciones, guarda de fecha efectiva) y máquina `RECURRING_DEFINITION_LIFECYCLE`: tests primero de TC-COMMITMENTS-RECUR-032, -033, -034, -035, -047, -048, -041
- [ ] 2.7 `CommittedCalculator` (ocurrencias no resueltas + pendientes sin doble conteo, `MIN_MAX` por máximo, `VARIABLE` contado aparte, criterio de transferencias líquida → no líquida, ingresos esperados aparte; Decimal 40, HALF_EVEN al presentar): tests primero de TC-COMMITMENTS-RECUR-036, -037, -052

## 3. APPLICATION

- [ ] 3.1 Puertos (`RecurringTransactionPort`, `TransactionLinkQuery`, `PendingFlowQuery`, `AccountCatalogQuery`, `CategoryCatalogQuery`, `FxValuationPort`, `WorkspaceCalendarQuery`, `FinancialPeriodPort`, `AuditPort`, `LifecyclePort`, `OutboxPort`, `UnitOfWork`, `Clock`) y dobles en `application/testing`
- [ ] 3.2 `CreateDefinition`, `UpdateDefinitionDetails`, `ReviseDefinition`, `PauseDefinition`, `ResumeDefinition`, `EndDefinition` con generación síncrona, `FOR UPDATE` de la definición, auditoría + recorrido + outbox en la UoW y roles: tests con dobles de TC-COMMITMENTS-RECUR-001, -002, -032, -034, -039, -041
- [ ] 3.3 `MaterializeOccurrence` (monto y fecha por tipo, `min(dueDate, today)`, errores de Transactions propagados), `EditOccurrence`, `SkipOccurrence`, `LinkOccurrence` (compatibilidad, `TRANSACTION_ALREADY_LINKED`): tests de TC-COMMITMENTS-RECUR-023, -024, -025, -026, -029, -030, -046, -049
- [ ] 3.4 Job `GenerateOccurrences(workspace)`: extensión de ventana, `BECOME_DUE`/`MARK_OVERDUE`, creación automática (`lastAutoCreateError` ante rechazo), lote de eventos: tests de TC-COMMITMENTS-RECUR-016, -018, -019, -021, -022, -050, -051
- [ ] 3.5 Consumidor `commitments.transaction-voided` (`RELEASE`, inbox): tests de TC-COMMITMENTS-RECUR-031
- [ ] 3.6 Queries `ListDefinitions`, `GetDefinition`, `ListOccurrences`, `ListUpcoming`, `GetCommitted`, lifecycle de definición y ocurrencia; contratos públicos `CommittedQuery`, `UpcomingPaymentsQuery`, `ResolvedOccurrencesQuery`, `DefinitionStatsQuery`, `OccurrenceLinkPort`: tests de TC-COMMITMENTS-RECUR-036, -038

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand: schema `commitments`, tres tablas, RLS forzada, grants, `forbid_mutation` en versiones, `workspace_scoped_table`; migración separada con `CREATE UNIQUE INDEX CONCURRENTLY` sobre `txn.transaction`; test de migración (TC-COMMITMENTS-RECUR-015 usa el UNIQUE nominal)
- [ ] 4.2 Repositorios Kysely (`INSERT … ON CONFLICT DO NOTHING RETURNING`, `FOR UPDATE`, índices del scheduler) y test de concurrencia con dos generaciones en paralelo sobre Postgres real: TC-COMMITMENTS-RECUR-015
- [ ] 4.3 Transactions: adapter de `RecurringTransactionPort` sobre `TransactionsService` (`source = RECURRING`, `externalRef`, UoW del llamador), `TransactionLinkQuery`, `PendingFlowQuery`; `origin.refId` en `TransactionCreated.v1`; test de contrato del puerto y regresión TC-TRANSACTIONS-* en verde
- [ ] 4.4 Adapter `FinancialPeriodPort` en la composición de `apps/api` sobre `PeriodQuery`; `pnpm arch:check` sin ciclos ni imports prohibidos
- [ ] 4.5 Schemas de eventos `contracts/events/commitments/*.v1.schema.json` y test de contrato de eventos: TC-COMMITMENTS-RECUR-040
- [ ] 4.6 Worker: cron `commitments.generate-occurrences` (`COMMITMENTS_SCHEDULER_CRON`, `COMMITMENTS_HORIZON_DAYS` en `api` y `worker`, validación de config), `singletonKey` por workspace, métricas; benchmark NFR-PERF-009 en la suite `perf`: TC-COMMITMENTS-RECUR-017
- [ ] 4.7 Audit: `LIFECYCLE_AGGREGATE_TYPES` + `RecurringDefinition`, `RecurringOccurrence` y política de campos auditables (`money` para montos)
- [ ] 4.8 Portabilidad: secciones `recurring-definitions`, `recurring-definition-versions`, `recurring-occurrences` (orden 750) y esquemas `contracts/export/v1/`; test de cobertura de `workspace_scoped_table` y de ida y vuelta del export

## 5. API

- [ ] 5.1 OpenAPI aditivo (tag `recurring`, schemas, errores nuevos en `ErrorCode` `x-extensible-enum`, `x-reserved` en `RecurringKind`); `oasdiff` sin breaking changes
- [ ] 5.2 Controller `recurring` (roles, `Idempotency-Key`, `If-Match`, RFC 9457) y tests de API de TC-COMMITMENTS-RECUR-002, -003, -023, -025, -030, -035, -039; lifecycle y export CSV/PDF del recorrido

## 6. NOTIFICATIONS

- [ ] 6.1 Tipos `RECURRING_PAYMENT_UPCOMING` y `RECURRING_APPROVAL_REQUIRED` (preferencias, plantillas es/en/pt sin montos salvo opt-in) y consumidor `notifications.occurrence-due` con clave `occurrence-due:<occurrenceId>`: tests de TC-COMMITMENTS-RECUR-043, -044

## 7. UI

- [ ] 7.1 Pantalla `/recurring`: pestañas Próximos (7/30/60/90), Por aprobar (contador en la sidebar), Definiciones; formulario con vista previa de 6 fechas y aviso de fin de mes; acciones Aprobar/Vincular/Omitir/Editar; tarjeta "Comprometido del periodo" con desglose; detalle con versiones y recorrido; i18n es/en/pt; accesibilidad (axe sin violaciones serias)
- [ ] 7.2 Tests de componentes (estados con texto + icono, montos con escala de la moneda, rango `MIN_MAX`)

## 8. TESTS / E2E

- [ ] 8.1 E2E: crear "Internet" mensual en aprobación pendiente, ver la ocurrencia en Por aprobar, aprobarla con monto real, anular el gasto y verla liberada; crear "Alquiler", revisarlo "desde enero" y verificar el comprometido del periodo (TC-COMMITMENTS-RECUR-023, -031, -034, -036)
- [ ] 8.2 (Opcional) Dataset demo: 6 definiciones con 6 meses de historia (docs/29), cargadas solo por la acción explícita de demo (D36)

## 9. DOCS

- [ ] 9.1 Aplicar la lista "Cambios a docs compartidos" de design.md (docs/01, 02, 03, 04, 05, 08, 10, 11, 26, 28, config-reference) cuando el lead la consolide
- [ ] 9.2 Actualizar estados de TC-COMMITMENTS-RECUR-* (`automated`, `automated_tests`), matriz de trazabilidad (`pnpm traceability:matrix`), `pnpm traceability:check` y `openspec validate add-recurrence-engine --strict`
