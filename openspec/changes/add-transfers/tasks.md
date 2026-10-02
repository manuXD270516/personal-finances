# Tareas

> DESIGN GATE aprobado el 2026-10-01. Requiere aplicados: `add-transaction-recording`, `add-accounts-management`, `add-ledger-core`, `add-classification`, `add-api-conventions`.

## 1. SPEC y test cases

- [ ] 1.1 Revisar con el owner las preguntas abiertas de design.md (re-emisión de `TransferCompleted`, comisiones en otra moneda, código `TRANSFER_CURRENCY_MISMATCH`); verificar que `openspec validate add-transfers --strict` pasa
- [ ] 1.2 Confirmar TC-TRANSACTIONS-TRANSFER-001..006, TC-TRANSACTIONS-CARDPAYMENT-001 y TC-LEDGER-TRANSFER-001 en estado `ready`; verificar con el chequeo del catálogo que ningún requirement Must queda sin TC
- [ ] 1.3 Aplicar (o confirmar aplicados) los cambios de design.md § Contratos; verificar Redocly lint 0/0 y validación de `examples` de `TransferCompleted.v1`

## 2. DOMAIN (TDD obligatorio)

- [ ] 2.1 Escribir primero los tests de `Transaction.recordTransfer` (misma moneda, cuentas distintas, montos positivos, legs SOURCE/TARGET, split de comisión) con TC-TRANSACTIONS-TRANSFER-001, TRANSFER-003 y luego implementar
- [ ] 2.2 TDD de la traducción `TRANSFER` (docs/09 §6.4 y §6.8) con y sin comisión (TC-TRANSACTIONS-TRANSFER-004, CARDPAYMENT-001); verificar con PBT que ∀ (monto, comisión): asiento balanceado y ΔPatrimonio = −comisión (INV-009, TC-TRANSACTIONS-TRANSFER-002)
- [ ] 2.3 TDD de amend/void de transferencias reutilizando la máquina de estados; verificar que cambiar una cuenta a otra moneda produce `TRANSFER_CURRENCY_MISMATCH`

## 3. APPLICATION

- [ ] 3.1 Implementar `RecordTransfer` con Unit of Work (Ledger + Audit + outbox) y validación de cuentas no activas; verificar TC-TRANSACTIONS-TRANSFER-005 y TC-LEDGER-TRANSFER-001
- [ ] 3.2 Emitir `TransferCompleted` en todos los caminos de posteo de `kind=TRANSFER` y nunca en `pending`; verificar TC-TRANSACTIONS-TRANSFER-006 con test de contrato del productor (Ajv strict)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración `txn_0002_transfers` con `txn.assert_transfer_consistency()`; verificar con test de integración que un insert inconsistente (misma cuenta o monedas distintas) falla al COMMIT

## 5. API

- [ ] 5.1 Implementar `POST W/transfers` (Idempotency-Key, rol EDITOR, problem con `suggestedOperationId`); verificar contract tests y los ejemplos del OpenAPI

## 6. UI

- [ ] 6.1 Formulario de transferencia con comisión opcional y atajo "Pagar tarjeta"; ante `TRANSFER_CURRENCY_MISMATCH` ofrecer abrir el formulario de conversión prellenado; verificar axe sin violaciones serious/critical y viewport 360 px

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Asegurar un test con `[TC-…]` por cada TC del change y actualizar `automation_status`/`automated_tests`; verificar en la matriz de trazabilidad
- [ ] 7.2 E2E Playwright del ejemplo canónico (A 1000.00 BOB → B 300.00 BOB) y del pago de tarjeta, comprobando saldos y patrimonio en el dashboard; verificar en CI con el stack `core`

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/10 §9.1 (`TRANSFER_CURRENCY_MISMATCH`), docs/09 §6.4 (consistencia en BD) y docs/11 (semántica de re-emisión decidida); verificar enlaces
- [ ] 8.2 Regenerar la matriz, actualizar estados de TC y ejecutar `openspec validate --all --strict --no-interactive`; verificar que pasa antes de archivar
