# Propuesta: add-card-interest-ledger-portions

## Why

Al implementar los reportes ampliados (change 59) se verificó que `debt/credit-cards` no registra los intereses ni los cargos de tarjeta como porciones del ledger con un rol identificable: el usuario los anota, si los anota, como un gasto común de la tarjeta. Por D372 ([docs/62](../../../docs/62-phase-7-consolidation-decisions.md)) el reporte de comisiones (reporte 14 del catálogo) y el de evolución de deudas (reporte 10) solo los cuentan si DEBT los registra con un rol identificable; si no, solo muestran el saldo pendiente de la tarjeta, y la inferencia por categoría quedó descartada. Hoy, por eso, el costo real de financiarse con tarjeta no aparece en ninguno de los dos reportes, y la diferencia entre el estado de cuenta del banco y el del sistema (requirement «Montos informados por el banco» de `debt/credit-cards`) queda sin una forma explícita de cerrarse.

Este change agrega el registro explícito de los intereses y cargos de una tarjeta como un gasto administrado por la tarjeta, con una porción por componente identificada como cargo de la tarjeta, y hace que los dos reportes los cuenten.

## What Changes

- **Cargo de tarjeta** (DEBT): registrar para una cuenta de una tarjeta los intereses, comisiones, seguro e impuestos que cobra el banco (fecha por omisión: el cierre del último estado de cuenta emitido). Crea un gasto posteado administrado por la tarjeta, con una porción por componente en su categoría de sistema («Intereses pagados», «Comisiones», «Seguros», «Impuestos») marcada como cargo de la tarjeta. Cuenta en las compras del ciclo de su fecha, como cualquier gasto de la tarjeta.
- **Anulación** con motivo: anula la transacción con la reversa de su asiento (ledger append-only).
- **Adopción** de un gasto existente de la tarjeta (manual o importado) como cargo, con una revisión de la transacción que reparte su monto en componentes; sin transacción nueva ni cambio de saldo. Es el camino para el histórico y para los cargos que llegan por un import, sin duplicarlos.
- **Estado de cuenta:** su detalle lista los cargos del ciclo; si el banco informó un saldo facturado mayor que el recalculado, se ofrece registrar la diferencia como cargo (Could), nunca de forma automática.
- **TRANSACTIONS:** la marca `debtRole = CARD_CHARGE` en la transacción, las porciones del cargo en la consulta de flujos con `groupBy ORIGIN` y la regla de transacción administrada (solo ediciones descriptivas).
- **REPORTING:** tipo nuevo `CARD` en el reporte de comisiones (exclusivo y antes que las categorías de comisiones); interés y otros cargos cargados por tarjeta y mes en el reporte de evolución de deudas, y su consolidado; nueva identidad de reconciliación entre los dos reportes.
- **Portabilidad:** sección `card-charges` en el export y la marca de la transacción.
- **Fuera de alcance:** calcular o estimar el interés de una tarjeta (método de saldo diario, tasas del banco); registrar automáticamente la diferencia con el banco; inferir cargos por categoría o hacer un backfill automático del histórico (D372); reconocer las líneas de interés en un import de extractos de tarjeta (los diseños PDF de tarjetas están fuera del change 57); cambiar el resumen de deudas (FR-DEBT-018), que ya atribuye a tarjetas el interés en «Intereses pagados»; el interés proyectado de las cuotas con interés, que sigue sin postearse.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities
- `debt/credit-cards`: 7 ADDED (6 Should, 1 Could).
- `transactions/transaction-recording`: 1 ADDED (Should).
- `reporting/financial-reports`: 3 MODIFIED («Reporte de comisiones», «Reporte de evolución de deudas», «Reconciliación de los reportes ampliados con el ledger»).

## Impact

**Specs impactadas:** `debt/credit-cards` (7 ADDED), `transactions/transaction-recording` (1 ADDED), `reporting/financial-reports` (3 MODIFIED, conservan sus scenarios y suman 6). Lee sin modificar: `classification/categories` (categorías de sistema `INTEREST`, `FEES`, `INSURANCE`, `TAXES`), `planning/financial-periods` (periodos cerrados), `identity/workspace-portability`.

**Componentes/contextos impactados:** DEBT: agregado `CardCharge` (dominio puro: componentes, total, validación), `CardChargesService` (registrar, adoptar, anular, listar, propuesta desde la diferencia), repositorio PG, endpoints y auditoría. TRANSACTIONS: puerto `CardChargeTransactionsPort` (registrar, adoptar y anular), `debtRole` en el agregado, regla de transacción administrada y `origin.debtRole` en `summarizeNominalFlows`. REPORTING: `classifyFee` con el tipo `CARD`, `getDebts` con lo cargado por tarjeta. `apps/web`: formulario de cargos en el estado de cuenta, lista y anulación, adopción desde el detalle de una transacción, columnas nuevas en `/reportes/comisiones` y `/reportes/deudas`.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` (aditivo): `POST W/credit-cards/{cardId}/charges` (`createCardCharge`), `GET W/credit-cards/{cardId}/charges` (`listCardCharges`), `POST W/credit-cards/{cardId}/charges/{chargeId}/void` (`voidCardCharge`); `CardStatement.charges` y `CardStatement.chargeProposal`; `Transaction.debtRole`; `CARD` en el `x-extensible-enum` del tipo del reporte de comisiones; `interestCharged` y `chargesCharged` en los meses de `DebtsReport` y `interestCharged` en su consolidado. `ErrorCode` nuevo: `CARD_CHARGE_INVALID`.

**Tablas impactadas:** nueva `debt.card_charge` (RLS forzada fail-closed, registrada en `platform.workspace_scoped_table`); `txn.transaction.debt_role` (columna nueva, nula).

**Eventos impactados:** ninguno nuevo. El cargo se registra por TRANSACTIONS y publica los eventos que ya publica toda transacción (mismos consumidores); sin consumidores ni conexiones nuevos (D249).

**Migraciones requeridas:** dos migraciones expand, no destructivas, con timestamp posterior a la última de `main`: `txn.transaction.debt_role` con sus CHECK (`NOT VALID` + `VALIDATE`) y `debt.card_charge`. Sin backfill.

**Test cases:** AÑADIDOS — TC-DEBT-CARD-043..056 (14), TC-TRANSACTIONS-CARDCHARGE-001..004 (4) y TC-REPORTING-REPORTS-058..063 (6). MODIFICADOS — ninguno (los scenarios existentes de los tres requirements MODIFIED no cambian: TC-REPORTING-REPORTS-042, -044 y -052 siguen válidos). DEPRECADOS — ninguno.

**Impacto de regresión:** los gastos con `debtRole` siguen siendo `EXPENSE`, así que cuentan igual que hoy en gastos, presupuestos, Q3, pronósticos y el resumen de deudas; el único cambio de cifras es que el reporte de comisiones pasa a contar como `CARD` los cargos (antes no contaba el interés de tarjeta, y una comisión de tarjeta en «Comisiones» contaba como `FEE_CATEGORY`). La regla de transacción administrada se amplía de «kind administrado» a «kind administrado o `debtRole` no nulo».

**Riesgos introducidos:** doble registro si el usuario registra un cargo y además importa la línea de interés del extracto (mitigación: adopción en vez de registro, y aviso de posible duplicado del alta manual existente); un periodo cerrado impide anular (comportamiento esperado, `PERIOD_CLOSED`).

**Invariantes afectadas:** INV-001, INV-002, INV-003 (montos Decimal con moneda y escala), INV-004 (el asiento del cargo cuadra), INV-007 e INV-008 (la anulación es una reversa), INV-015 (periodos cerrados) e INV-021 (las porciones suman el monto).
