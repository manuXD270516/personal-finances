## ADDED Requirements

### Requirement: Descomposición del cambio del patrimonio
Para un rango, el sistema DEBE (MUST) descomponer el cambio del patrimonio neto consolidado entre el cierre del día anterior al inicio y el cierre del último día en: ahorro del rango registrado en las cuentas del patrimonio (ingresos menos gastos, a la tasa de la fecha de cada flujo), resultado de conversiones, ajustes y saldos iniciales, revalorización por moneda (agrupada en cambiaria para monedas fiat y de activos para las demás) y otros movimientos; la suma de los componentes DEBE (MUST) ser exactamente igual al cambio del patrimonio, sin un residuo sin explicar.
Trace: FR-REPORTING-008, FR-REPORTING-005 · Priority: Must

#### Scenario: Octubre con ahorro y revalorización
- **CUANDO** al 2026-09-30 el patrimonio es "Banco BOB" 10000.00 BOB, "Cuenta USD" 100.00 USD a 10.00 y "Wallet USDT" 1000.000000 USDT a 12.00 (23000.00 BOB), en 2026-10 el ahorro es 8200.00 BOB todo en BOB y al 2026-10-31 las tasas son USD/BOB 10.50 y USDT/BOB 12.50
- **ENTONCES** el patrimonio al 2026-10-31 es 31750.00 BOB y el cambio de 8750.00 BOB se descompone en ahorro 8200.00 BOB, revalorización cambiaria 50.00 BOB (USD) y revalorización de activos 500.00 BOB (USDT)

#### Scenario: Conversión con spread
- **CUANDO** en 2026-10 la única operación es la venta de 100.000000 USDT por 1190.00 BOB sin comisión, con tasa USDT/BOB de valoración de 12.00 ese día y al inicio y al cierre del rango
- **ENTONCES** el cambio del patrimonio es −10.00 BOB y se informa como resultado de conversiones −10.00 BOB, con revalorización 0.00 BOB

### Requirement: Descomposición incompleta por falta de tasa
Si falta la tasa de una moneda con saldo en el inicio o el cierre del rango, o la de un día con flujos en esa moneda, la descomposición DEBE (MUST) marcarse incompleta e informar las monedas y montos sin valorar, y NO DEBE (MUST NOT) calcular la revalorización de esas monedas ni atribuir la diferencia a otro componente.
Trace: FR-REPORTING-008, FR-FX-006 · Priority: Must

#### Scenario: Bitcoin sin tasa al cierre
- **CUANDO** "Wallet BTC" tiene 0.01000000 BTC y no hay tasa BTC/BOB vigente al 2026-10-31
- **ENTONCES** la descomposición de 2026-10 se marca incompleta, informa 0.01000000 BTC sin valorar y no informa revalorización para BTC

### Requirement: Movimientos con cuentas fuera del patrimonio
Los movimientos entre cuentas incluidas en el patrimonio y cuentas excluidas de él DEBEN (MUST) informarse en la descomposición como "otros movimientos" y NO DEBEN (MUST NOT) contarse como ahorro ni como revalorización.
Trace: FR-REPORTING-005, FR-REPORTING-008 · Priority: Must

#### Scenario: Transferencia a una cuenta excluida
- **CUANDO** en 2026-10 la única operación es una transferencia de 1000.00 BOB de "Banco BOB" a "Fondo familiar", excluida del patrimonio
- **ENTONCES** el cambio del patrimonio es −1000.00 BOB y se informa como otros movimientos −1000.00 BOB

### Requirement: Serie diaria del patrimonio
El sistema DEBE (MUST) poder informar el patrimonio neto de cada día de un rango de hasta 366 días, con los saldos de cada día valorados con la tasa vigente al cierre de ese día (nunca la de hoy) y cada punto marcado incompleto si le falta una tasa.
Trace: FR-REPORTING-008, FR-REPORTING-006 · Priority: Should

#### Scenario: Sueldo del 5 de octubre
- **CUANDO** el patrimonio es 23000.00 BOB al 2026-10-04, el 2026-10-05 se cobra un sueldo de 12000.00 BOB y las tasas no cambian ese día
- **ENTONCES** la serie diaria informa 23000.00 BOB el 2026-10-04 y 35000.00 BOB el 2026-10-05

### Requirement: Drill-down del patrimonio a las cuentas
Desde un punto o un componente de la descomposición el sistema DEBE (MUST) listar las cuentas que lo componen con su saldo nativo y valorado, y enlazar cada cuenta con su historial de saldo del mismo rango.
Trace: FR-REPORTING-010, FR-REPORTING-005 · Priority: Should

#### Scenario: Revalorización de activos
- **CUANDO** se abre el drill-down de la revalorización de activos de 2026-10
- **ENTONCES** se lista "Wallet USDT" con 1000.000000 USDT, 500.00 BOB de revalorización y el enlace a su historial de saldo de 2026-10
