## ADDED Requirements

### Requirement: Vencimientos de tarjeta en los próximos pagos
La lista de próximos pagos y la tarjeta Q8 del Home DEBEN (MUST) incluir las ocurrencias no resueltas de pago de tarjeta, rotuladas como "Pago de tarjeta" con el nombre de la tarjeta y la moneda de la cuenta, con su monto exacto (estado de cuenta emitido) o marcado como estimado (ciclo abierto o cuotas de ciclos posteriores), y sumarlas al total de la lista y al comprometido del periodo con las reglas de valoración de esta capability; las que no tienen monto DEBEN (MUST) mostrarse como "monto por definir" sin sumarse.
Trace: FR-REPORTING-016, FR-DEBT-013, FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Estado de cuenta emitido en la lista de 30 días
- **CUANDO** el 2026-11-01 el pago de "Visa Oro BOB" del 2026-11-15 espera exactamente 1120.50 BOB y el "Internet" de 199.00 BOB vence el 2026-11-20
- **ENTONCES** la lista de 30 días muestra "Pago de tarjeta · Visa Oro" por 1120.50 BOB el 2026-11-15 y luego "Internet"
- **Y** el total de la lista es 1319.50 BOB

#### Scenario: Ciclo abierto estimado
- **CUANDO** el 2026-10-20 el pago de "Visa Oro BOB" del 2026-11-15 espera 1120.50 BOB como estimación
- **ENTONCES** la lista de 30 días muestra 1120.50 BOB marcado como estimado

#### Scenario: Parte en dólares valorada
- **CUANDO** además el pago de "Visa Oro USD" del 2026-11-15 espera exactamente 100.00 USD y la tasa de valoración USD/BOB vigente es 9.80
- **ENTONCES** la lista informa 1319.50 BOB y 100.00 USD por moneda y un total consolidado de 2299.50 BOB

### Requirement: Cuotas de tarjeta futuras en los próximos pagos
Las ocurrencias de pago de tarjeta de ciclos posteriores al abierto cuyo monto estimado proviene de cuotas programadas DEBEN (MUST) listarse en la ventana pedida con ese monto marcado como estimado y la indicación "cuotas".
Trace: FR-DEBT-017, FR-REPORTING-016 · Priority: Could

#### Scenario: Cuota de la laptop en 60 días
- **CUANDO** el 2026-10-20 se piden los próximos 60 días y el pago de "Visa Oro BOB" del 2026-12-15 espera 333.33 BOB por la segunda cuota de "Laptop"
- **ENTONCES** la lista muestra el 2026-12-15 "Pago de tarjeta · Visa Oro" por 333.33 BOB marcado como estimado con la indicación "cuotas"
