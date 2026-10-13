# Propuesta: fix-phase-4-gaps

## Why

Phase 4 se fusionó con defectos menores conocidos que no bloquearon los merges pero que el owner nota al usar tarjetas, metas y préstamos (docs/39 §A.6, docs/38 §4). La decisión D222 (por omisión, revertible) los agrupa en un change de correcciones al inicio de Phase 5, como `fix-phase-2-gaps` (D113), con el alcance de docs/40 P4 y **sin deltas de spec sobre `debt/loans` ni `debt/amortization`** mientras no termine el archivado encadenado de Phase 4 (D219). La sub-pregunta de D222 quedó resuelta: anular un aporte con retiros posteriores se **avisa**, no se bloquea.

## What Changes

- **Próximo vencimiento de la tarjeta nunca en el pasado.** Recién registrada una tarjeta con deuda previa, el próximo vencimiento puede apuntar al vencimiento ya pasado de un ciclo calculado y no emitido. El próximo vencimiento pasa a ser la fecha más cercana no anterior a hoy entre los estados de cuenta emitidos con faltante y el ciclo abierto; un estado de cuenta vencido con faltante se informa aparte como atrasado.
- **Ciclo con saldo inicial cuadrado.** El asiento de apertura de la cuenta de la tarjeta no tiene transacción y no entra en "otros movimientos", así que el ciclo que lo contiene queda marcado como descuadrado aunque sus cifras sean correctas. El saldo inicial se cuenta en "otros movimientos" del ciclo que contiene su fecha y el ciclo se informa cuadrado.
- **Aviso al anular un aporte con retiros posteriores.** Anular la transacción de un aporte del que ya se retiró una parte deja los fondos de la meta en negativo sin avisar. La anulación sigue permitida (D222), pero antes de confirmarla se muestra el efecto sobre cada meta afectada y, después, la meta informa los fondos negativos de esa cuenta como faltante.
- **UI de préstamos** (sin cambio de spec): la lista de préstamos deja de consultar cada detalle por separado (una sola consulta con los campos que la lista necesita) y un préstamo en borrador se edita desde la pantalla (hoy solo por `PATCH`).
- **Benchmark del simulador de pago anticipado:** prueba de rendimiento con p95 < 300 ms para 10 préstamos (objetivo ya fijado en el design de `add-loan-amortization-advanced`; hoy el test usa 3 s).
- **Fuera de alcance:** notas y etiquetas de transacciones `LOAN_*` no editables desde la UI, rótulo de las cuotas de tarjeta en Q8, supuestos de Q5 sin spec (mes calendario sin periodo, tarjetas sin pago programado) y frecuencia horaria del job de metas: no están en el alcance de D222 (pregunta 1 de design.md). Adopción de una tabla del banco con fechas distintas en cuotas pendientes: espera la evidencia del owner (D154) y tocaría `debt/amortization`. Cualquier cambio de comportamiento de préstamos que requiera spec: después del archivado encadenado.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `debt/credit-cards`: el resumen del ciclo cuenta el saldo inicial en "otros movimientos" y se informa cuadrado (1 requirement MODIFIED, Must); próximo vencimiento de cada cuenta de la tarjeta (1 requirement ADDED, Must).
- `goals/savings-goals`: la anulación de la transacción de un aporte con retiros posteriores se avisa antes de confirmarla y deja los fondos negativos marcados, sin bloquearse (1 requirement MODIFIED, Must).

Sin deltas en `debt/loans` ni `debt/amortization` (D219, D222): los TC de préstamos de este change referencian requirements de los changes activos `add-loans` y `add-loan-amortization-advanced` sin modificarlos.

## Impact

**Specs impactadas:** `debt/credit-cards` (MODIFIED "Resumen del ciclo y saldo al cierre"; ADDED "Próximo vencimiento de la tarjeta"), `goals/savings-goals` (MODIFIED "Anulación o revisión de la transacción de un movimiento"). Leídas sin cambios: `debt/loans` y `debt/amortization` (changes activos), `ledger/balances`, `transactions/transaction-recording`.

**Componentes/contextos impactados:** DEBT (`@pf/debt`): `CardCycleCalculator` (otros movimientos con el saldo inicial), vista de tarjeta (próximo vencimiento y estados atrasados), `ListLoans` ampliado (campos de la lista, aditivo), sin cambios de dominio de préstamos. GOALS (`@pf/goals`): DS puro de impacto de anulación y query de vista previa; marca de fondos negativos en la vista de la meta. LEDGER: consulta pública de asientos de apertura por cuenta (aditiva, si no existe). `apps/api` y `apps/web` (lista y edición de préstamos, diálogo de anulación de transacciones, detalle de tarjeta y meta).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, todo aditivo: `GET W/goals/void-impact?transactionId=` (nueva, VIEWER); campos nuevos opcionales en la vista de tarjeta (`overdueStatements[]`), en la vista de meta (`negativeFunds[]`) y en la lista de préstamos (resumen de la próxima cuota y saldo). Sin códigos de error nuevos. `pnpm contract:breaking` limpio.

**Tablas impactadas:** ninguna (lecturas de `ledger.*` y `debt.*`; `goals.*` sin cambios de esquema).

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-DEBT-CARD-038..040, TC-GOALS-SAVINGS-051..053, TC-DEBT-LOAN-053..054, TC-DEBT-AMORT-045 (9). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** cifras de ciclos y estados de cuenta (TC-DEBT-CARD-\*), Q5 y Q8 que leen el próximo vencimiento de tarjeta (TC-REPORTING-SPENDABLE-\*, TC-REPORTING-UPCOMING-\*), anulación y revisión de aportes (TC-GOALS-SAVINGS-\*), lista y detalle de préstamos (TC-DEBT-LOAN-\*), simulador (TC-DEBT-AMORT-\*).

**Riesgos introducidos:** RISK-020 (hoy en la zona del workspace para decidir qué vencimiento es pasado), RISK-029 (la lista de préstamos y el simulador con el seed `large`). Ninguno nuevo en el registro.

**Invariantes afectadas:** INV-018 (movimientos de meta inmutables: la anulación sigue siendo un inverso, nunca una edición), INV-022 (saldos derivados del ledger: el saldo inicial viene del asiento de apertura), INV-001/002 (Decimal con moneda en el faltante). Sin escrituras nuevas en el ledger.
