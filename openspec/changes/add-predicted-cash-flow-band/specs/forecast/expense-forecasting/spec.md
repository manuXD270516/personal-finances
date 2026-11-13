## ADDED Requirements

### Requirement: Pronóstico del gasto variable por moneda para el flujo de caja
Para cada moneda de las cuentas líquidas del workspace, la corrida DEBE (MUST) pronosticar, en esa moneda y sin conversión, el gasto variable pagado desde cuentas líquidas: la historia por periodo es el gasto de las porciones pagadas desde cuentas líquidas en esa moneda menos las ocurrencias resueltas pagadas desde esas cuentas y los componentes de gasto de cuotas pagadas desde ellas. Las compras cargadas a cuentas no líquidas (por ejemplo una tarjeta de crédito) NO DEBEN (MUST NOT) contarse. La serie DEBE (MUST) cubrir el periodo en curso y los 3 siguientes, con intervalo del 80 % y la misma preparación de datos que las demás series.
Trace: FR-FORECAST-008, FR-FORECAST-003 · Priority: Should

#### Scenario: Gasto variable en bolivianos
- **CUANDO** en el periodo 2026-10 los gastos pagados desde cuentas líquidas en BOB suman 3900.00 BOB y las ocurrencias resueltas pagadas desde esas cuentas suman 2748.00 BOB
- **ENTONCES** la historia del gasto variable líquido en BOB tiene 1152.00 BOB en 2026-10

#### Scenario: Compras con tarjeta fuera de la serie
- **CUANDO** además en 2026-10 se cargaron 600.00 BOB de compras a la tarjeta "Visa Oro"
- **ENTONCES** la historia del gasto variable líquido en BOB de 2026-10 sigue en 1152.00 BOB

#### Scenario: Serie en dólares sin conversión
- **CUANDO** en 2026-10 se pagaron 120.00 USD de gastos variables desde "Banco USD"
- **ENTONCES** la serie del gasto variable líquido en USD tiene 120.00 USD en 2026-10 y no se convierte a BOB
