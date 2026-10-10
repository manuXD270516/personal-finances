# Spec Delta

## ADDED Requirements

### Requirement: Sistemas de amortización habilitados
El registro de un préstamo DEBE (MUST) admitir los sistemas francés, alemán, capital fijo (con el principal por cuota) y custom (con las cuotas definidas o adoptadas de la tabla del banco), aplicando a cada uno las reglas de su cronograma.
Trace: FR-DEBT-004, FR-DEBT-005 · Priority: Should

#### Scenario: Préstamo alemán registrado
- **CUANDO** el EDITOR registra un préstamo de 12000.00 BOB al 12.00 % con sistema alemán a 12 cuotas
- **ENTONCES** el préstamo queda en borrador con una vista previa de cuotas decrecientes de 1120.00 a 1010.00 BOB

### Requirement: Registrar un pago extraordinario
El usuario DEBE (MUST) poder registrar un pago extraordinario de un préstamo activo eligiendo reducir plazo o reducir cuota, con una comisión por prepago opcional; el sistema DEBE (MUST), en una sola unidad de trabajo, crear una transacción de pago de préstamo que reduce la deuda por el monto del prepago y registra la comisión como gasto en "Comisiones de préstamo", y fijar la nueva versión del cronograma; las cuotas vencidas a la fecha del prepago DEBEN (MUST) estar pagadas (`LOAN_INSTALLMENTS_PENDING`) y un prepago mayor que el principal pendiente DEBE (MUST) rechazarse con `LOAN_OVERPAYMENT`; un prepago igual al principal pendiente DEBE (MUST) saldar el préstamo.
Trace: FR-DEBT-008, INV-016 · Priority: Should

#### Scenario: Prepago con comisión
- **CUANDO** el préstamo de 12000.00 BOB tiene pagadas las cuotas 1 a 3 y el EDITOR registra el 2027-01-15 desde "Banco BOB" un pago extraordinario de 3000.00 BOB reduciendo el plazo con una comisión por prepago de 30.00 BOB
- **ENTONCES** "Banco BOB" baja 3030.00 BOB, la deuda baja 3000.00 BOB a 6132.95 BOB y el gasto en "Comisiones de préstamo" es 30.00 BOB
- **Y** el cronograma vigente es la versión 2 con las cuotas 4 a 9

#### Scenario: Prepago que salda el préstamo
- **CUANDO** el principal pendiente es 9132.95 BOB y el EDITOR registra un pago extraordinario de 9132.95 BOB
- **ENTONCES** la deuda queda en 0.00 BOB, el préstamo queda saldado y su compromiso terminado

#### Scenario: Prepago con una cuota vencida sin pagar
- **CUANDO** la cuota 4 del 2027-02-15 no está pagada y el EDITOR registra un pago extraordinario con fecha 2027-02-20
- **ENTONCES** se rechaza con `LOAN_INSTALLMENTS_PENDING` y no se crea ninguna transacción

### Requirement: Anular un pago extraordinario
Anular el pago extraordinario más reciente DEBE (MUST), en una sola unidad de trabajo, anular su transacción y fijar una nueva versión del cronograma que vuelve a las cuotas que regían antes del prepago, sin borrar ninguna versión.
Trace: FR-DEBT-008, INV-016 · Priority: Should

#### Scenario: Prepago anulado
- **CUANDO** el EDITOR anula el pago extraordinario de 3000.00 BOB que creó la versión 2
- **ENTONCES** la deuda vuelve a 9132.95 BOB y la versión 3 rige con las cuotas 4 a 12 de 1066.19 BOB (la 12 de 1066.14 BOB)
- **Y** las versiones 1 y 2 siguen consultables como reemplazadas

### Requirement: Compromisos actualizados con la nueva versión del cronograma
Al fijarse una nueva versión del cronograma, el compromiso de cuotas del préstamo DEBE (MUST) reemplazar en la misma unidad de trabajo sus ocurrencias no resueltas desde la vigencia por las cuotas de la nueva versión, cancelando las que ya no existen, sin tocar las ocurrencias resueltas.
Trace: FR-DEBT-011, FR-DEBT-008 · Priority: Should

#### Scenario: Plazo reducido en los próximos pagos
- **CUANDO** el prepago reduciendo el plazo deja las cuotas 4 a 9 con la 9 del 2027-07-15 de 1017.22 BOB
- **ENTONCES** la ocurrencia del 2027-07-15 espera 1017.22 BOB y no queda ninguna ocurrencia sin resolver del préstamo después del 2027-07-15

#### Scenario: Cuota reducida en el comprometido
- **CUANDO** el prepago reduciendo la cuota deja cuotas de 715.96 BOB y el periodo "2027-02" tiene la cuota 4 del 2027-02-15
- **ENTONCES** el comprometido de febrero de 2027 incluye 715.96 BOB por esa cuota
