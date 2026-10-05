# Propuesta: add-ledger-core

## Why

Todo slice financiero de Phase 1 (cuentas con saldo inicial, transacciones, transferencias, conversiones, dashboard) necesita un núcleo contable que garantice que el dinero no se crea ni se destruye por error. Este change convierte el diseño de Phase 0 (docs/09-ledger-design.md, ADR-0004 modelo de ledger, ADR-0006 representación de dinero, ADR-0007/ADR-0023 acceso a datos y RLS) y la evidencia de SPIKE-02 y SPIKE-03 en comportamiento verificable: un ledger de doble entrada multi-moneda, balanceado por moneda, append-only, corregible solo con reversas, con dinero decimal exacto y redondeo determinista. Es el change 4 del plan (docs/03-openspec-strategy.md §7) y bloquea a `add-transaction-recording`, `add-transfers`, `add-manual-conversions` y `add-basic-dashboard`.

## What Changes

- Se introduce el plan de cuentas contables: una cuenta contable `ASSET`/`LIABILITY` por cada cuenta del usuario (misma moneda, obtención idempotente) y cuentas de sistema por workspace y moneda creadas bajo demanda (`INCOME:<CCY>`, `EXPENSE:<CCY>`, `EQUITY:OPENING_BALANCE:<CCY>`, `EQUITY:FX_TRADING:<CCY>`, `EQUITY:ADJUSTMENTS:<CCY>`).
- Se introduce el registro de asientos (`PostJournalEntry`) con convención débito positivo / crédito negativo, balance por moneda, ≥ 2 postings sin montos cero, moneda del posting = moneda de la cuenta, split obligatorio en postings nominales, metadatos de trazabilidad e idempotencia por origen y revisión.
- Se introduce la inmutabilidad append-only (sin UPDATE/DELETE/TRUNCATE para el rol de aplicación, trigger de defensa) y la corrección por reversa exacta y única (`ReverseJournalEntry`).
- Se introduce el rechazo de asientos con fecha en periodos bloqueados (`PERIOD_CLOSED`) y el contrato público `LedgerPeriodLockPort` que Planning usará en Phase 2; en Phase 1 no existen bloqueos.
- Se introduce el value object de dinero del shared-kernel como comportamiento observable: decimal exacto, nunca punto flotante, serialización canónica, operaciones solo entre la misma moneda, rechazo de escala excedida (`AMOUNT_SCALE_EXCEEDED`), redondeo HALF_EVEN de una sola cuantización y reparto por mayor residuo truncando hacia cero.
- Se introducen las consultas de saldo (actual, a una fecha, agregadas por moneda, saldo presentado por naturaleza), snapshots derivados y reconstruibles, el verificador periódico de invariantes y, como Could, la vista técnica de balance de comprobación para miembros con rol `VIEWER` o superior (docs/31 D44).
- Se publica `ledger.JournalEntryPosted.v1` vía outbox en la misma transacción que el asiento.
- **Fuera de alcance:** traducción de transacciones de negocio a asientos (`TransactionPostingTranslator`, change `add-transaction-recording`); transferencias y conversiones (`add-transfers`, `add-manual-conversions`); creación de cuentas de usuario y orquestación del saldo inicial (`add-accounts-management`); ciclo de vida de periodos, cierre y reapertura (Planning, Phase 2 — aquí solo el rechazo y el puerto de bloqueo); saldo proyectado con pendientes, conciliado/cleared y valoración de patrimonio en moneda de reporte (Accounts/Transactions/Reporting); revaluaciones (nunca existen); cuentas archivadas que reciben postings (INV-026, lo valida Transactions vía Accounts); UI de usuario (el ledger es invisible).

## Capabilities

### New Capabilities
- `ledger/journal-posting`: plan de cuentas contables, registro de asientos balanceados por moneda, inmutabilidad, reversas, rechazo por periodo bloqueado, aislamiento por workspace, publicación del evento y comportamiento del dinero (escala, redondeo, reparto).
- `ledger/balances`: saldos derivados de postings (actuales, a una fecha, por moneda, presentados por naturaleza), balance de comprobación en cero, snapshots reconstruibles, verificador de invariantes y vista técnica de balance de comprobación.

### Modified Capabilities
- Ninguna (no existen specs principales del ledger).

## Impact

**Specs impactadas:** crea `ledger/journal-posting` (23 requirements) y `ledger/balances` (9 requirements). Consumidas por `accounts/account-management`, `transactions/transaction-recording`, `transactions/transfers`, `transactions/conversions`, `reporting/dashboard` y, en Phase 2, `planning/month-closing`.

**Componentes/contextos impactados:** contexto LEDGER (`@pf/ledger`: domain, application, infrastructure, contracts) y `@pf/shared-kernel` (`Money`, `Currency`, redondeo y reparto, promovidos desde SPIKE-03). Puertos públicos: `LedgerPostingPort`, `LedgerPeriodLockPort`, `BalanceQuery`. Interface: un endpoint técnico opcional (Could). Sin cambios en la UI de usuario.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — nuevos códigos en `ErrorCode` (`LEDGER_ENTRY_TOO_FEW_POSTINGS`, `LEDGER_ZERO_AMOUNT_POSTING`, `LEDGER_SPLIT_REQUIRED`, `LEDGER_ENTRY_ALREADY_REVERSED`, `LEDGER_ENTRY_NOT_REVERSIBLE`, `MONEY_INVALID_AMOUNT`, `AMOUNT_OUT_OF_RANGE`) y operación Could `GET /workspaces/{workspaceId}/ledger/trial-balance`. Detalle exacto en design.md → Contratos. Los endpoints de negocio que postean ya declaran `ledger/journal-posting` en `x-openspec-capability`.

**Tablas impactadas:** `ledger.ledger_account`, `ledger.journal_entry`, `ledger.posting`, `ledger.entry_reversal`, `ledger.period_lock`, `ledger.balance_snapshot` (nuevas); datos de referencia de `fx.currency` (escalas BOB 2, USD 2, USDT 6, BTC 8, JPY 0, ETH 18) si `add-manual-conversions` aún no los creó; uso de `platform.outbox` y `platform.current_workspace_id()` existentes.

**Eventos impactados:** produce `ledger.JournalEntryPosted.v1` (contrato existente en `contracts/events/ledger/`, sin cambios de schema). No consume eventos.

**Migraciones requeridas:** fase *expand* únicamente: creación del schema `ledger`, tablas, constraints, FKs compuestas, triggers (diferidos de balance y mínimo de postings, inmutabilidad, periodo bloqueado), RLS ENABLE+FORCE y grants. No destructiva. Ningún *contract*.

**Test cases:** AÑADIDOS — TC-LEDGER-STRUCTURE-001, TC-LEDGER-STRUCTURE-002, TC-LEDGER-CURRENCY-001, TC-LEDGER-SIGN-001, TC-LEDGER-CHART-001, TC-LEDGER-CHART-002, TC-LEDGER-CHART-003, TC-LEDGER-SPLITREF-001, TC-LEDGER-METADATA-001, TC-LEDGER-IDEMPOTENCY-001, TC-LEDGER-REVERSAL-002, TC-LEDGER-REVERSAL-003, TC-LEDGER-PERIOD-002, TC-LEDGER-ISOLATION-001, TC-LEDGER-EVENT-001, TC-LEDGER-BALANCES-002, TC-LEDGER-BALANCES-003, TC-LEDGER-BALANCES-004, TC-LEDGER-BALANCES-005, TC-LEDGER-VALUATION-001, TC-LEDGER-SNAPSHOT-001, TC-LEDGER-INTEGRITY-001, TC-LEDGER-TRIAL-001. MODIFICADOS (requirement/spec/FR confirmados, `status: ready`) — TC-LEDGER-BALANCE-001, TC-LEDGER-BALANCE-002, TC-LEDGER-BALANCE-003, TC-LEDGER-BALANCES-001, TC-LEDGER-IMMUTABILITY-001, TC-LEDGER-MONEY-001, TC-LEDGER-MONEY-002, TC-LEDGER-MONEY-003, TC-LEDGER-MONEY-004, TC-LEDGER-MONEY-005, TC-LEDGER-MONEY-006, TC-LEDGER-MONEY-007, TC-LEDGER-MONEY-008, TC-LEDGER-OPENING-001, TC-LEDGER-PERIOD-001 (pasa a Phase 1 desde la perspectiva del ledger), TC-LEDGER-REVERSAL-001, TC-LEDGER-SCALE-001, TC-LEDGER-TRANSFER-001 (re-apuntado a `ledger/journal-posting`). DEPRECADOS — ninguno.

**Invariantes afectadas:** INV-001, INV-002, INV-003, INV-004, INV-005, INV-006, INV-007, INV-008, INV-009 (desde el asiento de transferencia), INV-015, INV-020, INV-022, INV-025, INV-031.

**Impacto de regresión:** ninguno sobre comportamiento existente (no hay ledger previo). Desde este change, la Financial Regression Suite (`regression_suite: true`) incluye todos los TC críticos del ledger y del dinero; cualquier change posterior que postee asientos debe mantenerlos en verde.

**Riesgos introducidos:** colisión de SQLSTATE `PF002` entre el fail-closed de RLS y el trigger de mínimo de postings (resuelta en design.md con `PF005`); creación concurrente de cuentas de sistema (mitigada con `ON CONFLICT DO NOTHING` + relectura); orden de `sequence` ≠ orden de commit para snapshots (mitigado con checkpoints conservadores y reconstrucción); doble redondeo en multiplicaciones (mitigado con cuantización racional exacta, hallazgo H3 de SPIKE-03); overhead de RLS no medido (medición con `EXPLAIN ANALYZE` en tareas). Sin RISK-ids nuevos registrados.
