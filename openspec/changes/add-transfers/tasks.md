# Tareas

> DESIGN GATE aprobado el 2026-10-01. Requiere aplicados: `add-transaction-recording`, `add-accounts-management`, `add-ledger-core`, `add-classification`, `add-api-conventions`.

## 1. SPEC y test cases

- [x] 1.1 Revisar con el owner las preguntas abiertas de design.md (re-emisión de `TransferCompleted`, comisiones en otra moneda, código `TRANSFER_CURRENCY_MISMATCH`); verificar que `openspec validate add-transfers --strict` pasa
  - Nota (2026-10-03): resueltas por el owner en docs/31 D37 — `TransferCompleted` una sola vez + `TransferRevised.v1` por edición (se implementa en `add-lifecycle-timeline`), se mantiene `TRANSFER_CURRENCY_MISMATCH`; comisión en otra moneda: propuesta "no en Phase 1", pendiente de confirmación.
  - Nota (2026-10-04): el owner confirmó que la comisión en otra moneda **no se soporta** como comisión de transferencia (docs/31 D40); se registra como conversión o gasto aparte. Spec ampliada con el scenario "Comisión en otra moneda rechazada" y TC-TRANSACTIONS-TRANSFERFEE-001 (`ready`, sin automatizar: el rechazo ya está implementado en `Transaction.recordTransfer`, falta el test con el TC-id, tarea 2.4).
- [x] 1.2 Confirmar TC-TRANSACTIONS-TRANSFER-001..006, TC-TRANSACTIONS-CARDPAYMENT-001 y TC-LEDGER-TRANSFER-001 en estado `ready`; verificar con el chequeo del catálogo que ningún requirement Must queda sin TC
  > Verificado 2026-10-04: TC-TRANSACTIONS-TRANSFER-001..006, TC-TRANSACTIONS-CARDPAYMENT-001 y TC-LEDGER-TRANSFER-001 están `automated` con su requirement exacto; `pnpm traceability:check` (R2) en verde.
- [ ] 1.3 Aplicar (o confirmar aplicados) los cambios de design.md § Contratos; verificar Redocly lint 0/0 y validación de `examples` de `TransferCompleted.v1`
  > Verificado 2026-10-04 (parcial): OpenAPI con `TRANSFER_CURRENCY_MISMATCH`, `TRANSFER_SAME_ACCOUNT`, `suggestedOperationId` y ejemplos de `createTransfer`; `TransferCompleted.v1` (con ejemplo de comisión) y `TransferRevised.v1` con `examples`; Redocly en `pr.yml`. Falta: validación automática de los `examples` de los eventos contra su schema.

## 2. DOMAIN (TDD obligatorio)

- [x] 2.1 Escribir primero los tests de `Transaction.recordTransfer` (misma moneda, cuentas distintas, montos positivos, legs SOURCE/TARGET, split de comisión) con TC-TRANSACTIONS-TRANSFER-001, TRANSFER-003 y luego implementar
- [x] 2.2 TDD de la traducción `TRANSFER` (docs/09 §6.4 y §6.8) con y sin comisión (TC-TRANSACTIONS-TRANSFER-004, CARDPAYMENT-001); verificar con PBT que ∀ (monto, comisión): asiento balanceado y ΔPatrimonio = −comisión (INV-009, TC-TRANSACTIONS-TRANSFER-002)
- [x] 2.3 TDD de amend/void de transferencias reutilizando la máquina de estados; verificar que cambiar una cuenta a otra moneda produce `TRANSFER_CURRENCY_MISMATCH`
- [ ] 2.4 (docs/31 D40) Test con el TC-id de la comisión en otra moneda: `Transaction.recordTransfer` con comisión en USD sobre una transferencia en BOB ⇒ `TRANSFER_CURRENCY_MISMATCH` en `/fee/amount/currency`, sin asiento ni evento (TC-TRANSACTIONS-TRANSFERFEE-001; el comportamiento ya está implementado)
  > Verificado 2026-10-04 (pendiente, código): `TC-TRANSACTIONS-TRANSFERFEE-001` existe (`ready`, `not_automated`) pero ningún test lleva su id ni prueba la comisión en USD con el puntero `/fee/amount/currency`.

## 3. APPLICATION

- [x] 3.1 Implementar `RecordTransfer` con Unit of Work (Ledger + Audit + outbox) y validación de cuentas no activas; verificar TC-TRANSACTIONS-TRANSFER-005 y TC-LEDGER-TRANSFER-001
- [x] 3.2 Emitir `TransferCompleted` en todos los caminos de posteo de `kind=TRANSFER` y nunca en `pending`; verificar TC-TRANSACTIONS-TRANSFER-006 con test de contrato del productor (Ajv strict)

## 4. INFRASTRUCTURE

- [x] 4.1 Migración `txn_0002_transfers` con `txn.assert_transfer_consistency()`; verificar con test de integración que un insert inconsistente (misma cuenta o monedas distintas) falla al COMMIT

## 5. API

- [x] 5.1 Implementar `POST W/transfers` (Idempotency-Key, rol EDITOR, problem con `suggestedOperationId`); verificar contract tests y los ejemplos del OpenAPI

## 6. UI

- [x] 6.1 Formulario de transferencia con comisión opcional y atajo "Pagar tarjeta"; ante `TRANSFER_CURRENCY_MISMATCH` ofrecer abrir el formulario de conversión prellenado; verificar axe sin violaciones serious/critical y viewport 360 px
  - Nota (2026-10-03): formulario hecho (`apps/web/src/ui/transactions/TransferForm.tsx`, `/transferencias/nueva` y atajo "Pagar tarjeta" `?pagoTarjeta=1` con la deuda de la tarjeta y "Pagar el total"); con monedas distintas no permite registrar y ofrece la conversión prellenada (también ante `TRANSFER_CURRENCY_MISMATCH`). Viewport 360 px verificado en E2E; pendiente la verificación con axe.
  - Nota (2026-10-04): /transferencias/nueva (y /fx/conversiones/nueva) verificado con axe-core (`@axe-core/playwright`, WCAG 2.1 A/AA) en `tests/e2e/specs/a11y.spec.ts`: sin violaciones serious/critical (2026-10-04).

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Asegurar un test con `[TC-…]` por cada TC del change y actualizar `automation_status`/`automated_tests`; verificar en la matriz de trazabilidad
  - Nota (2026-10-03): todos los TC del change (TC-TRANSACTIONS-TRANSFER-001..008, TC-TRANSACTIONS-CARDPAYMENT-001, TC-LEDGER-TRANSFER-001) están `automated`; la UI agregó cobertura E2E a TRANSFER-001, -007, -008 y CARDPAYMENT-001.
- [x] 7.2 E2E Playwright del ejemplo canónico (A 1000.00 BOB → B 300.00 BOB) y del pago de tarjeta, comprobando saldos y patrimonio en el dashboard; verificar en CI con el stack `core`
  - Nota (2026-10-03): `tests/e2e/specs/transfers.spec.ts` (A 1000.00 → B 300.00 por QR, pago de tarjeta con QR, saldos y patrimonio en el Home; orientación a conversión); corrido localmente contra el stack desechable `pfos-e2e*` (perfil core, Minimal Seed, `FX_PROVIDER_* = none`).

## 8. DOCUMENTACIÓN y cierre

- [x] 8.1 Actualizar docs/10 §9.1 (`TRANSFER_CURRENCY_MISMATCH`), docs/09 §6.4 (consistencia en BD) y docs/11 (semántica de re-emisión decidida); verificar enlaces
  > Hecho 2026-10-04: docs/10 §9.1 (`TRANSFER_CURRENCY_MISMATCH`, D37/D40), docs/09 §6.4 (comisión en la misma moneda, edición y eventos, `txn.assert_transfer_consistency` diferido) y docs/11 (D37: `TransferCompleted` una vez, `TransferRevised.v1` por edición); enlaces verificados.
- [ ] 8.2 Regenerar la matriz, actualizar estados de TC y ejecutar `openspec validate --all --strict --no-interactive`; verificar que pasa antes de archivar
