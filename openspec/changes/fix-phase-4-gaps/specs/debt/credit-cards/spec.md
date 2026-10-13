## MODIFIED Requirements

### Requirement: Resumen del ciclo y saldo al cierre
Para cada cuenta de la tarjeta y cada ciclo, el sistema DEBE (MUST) calcular a partir de las transacciones posteadas: saldo anterior (saldo al cierre previo), compras (gastos cargados a la cuenta, incluidos intereses y comisiones), reembolsos, pagos (transferencias y conversiones recibidas por la cuenta), otros movimientos (ajustes y saldos iniciales) y saldo al cierre, que DEBE (MUST) ser igual al saldo adeudado de la cuenta a la fecha de cierre y cumplir saldo anterior + compras − reembolsos − pagos ± otros = saldo al cierre. El saldo inicial de la cuenta, registrado al abrirla sin transacción, DEBE (MUST) contarse en otros movimientos del ciclo que contiene su fecha, y un ciclo cuyas cifras cumplen la igualdad DEBE (MUST) informarse como cuadrado. Las transacciones pendientes NO DEBEN (MUST NOT) contarse en el ciclo.
Trace: FR-DEBT-013, FR-LEDGER-012 · Priority: Must

#### Scenario: Ciclo de octubre de Visa Oro BOB
- **CUANDO** "Visa Oro BOB" tenía un saldo de 1200.00 BOB al cierre del 2026-09-25, se pagaron 1200.00 BOB el 2026-10-10, se compraron 350.00 BOB el 2026-10-03 y 820.50 BOB el 2026-10-18, hubo un reembolso de 50.00 BOB el 2026-10-20 y una compra de 400.00 BOB el 2026-10-26
- **ENTONCES** el ciclo del 2026-09-26 al 2026-10-25 informa saldo anterior 1200.00 BOB, compras 1170.50 BOB, reembolsos 50.00 BOB, pagos 1200.00 BOB y saldo al cierre 1120.50 BOB
- **Y** la compra de 400.00 BOB del 2026-10-26 pertenece al ciclo siguiente

#### Scenario: Compra pendiente fuera del ciclo
- **CUANDO** además existe una compra pendiente de 75.00 BOB del 2026-10-22 en "Visa Oro BOB"
- **ENTONCES** el saldo al cierre del 2026-10-25 sigue siendo 1120.50 BOB y las compras del ciclo siguen siendo 1170.50 BOB

#### Scenario: Ciclo que contiene el saldo inicial de la cuenta
- **CUANDO** "Visa Oro BOB" se abrió el 2026-10-05 con un saldo inicial adeudado de 1200.00 BOB, sin transacción, y se compraron 350.00 BOB el 2026-10-08
- **ENTONCES** el ciclo del 2026-09-26 al 2026-10-25 informa saldo anterior 0.00 BOB, compras 350.00 BOB, reembolsos 0.00 BOB, pagos 0.00 BOB, otros movimientos 1200.00 BOB y saldo al cierre 1550.00 BOB
- **Y** el ciclo se informa cuadrado, porque 0.00 + 350.00 − 0.00 − 0.00 + 1200.00 = 1550.00 BOB

## ADDED Requirements

### Requirement: Próximo vencimiento de la tarjeta
Para cada cuenta de la tarjeta, el sistema DEBE (MUST) informar como próximo vencimiento la fecha de vencimiento más cercana que no sea anterior a hoy, en la zona del workspace, entre los estados de cuenta emitidos a los que les falta algo para no generar intereses y el ciclo abierto. El próximo vencimiento NO DEBE (MUST NOT) ser una fecha pasada ni la de un ciclo cerrado que no tiene estado de cuenta emitido; cada estado de cuenta emitido cuyo vencimiento ya pasó y al que le falta algo DEBE (MUST) informarse aparte como atrasado, con su estado y lo que falta.
Trace: FR-DEBT-013 · Priority: Must

#### Scenario: Tarjeta recién registrada con deuda previa
- **CUANDO** hoy es 2026-10-20 en America/La_Paz y el EDITOR registra "Visa Oro" (cierre el día 25, vencimiento el día 15) con "Visa Oro BOB", que adeuda 1200.00 BOB
- **ENTONCES** el próximo vencimiento de "Visa Oro BOB" es 2026-11-15, el del ciclo abierto del 2026-09-26 al 2026-10-25
- **Y** no se informa el 2026-10-15, vencimiento del ciclo cerrado el 2026-09-25, que no tiene estado de cuenta emitido

#### Scenario: Estado de cuenta emitido aún no vencido
- **CUANDO** hoy es 2026-10-28 y el estado de cuenta de "Visa Oro BOB" cerrado el 2026-10-25 tiene 1120.50 BOB sin pagar con vencimiento 2026-11-15
- **ENTONCES** el próximo vencimiento de "Visa Oro BOB" es 2026-11-15

#### Scenario: Estado de cuenta vencido con saldo pendiente
- **CUANDO** hoy es 2026-11-20, el estado de cuenta cerrado el 2026-10-25 venció el 2026-11-15 con 620.50 BOB pendientes tras un pago de 500.00 BOB y el ciclo abierto va del 2026-10-26 al 2026-11-25
- **ENTONCES** el próximo vencimiento de "Visa Oro BOB" es 2026-12-15
- **Y** el estado de cuenta cerrado el 2026-10-25 se informa aparte como atrasado, `PARTIALLY_PAID`, con 620.50 BOB pendientes
