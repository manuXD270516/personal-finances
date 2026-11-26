# Spec Delta

## ADDED Requirements

### Requirement: Disponible sin un periodo financiero que cubra hoy
Cuando ningún periodo financiero del workspace contiene la fecha de hoy en su zona horaria (por ejemplo, un workspace nuevo cuyos periodos todavía no se crearon tras su primer asiento), el disponible para gastar DEBE (MUST) calcularse con el mes calendario que contiene hoy como horizonte, declarar ese mes como periodo sin identificador de periodo financiero y NO DEBE (MUST NOT) consultar ningún plan de presupuesto. La segunda vista DEBE (MUST) indicar que no hay presupuesto y ofrecer crearlo, sin mostrar 0.00 y sin dejar de mostrar la primera vista.
Trace: FR-PLANNING-024, NFR-USAB-004 · Priority: Must

#### Scenario: Workspace nuevo sin periodos
- **CUANDO** el 2026-10-20 el workspace acaba de registrar el saldo inicial de 12000.00 BOB de "Banco BOB", su única cuenta líquida, todavía no se creó ningún periodo financiero y no hay reservas, compromisos, aportes planificados ni reserva mínima
- **ENTONCES** el disponible para gastar es 12000.00 BOB con el horizonte del 2026-10-01 al 2026-10-31, rotulado "2026-10" y sin identificador de periodo financiero
- **Y** la segunda vista indica que no hay presupuesto y ofrece crearlo

### Requirement: Aviso de tarjetas sin pago programado en el disponible
El disponible para gastar DEBE (MUST) informar cuántas tarjetas de crédito no archivadas tienen saldo adeudado y no tienen ninguna transferencia recurrente no resuelta ni transacción pendiente hacia ellas con fecha hasta el fin del horizonte, porque sus compras no se descuentan hasta que se programa el pago. Una tarjeta con un pago programado DEBE (MUST) quedar fuera del aviso aunque el monto programado sea menor que el pago mínimo de su estado de cuenta (D213, D491). El aviso NO DEBE (MUST NOT) cambiar el monto del disponible.
Trace: FR-REPORTING-016, FR-COMMITMENTS-011, FR-DEBT-014 · Priority: Should

#### Scenario: Tarjeta con saldo adeudado sin pago programado
- **CUANDO** el 2026-11-10 "Visa Oro BOB" adeuda 1500.00 BOB y no hay ninguna transferencia recurrente ni transacción pendiente hacia ella hasta el 2026-11-30, fin del horizonte
- **ENTONCES** el disponible informa 1 tarjeta sin pago programado
- **Y** el monto del disponible es el mismo que sin el aviso

#### Scenario: Pago programado menor que el mínimo
- **CUANDO** el 2026-11-10 "Visa Oro BOB" adeuda 1500.00 BOB con un pago mínimo de 300.00 BOB y hay una transferencia recurrente no resuelta de 200.00 BOB desde "Banco BOB" hacia ella con fecha 2026-11-25
- **ENTONCES** el disponible informa 0 tarjetas sin pago programado
- **Y** el comprometido incluye la transferencia de 200.00 BOB
