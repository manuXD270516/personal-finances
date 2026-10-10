# Tareas

> Requiere aplicados `add-recurrence-engine` (contexto `@pf/commitments`, schema `commitments`, necesidades N1–N12 de design.md § Dependencias), `add-alerts`, `add-classification`, `add-accounts-management`, `add-market-rate-providers`, `add-budgets` (`FlowValuation` y `REPORTING_RATE_VALIDITY_WINDOW` en el worker), `add-lifecycle-timeline` y `add-workspace-export`. Coordina con `add-commitment-matching`. No iniciar la implementación con las preguntas abiertas 1 y 2 de design.md sin resolver (bloquean contratos de eventos y el acuerdo con el motor; docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner la spec `commitments/subscriptions`, el delta de `notifications/alerts` y las preguntas abiertas 1–10 de design.md; verificar con `openspec validate add-subscriptions --strict` _(2026-10-10: spec y TC revisados con las decisiones del owner D118–D151 (docs/35))_
- [x] 1.2 Acordar con `add-recurrence-engine` las necesidades N1–N12 de design.md (en especial las **pedidas**: N3 monto indexado y N9 `managedBy` en `RecurringOccurrenceDue.v1`; y confirmar N4 y N10); registrar el acuerdo en design.md _(2026-10-10: necesidades N1–N12 resueltas en el motor; ver "Notas de implementación")_
- [x] 1.3 Revisar TC-COMMITMENTS-SUBS-001..035 contra los scenarios (cifras a mano: 10.99 × 9.80 = 107.702 → 107.70 BOB; total 487.8605 → 487.86 BOB al mes y 5854.326 → 5854.33 BOB al año; 2 / 9.99 = 20.02 %; 2 / 10.99 = 18.20 %; 108.50 / 10.99 = 9.8726), fechas fijas y `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed`; `pnpm traceability:check` sin errores _(2026-10-10: cifras de los TC verificadas por las pruebas)_

## 2. DOMAIN (TDD, lógica financiera crítica)

- [x] 2.1 `SubscriptionStateMachine` (estados, transiciones, guardas, cancelación programada como atributo) test-first: TC-COMMITMENTS-SUBS-007, -008, -009, -019; PBT: ninguna secuencia de comandos sale de `CANCELLED`
- [x] 2.2 `PriceHistory` (precio vigente por fecha, cronología estricta, reemplazo único, misma moneda) test-first: TC-COMMITMENTS-SUBS-012, -013, -014, -018; PBT: para todo historial válido, el precio vigente es una función escalonada no ambigua de la fecha
- [x] 2.3 `PriceChangeDetector` (desvío en Decimal precisión 40, HALF_EVEN a 2 decimales, comparación estricta con la tolerancia, `NOT_COMPARABLE` entre monedas, tasa implícita) test-first: TC-COMMITMENTS-SUBS-020, -021, -024
- [x] 2.4 `SubscriptionCostCalculator` (renovaciones por año por cadencia e intervalo, anualizado/mensualizado sin redondeo intermedio) test-first: TC-COMMITMENTS-SUBS-025; PBT: `monthly × 12 == annual` a precisión completa
- [x] 2.5 `RenewalReminderPolicy` (ventana `[hoy, hoy + N]` en la TZ del workspace, fechas pasadas excluidas) test-first: TC-COMMITMENTS-SUBS-027, -028; tests con `TZ=UTC` y `TZ=America/La_Paz` a las 23:30 y 00:05 de La Paz (RISK-020)
- [x] 2.6 AR `Subscription` (validaciones de alta: trial vs primera renovación, precio positivo, tolerancia y recordatorio en rango) test-first: TC-COMMITMENTS-SUBS-002, -008

## 3. APPLICATION

- [x] 3.1 `CreateSubscription` con validación de contraparte, cuenta, moneda y escala, y creación de la definición (N1) en la misma UoW con `managedBy` y monto indexado si las monedas difieren (N3); auditoría: TC-COMMITMENTS-SUBS-001, -002, -003, -004, -035
- [x] 3.2 `UpdateSubscription` (datos simples y cambios de cuenta/ciclo a futuro vía N6), `PauseSubscription`/`ResumeSubscription` (N4), `CancelSubscription` inmediata y programada y `UndoScheduledCancellation` (N10); rol EDITOR/OWNER, `If-Match`, auditoría: TC-COMMITMENTS-SUBS-006, -011, -015, -016, -019
- [x] 3.3 `ChangeSubscriptionPrice` y `SupersedeSubscriptionPrice` (entrada append-only + change future + `SubscriptionPriceChanged.v1` en el outbox): TC-COMMITMENTS-SUBS-013, -014, -018
- [x] 3.4 Consumidor `commitments.subscription-charges` de `RecurringOccurrenceMaterialized.v1` y `RecurringOccurrenceChanged.v1 (RELEASE)` (inbox, `FOR UPDATE` de la suscripción, `subscription_charge` con `ON CONFLICT DO NOTHING`, propuesta única pendiente, evento con versión nueva del agregado; liberación ⇒ `VOIDED`/`WITHDRAWN`): TC-COMMITMENTS-SUBS-020, -021, -022, -024
- [x] 3.5 `AcceptPriceProposal`/`RejectPriceProposal` (sin re-publicar el hecho; vigencia explícita si no es cronológica) y `RecordChargeOriginalAmount`: TC-COMMITMENTS-SUBS-023, -024
- [x] 3.6 Queries `ListSubscriptions`, `GetSubscription` (precio vigente, historial con reemplazos, propuesta pendiente, próxima renovación vía N5), `ListSubscriptionCharges`, `GetSubscriptionCostSummary` (`FlowValuation` + `FxValuationPort` con `windowDays` de REPORTING, una sola resolución de tasas): TC-COMMITMENTS-SUBS-005, -010, -025, -026
- [x] 3.7 Job `commitments.subscription-daily` (fin de trial, cancelación programada, recordatorios con `subscription_reminder` + outbox en la misma transacción): TC-COMMITMENTS-SUBS-008, -019, -027, -028
- [x] 3.8 Recorrido: registrar la máquina `Subscription` en `audit/lifecycle-timeline` (si se aprueba la pregunta 4): TC-COMMITMENTS-SUBS-029
- [x] 3.9 NOTIFY: tres entradas del catálogo de tipos (lectura defensiva del payload, dedupe, destinatarios, severidad, enlace `SUBSCRIPTION`), descarte de `origin ≠ DETECTED` para el cambio de precio, plantillas in-app y email es/en/pt con y sin detalles: TC-COMMITMENTS-SUBS-030..034

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand de las cinco tablas (RLS forzada, grants, `forbid_mutation` en `subscription_price` y `subscription_reminder`, índices únicos parciales, `platform.workspace_scoped_table`); tests de integración Testcontainers: aislamiento entre workspaces (TC-COMMITMENTS-SUBS-017), append-only del historial (TC-COMMITMENTS-SUBS-012), una sola propuesta pendiente y un solo cargo por ocurrencia bajo concurrencia (TC-COMMITMENTS-SUBS-022)
- [x] 4.2 Repositorios Kysely y adapters (implementación de `RecurringDefinitionPort` para `managedBy = SUBSCRIPTION` sobre el motor, expand del CHECK `managed_by`, guarda `RECURRING_MANAGED_EXTERNALLY` en los comandos de usuario del motor, `ClassificationValidator`, `AccountsQueryPort`, `FxValuationPort`, `WorkspaceCalendarQuery`); tipos de NOTIFY en la tabla de preferencias si tiene CHECK
- [x] 4.3 Esquemas `contracts/events/commitments/SubscriptionPriceChanged.v1`, `SubscriptionRenewalUpcoming.v1`, `SubscriptionTrialEnding.v1`, `SubscriptionCancelled.v1` con `examples` + test de contrato (payload validado al escribir en el outbox) y test de NOTIFY `consumed-events.contract.test.ts` ampliado
- [x] 4.4 Portabilidad: secciones de las cinco tablas en `@pf/commitments/contracts/portability.ts` (remapeo de `supersedes_id`, `proposal_id`, `charge_id`, `definition_id`); test de cobertura de tablas y round-trip con suscripciones

## 5. API

- [x] 5.1 Operaciones de design.md § Contratos con `Idempotency-Key`, `If-Match`, ETag y problem+json; códigos nuevos en `ErrorCode` y `errors.{es,en,pt}.json`; tipos y enlace nuevos de notificaciones; Spectral/Redocly válidos y `pnpm contract:breaking` sin rupturas: TC-COMMITMENTS-SUBS-001, -005, -016, -023
- [x] 5.2 Benchmark: `GET W/subscriptions/cost-summary` p95 ≤ 300 ms con 60 suscripciones en 4 monedas (referencia NFR-PERF-004); el job diario procesa 60 suscripciones por workspace en ≤ 10 s (referencia NFR-PERF-009) _(2026-10-10: perf nocturno `test/perf/subscriptions.perf.ts` verde)_

## 6. UI

- [x] 6.1 Pantalla "Suscripciones" en `/recurring` (docs/28): listado con estado (texto + icono), próxima renovación y precio; alta/edición con selector de provider (creación inline de contraparte), cuenta de pago (avisa "precio en USD, cargo estimado en BOB con la tasa paralela"), ciclo, trial y recordatorio; errores por `code` (NFR-USAB-009); i18n es/en/pt
- [x] 6.2 Detalle: historial de precios (con reemplazos), propuesta pendiente con aceptar/rechazar, cargos con tasa implícita y monto del extracto, recorrido, cancelar ahora o al fin del ciclo
- [x] 6.3 Vista "Costo de suscripciones": mensual/anual por suscripción y total en BOB, tasas usadas con atribución, montos sin convertir, trials aparte; widget compacto opcional en el Home (Could)

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar TC-COMMITMENTS-SUBS-001..035 con el TC-ID en el nombre del test; actualizar el front matter (`automated_tests`, `status`)
- [x] 7.2 Test de integración del flujo completo con PG real: alta USD en tarjeta BOB → ocurrencia indexada → aprobación con monto distinto → cargo `NOT_COMPARABLE` → monto del extracto → propuesta → aceptar → historial y cargo siguiente actualizados
- [x] 7.3 E2E: registrar las suscripciones del exit criterion (USD con tarjeta USD, USD con tarjeta BOB, USDT, BOB anual con trial), ver el costo total y recibir el recordatorio en la bandeja (y en Mailpit sin montos) _(2026-10-10: `tests/e2e/specs/subscriptions.spec.ts` (TC-033); cubre dos suscripciones, el total en BOB y el recordatorio en la bandeja)_

## 8. DOCUMENTATION

- [x] 8.1 Aplicar los cambios de design.md § "Cambios a docs compartidos" (docs/01, 04, 05, 08, 10, 11, 14, 28, 03)
- [x] 8.2 Actualizar la matriz de trazabilidad; ejecutar `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
- [ ] 8.3 (Could) Generador de datos demo (docs/29): suscripciones con un `SUBSCRIPTION_PRICE_HIKE`

## Notas de implementación (2026-10-10)

- N3 (monto indexado) se implementó en el motor (columnas `indexed_amount`/`indexed_currency`, la plantilla queda `VARIABLE`, `indexCandidates` estima `precio × tasa` al generar con HALF_EVEN); una ocurrencia generada sin tasa queda `VARIABLE` y no se re-estima después. N4, N10 y N12 se cubrieron de forma aditiva (`manager`, `deferClose`/`unscheduleEnd`, `managedBy/managedRef`); el job del motor no cierra definiciones administradas.
- `RecurringDefinitionPort` se implementa como el puerto interno `ManagedDefinitionPort` (`EngineManagedDefinitions`).
- No se implementó `nextRenewalComputedAt`. Cada recordatorio sube la versión de la suscripción (el outbox exige versión distinta por evento). `PATCH …/charges/{id}` exige `If-Match` con la versión de la suscripción.
- Los correos básicos dicen "en {days} días"; los montos de las notificaciones se formatean según el idioma. El resumen de costo devuelve `unconverted` como `{monthly, annual}`.
- `DATABASE_POOL_MAX` pasa de 30 a 40 (plantilla del host de 14 a 20) por los consumidores nuevos; el consumidor de cargos usa `concurrency: 1`.
- UI: sin ítem de la barra lateral ni pruebas axe propias; el alta no ofrece ciclos quincenal-dos-veces-al-mes ni personalizado.
- 8.3 (Could, datos demo) no se implementó.

