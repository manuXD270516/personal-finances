## ADDED Requirements

### Requirement: Resumen de deudas en el Home
El Home DEBE (MUST) mostrar una tarjeta "Deudas" que responda "¿cuánto debo y cuándo termino?" con el total adeudado consolidado en la moneda base, el interés pagado en el año consolidado, la fecha estimada libre de deudas (mes y año, indicando las deudas no estimables) y el próximo vencimiento de deuda, con enlace a la vista de deudas; un consolidado incompleto DEBE (MUST) indicarlo con las monedas sin convertir. Si el workspace no tiene cuentas de pasivo, la tarjeta DEBE (MUST) indicar que no hay deudas registradas con la acción de registrar un préstamo o una tarjeta, sin mostrar montos en cero; si las tiene pero ninguna adeuda, DEBE (MUST) indicar que no hay deudas pendientes.
Trace: FR-REPORTING-001, FR-DEBT-018 · Priority: Could

#### Scenario: Tarjeta Deudas del owner
- **CUANDO** el 2026-10-28 el total adeudado es 49100.50 BOB consolidado, el interés pagado en el año 3367.40 BOB, la fecha libre de deudas 2029-06-05 sin contar "Deuda familiar" y el próximo vencimiento "Préstamo auto" el 2026-11-05 por 1850.00 BOB
- **ENTONCES** la tarjeta "Deudas" muestra 49100.50 BOB adeudados, 3367.40 BOB de interés en 2026, "libre de deudas en junio de 2029 (sin contar Deuda familiar)" y "Préstamo auto · 2026-11-05 · 1850.00 BOB" con enlace a la vista de deudas

#### Scenario: Consolidado incompleto
- **CUANDO** no hay tasa de valoración USD/BOB vigente
- **ENTONCES** la tarjeta muestra 48120.50 BOB adeudados con el aviso "sin convertir: 100.00 USD"

#### Scenario: Workspace sin pasivos
- **CUANDO** el workspace no tiene ninguna cuenta de pasivo
- **ENTONCES** la tarjeta "Deudas" indica que no hay deudas registradas y ofrece registrar un préstamo o una tarjeta
- **Y** no muestra 0.00 BOB

#### Scenario: Deudas saldadas
- **CUANDO** el workspace tiene "Visa Oro BOB" y "Préstamo auto" con saldo adeudado 0.00 BOB
- **ENTONCES** la tarjeta "Deudas" indica que no hay deudas pendientes, sin fecha estimada ni próximo vencimiento
