# Spec Delta

## MODIFIED Requirements

### Requirement: Cuotas de tarjeta futuras en los próximos pagos
Las ocurrencias de pago de tarjeta de ciclos posteriores al abierto cuyo monto estimado proviene de cuotas programadas DEBEN (MUST) listarse en la ventana pedida con ese monto marcado como estimado y la indicación "cuotas", tanto en la lista de próximos pagos como en la tarjeta Q8 del Home. La respuesta de próximos pagos DEBE (MUST) informar el origen del monto esperado de cada pago de tarjeta (estado de cuenta emitido, ciclo abierto o cuotas programadas), de modo que la indicación no dependa del nombre ni de la fecha del pago. El pago del ciclo abierto y el de un estado de cuenta emitido NO DEBEN (MUST NOT) llevar la indicación "cuotas".
Trace: FR-DEBT-017, FR-REPORTING-016 · Priority: Could

#### Scenario: Cuota de la laptop en 60 días
- **CUANDO** el 2026-10-20 se piden los próximos 60 días y el pago de "Visa Oro BOB" del 2026-12-15 espera 333.33 BOB por la segunda cuota de "Laptop"
- **ENTONCES** la lista muestra el 2026-12-15 "Pago de tarjeta · Visa Oro" por 333.33 BOB marcado como estimado con la indicación "cuotas"
- **Y** la respuesta informa que el origen del monto esperado son cuotas programadas

#### Scenario: Cuota en la tarjeta Q8 del Home
- **CUANDO** el 2026-11-20 la tarjeta Q8 del Home lista los próximos 30 días y el pago de "Visa Oro BOB" del 2026-12-15 espera 333.33 BOB por la segunda cuota de "Laptop"
- **ENTONCES** la tarjeta Q8 muestra "Pago de tarjeta · Visa Oro" por 333.33 BOB marcado como estimado con la indicación "cuotas"

#### Scenario: Ciclo abierto sin la indicación de cuotas
- **CUANDO** el 2026-10-20 el pago de "Visa Oro BOB" del 2026-11-15 espera 1120.50 BOB estimados con el saldo del ciclo abierto
- **ENTONCES** la lista lo muestra marcado como estimado, sin la indicación "cuotas", y la respuesta informa que el origen es el ciclo abierto

#### Scenario: Estado de cuenta emitido sin la indicación de cuotas
- **CUANDO** el 2026-11-01 el pago de "Visa Oro BOB" del 2026-11-15 espera exactamente 333.33 BOB del estado de cuenta emitido, que incluye la primera cuota de "Laptop"
- **ENTONCES** la lista lo muestra con su monto exacto, sin la indicación "cuotas", y la respuesta informa que el origen es el estado de cuenta emitido
