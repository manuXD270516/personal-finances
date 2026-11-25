# Tareas

> Change 70 (Phase 9, docs/03 §7). Cierra el hallazgo de D372. La pregunta 1 de docs/76 bloquea la implementación (modelo del cargo); las 2–5 se implementan con la recomendación si el owner no responde antes del grupo que las usa. Gates: los de CLAUDE.md, con `pnpm test:integration` dos veces seguidas en verde y `pnpm test:e2e` con `PF_E2E_PROJECT`.

## 1. SPEC y TEST CASES

- [x] 1.1 Registrar las respuestas del owner a las preguntas 1–5 de docs/76 y ajustar specs, design y TC; `openspec validate add-card-interest-ledger-portions --strict` — 2026-11-25: pregunta 1 resuelta por el owner (opción (a), D465); 2–5 con la recomendación de docs/76, pendientes de confirmación del owner; design actualizado
- [x] 1.2 Revisar TC-DEBT-CARD-043..056, TC-TRANSACTIONS-CARDCHARGE-001..004 y TC-REPORTING-REPORTS-058..063 contra los scenarios (cifras: 1520.50 + 4.80 = 1525.30 BOB; 1170.50 + 4.80 = 1175.30 BOB; 1120.50 + 4.80 = 1125.30 BOB; 422.00 + 4.80 = 426.80 BOB); pasar a `ready` y `requirement_status: confirmed` tras las decisiones

## 2. DOMAIN (TDD)

- [x] 2.1 DEBT: `CardCharge` puro test-first (componentes ≥ 0 con al menos uno > 0, escala de la moneda, fecha entre la apertura de la cuenta y hoy en la zona del workspace, total, adopción con Σ componentes = monto): TC-DEBT-CARD-043..046, -052; PBT con timeout explícito (total = Σ componentes para montos aleatorios a la escala de BOB, USD y USDT)
- [x] 2.2 TRANSACTIONS: `isManaged(state)` y las porciones del cargo (una por componente positivo, categoría por código de sistema, Σ porciones = monto): TC-TRANSACTIONS-CARDCHARGE-002..004
- [x] 2.3 REPORTING: `classifyFee` con `CARD` antes de `FEE_CATEGORY` y lo cargado por tarjeta en `DebtSeries`: TC-REPORTING-REPORTS-058..062

## 3. APPLICATION

- [x] 3.1 `CardChargeTransactionsPort` en TRANSACTIONS (`recordCharge`, `adoptCharge`, `voidCharge` sobre `voidManaged`): TC-TRANSACTIONS-CARDCHARGE-001..004
- [x] 3.2 `CardChargesService` en DEBT (registrar, adoptar, anular, listar; auditoría en la misma unidad de trabajo; idempotencia): TC-DEBT-CARD-043, -049..055
- [x] 3.3 Detalle del estado de cuenta con `charges` y `chargeProposal`: TC-DEBT-CARD-047, -048
- [x] 3.4 `summarizeNominalFlows` con `origin.debtRole`; `getFees` y `getDebts` con los cargos (una consulta por reporte, sin consultas en paralelo): TC-REPORTING-REPORTS-058..063
- [x] 3.5 Cambiar a `isManaged` la edición masiva y la aplicación de reglas (excluyen los cargos como a los pagos de préstamo)

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand `txn_debt_role` (timestamp posterior a la última de `main`; CHECK `NOT VALID` + `VALIDATE`)
- [x] 4.2 Migración expand `debt_card_charge` (RLS forzada fail-closed, grants, registro en `platform.workspace_scoped_table`, matriz TC-SECURITY-RLS-007)
- [x] 4.3 Repositorio PG de `CardCharge` y test de integración con dos workspaces (aislamiento, reintento idempotente, anulación con reversa): TC-DEBT-CARD-049, -053, -055
- [x] 4.4 Export e import: sección `card-charges` y `debt_role` (esquemas en `contracts/export/v1`, misma `formatVersion`): TC-DEBT-CARD-056

## 5. API

- [x] 5.1 `createCardCharge`, `listCardCharges`, `voidCardCharge`, `CardStatement.charges`/`chargeProposal`, `Transaction.debtRole`, `CARD` en el tipo de comisión, `interestCharged`/`chargesCharged` en `DebtsReport` y `CARD_CHARGE_INVALID` en `ErrorCode` (aditivo; Spectral y Redocly sin errores; `pnpm contract:breaking` limpio): TC-DEBT-CARD-043, -045, -053, TC-REPORTING-REPORTS-058, -060

## 6. UI

- [x] 6.1 Estado de cuenta: formulario «Registrar intereses y cargos» (componentes, fecha por omisión el cierre, total en vivo), lista de cargos con anulación y propuesta desde la diferencia con el banco; aviso de posible doble registro con un gasto sin adoptar; i18n es/en/pt; axe: TC-DEBT-CARD-043, -047..049
- [x] 6.2 Detalle de una transacción de la tarjeta: acción «Es un cargo de la tarjeta» (adopción) y rótulo del cargo en el listado: TC-DEBT-CARD-051, TC-TRANSACTIONS-CARDCHARGE-001
- [x] 6.3 `/reportes/comisiones` con la columna «Tarjetas» y `/reportes/deudas` con interés y otros cargos de las tarjetas: TC-REPORTING-REPORTS-058, -060

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar todos los TC del change con el TC-id en el nombre del test; actualizar el front matter
- [x] 7.2 Reconciliación de los reportes ampliados: sumar la identidad «Σ cargos del reporte de deudas = `CARD` del de comisiones» al PBT, al dataset Demo y al nightly del Large Seed: TC-REPORTING-REPORTS-063
- [x] 7.3 E2E: registrar un cargo desde el estado de cuenta con la diferencia del banco, verlo en el reporte de comisiones y anularlo: TC-DEBT-CARD-047, -049, TC-REPORTING-REPORTS-058
- [x] 7.4 (Could, pregunta 5 de docs/76) Agregar un cargo de interés a una tarjeta del dataset Demo v2 y regenerar su golden — 2026-11-25: DIFERIDA (no hecha): exige una operación nueva del plan y del ejecutor y cambia todas las cifras del golden; el reporte de comisiones y la reconciliación ya se prueban con datos propios

## 8. DOCUMENTATION

- [x] 8.1 Aplicar design.md § «Cambios a docs compartidos»; anotar en docs/38 §4 que `origin.loanComponent` sigue sin llenarse
- [x] 8.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
