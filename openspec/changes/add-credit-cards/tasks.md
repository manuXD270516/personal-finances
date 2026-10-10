# Tareas

> Requiere aplicados `add-recurrence-engine`, `add-upcoming-payments`, `add-commitment-matching`, `add-alerts`, `add-transfers`, `add-manual-conversions`, `add-net-worth-evolution` (`AccountBalanceHistoryQuery`), `add-budgets` (`FlowValuation` y `REPORTING_RATE_VALIDITY_WINDOW` en el worker) y `add-workspace-export`; recomendado después de `add-loans` (contexto `@pf/debt` y puerto `RecurringDefinitionPort`, design.md § Dependencias L1/L2). No iniciar la implementación con las preguntas abiertas 1 y 2 de design.md sin resolver (docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `debt/credit-cards`, los deltas de `commitments/recurrence-engine`, `reporting/cash-flow-calendar` y `notifications/alerts` y las preguntas abiertas 1–14; `openspec validate add-credit-cards --strict`
- [ ] 1.2 Acordar con `add-loans` L1–L6 (contexto, puerto `RecurringDefinitionPort` único, guarda por `kind`, consolidación de los requirements de monto esperado) y con el motor N1–N7; registrar el acuerdo en design.md
- [ ] 1.3 Revisar TC-DEBT-CARD-001..037 contra los scenarios (cifras a mano: 1120.50 × 5 % = 56.025 → 56.02; 1165.50 × 5 % = 58.275 → 58.28; 4580 ÷ 15000 = 30.53 %; 1195.50 ÷ 10000 = 11.955 → 11.96 %; 1000 ÷ 3 → 333.33/333.33/333.34; francés 1200 al 2 % mensual → 416.11/416.11/416.10, interés 48.32), fechas fijas y `FixedClock` en America/La_Paz; pasar a `ready` y `requirement_status: confirmed`; `pnpm traceability:check` sin errores

## 2. DOMAIN (TDD, lógica financiera crítica)

- [ ] 2.1 `CardCycleCalendar` (cierre con fin de mes, ciclos contiguos, vencimiento posterior al cierre, ajuste de fin de semana, ciclo abierto por "hoy" del workspace, cambio de términos desde el ciclo abierto) test-first: TC-DEBT-CARD-006, -007, -008, -026; PBT: para toda combinación de días 1–31 y 36 meses, los ciclos son contiguos sin huecos ni solapes, hay un cierre y un vencimiento nominal por mes y el vencimiento es posterior al cierre (salvo ajuste `PREVIOUS`); tests con `TZ=UTC` y `TZ=America/La_Paz` a las 23:30 y 00:05 (RISK-020)
- [ ] 2.2 `MinimumPaymentRule` (porcentaje con piso, monto fijo, saldo ≤ 0, HALF_EVEN) test-first: TC-DEBT-CARD-005; PBT: `0 ≤ mínimo ≤ max(facturado, 0)`
- [ ] 2.3 `CardCycleCalculator` (cifras del ciclo, cuadre `anterior + compras − reembolsos − pagos + otros = cierre`, saldo facturado con cuotas, lo que falta, saldo a favor, estado, montos del banco) test-first: TC-DEBT-CARD-009, -010, -011, -012, -013, -014, -024; PBT del cuadre con movimientos aleatorios
- [ ] 2.4 `InstallmentScheduler` (sin interés con residuo en la última; francés con tasa mensual; reasignación de cuotas no facturadas al cambiar términos) test-first: TC-DEBT-CARD-022, -023; PBT: Σ capital = compra exacta (INV-017), cuotas ≥ 0
- [ ] 2.5 `UtilizationCalculator` y `UtilizationThresholdTracker` (separado/compartido, pendientes, sin tasa, un hecho por cambio con el más alto y `alsoCrossed`, rearme al bajar) test-first: TC-DEBT-CARD-020, -021
- [ ] 2.6 `PaymentPlanExpectation` (emitido exacto según política, abierto estimado, posteriores por cuotas, omitir con `NOTHING_BILLED`/`STATEMENT_PAID`, sin cambios redundantes) test-first: TC-DEBT-CARD-017
- [ ] 2.7 AR `CreditCard` (validaciones de alta: cuentas por moneda, límites, días, umbrales, recordatorio; archivar) y AR `CardInstallmentPlan` (validaciones, cancelación, completado) test-first: TC-DEBT-CARD-001, -002, -003, -004, -025, -027

## 3. APPLICATION

- [ ] 3.1 `RegisterCreditCard` (cuentas `credit_card` activas vía `AccountsQueryPort`/`AccountCatalogQuery`, una tarjeta activa por cuenta, emisión del último ciclo cerrado si no venció, plan de pago opcional con conflicto informado), auditoría: TC-DEBT-CARD-001, -002, -003, -004, -018, -028
- [ ] 3.2 `UpdateCreditCard` (términos versionados en `credit_card_terms`, límites y umbrales con evaluación síncrona, revisión del plan desde la primera ocurrencia no resuelta) y `ArchiveCreditCard` (termina planes): TC-DEBT-CARD-026, -027
- [ ] 3.3 `EnableCardPaymentPlan`/`DisableCardPaymentPlan` (conflicto con `RecurringDefinitionQuery.listActiveTransfersTo`, `RecurringDefinitionPort.createManaged/revise/end` en la misma UoW, expectativas iniciales): TC-DEBT-CARD-017, -018, -029
- [ ] 3.4 Queries `ListCreditCards`, `GetCreditCard` (ciclo abierto, último emitido, utilización con `FlowValuation` y una sola resolución de tasas), `ListCardStatements`/`GetCardStatement` (emitidas + calculadas, `issued`/`current`/`difference`), `GetFutureCharges`: TC-DEBT-CARD-009..014, -020, -024
- [ ] 3.5 `RecordReportedStatementFigures`: TC-DEBT-CARD-014
- [ ] 3.6 `CreateInstallmentPlan`/`CancelInstallmentPlan` (validación con `TransactionLinkQuery`, recálculo de expectativas): TC-DEBT-CARD-022, -023, -025
- [ ] 3.7 Consumidor `debt.card-activity` (`ledger.JournalEntryPosted.v1`, `transactions.TransactionCreated/Updated/Voided.v1`; inbox, `FOR UPDATE` de la tarjeta, expectativas, utilización y umbrales con `debt.CreditUtilizationThresholdReached.v1`, cancelación de cuotas): TC-DEBT-CARD-017, -021, -025
- [ ] 3.8 Job `debt.card-daily` (emisión única con `CardStatementIssued.v1` y expectativa exacta; estado persistido; recordatorios con `card_reminder` + `CardPaymentDue.v1`; red de seguridad de expectativas y umbrales de límites compartidos): TC-DEBT-CARD-008, -013, -019
- [ ] 3.9 COMMITMENTS: `CARD_PAYMENT` con `managedBy = DEBT` (guarda de dominio por `kind`, usuario sigue con `RECURRING_KIND_NOT_AVAILABLE`, `RECURRING_MANAGED_EXTERNALLY` en comandos de definición), materialización como transferencia, liquidez en comprometido y próximos pagos, matching como transferencia, `setExpected` con `NONE` y `skip` del administrador: TC-DEBT-CARD-029, -030, -031
- [ ] 3.10 TRANSACTIONS: `AccountMovementsQuery.summarizeAccountMovements` (clasificación por pata/porción, solo asiento activo) con tests propios: TC-DEBT-CARD-009, -016
- [ ] 3.11 NOTIFY: tipos `CARD_PAYMENT_DUE` y `CARD_UTILIZATION` (lectura defensiva del payload, dedupe `card-due:<cardAccountId>:<closingDate>` y `card-utilization:<cardId>:<scope>:<threshold>:<crossingNo>`, OWNER/EDITOR, severidades, enlace `CREDIT_CARD`), omisión del aviso genérico para `CARD_PAYMENT` sin aprobación, plantillas es/en/pt con y sin detalles: TC-DEBT-CARD-034..037

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand del schema `debt` (si no existe) y las nueve tablas (RLS forzada, FK compuestas, grants, `forbid_mutation` en `credit_card_terms`, `card_utilization_crossing` y `card_reminder`, índices únicos parciales, `platform.workspace_scoped_table`); CHECK de `commitments.recurring_definition` (`managed_by` con `DEBT`, `CARD_PAYMENT` solo con `DEBT`) con `NOT VALID` + `VALIDATE`; tests Testcontainers: aislamiento (TC-DEBT-CARD-028), una emisión y un recordatorio por cierre bajo concurrencia (TC-DEBT-CARD-013, -019), un cruce por umbral bajo consumidores concurrentes (TC-DEBT-CARD-021)
- [ ] 4.2 Repositorios Kysely y adapters (`AccountBalanceHistoryQuery`, `AccountMovementsQuery`, `PendingFlowQuery`, `TransactionLinkQuery`, `RecurringDefinitionPort`, `RecurringDefinitionQuery`, `FxValuationPort`, `WorkspaceCalendarQuery`); regla dependency-cruiser: `@pf/debt` solo importa `contracts` de otros contextos
- [ ] 4.3 Esquemas `contracts/events/debt/CardStatementIssued.v1`, `CardPaymentDue.v1`, `CreditUtilizationThresholdReached.v1` con `examples` + test de contrato; test `consumed-events.contract.test.ts` de NOTIFY ampliado
- [ ] 4.4 Portabilidad: secciones de las tablas en `@pf/debt/contracts/portability.ts` (remapeo de `account_id`, `definition_id`, `purchase_transaction_id`, `card_id`); test de cobertura de tablas y round-trip con una tarjeta bimoneda con plan y cuotas

## 5. API

- [ ] 5.1 OpenAPI: operaciones y schemas de design.md § Contratos, `NotificationType`/`NotificationLink` y códigos nuevos (`x-extensible-enum`); `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas
- [ ] 5.2 Controller `credit-cards` (roles, `Idempotency-Key`, `If-Match`/`ETag`, problem+json) con tests de API: TC-DEBT-CARD-001, -002, -004, -014, -017, -018, -022, -028
- [ ] 5.3 Tests de API de `W/recurring` con definiciones `CARD_PAYMENT` (rechazos del usuario, acciones sobre ocurrencias permitidas) y de `W/upcoming-payments`/comprometido: TC-DEBT-CARD-029, -031, -032, -033

## 6. UI

- [ ] 6.1 `/debts` pestaña Tarjetas: listado con utilización (texto + barra, nunca solo color), disponible, próximo vencimiento y lo que falta; alta en pasos (cuentas por moneda con opción "crear cuenta", límites, días, mínimo, plan de pago con aviso de conflicto)
- [ ] 6.2 Detalle de tarjeta: ciclo abierto, estados de cuenta (emitido vs recalculado con diferencia, montos del banco), plan de pago, planes de cuotas y calendario de cargos futuros; acciones según rol
- [ ] 6.3 Formulario de transferencia: rótulo "Pago de tarjeta" y sugerencias "Total para no generar intereses" / "Pago mínimo" cuando el destino es una tarjeta; conversión si las monedas difieren
- [ ] 6.4 Q8 y `/pagos-proximos`: rótulo "Pago de tarjeta · <nombre>", estimado y "cuotas"; centro de notificaciones con los dos tipos nuevos; i18n es/en/pt; accesibilidad (axe) y móvil

## 7. TESTS AUTOMATIZADOS y E2E

- [ ] 7.1 E2E del exit criterion: registrar "Visa Oro", comprar, emitir, pagar con transferencia desde "Banco BOB" y verificar que los gastos del mes y el ahorro no cambian y el estado queda `PAID` (TC-DEBT-CARD-015)
- [ ] 7.2 E2E plan de pago: activar con conflicto, terminar "Pago Visa", activar, ver estimado en Q8, emitir, aprobar la ocurrencia por el monto exacto (TC-DEBT-CARD-017, -018, -032)
- [ ] 7.3 E2E utilización y notificación de vencimiento (TC-DEBT-CARD-020, -034)
- [ ] 7.4 Regresión: TC-COMMITMENTS-RECUR-*, TC-COMMITMENTS-MATCH-*, TC-REPORTING-UPCOMING-*, TC-TRANSACTIONS-CARDPAYMENT-*, TC-IDENTITY-EXPORT-*/RESTORE-* en verde; métricas de lag del consumidor (NFR-PERF-008)

## 8. DOCS

- [ ] 8.1 Aplicar § Cambios a docs compartidos de design.md (lo consolida el lead) y actualizar `docs/17` (matriz de trazabilidad)
- [ ] 8.2 Estados de TC-DEBT-CARD-* a `automated` con `automated_tests`; `pnpm traceability:check`, `pnpm format:check`, `openspec validate add-credit-cards --strict`
- [ ] 8.3 (Could) Datos demo: "Visa Oro" bimoneda con una compra en cuotas (docs/29)
