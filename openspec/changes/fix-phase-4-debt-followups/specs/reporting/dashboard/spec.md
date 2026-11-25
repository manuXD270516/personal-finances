# Spec Delta

## ADDED Requirements

### Requirement: Disponible sin un periodo financiero que cubra hoy
Cuando ningún periodo financiero del workspace contiene la fecha de hoy en su zona horaria (por ejemplo, un workspace nuevo cuyos periodos todavía no se crearon tras su primer asiento), el disponible para gastar DEBE (MUST) calcularse con el mes calendario que contiene hoy como horizonte, declarar ese mes como periodo sin identificador de periodo financiero y NO DEBE (MUST NOT) consultar ningún plan de presupuesto. La segunda vista DEBE (MUST) indicar que no hay presupuesto y ofrecer crearlo, sin mostrar 0.00 y sin dejar de mostrar la primera vista.
Trace: FR-PLANNING-024, NFR-USAB-004 · Priority: Must

#### Scenario: Workspace nuevo sin periodos
- **CUANDO** el 2026-10-20 el workspace acaba de registrar el saldo inicial de 12000.00 BOB de "Banco BOB", su única cuenta líquida, todavía no se creó ningún periodo financiero y no hay reservas, compromisos, aportes planificados ni reserva mínima
- **ENTONCES** el disponible para gastar es 12000.00 BOB con el horizonte del 2026-10-01 al 2026-10-31, rotulado "2026-10" y sin identificador de periodo financiero
- **Y** la segunda vista indica que no hay presupuesto y ofrece crearlo
