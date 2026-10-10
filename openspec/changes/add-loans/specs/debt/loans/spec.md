# Spec Delta

## Purpose

Permite controlar los préstamos del workspace (vehicular, hipotecario, de consumo, entre personas) como deudas amortizables: registrar el préstamo con sus condiciones (principal, moneda, tasa nominal anual, convención de días, periodicidad, plazo, fechas, prestamista, cuenta de pasivo y cuenta destino), registrar el desembolso como una transacción que aumenta la deuda por el principal completo, incorporar préstamos preexistentes con su saldo pendiente, registrar cada pago separando el principal (que reduce la deuda) del interés, las comisiones, el seguro y los impuestos (que son gasto), mostrar las diferencias entre lo pagado y lo esperado, y convertir las cuotas en compromisos recurrentes que alimentan el comprometido del periodo (Q4) y los próximos pagos (Q8). El cálculo del cronograma vive en `debt/amortization`; las transacciones y los asientos los crea el contexto de transacciones.

## ADDED Requirements

### Requirement: Registrar un préstamo con sus condiciones
El sistema DEBE (MUST) permitir registrar un préstamo con nombre, principal mayor que cero en la moneda de la cuenta del préstamo, tasa nominal anual mayor o igual a cero con tipo fijo o variable, convención de días, periodicidad de pago, plazo en número de cuotas entre 1 y 600, fecha de desembolso, fecha de la primera cuota posterior a la de desembolso, sistema de amortización, cargos por cuota opcionales, prestamista (contraparte) opcional, cuenta del préstamo, cuenta destino del desembolso y cuenta de pago habitual; un préstamo nuevo DEBE (MUST) quedar en borrador con la vista previa de su cronograma y sin ningún asiento contable; valores fuera de rango DEBEN (MUST) rechazarse con `VALIDATION_FAILED`, montos con más decimales que la moneda con `AMOUNT_SCALE_EXCEEDED` y un sistema de amortización distinto del francés con `LOAN_METHOD_NOT_AVAILABLE` mientras los demás sistemas no estén habilitados, sin crear nada.
Trace: FR-DEBT-001 · Priority: Must

#### Scenario: Préstamo vehicular en borrador
- **CUANDO** el EDITOR registra "Préstamo vehicular" de 50000.00 BOB al 11.50 % nominal anual fijo, convención 30/360, mensual, 24 cuotas, desembolso el 2026-10-15, primera cuota el 2026-11-15, sistema francés, prestamista "Banco Andino", cuenta del préstamo "Préstamo vehicular" (`loan`, BOB) y destino "Banco BOB"
- **ENTONCES** el préstamo queda en borrador con una vista previa de 24 cuotas de 2342.02 BOB (la última de 2341.90 BOB)
- **Y** el saldo de "Préstamo vehicular" sigue en 0.00 BOB y no existe ninguna transacción del préstamo

#### Scenario: Primera cuota antes del desembolso
- **CUANDO** el EDITOR registra un préstamo con desembolso el 2026-10-15 y primera cuota el 2026-10-10
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y no se crea el préstamo

#### Scenario: Principal con escala inválida
- **CUANDO** el EDITOR registra un préstamo de 50000.005 BOB
- **ENTONCES** se rechaza con `AMOUNT_SCALE_EXCEEDED` y no se crea el préstamo

#### Scenario: Sistema alemán aún no disponible
- **CUANDO** el EDITOR registra un préstamo de 12000.00 BOB con sistema alemán antes de que ese sistema esté habilitado
- **ENTONCES** se rechaza con `LOAN_METHOD_NOT_AVAILABLE` y no se crea el préstamo

### Requirement: Cuenta del préstamo y cuenta destino
La cuenta del préstamo DEBE (MUST) ser una cuenta activa de tipo `loan` (naturaleza pasivo) en la moneda del préstamo, sin otro préstamo no cancelado vinculado (`LOAN_ACCOUNT_IN_USE`) y, para un préstamo nuevo, con saldo cero (`LOAN_ACCOUNT_NOT_EMPTY`); el sistema DEBE (MUST) permitir crear esa cuenta en el mismo acto del registro; una cuenta de otro tipo DEBE (MUST) rechazarse con `LOAN_ACCOUNT_INVALID`; la cuenta destino y la cuenta de pago DEBEN (MUST) estar activas, ser distintas de la cuenta del préstamo y estar en la moneda del préstamo (`CURRENCY_MISMATCH`), sin crear nada si alguna validación falla.
Trace: FR-DEBT-001, INV-030, INV-002 · Priority: Must

#### Scenario: Cuenta del préstamo creada en el mismo acto
- **CUANDO** el EDITOR registra el préstamo de 50000.00 BOB pidiendo crear la cuenta "Préstamo vehicular"
- **ENTONCES** existe la cuenta "Préstamo vehicular" de tipo `loan`, naturaleza pasivo, en BOB, con saldo 0.00 BOB, vinculada al préstamo en borrador

#### Scenario: Cuenta bancaria como cuenta del préstamo
- **CUANDO** el EDITOR registra un préstamo indicando "Banco BOB" (`bank`) como cuenta del préstamo
- **ENTONCES** se rechaza con `LOAN_ACCOUNT_INVALID` y no se crea el préstamo

#### Scenario: Destino en otra moneda
- **CUANDO** el EDITOR registra un préstamo de 50000.00 BOB con destino "Banco USD" (USD)
- **ENTONCES** se rechaza con `CURRENCY_MISMATCH` y no se crea el préstamo

#### Scenario: Cuenta ya usada por otro préstamo
- **CUANDO** el EDITOR registra un segundo préstamo con la cuenta "Préstamo vehicular" que ya respalda un préstamo activo
- **ENTONCES** se rechaza con `LOAN_ACCOUNT_IN_USE` y no se crea el préstamo

### Requirement: Desembolso registrado como transacción
Desembolsar un préstamo en borrador DEBE (MUST), en una sola unidad de trabajo, crear una transacción de desembolso de préstamo con la fecha de desembolso que aumente el saldo de la cuenta destino por el principal menos la comisión retenida, aumente la deuda de la cuenta del préstamo por el principal completo y registre la comisión retenida como gasto en la categoría de sistema "Comisiones de préstamo", fijar el cronograma vigente, activar el préstamo y crear el compromiso de sus cuotas; si la fecha cae en un periodo cerrado DEBE (MUST) rechazarse con `PERIOD_CLOSED` sin crear nada; desembolsar un préstamo que no está en borrador DEBE (MUST) rechazarse con `LOAN_NOT_DRAFT`.
Trace: FR-DEBT-002, INV-030, INV-004, INV-009 · Priority: Must

#### Scenario: Desembolso completo
- **CUANDO** "Banco BOB" tiene 1000.00 BOB y el EDITOR desembolsa el 2026-10-15 el "Préstamo vehicular" de 50000.00 BOB sin comisión
- **ENTONCES** existe una transacción de desembolso de préstamo del 2026-10-15, "Banco BOB" tiene 51000.00 BOB y "Préstamo vehicular" adeuda 50000.00 BOB
- **Y** el asiento suma 0.00 BOB, el patrimonio neto no cambia y el préstamo queda activo con su cronograma de 24 cuotas

#### Scenario: Desembolso con comisión retenida por el banco
- **CUANDO** "Banco BOB" tiene 1000.00 BOB y el EDITOR desembolsa el préstamo de 50000.00 BOB con una comisión de originación retenida de 500.00 BOB
- **ENTONCES** "Banco BOB" tiene 50500.00 BOB, "Préstamo vehicular" adeuda 50000.00 BOB y el gasto en "Comisiones de préstamo" del 2026-10-15 es 500.00 BOB
- **Y** el asiento suma 0.00 BOB (49500.00 + 500.00 − 50000.00) y el patrimonio neto baja exactamente 500.00 BOB

#### Scenario: Desembolso en un periodo cerrado
- **CUANDO** el periodo "2026-09" está cerrado y el EDITOR desembolsa un préstamo con fecha 2026-09-30
- **ENTONCES** se rechaza con `PERIOD_CLOSED`, el préstamo sigue en borrador y no se crea ninguna transacción

### Requirement: Préstamo preexistente con saldo pendiente
El sistema DEBE (MUST) permitir registrar un préstamo que ya estaba en curso indicando el saldo de principal pendiente a una fecha, el número de la próxima cuota, la cantidad de cuotas restantes y la fecha de la próxima cuota, sin transacción de desembolso; si la cuenta del préstamo se crea en el acto, su saldo inicial adeudado DEBE (MUST) ser el saldo pendiente a esa fecha; si la cuenta ya existe, su saldo adeudado a esa fecha DEBE (MUST) coincidir con el saldo pendiente o rechazarse con `LOAN_BALANCE_MISMATCH` informando ambos montos; el préstamo DEBE (MUST) quedar activo con un cronograma calculado sobre el saldo pendiente que continúa la numeración original.
Trace: FR-DEBT-002 · Priority: Must

#### Scenario: Préstamo en curso desde la cuota 7
- **CUANDO** el EDITOR registra el préstamo en curso "Préstamo personal" con saldo pendiente 30000.00 BOB al 2026-10-15, 11.50 % anual, 30/360, mensual, próxima cuota número 7 el 2026-11-15 y 18 cuotas restantes, creando su cuenta
- **ENTONCES** la cuenta "Préstamo personal" adeuda 30000.00 BOB por un asiento de apertura fechado 2026-10-15
- **Y** el préstamo queda activo con las cuotas 7 a 24 de 1822.50 BOB (la 24 de 1822.53 BOB) cuyo principal suma 30000.00 BOB

#### Scenario: Saldo de la cuenta distinto del pendiente
- **CUANDO** la cuenta "Préstamo personal" ya adeuda 29500.00 BOB al 2026-10-15 y el EDITOR registra el préstamo en curso con saldo pendiente 30000.00 BOB
- **ENTONCES** se rechaza con `LOAN_BALANCE_MISMATCH` informando 29500.00 BOB en la cuenta y 30000.00 BOB declarados, y no se crea el préstamo

### Requirement: Registrar el pago de cuotas con su desglose
Registrar un pago de un préstamo activo (monto mayor que cero, fecha, cuenta de pago activa en la moneda del préstamo distinta de la cuenta del préstamo y medio de pago opcional) DEBE (MUST) crear en la misma unidad de trabajo una transacción de pago de préstamo que retire el monto de la cuenta de pago, reduzca la deuda por el principal y registre el interés, las comisiones, el seguro y los impuestos como gasto en las categorías de sistema "Intereses pagados", "Comisiones de préstamo", "Seguros" e "Impuestos"; sin desglose indicado, el monto DEBE (MUST) imputarse a las cuotas no pagadas en orden de número y, dentro de cada cuota, en el orden impuestos, seguro, comisiones, interés y principal; los componentes en cero NO DEBEN (MUST NOT) generar porciones; principal + interés + comisiones + seguro + impuestos DEBE (MUST) ser igual al monto pagado.
Trace: FR-DEBT-007, INV-016, INV-009 · Priority: Must

#### Scenario: Pago exacto de la primera cuota
- **CUANDO** "Banco BOB" tiene 51000.00 BOB y el EDITOR registra el 2026-11-15 un pago de 2342.02 BOB del "Préstamo vehicular" desde "Banco BOB"
- **ENTONCES** "Banco BOB" tiene 48657.98 BOB, "Préstamo vehicular" adeuda 48137.15 BOB y el gasto en "Intereses pagados" del 2026-11-15 es 479.17 BOB
- **Y** la cuota 1 queda pagada con principal 1862.85 BOB e interés 479.17 BOB, y el asiento suma 0.00 BOB

#### Scenario: Cuota con comisión y seguro
- **CUANDO** el préstamo de 50000.00 BOB tiene una comisión fija de 10.00 BOB por cuota y un seguro del 0.0400 % mensual sobre el saldo, y el EDITOR paga la cuota 1 de 2372.02 BOB
- **ENTONCES** la deuda baja 1862.85 BOB y se registran como gasto 479.17 BOB en "Intereses pagados", 10.00 BOB en "Comisiones de préstamo" y 20.00 BOB en "Seguros"
- **Y** no se registra ninguna porción de "Impuestos"

#### Scenario: Un pago que cubre dos cuotas
- **CUANDO** el EDITOR registra un pago de 4684.04 BOB del préstamo sin cargos con las cuotas 1 y 2 sin pagar
- **ENTONCES** las cuotas 1 y 2 quedan pagadas, la deuda baja 3743.56 BOB (1862.85 + 1880.71) y el interés registrado es 940.48 BOB (479.17 + 461.31)

### Requirement: Diferencias entre el pago real y la cuota esperada
El sistema DEBE (MUST) mostrar, para cada cuota, el monto esperado, el monto pagado y la diferencia por componente (principal, interés, comisiones, seguro e impuestos); un pago menor que lo pendiente de una cuota DEBE (MUST) dejarla parcialmente pagada con su pendiente por componente; un pago (o un principal indicado) mayor que todo lo pendiente del préstamo DEBE (MUST) rechazarse con `LOAN_OVERPAYMENT` sin crear nada.
Trace: FR-DEBT-007, INV-016 · Priority: Must

#### Scenario: Pago parcial de una cuota con cargos
- **CUANDO** el EDITOR paga 2000.00 BOB de la cuota 1 de 2372.02 BOB (principal 1862.85, interés 479.17, comisión 10.00, seguro 20.00)
- **ENTONCES** se imputan 20.00 BOB a seguro, 10.00 BOB a comisión, 479.17 BOB a interés y 1490.83 BOB a principal
- **Y** la cuota 1 queda parcialmente pagada con 372.02 BOB de principal pendiente y una diferencia de −372.02 BOB frente a lo esperado

#### Scenario: Completar la cuota parcial
- **CUANDO** después el EDITOR paga 372.02 BOB
- **ENTONCES** la cuota 1 queda pagada con 1862.85 BOB de principal en dos pagos y diferencia 0.00 BOB

#### Scenario: Pago mayor que la deuda
- **CUANDO** el préstamo de 1000.00 BOB a 3 cuotas solo tiene pendiente la cuota 3 de 340.03 BOB y el EDITOR registra un pago de 500.00 BOB
- **ENTONCES** se rechaza con `LOAN_OVERPAYMENT` y no se crea ninguna transacción

### Requirement: Desglose indicado por el usuario
El usuario DEBE (MUST) poder indicar el desglose de un pago para una cuota (por ejemplo, según el recibo del banco con interés moratorio); la suma de los componentes DEBE (MUST) ser igual al monto pagado o rechazarse con `PAYMENT_BREAKDOWN_MISMATCH`; el principal indicado NO DEBE (MUST NOT) superar el principal pendiente del préstamo (`LOAN_OVERPAYMENT`); la cuota DEBE (MUST) quedar pagada cuando el principal acumulado cubre su principal esperado y las diferencias por componente DEBEN (MUST) quedar visibles.
Trace: FR-DEBT-007, INV-016 · Priority: Must

#### Scenario: Pago con interés moratorio
- **CUANDO** el EDITOR registra el 2026-11-20 un pago de 2360.00 BOB de la cuota 1 de 2342.02 BOB indicando principal 1862.85 BOB e interés 497.15 BOB
- **ENTONCES** la cuota 1 queda pagada, el gasto en "Intereses pagados" es 497.15 BOB y la cuota muestra una diferencia de interés de +17.98 BOB

#### Scenario: Desglose que no suma el pago
- **CUANDO** el EDITOR registra un pago de 2400.00 BOB indicando principal 1862.85 BOB, interés 479.17 BOB y comisiones 50.00 BOB
- **ENTONCES** se rechaza con `PAYMENT_BREAKDOWN_MISMATCH` (2392.02 BOB indicados frente a 2400.00 BOB) y no se crea ninguna transacción

### Requirement: Anular un pago de préstamo
Anular un pago desde el préstamo DEBE (MUST), en una sola unidad de trabajo, anular su transacción con reversa del asiento, devolver las cuotas imputadas al estado anterior al pago y restituir la ocurrencia de compromiso correspondiente; solo el pago no anulado más reciente del préstamo DEBE (MUST) poder anularse (`LOAN_PAYMENT_NOT_LATEST`) para que la imputación de los pagos restantes no cambie.
Trace: FR-DEBT-007, INV-016, INV-008 · Priority: Must

#### Scenario: Anular el último pago
- **CUANDO** la cuota 1 está pagada con 2342.02 BOB y el EDITOR anula ese pago con motivo "monto equivocado"
- **ENTONCES** la transacción queda anulada con su reversa, "Préstamo vehicular" vuelve a adeudar 50000.00 BOB y la cuota 1 vuelve a no pagada

#### Scenario: Anular un pago anterior
- **CUANDO** las cuotas 1 y 2 se pagaron con dos pagos y el EDITOR anula el pago de la cuota 1
- **ENTONCES** se rechaza con `LOAN_PAYMENT_NOT_LATEST` y ambos pagos siguen vigentes

### Requirement: Cuotas como compromisos recurrentes
Al activarse un préstamo el sistema DEBE (MUST) crear, en la misma unidad de trabajo, un compromiso recurrente de cuota de préstamo administrado por el préstamo, con la cuenta de pago y una ocurrencia esperada por cada cuota no pagada con su fecha de vencimiento y el total de la cuota (incluidos cargos); esas ocurrencias DEBEN (MUST) contar en el comprometido del periodo y en los próximos pagos; el usuario NO DEBE (MUST NOT) poder editar, pausar, terminar ni aprobar ese compromiso desde recurrentes (`RECURRING_MANAGED_EXTERNALLY`).
Trace: FR-DEBT-011, FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Cuota en el comprometido de noviembre
- **CUANDO** hoy es 2026-11-02, el periodo "2026-11" va del 2026-11-01 al 2026-11-30 y la única ocurrencia sin resolver es la cuota 1 del "Préstamo vehicular" del 2026-11-15 por 2342.02 BOB
- **ENTONCES** el comprometido de noviembre en BOB es 2342.02 BOB
- **Y** los próximos pagos de 30 días listan "Préstamo vehicular — cuota 1" del 2026-11-15 por 2342.02 BOB

#### Scenario: Pausar el compromiso del préstamo
- **CUANDO** el EDITOR intenta pausar desde recurrentes el compromiso del "Préstamo vehicular"
- **ENTONCES** se rechaza con `RECURRING_MANAGED_EXTERNALLY` y el compromiso sigue activo

### Requirement: Pago registrado resuelve la ocurrencia de la cuota
Un pago que deja una cuota pagada DEBE (MUST) resolver la ocurrencia de esa cuota vinculándola a la transacción del pago en la misma unidad de trabajo; una transacción que paga varias cuotas DEBE (MUST) resolver todas sus ocurrencias; un pago parcial DEBE (MUST) dejar la ocurrencia sin resolver con el pendiente de la cuota como monto esperado; anular el pago DEBE (MUST) devolver la ocurrencia a próxima o atrasada según su vencimiento y la fecha de hoy, con el monto pendiente de la cuota.
Trace: FR-DEBT-011, FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Pago parcial reduce lo esperado
- **CUANDO** el EDITOR paga 2000.00 BOB de la cuota 1 de 2372.02 BOB
- **ENTONCES** la ocurrencia de la cuota 1 sigue sin resolver y espera 372.02 BOB
- **Y** el comprometido de noviembre incluye 372.02 BOB por esa cuota

#### Scenario: Un pago resuelve dos ocurrencias
- **CUANDO** el EDITOR registra un pago de 4684.04 BOB que paga las cuotas 1 y 2
- **ENTONCES** las ocurrencias del 2026-11-15 y del 2026-12-15 quedan resueltas por la misma transacción

#### Scenario: Anular el pago devuelve la ocurrencia
- **CUANDO** hoy es 2026-11-20 y el EDITOR anula el pago de 2342.02 BOB de la cuota 1 del 2026-11-15
- **ENTONCES** la ocurrencia de la cuota 1 vuelve a atrasada esperando 2342.02 BOB y sin transacción

### Requirement: Préstamo saldado y préstamo cancelado
Cuando el principal pendiente llega a cero por pagos, el préstamo DEBE (MUST) quedar saldado, su compromiso terminado y DEBE (MUST) rechazar nuevos pagos con `LOAN_NOT_ACTIVE`; anular el pago que lo saldó DEBE (MUST) volverlo a activo; un préstamo en borrador DEBE (MUST) poder cancelarse sin efectos contables; un préstamo activo sin pagos vigentes DEBE (MUST) poder cancelarse anulando su desembolso y terminando su compromiso; con pagos vigentes DEBE (MUST) rechazarse con `LOAN_HAS_PAYMENTS`.
Trace: FR-DEBT-001, FR-DEBT-002, FR-DEBT-011 · Priority: Must

#### Scenario: Préstamo saldado con la última cuota
- **CUANDO** el préstamo de 1000.00 BOB al 1 % mensual a 3 cuotas tiene pagadas las cuotas de 340.02 BOB y 340.02 BOB y el EDITOR paga la cuota 3 de 340.03 BOB
- **ENTONCES** la cuenta del préstamo adeuda 0.00 BOB, el préstamo queda saldado y su compromiso terminado
- **Y** un nuevo pago de 10.00 BOB se rechaza con `LOAN_NOT_ACTIVE`

#### Scenario: Cancelar un préstamo con pagos
- **CUANDO** el EDITOR cancela el "Préstamo vehicular" con la cuota 1 pagada
- **ENTONCES** se rechaza con `LOAN_HAS_PAYMENTS` y el préstamo sigue activo

#### Scenario: Cancelar un desembolso registrado por error
- **CUANDO** el EDITOR cancela el "Préstamo vehicular" activo sin pagos con motivo "duplicado"
- **ENTONCES** la transacción de desembolso queda anulada con su reversa, la cuenta del préstamo adeuda 0.00 BOB, el préstamo queda cancelado y su compromiso terminado sin ocurrencias pendientes

### Requirement: Detalle y estado del préstamo
El detalle de un préstamo DEBE (MUST) mostrar sus condiciones, el principal pendiente según el cronograma (principal menos el principal pagado), el saldo adeudado según la cuenta del préstamo, la diferencia entre ambos (movimientos de la cuenta no registrados como pagos del préstamo), la próxima cuota, las cuotas atrasadas (vencidas sin pagar según la fecha de hoy en la zona del workspace) y el interés, las comisiones, el seguro y los impuestos pagados acumulados.
Trace: FR-DEBT-007, FR-DEBT-001 · Priority: Must

#### Scenario: Detalle tras la primera cuota
- **CUANDO** hoy es 2026-12-16 en America/La_Paz, la cuota 1 está pagada con 2342.02 BOB y la cuota 2 del 2026-12-15 está sin pagar
- **ENTONCES** el principal pendiente es 48137.15 BOB, igual al saldo adeudado de la cuenta, con diferencia 0.00 BOB
- **Y** la cuota 2 figura atrasada y el interés pagado acumulado es 479.17 BOB

#### Scenario: Transferencia manual a la cuenta del préstamo
- **CUANDO** además el usuario transfiere a mano 1000.00 BOB de "Banco BOB" a "Préstamo vehicular" fuera del préstamo
- **ENTONCES** el saldo adeudado de la cuenta es 47137.15 BOB, el principal pendiente sigue en 48137.15 BOB y el detalle informa una diferencia de 1000.00 BOB no registrada como pago

### Requirement: Gastos del préstamo en los reportes
El interés, las comisiones, el seguro y los impuestos de los pagos y la comisión retenida en el desembolso DEBEN (MUST) contarse como gasto del periodo en sus categorías de sistema; el principal pagado y el principal desembolsado NO DEBEN (MUST NOT) contarse como gasto ni como ingreso.
Trace: FR-DEBT-007, FR-DEBT-002, INV-009 · Priority: Must

#### Scenario: Gasto de noviembre con una cuota pagada
- **CUANDO** en noviembre de 2026 la única transacción es el pago de la cuota 1 de 2342.02 BOB (principal 1862.85 BOB e interés 479.17 BOB)
- **ENTONCES** el gasto de noviembre es 479.17 BOB en "Intereses pagados"
- **Y** los ingresos de noviembre no cambian y el patrimonio neto baja exactamente 479.17 BOB

### Requirement: Permisos, auditoría e idempotencia de los préstamos
Consultar préstamos, cronogramas, pagos y comparaciones DEBE (MUST) estar permitido a VIEWER, EDITOR y OWNER; registrar, desembolsar, pagar, anular, cancelar y cargar tablas de referencia DEBE (MUST) exigir EDITOR u OWNER (`INSUFFICIENT_ROLE`); cada cambio DEBE (MUST) auditarse con actor y diff en la misma unidad de trabajo; los comandos que crean préstamos, desembolsos o pagos DEBEN (MUST) ser idempotentes con `Idempotency-Key` y los cambios sobre un préstamo existente DEBEN (MUST) exigir su versión (`If-Match`).
Trace: FR-DEBT-001, FR-DEBT-007, FR-AUDIT-001, NFR-REL-007 · Priority: Must

#### Scenario: VIEWER no registra pagos
- **CUANDO** un VIEWER registra un pago de 2342.02 BOB del "Préstamo vehicular"
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y no se crea ninguna transacción

#### Scenario: Reintento del registro de un pago
- **CUANDO** el cliente envía dos veces el pago de 2342.02 BOB de la cuota 1 con la misma clave de idempotencia
- **ENTONCES** ambas respuestas devuelven el mismo pago y existe una sola transacción, y la deuda baja una sola vez a 48137.15 BOB

### Requirement: Hechos publicados de los préstamos
El sistema DEBE (MUST) publicar, en la misma unidad de trabajo que el cambio, un hecho de desembolso, un hecho por cronograma fijado (con todas sus cuotas y su versión), un hecho por pago registrado con las cuotas imputadas, el desglose y el principal pendiente, un hecho por pago anulado y un hecho al saldarse el préstamo; los montos DEBEN (MUST) viajar como texto decimal con su moneda y cada hecho DEBE (MUST) publicarse una sola vez por cambio.
Trace: FR-DEBT-002, FR-DEBT-003, FR-DEBT-007 · Priority: Must

#### Scenario: Pago publicado
- **CUANDO** el EDITOR paga la cuota 1 de 2342.02 BOB
- **ENTONCES** se publica un único hecho de pago con la cuota 1, el desglose (principal "1862.85", interés "479.17", comisiones "0.00", seguro "0.00", impuestos "0.00", total "2342.02") en BOB y el principal pendiente "48137.15"

### Requirement: Recorrido del préstamo
El sistema DEBE (MUST) registrar cada transición de estado de un préstamo (registro en borrador, desembolso o alta en curso, saldado, reactivado por anulación del último pago, cancelado) con actor, instante, motivo y la transacción asociada, y DEBE (MUST) permitir a todo miembro consultarlas en orden como recorrido del préstamo; los pagos y sus anulaciones DEBEN (MUST) aparecer como anotaciones del recorrido.
Trace: FR-DEBT-001, FR-AUDIT-009 · Priority: Should

#### Scenario: Recorrido de un préstamo saldado
- **CUANDO** el préstamo de 1000.00 BOB se registró el 2026-10-10, se desembolsó el 2026-10-15 y se saldó con la cuota 3 el 2027-01-15
- **ENTONCES** su recorrido muestra en orden: borrador (EDITOR, 2026-10-10), activo por desembolso (EDITOR, 2026-10-15) y saldado (EDITOR, 2027-01-15), con los tres pagos como anotaciones
