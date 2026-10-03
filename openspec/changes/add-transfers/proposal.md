# Propuesta: add-transfers

## Why

Mover dinero entre cuentas propias (banco → efectivo, ahorro → corriente, pago de la tarjeta) es frecuente y es la operación donde más fácil se corrompe un sistema de finanzas personales: si se registra como gasto + ingreso infla ambos totales, y si no cuadra crea o destruye patrimonio. Este change materializa FR-TRANSACTIONS-018..020 (Phase 1) con el ejemplo canónico de ARCHITECTURE §12 (A = 1000.00 BOB, B = 0.00 BOB, transferir 300.00 BOB ⇒ A 700.00, B 300.00, patrimonio sin cambio) y protege INV-009.

## What Changes

- Transferencia entre dos cuentas del workspace en la **misma moneda** como una transacción `TRANSFER` con un único asiento balanceado (entrada en destino, salida en origen), sin postings a INCOME ni EXPENSE.
- Comisión opcional pagada desde el origen, registrada en el mismo asiento como gasto en la categoría de sistema *Fees*: el patrimonio baja exactamente la comisión.
- Rechazo de origen = destino (`TRANSFER_SAME_ACCOUNT`) y de monedas distintas (`TRANSFER_CURRENCY_MISMATCH`, con orientación a registrar una conversión).
- Pago de tarjeta de crédito = transferencia ASSET → LIABILITY: reduce deuda y activo por igual, nunca es gasto.
- Rechazo de transferencias que toquen cuentas archivadas o cerradas (INV-026).
- Publicación de `transactions.TransferCompleted.v1` cuando la transferencia queda posteada (nunca estando `pending`).
- Reutiliza de `add-transaction-recording` el ciclo de estados, la edición con reversa, la anulación, el bloqueo optimista y la idempotencia.
- **Fuera de alcance:** conversiones entre monedas (`add-manual-conversions`), emparejamiento de dos transacciones importadas como transferencia (`LinkAsTransfer`, Phase 6), transferencias entre workspaces (track de Colaboración), aportes a metas vía transferencia (Phase 4), kind `CARD_PAYMENT` con vínculo a estado de cuenta de tarjeta (Phase 4, `debt/credit-cards`).

## Capabilities

### New Capabilities
- `transactions/transfers`: transferencias en la misma moneda (con comisión opcional), validaciones de origen/destino/moneda/estado de cuenta, pago de tarjeta como transferencia y evento de transferencia completada.

### Modified Capabilities
- Ninguna.

## Impact

**Specs impactadas:** crea `transactions/transfers` (7 requirements).

**Componentes/contextos impactados:** TRANSACTIONS (`@pf/transactions`): comando `RecordTransfer`, extensión de `TransactionPostingTranslator` para `TRANSFER` (docs/09 §6.4 y §6.8); puertos `AccountDirectory` (naturaleza/moneda/estado), `ClassificationValidator` (categoría *Fees*), `LedgerPostingPort`. `apps/api` (controller `/transfers`) y `apps/web` (formulario de transferencia y pago de tarjeta).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — `createTransfer` (campos y errores), `TransferCreate` (`postingDate`), nuevo código `TRANSFER_CURRENCY_MISMATCH` y extensión `suggestedOperationId` en problem details. Detalle exacto en design.md § Contratos.

**Tablas impactadas:** ninguna tabla nueva; usa `txn.transaction` (`kind='TRANSFER'`), `txn.transaction_leg` (roles `SOURCE`/`TARGET`), `txn.transaction_split` (solo split de comisión) creadas por `add-transaction-recording`. Agrega un CHECK/trigger de consistencia de transferencias (ver design.md).

**Eventos impactados:** produce `transactions.TransferCompleted.v1` (sin cambios de schema) además de `TransactionCreated.v1`/`TransactionPosted.v1`/`TransactionVoided.v1`; Ledger produce `ledger.JournalEntryPosted.v1`.

**Migraciones requeridas:** expand-only, no destructiva: constraint trigger diferido `txn.assert_transfer_consistency()` (dos legs de la misma moneda y cuentas distintas para `kind='TRANSFER'`).

**Invariantes afectadas:** INV-002, INV-004, INV-005, INV-006, INV-009, INV-021, INV-023, INV-024, INV-026, INV-030.

**Test cases:** AÑADIDOS — TC-TRANSACTIONS-TRANSFER-002, TC-TRANSACTIONS-TRANSFER-003, TC-TRANSACTIONS-TRANSFER-004, TC-TRANSACTIONS-TRANSFER-005, TC-TRANSACTIONS-TRANSFER-006, TC-TRANSACTIONS-CARDPAYMENT-001. MODIFICADOS — TC-TRANSACTIONS-TRANSFER-001 (requirement "Transferencia entre monedas distintas orientada a conversión", FR-TRANSACTIONS-020; el caso de misma cuenta pasa a TRANSFER-003). REFERENCIADO sin modificar (dueño: change del ledger) — TC-LEDGER-TRANSFER-001, que ya apunta a `transactions/transfers` › "Transferencia entre cuentas propias". DEPRECADOS — ninguno. AÑADIDOS (2026-10-02, decisiones D27/D28 del owner): TC-TRANSACTIONS-TRANSFER-007, TC-TRANSACTIONS-TRANSFER-008.

**Impacto de regresión:** TC-LEDGER-TRANSFER-001, TRANSFER-002, TRANSFER-004 y CARDPAYMENT-001 entran en la Financial Regression Suite (patrimonio neto). Cambios futuros en el traductor de postings o en Debt (Phase 4, pagos de tarjeta) deben mantenerlos verdes.

**Riesgos introducidos:** doble conteo del pago de tarjeta como gasto en reportes si Reporting no distingue `TRANSFER` (mitigado: el pago no tiene postings EXPENSE); semántica de `TransferCompleted` tras un amend (resuelta por docs/31 D37: emisión única + `TransferRevised.v1`, implementada en `add-lifecycle-timeline`).
