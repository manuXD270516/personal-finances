# Spec Delta

## ADDED Requirements

### Requirement: Cuotas de préstamo administradas por el contexto de deudas
El tipo `LOAN_PAYMENT` DEBE (MUST) admitirse solo en definiciones administradas por el contexto de deudas, creadas y revisadas por un préstamo; crear o revisar una definición `LOAN_PAYMENT` desde la API de recurrentes DEBE (MUST) seguir rechazándose con `RECURRING_KIND_NOT_AVAILABLE`; una definición de cuotas DEBE (MUST) llevar un calendario explícito de cuotas (número, fecha de vencimiento y total esperado de cada una) en lugar de una regla de recurrencia, generar una ocurrencia por cuota dentro del horizonte con su total como monto esperado fijo y operar en modo solo aviso; el motor NO DEBE (MUST NOT) crear transacciones para esas ocurrencias y aprobarlas, editarlas, omitirlas o vincularlas desde recurrentes DEBE (MUST) rechazarse con `RECURRING_MANAGED_EXTERNALLY`.
Trace: FR-DEBT-011, FR-COMMITMENTS-001, FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Calendario de cuotas generado hasta el horizonte
- **CUANDO** hoy es 2026-10-15, el horizonte es de 90 días y el "Préstamo vehicular" crea su definición de cuotas con 24 cuotas de 2342.02 BOB (la última de 2341.90 BOB) desde el 2026-11-15
- **ENTONCES** existen ocurrencias programadas para el 2026-11-15, el 2026-12-15 y el 2027-01-15 por 2342.02 BOB cada una
- **Y** la ocurrencia del 2027-02-15 se genera cuando el horizonte la alcanza

#### Scenario: Cuota de préstamo creada a mano
- **CUANDO** el EDITOR crea desde recurrentes una definición `LOAN_PAYMENT` de 1200.00 BOB mensual
- **ENTONCES** se rechaza con `RECURRING_KIND_NOT_AVAILABLE` y no se crea nada

#### Scenario: Aprobar una cuota desde recurrentes
- **CUANDO** el EDITOR aprueba desde recurrentes la ocurrencia del 2026-11-15 del "Préstamo vehicular"
- **ENTONCES** se rechaza con `RECURRING_MANAGED_EXTERNALLY` indicando el préstamo que la administra y no se crea ninguna transacción

### Requirement: Cuotas de préstamo en el comprometido y en los próximos pagos
Las ocurrencias no resueltas de cuotas de préstamo DEBEN (MUST) sumarse al total comprometido del periodo por su monto esperado y figurar en la lista de próximos pagos con el nombre del préstamo y el número de cuota, igual que un gasto, sin contarse dos veces con la transacción del pago que las resuelve.
Trace: FR-COMMITMENTS-011, FR-DEBT-011 · Priority: Must

#### Scenario: Comprometido con alquiler y cuota
- **CUANDO** el periodo "2026-11" tiene sin resolver el "Alquiler" de 3500.00 BOB del 2026-11-05 y la cuota 1 del "Préstamo vehicular" de 2342.02 BOB del 2026-11-15
- **ENTONCES** el comprometido de noviembre en BOB es 5842.02 BOB
- **Y** al registrarse el pago de la cuota 1 el comprometido baja a 3500.00 BOB

### Requirement: Resolución de cuotas por el contexto de deudas
El contexto de deudas DEBE (MUST) poder, en su unidad de trabajo, resolver una o varias ocurrencias de cuotas de la misma definición con una sola transacción de pago, cambiar el monto esperado de una ocurrencia no resuelta por el pendiente de la cuota, devolver ocurrencias resueltas a no resueltas al anularse el pago y terminar la definición; la liberación automática por anulación de transacciones y las sugerencias de coincidencia NO DEBEN (MUST NOT) actuar sobre ocurrencias de cuotas de préstamo.
Trace: FR-DEBT-011, FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Dos cuotas con un solo pago
- **CUANDO** el préstamo registra un pago de 4684.04 BOB que paga las cuotas 1 y 2
- **ENTONCES** las ocurrencias del 2026-11-15 y del 2026-12-15 quedan vinculadas a la misma transacción

#### Scenario: Sin sugerencias para cuotas
- **CUANDO** el usuario registra a mano un gasto de 2342.02 BOB en "Banco BOB" el 2026-11-15
- **ENTONCES** no se sugiere vincularlo con la ocurrencia de la cuota 1 del "Préstamo vehicular"
