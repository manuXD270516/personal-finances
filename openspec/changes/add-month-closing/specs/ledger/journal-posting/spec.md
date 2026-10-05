# Spec Delta

## MODIFIED Requirements

### Requirement: Los periodos bloqueados rechazan asientos
El sistema DEBE (MUST) rechazar con `PERIOD_CLOSED`, en el dominio y en la base de datos, todo asiento (incluidas reversas y aperturas) cuya fecha de negocio caiga dentro del rango de fechas de un periodo bloqueado del workspace, que es el rango del periodo financiero cerrado (con día de inicio 1, el mes calendario) y, para el primer periodo bloqueado, también toda fecha anterior a su inicio, sin persistir nada; los periodos no bloqueados aceptan asientos.
Trace: FR-LEDGER-011, FR-PLANNING-005 · Priority: Must

#### Scenario: Asiento con fecha en un periodo bloqueado
- **CUANDO** el periodo del 2026-08-01 al 2026-08-31 está bloqueado, "Bank A" tiene 1000.00 BOB y se registra un asiento de gasto de 45.00 BOB con fecha 2026-08-15
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y los saldos de agosto de 2026 no cambian
- **Y** el mismo gasto con fecha 2026-09-01 se acepta y "Bank A" queda en 955.00 BOB

#### Scenario: Reversa fechada en un periodo bloqueado
- **CUANDO** se solicita revertir con fecha 2026-08-10 un asiento de 120.00 BOB mientras agosto de 2026 está bloqueado
- **ENTONCES** se rechaza con `PERIOD_CLOSED`

#### Scenario: Escritura directa en la base de datos durante el bloqueo
- **CUANDO** con el rol de aplicación se inserta directamente un asiento con fecha 2026-08-31 mientras agosto de 2026 está bloqueado
- **ENTONCES** la base de datos rechaza la inserción

#### Scenario: Sin bloqueos en Phase 1
- **CUANDO** no existe ningún periodo bloqueado en el workspace
- **ENTONCES** se aceptan asientos balanceados con cualquier fecha de negocio, como 2025-12-31 o 2026-08-15

#### Scenario: Periodo financiero con día de inicio 25
- **CUANDO** está bloqueado el periodo "2026-10" del 2026-10-25 al 2026-11-24 y "Bank A" tiene 1000.00 BOB
- **ENTONCES** los gastos de 20.00 BOB con fechas 2026-10-25 y 2026-11-24 se rechazan con `PERIOD_CLOSED`, también al insertarlos directamente en la base de datos
- **Y** los gastos de 20.00 BOB con fechas 2026-10-24 y 2026-11-25 se aceptan y "Bank A" queda en 960.00 BOB

#### Scenario: Fechas anteriores al primer periodo bloqueado
- **CUANDO** el único periodo bloqueado del workspace es el primero, del 2026-07-01 al 2026-07-31, y se registra un saldo inicial de 500.00 BOB con fecha 2026-06-15
- **ENTONCES** se rechaza con `PERIOD_CLOSED`
