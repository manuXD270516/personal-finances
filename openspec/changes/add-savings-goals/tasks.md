# Tareas

> Requiere aplicados `add-accounts-management`, `add-transaction-recording`, `add-transfers`, `add-ledger-core`, `add-manual-conversions` y `add-market-rate-providers` (valoración), `add-financial-periods`, `add-budgets` (`FlowValuation`, `REPORTING_RATE_VALIDITY_WINDOW`), `add-alerts`, `add-recurrence-engine`, `add-subscriptions` (guarda `RECURRING_MANAGED_EXTERNALLY`), `add-upcoming-payments`, `add-lifecycle-timeline` y `add-workspace-export`; y, para la parte recurrente, `add-loans` (puerto público `RecurringDefinitionPort`, N5 de design.md). No iniciar la implementación con las preguntas abiertas 1, 2 y 4 de design.md sin resolver (estados, base de lo reservado y contrato con Commitments; docs/DESIGN-GATE.md). Si la pregunta 4 queda pendiente, el grupo 3.9 se difiere sin bloquear el resto.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `goals/savings-goals`, los deltas de `notifications/alerts`, `planning/budgets`, `reporting/dashboard` y `transactions/transfers`, y las preguntas abiertas 1–15 de design.md; verificar con `openspec validate add-savings-goals --strict`
- [ ] 1.2 Acordar con `add-loans` y `add-credit-cards` el puerto público `RecurringDefinitionPort` (N5) y con Transactions `GoalTransferPort` y `TransactionLinkDto.revision` (N1, N2); confirmar N3, N4 y N6; registrar el acuerdo en design.md
- [ ] 1.3 Revisar TC-GOALS-SAVINGS-001..050 contra los scenarios (cifras a mano: 1000/15000 = 6.67 %; 2000/9000 = 22.22 %; 12500/12000 = 104.17 %; 10000/6 = 1666.67; 10000/7 = 1428.57; ceil(10000/1200) = 9 ⇒ 2027-06-30; 10000/9 = 1111.11; 4000/6 = 666.67; 300 + 7500/12.50 = 900.00 USD; 300 + 21000/12.00 = 2050.00 USD; desvíos −4.00/−6.00/+6.00/−5.00 % con esperado 5000.00), fechas fijas y `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed` tras las decisiones; `pnpm traceability:check` sin errores
- [ ] 1.4 Actualizar TC-REPORTING-DASHBOARD-005 (Q9 deja de estar no disponible) junto con el delta MODIFIED de `reporting/dashboard`

## 2. DOMAIN (TDD, lógica financiera crítica)

- [ ] 2.1 Extraer `period-calendar` de `planning/domain` al shared-kernel (`FinancialPeriodCalendar.periodOf`, `periodsBetween`) sin cambio de comportamiento: tests de Planning en verde (TC-PLANNING-PERIOD-*) (N8)
- [ ] 2.2 `GoalStateMachine` (estados, transiciones de usuario y de sistema, guardas, archivo solo terminal) test-first: TC-GOALS-SAVINGS-004, -006, -007, -008, -037; PBT: ninguna secuencia sale de `CLOSED`/`CANCELLED`
- [ ] 2.3 `GoalMovement` y fondos por `(meta, cuenta, fondo)` (signos, inversos, reasignaciones) test-first: TC-GOALS-SAVINGS-025, -027, -028, -029; PBT INV-018: progreso = Σ(+) − Σ(−) y ningún fondo negativo
- [ ] 2.4 `EarmarkGuard` y `ReservationEpisode` (límite inclusivo, episodios `NORMAL ⇄ OVER_ALLOCATED`) test-first: TC-GOALS-SAVINGS-014, -015, -016, -017, -018; PBT: tras cada comando aceptado reservado ≤ saldo
- [ ] 2.5 `GoalProgressCalculator` (Σ por moneda, conversión exacta con tasa invertida, `unconverted`, HALF_EVEN al presentar) test-first: TC-GOALS-SAVINGS-030, -036
- [ ] 2.6 `RequiredContributionCalculator` (periodos incluidos, día de inicio, vencida, sin fecha) test-first: TC-GOALS-SAVINGS-031, -032; tests con `TZ=UTC` y `TZ=America/La_Paz` a las 23:30 y 00:05 de La Paz, día de inicio 25, 29-feb y fin de mes (RISK-020)
- [ ] 2.7 `ExpectedDateCalculator` (ritmo de los últimos N periodos terminados, plan como respaldo, `NO_PACE`, flujos con `FlowValuation` a la fecha) test-first: TC-GOALS-SAVINGS-033, -036
- [ ] 2.8 `GoalTrackingEvaluator` (esperado lineal, tolerancia inclusiva, estados de ciclo de vida sin avance) test-first: TC-GOALS-SAVINGS-034
- [ ] 2.9 AR `SavingsGoal` (validaciones de alta y edición, moneda bloqueada, desvincular con fondos, plan en la moneda del objetivo) test-first: TC-GOALS-SAVINGS-001, -002, -003, -005, -038

## 3. APPLICATION

- [ ] 3.1 `CreateGoal`, `UpdateGoal`, `PauseGoal`, `ResumeGoal`, `CloseGoal`, `CancelGoal` (liberaciones explícitas), `ArchiveGoal` con `If-Match`, auditoría y evaluación de estado en la UoW: TC-GOALS-SAVINGS-001, -004, -005, -006, -007, -008
- [ ] 3.2 `ContributeToGoal` REAL con `GoalTransferPort` en la misma UoW (errores de Transactions propagados) y EARMARK con lock por cuenta (`account_reservation_state FOR UPDATE`) y `AccountBalancesQuery`: TC-GOALS-SAVINGS-009, -010, -011, -012, -014, -015
- [ ] 3.3 `LinkTransactionToGoal` (`TransactionLinkQuery` con `revision`, motivos, unicidad): TC-GOALS-SAVINGS-019, -020, -021
- [ ] 3.4 `WithdrawFromGoal` (TRANSFER, LINK parcial, RELEASE) y `ReassignGoalFunds` (lock de ambas metas en orden de id): TC-GOALS-SAVINGS-024, -025, -026, -027, -028
- [ ] 3.5 Consumidor `goals.transaction-changes` (`TransactionVoided`, `TransferRevised`, `TransactionUpdated`; inverso único por `reverses_id`, aporte nuevo con la revisión, reevaluación de estado y sobre-asignación): TC-GOALS-SAVINGS-022, -023
- [ ] 3.6 Consumidor `goals.balance-watch` (`JournalEntryPosted`) y reevaluación en los comandos que bajan lo reservado; `EarmarkExceedsBalance.v1` una vez por episodio: TC-GOALS-SAVINGS-016, -017, -018
- [ ] 3.7 Job `goals.daily-evaluation` (reevaluación de metas multi-moneda: `REACH` por tipo de cambio sin `REOPEN`; barrido de sobre-asignación) con "hoy" por workspace: TC-GOALS-SAVINGS-037, -018
- [ ] 3.8 Queries `ListGoals`, `GetGoal` (progreso, requerido, ritmo, fecha, estado, tasas usadas con una sola resolución por petición), `ListGoalMovements`, `SimulateGoal`, `GetAccountReservations`, `ListGoalTransactionLinks` y los contratos públicos `GoalReservationsQuery`, `GoalPlansQuery`, `GoalSummaryQuery`, `GoalFlowsQuery`: TC-GOALS-SAVINGS-013, -030..036, -038
- [ ] 3.9 `SetGoalPlan`/`RemoveGoalPlan` con `RecurringDefinitionPort` (`createManaged` por regla, `reviseManaged`, `pauseManaged`, `resumeManaged`, `endManaged`) en la misma UoW; consumidor `goals.recurring-contributions` (`RecurringOccurrenceMaterialized.v1` con `managedBy = GOAL`, espera en `recurring_materialization` si queda pendiente): TC-GOALS-SAVINGS-038, -039
- [ ] 3.10 Consumidor `goals.contribution-suggestions` (`TransferCompleted`: sugerencias, exclusiones, expiración; completa las esperas de 3.9) y comandos `Confirm`/`Dismiss`: TC-GOALS-SAVINGS-040
- [ ] 3.11 Recorrido: registrar la máquina `SavingsGoal` en `audit/lifecycle-timeline` (Should, pregunta 12)
- [ ] 3.12 NOTIFY: tipos `GOAL_OVER_ALLOCATED` (OWNER/EDITOR), `GOAL_REACHED` y `GOAL_MILESTONE` (todos los miembros), lectura defensiva del payload, dedupe por episodio, por alcance y por hito/meta/destinatario, `alsoCrossed`, sin hitos con progreso incompleto, enlaces `GOAL`/`GOAL_RESERVATIONS`, plantillas in-app y email es/en/pt con y sin detalles: TC-GOALS-SAVINGS-042..045
- [ ] 3.13 Planning: `GoalPlanPort` (adapter en `apps/api`) y sección `goalContributions` del plan: TC-GOALS-SAVINGS-050
- [ ] 3.14 Reporting: bloques `goals` (Q9) y `goalContributions` (Q6) en el resumen; Q9 `NO_DATA` con `CREATE_GOAL`: TC-GOALS-SAVINGS-046, -047, -048

## 4. INFRASTRUCTURE

- [ ] 4.1 Paquete `packages/contexts/goals` (capas, `contracts`, reglas de dependency-cruiser: solo `contracts` de Transactions, Ledger, Accounts, FX, Commitments, Identity, Audit)
- [ ] 4.2 Migración expand: schema `goals`, siete tablas con RLS forzada, grants, `forbid_mutation` en `goal_movement`, índices únicos parciales, `platform.workspace_scoped_table`; CHECK `managed_by` con `GOAL`; tests de integración Testcontainers: aislamiento (TC-GOALS-SAVINGS-041), append-only (TC-GOALS-SAVINGS-029), unicidad de vínculo en concurrencia (TC-GOALS-SAVINGS-021), un inverso por movimiento
- [ ] 4.3 Repositorios Kysely y adapters: `GoalTransferPort` en Transactions (N1), `revision` en `TransactionLinkDto` (N2), filtro `source=GOAL` (N4), `RecurringDefinitionPort` ampliado (N5), tolerancia de `managedBy = GOAL` en los consumidores del motor (N6), `AccountBalancesQuery`, `AccountCatalogQuery`, `FxValuationPort`, `WorkspaceCalendarQuery`
- [ ] 4.4 Esquemas `contracts/events/goals/SavingsContributionRecorded.v1`, `GoalReached.v1`, `EarmarkExceedsBalance.v1` con `examples` + test de contrato; enum `managedBy` con `GOAL` en los cuatro esquemas del motor (aditivo); test de NOTIFY `consumed-events.contract.test.ts` ampliado
- [ ] 4.5 Portabilidad: `GOALS_PORTABILITY_SECTIONS` (remapeo de `goal_id`, `account_id`, `transaction_id`, `reverses_id`, `reassignment_id`, `definition_id`); test de cobertura de tablas y round-trip con metas, movimientos y plan

## 5. API

- [ ] 5.1 Operaciones de design.md § Contratos con `Idempotency-Key`, `If-Match`, ETag y problem+json; códigos nuevos en `ErrorCode` y `errors.{es,en,pt}.json`; aditivos en `ReportSummary`, `Budget`, `NotificationType`, `NotificationLink`, `ManagedBy`; Spectral/Redocly válidos y `pnpm contract:breaking` sin rupturas: TC-GOALS-SAVINGS-001, -002, -010, -019, -020, -035, -041, -049
- [ ] 5.2 Benchmark: `GET W/goals` p95 ≤ 300 ms con 20 metas y 2 000 movimientos en 3 monedas; `GET W/reports/summary` con el bloque Q9 dentro de NFR-PERF-004

## 6. UI

- [ ] 6.1 Pantalla "Metas" en `/goals` (docs/28): listado con progreso (barra + porcentaje en texto), estado (texto + icono), requerido, fecha esperada y marca de sobre-asignada; alta/edición con tipo, objetivo, fechas, cuentas vinculadas y prioridad; errores por `code` (NFR-USAB-009); i18n es/en/pt
- [ ] 6.2 Detalle: movimientos (con inversos y reasignaciones), aportar/reservar, retirar/liberar, reasignar, vincular transacción, plan mensual y programación recurrente, simulación, tasas usadas con atribución, recorrido
- [ ] 6.3 "Reservas por cuenta" (saldo, reservado, disponible, faltante) y bandeja de sugerencias con contador; enlace a la meta desde el detalle de una transacción
- [ ] 6.4 Tarjeta Q9 del Home (hasta 3 metas, "N más", estado vacío con "Crear meta") y aportes del mes junto a Q6; sección "Aportes a metas" en el plan

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar TC-GOALS-SAVINGS-001..050 con el TC-ID en el nombre del test; actualizar el front matter (`automated_tests`, `status`)
- [ ] 7.2 Test de integración del flujo completo con PG real: crear meta → aporte real → reserva → gasto que sobre-asigna → notificación → liberación que resuelve → alcanzar → cerrar
- [ ] 7.3 E2E: registrar las metas del exit criterion (fondo de emergencia con cuenta de ahorro, compra con reserva, viaje en USD con fondos en BOB y USD), ver el estado calculado en `/goals` y en Q9 del Home

## 8. DOCUMENTATION

- [ ] 8.1 Aplicar los cambios de design.md § "Cambios a docs compartidos" (docs/01, 03, 04, 05, 06, 08, 09, 10, 11, 14, 28 y ARCHITECTURE.md §155)
- [ ] 8.2 Actualizar la matriz de trazabilidad; ejecutar `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
- [ ] 8.3 (Could) Generador de datos demo (docs/29): metas del perfil con aportes reales, reservas y un episodio de sobre-asignación
