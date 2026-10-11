## ADDED Requirements

### Requirement: Pago de tarjeta administrado por la tarjeta
El tipo `CARD_PAYMENT` DEBE (MUST) admitirse solo en definiciones administradas por una tarjeta de crédito: su cuenta origen DEBE (MUST) ser una cuenta de activo y su cuenta destino la cuenta de pasivo de la tarjeta, en la misma moneda (`TRANSFER_CURRENCY_MISMATCH`, `TRANSFER_SAME_ACCOUNT` como en una transferencia), y materializarla DEBE (MUST) crear una transferencia. Crear o revisar desde los comandos del usuario una definición de tipo `CARD_PAYMENT` DEBE (MUST) seguir rechazándose con `RECURRING_KIND_NOT_AVAILABLE`; los comandos del usuario que cambian una definición administrada (revisar, pausar, reanudar, terminar, editar datos) DEBEN (MUST) rechazarse con `RECURRING_MANAGED_EXTERNALLY`, mientras que aprobar, editar, omitir y vincular sus ocurrencias DEBEN (MUST) seguir permitidos y las sugerencias de coincidencia DEBEN (MUST) tratarlas como transferencias entre esas mismas cuentas. Las definiciones de tipo `TRANSFER` del usuario cuyo destino es una tarjeta NO DEBEN (MUST NOT) cambiar.
Trace: FR-COMMITMENTS-001, FR-DEBT-013, FR-DEBT-014 · Priority: Must

#### Scenario: Plan de pago de la tarjeta
- **CUANDO** el EDITOR activa el plan de pago de "Visa Oro BOB" con origen "Banco BOB" y vencimiento el día 15
- **ENTONCES** existe una definición activa de tipo `CARD_PAYMENT` administrada por la tarjeta, mensual el día 15, de "Banco BOB" a "Visa Oro BOB"
- **Y** al aprobar su ocurrencia del 2026-11-15 por 1120.50 BOB se crea una transferencia de 1120.50 BOB entre esas cuentas

#### Scenario: Transferencia manual sugerida para el pago
- **CUANDO** la ocurrencia del 2026-11-15 del pago de "Visa Oro BOB" espera exactamente 1120.50 BOB y el usuario registra a mano una transferencia posteada de 1120.50 BOB de "Banco BOB" a "Visa Oro BOB" el 2026-11-14
- **ENTONCES** se sugiere vincular esa transferencia con la ocurrencia del 2026-11-15, sin vincularla hasta que el usuario confirme

#### Scenario: Usuario crea un pago de tarjeta directamente
- **CUANDO** el EDITOR crea desde Pagos recurrentes una definición de tipo `CARD_PAYMENT` por 1450.00 BOB mensual
- **ENTONCES** se rechaza con `RECURRING_KIND_NOT_AVAILABLE` y no se crea nada

#### Scenario: Pausar desde Pagos recurrentes
- **CUANDO** el EDITOR intenta pausar la definición de pago de "Visa Oro BOB" desde Pagos recurrentes
- **ENTONCES** se rechaza con `RECURRING_MANAGED_EXTERNALLY` y la definición sigue activa

#### Scenario: Transferencia del usuario intacta
- **CUANDO** existe la transferencia recurrente del usuario "Pago Visa" de 1450.00 BOB a "Visa Oro BOB"
- **ENTONCES** sigue siendo de tipo `TRANSFER`, administrada por el usuario y editable como antes

### Requirement: Monto esperado fijado por el administrador
El administrador de una definición DEBE (MUST) poder fijar, en la misma unidad de trabajo, el monto esperado de una ocurrencia no resuelta como monto exacto, como estimación o sin monto, y omitirla con un motivo, conservando su fecha nominal; una ocurrencia resuelta NO DEBE (MUST NOT) cambiar. Cada cambio DEBE (MUST) publicar el hecho de ocurrencia editada u omitida y auditarse con actor de proceso.
Trace: FR-COMMITMENTS-008, FR-DEBT-013 · Priority: Must

#### Scenario: De estimación a monto exacto
- **CUANDO** la ocurrencia del 2026-11-15 del pago de "Visa Oro BOB" espera 1120.50 BOB como estimación y la tarjeta emite su estado de cuenta con 1120.50 BOB
- **ENTONCES** la ocurrencia espera exactamente 1120.50 BOB, conserva la fecha nominal 2026-11-15 y se publica un hecho de ocurrencia editada

#### Scenario: Ocurrencia ya pagada
- **CUANDO** la ocurrencia del 2026-11-15 ya está vinculada a una transferencia de 1120.50 BOB y la tarjeta recalcula el estado de cuenta en 1165.50 BOB
- **ENTONCES** la ocurrencia no cambia

### Requirement: Pago de tarjeta en el comprometido y en próximos pagos
Las ocurrencias no resueltas de tipo `CARD_PAYMENT` DEBEN (MUST) contarse en el total comprometido del periodo y listarse en los próximos pagos como una transferencia de una cuenta líquida a una no líquida, con su monto exacto o estimado; las que no tienen monto NO DEBEN (MUST NOT) sumarse y DEBEN (MUST) contarse como pagos sin monto.
Trace: FR-COMMITMENTS-011, FR-DEBT-013 · Priority: Must

#### Scenario: Pago de tarjeta en el comprometido de noviembre
- **CUANDO** hoy es 2026-11-01 en el periodo "2026-11" (2026-11-01 a 2026-11-30), queda sin resolver el pago de "Visa Oro BOB" de 1120.50 BOB del 2026-11-15 desde "Banco BOB" (líquida) y el "Internet" de 199.00 BOB del 2026-11-20
- **ENTONCES** el comprometido del periodo en BOB es 1319.50 BOB

#### Scenario: Ciclo futuro sin cuotas
- **CUANDO** la ocurrencia del 2027-01-15 del pago de "Visa Oro BOB", que corresponde al ciclo que cierra el 2026-12-25, aún no tiene monto porque ese ciclo no tiene cuotas programadas
- **ENTONCES** no suma al comprometido del periodo "2027-01" y se informa 1 pago sin monto
