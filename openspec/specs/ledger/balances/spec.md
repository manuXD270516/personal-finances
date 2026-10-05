# ledger/balances Specification

## Purpose
Calcula los saldos de las cuentas contables como suma de sus postings —actuales, a una fecha y agregados por moneda—, mantiene snapshots solo como caché reconstruible y verifica de forma continua las invariantes del ledger.

## Requirements

### Requirement: Saldos derivados de los postings
El saldo contable de una cuenta contable DEBE (MUST) ser siempre la suma con signo de todos sus postings, incluidas las reversas; el sistema NO DEBE (MUST NOT) permitir fijar ni editar un saldo directamente.
Trace: FR-LEDGER-012, FR-ACCOUNTS-006 · Priority: Must

#### Scenario: Saldo de una cuenta bancaria
- **CUANDO** "Bank A" (BOB) tiene los postings +1000.00 BOB (saldo inicial), -150.00 BOB, +45.50 BOB y -300.00 BOB
- **ENTONCES** su saldo contable es 595.50 BOB

#### Scenario: Saldo después de una reversa
- **CUANDO** "Bank A" tiene 1000.00 BOB, se registra un gasto de 120.00 BOB y luego se revierte
- **ENTONCES** su saldo contable vuelve a ser 1000.00 BOB

### Requirement: Saldo a una fecha (as-of)
El sistema DEBE (MUST) calcular el saldo de una cuenta contable a una fecha de negocio dada como la suma de los postings de asientos con fecha menor o igual a esa fecha, en la zona horaria del workspace, incluidos asientos registrados después con fecha anterior.
Trace: FR-LEDGER-012 · Priority: Must

#### Scenario: Saldos a fin de mes
- **CUANDO** "Bank A" tiene +1000.00 BOB el 2026-01-01, -150.00 BOB el 2026-01-31 y -300.00 BOB el 2026-02-01
- **ENTONCES** su saldo al 2026-01-30 es 1000.00 BOB, al 2026-01-31 es 850.00 BOB y al 2026-02-01 es 550.00 BOB

#### Scenario: Asiento con fecha retroactiva
- **CUANDO** después de consultar el saldo al 2026-01-31 (850.00 BOB) se registra un gasto de 20.00 BOB con fecha 2026-01-15
- **ENTONCES** el saldo al 2026-01-31 pasa a ser 830.00 BOB

### Requirement: Saldos agregados por moneda
El sistema DEBE (MUST) obtener en una sola consulta los saldos de varias cuentas contables, actuales o a una fecha, y sus totales agrupados por moneda, sin sumar nunca montos de monedas distintas entre sí.
Trace: FR-LEDGER-012 · Priority: Must

#### Scenario: Cuentas en BOB y USDT
- **CUANDO** "Bank A" tiene 595.50 BOB, "Efectivo BOB" tiene 200.00 BOB y "Binance USDT" tiene 99.900000 USDT
- **ENTONCES** la consulta devuelve el saldo de cada cuenta y los totales 795.50 BOB y 99.900000 USDT por separado

### Requirement: Saldo presentado según la naturaleza de la cuenta
El sistema DEBE (MUST) presentar el saldo de una cuenta `ASSET` o `EXPENSE` igual a su saldo contable y el de una cuenta `LIABILITY`, `INCOME` o `EQUITY` como el saldo contable con signo invertido, de modo que una deuda se muestre como monto positivo adeudado.
Trace: FR-LEDGER-002, FR-LEDGER-012 · Priority: Must

#### Scenario: Deuda de tarjeta de crédito
- **CUANDO** "Visa BOB" tiene una deuda inicial de -2000.00 BOB, una compra de -350.00 BOB y un pago de +350.00 BOB
- **ENTONCES** su saldo contable es -2000.00 BOB y su saldo presentado es 2000.00 BOB adeudados

#### Scenario: Ingreso del mes
- **CUANDO** `INCOME:BOB` tiene postings de -8000.00 BOB y -12.34 BOB
- **ENTONCES** su saldo presentado es 8012.34 BOB

### Requirement: El saldo contable excluye transacciones pendientes
El saldo contable DEBE (MUST) incluir solo asientos registrados y NO DEBE (MUST NOT) incluir transacciones pendientes, que no generan asientos; todo saldo proyectado que sume pendientes DEBE (MUST) exponerse diferenciado del saldo contable.
Trace: FR-LEDGER-013 · Priority: Must

#### Scenario: Gasto pendiente
- **CUANDO** "Bank A" tiene un saldo contable de 1000.00 BOB y existe un gasto pendiente de 200.00 BOB
- **ENTONCES** el saldo contable de "Bank A" sigue siendo 1000.00 BOB
- **Y** el saldo proyectado de 800.00 BOB se presenta como un valor distinto del saldo contable

### Requirement: Balance de comprobación en cero por moneda
Para cada moneda y a cualquier fecha, la suma de los saldos contables de todas las cuentas contables del workspace DEBE (MUST) ser exactamente cero; en consecuencia, para cualquier conjunto de tasas positivas, la suma de los saldos valorizados en una moneda de reporte DEBE (MUST) ser cero.
Trace: FR-LEDGER-001, FR-LEDGER-012, NFR-DATA-004 · Priority: Must

#### Scenario: Balance de comprobación tras una conversión
- **CUANDO** el workspace registró un saldo inicial de 10000.00 BOB en "Bank A", la conversión de -100.000000 USDT, +100.000000 USDT, -690.00 BOB, +685.00 BOB y +5.00 BOB, y un saldo inicial de 100.000000 USDT en "Binance USDT"
- **ENTONCES** la suma de los saldos en BOB es 0.00 BOB y la suma de los saldos en USDT es 0.000000 USDT

#### Scenario: Identidad de valoración
- **CUANDO** los saldos anteriores se valorizan en BOB con la tasa 6.95 BOB por USDT
- **ENTONCES** la suma de todos los saldos valorizados es 0.00 BOB
- **Y** el patrimonio neto valorizado es igual al valor de `EQUITY`, `INCOME` y `EXPENSE` con signo invertido

### Requirement: Snapshots de saldo derivados y reconstruibles
Los snapshots de saldo DEBEN (MUST) ser solo una caché derivada: un saldo obtenido desde un snapshot DEBE (MUST) ser igual a la suma de los postings, un asiento con fecha anterior a un snapshot DEBE (MUST) invalidarlo, y un comando de reconstrucción DEBE (MUST) regenerarlos idénticos desde los postings.
Trace: FR-LEDGER-014, NFR-DATA-009 · Priority: Must

#### Scenario: Reconstrucción tras eliminar los snapshots
- **CUANDO** "Bank A" tiene un snapshot de 595.50 BOB, se eliminan todos los snapshots del workspace y se ejecuta la reconstrucción
- **ENTONCES** el snapshot reconstruido vale 595.50 BOB y es igual al previo a la eliminación

#### Scenario: Asiento retroactivo invalida el snapshot
- **CUANDO** existe un snapshot de "Bank A" al 2026-01-31 de 850.00 BOB y se registra un gasto de 20.00 BOB con fecha 2026-01-15
- **ENTONCES** el saldo al 2026-01-31 obtenido es 830.00 BOB y coincide con la suma de los postings

### Requirement: Verificación periódica de invariantes del ledger
El sistema DEBE (MUST) ejecutar periódicamente, y tras cada restauración, una verificación de las invariantes del ledger (balance por asiento y moneda, ausencia de mutaciones, snapshot igual a la suma de postings) y DEBE (MUST) emitir una alerta y una métrica ante cualquier violación.
Trace: FR-LEDGER-015, NFR-DATA-008, NFR-OBS-005 · Priority: Must

#### Scenario: Snapshot divergente detectado
- **CUANDO** un snapshot de "Bank A" vale 600.00 BOB mientras la suma de sus postings es 595.50 BOB y se ejecuta la verificación
- **ENTONCES** la verificación reporta la violación con la cuenta, la fecha y la diferencia de 4.50 BOB
- **Y** se emite una alerta crítica y se incrementa la métrica de invariantes violadas

#### Scenario: Ledger íntegro
- **CUANDO** todos los asientos balancean por moneda y todos los snapshots coinciden con la suma de los postings
- **ENTONCES** la verificación termina sin violaciones y no emite alertas

### Requirement: Vista técnica de balance de comprobación
El sistema DEBE (MUST) ofrecer a todo miembro del workspace con rol mínimo `VIEWER` (docs/31 D44) un balance de comprobación por moneda a una fecha con el saldo de cada cuenta contable y el total por moneda; quien no es miembro del workspace DEBE (MUST) recibir `WORKSPACE_ACCESS_DENIED`.
Trace: FR-LEDGER-016 · Priority: Could

#### Scenario: Consulta por un miembro
- **CUANDO** un miembro con rol `VIEWER` consulta el balance de comprobación al 2026-03-31 de un workspace con "Bank A" 685.00 BOB, `EQUITY:FX_TRADING:BOB` -690.00 BOB y `EXPENSE:BOB` 5.00 BOB
- **ENTONCES** recibe esas tres líneas con total 0.00 BOB

#### Scenario: Consulta por un no miembro
- **CUANDO** un usuario que no es miembro del workspace solicita el balance de comprobación
- **ENTONCES** recibe `WORKSPACE_ACCESS_DENIED` y ninguna línea del ledger
