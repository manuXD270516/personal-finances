# Spec Delta

## ADDED Requirements

### Requirement: Sistema alemán de capital constante
El sistema DEBE (MUST) calcular el cronograma alemán con un principal por cuota igual al principal dividido por el número de cuotas redondeado HALF_EVEN, el interés de cada cuota sobre el saldo al inicio del periodo según la convención y la última cuota absorbiendo el residuo del principal, de modo que la cuota sea decreciente y la suma del principal sea exactamente el principal.
Trace: FR-DEBT-004, FR-DEBT-006, INV-017 · Priority: Should

#### Scenario: Alemán a 12 cuotas
- **CUANDO** se calcula el cronograma alemán de 12000.00 BOB al 12.00 % anual, 30/360, mensual, 12 cuotas desde el 2026-11-15
- **ENTONCES** cada cuota tiene 1000.00 BOB de principal y las cuotas son 1120.00, 1110.00, … hasta 1010.00 BOB
- **Y** el interés total es 780.00 BOB y la suma del principal es 12000.00 BOB

#### Scenario: Principal no divisible
- **CUANDO** se calcula el cronograma alemán de 10000.00 BOB al 0.00 % en 3 cuotas
- **ENTONCES** el principal de las cuotas es 3333.33, 3333.33 y 3333.34 BOB

### Requirement: Sistema de capital fijo con cuota final balloon
El sistema DEBE (MUST) calcular un cronograma de capital fijo con el principal por cuota definido por el usuario para las cuotas anteriores a la última, la última cuota con el saldo restante como cuota final balloon y el interés de cada cuota sobre el saldo al inicio del periodo; un principal por cuota cuya suma alcance o supere el principal antes de la última cuota DEBE (MUST) rechazarse con `VALIDATION_FAILED`.
Trace: FR-DEBT-004, FR-DEBT-006, INV-017 · Priority: Should

#### Scenario: Capital fijo con balloon
- **CUANDO** se calcula el cronograma de capital fijo de 10000.00 BOB al 12.00 % anual, 30/360, mensual, 12 cuotas con 500.00 BOB de principal por cuota
- **ENTONCES** la cuota 1 es 600.00 BOB (interés 100.00), la cuota 11 es 550.00 BOB (interés 50.00) y la cuota 12 es 4545.00 BOB (principal 4500.00, interés 45.00)
- **Y** el interés total es 870.00 BOB y la suma del principal es 10000.00 BOB

#### Scenario: Capital fijo excesivo
- **CUANDO** se registra un préstamo de capital fijo de 10000.00 BOB en 12 cuotas con 1000.00 BOB de principal por cuota
- **ENTONCES** se rechaza con `VALIDATION_FAILED` porque las primeras 11 cuotas suman 11000.00 BOB

### Requirement: Cronograma custom cargado manualmente
El usuario DEBE (MUST) poder definir el cronograma de un préstamo cuota por cuota (vencimiento, principal, interés, comisiones, seguro e impuestos); el sistema DEBE (MUST) rechazar con `CUSTOM_SCHEDULE_INVALID`, indicando la cuota, un cronograma cuya suma de principal no sea exactamente el principal (o el saldo pendiente de un préstamo en curso), con vencimientos no estrictamente crecientes o anteriores al desembolso, con componentes negativos o con escala mayor a la de la moneda.
Trace: FR-DEBT-005, INV-017 · Priority: Should

#### Scenario: Cronograma de tres cuotas cargado a mano
- **CUANDO** el EDITOR define para un préstamo de 1000.00 BOB las cuotas 400.00 + 10.00, 300.00 + 6.00 y 300.00 + 3.00 BOB (principal + interés) con vencimientos 2026-11-15, 2026-12-15 y 2027-01-15
- **ENTONCES** el cronograma custom queda con cuotas de 410.00, 306.00 y 303.00 BOB

#### Scenario: Principal que no suma
- **CUANDO** el EDITOR define cuotas cuyo principal suma 999.99 BOB para un préstamo de 1000.00 BOB
- **ENTONCES** se rechaza con `CUSTOM_SCHEDULE_INVALID` informando 999.99 BOB frente a 1000.00 BOB

### Requirement: Cronograma custom importado desde la tabla del banco
El usuario DEBE (MUST) poder adoptar una tabla del banco cargada como referencia como cronograma custom del préstamo, con las mismas validaciones del cronograma custom; adoptarla en un préstamo activo DEBE (MUST) crear una nueva versión del cronograma desde la primera cuota no pagada, sin cambiar las cuotas pagadas.
Trace: FR-DEBT-005 · Priority: Should

#### Scenario: Adoptar la tabla del banco
- **CUANDO** el "Préstamo vehicular" activo tiene la cuota 1 pagada y el EDITOR adopta la referencia versión 1 del banco como cronograma custom
- **ENTONCES** el préstamo pasa a cronograma custom versión 2 con las cuotas 2 a 24 de la referencia
- **Y** la cuota 1 pagada de la versión 1 y su pago no cambian

### Requirement: El cronograma custom prevalece sobre el cálculo
En un préstamo con cronograma custom, los pagos, las diferencias, los compromisos y el principal pendiente DEBEN (MUST) usar las cuotas custom y el sistema NO DEBE (MUST NOT) recalcularlas; un pago extraordinario o un cambio de tasa sobre un préstamo custom DEBE (MUST) rechazarse con `LOAN_SCHEDULE_IS_CUSTOM` hasta que el usuario cargue la versión nueva del cronograma.
Trace: FR-DEBT-005 · Priority: Should

#### Scenario: Pago contra la cuota custom
- **CUANDO** el préstamo de 1000.00 BOB con cronograma custom recibe el pago de 410.00 BOB de la cuota 1
- **ENTONCES** se imputan 400.00 BOB a principal y 10.00 BOB a interés según la cuota custom

#### Scenario: Cambio de tasa sobre un custom
- **CUANDO** el EDITOR registra un cambio de tasa en el préstamo con cronograma custom
- **ENTONCES** se rechaza con `LOAN_SCHEDULE_IS_CUSTOM` y el cronograma no cambia

### Requirement: Pago extraordinario reduciendo el plazo
Un pago extraordinario con la opción reducir plazo DEBE (MUST) reducir el principal pendiente por el monto del pago y recalcular las cuotas siguientes con la misma cuota y el mismo sistema hasta saldar, con la última cuota absorbiendo el residuo, como una nueva versión del cronograma.
Trace: FR-DEBT-008, INV-017 · Priority: Should

#### Scenario: Prepago de 3000.00 reduciendo el plazo
- **CUANDO** el préstamo francés de 12000.00 BOB al 12.00 % a 12 cuotas de 1066.19 BOB tiene pagadas las cuotas 1 a 3 (principal pendiente 9132.95 BOB) y el 2027-01-15 se registra un pago extraordinario de 3000.00 BOB reduciendo el plazo
- **ENTONCES** la versión 2 tiene las cuotas 4 a 9 de 1066.19 BOB con la cuota 9 del 2027-07-15 de 1017.22 BOB y la suma de su principal es 6132.95 BOB
- **Y** el interés restante baja de 462.71 BOB a 215.22 BOB (ahorro 247.49 BOB)

### Requirement: Pago extraordinario reduciendo la cuota
Un pago extraordinario con la opción reducir cuota DEBE (MUST) reducir el principal pendiente por el monto del pago y recalcular las cuotas restantes conservando su número y sus fechas, con la cuota del sistema recalculada sobre el nuevo saldo, como una nueva versión del cronograma.
Trace: FR-DEBT-008, INV-017 · Priority: Should

#### Scenario: Prepago de 3000.00 reduciendo la cuota
- **CUANDO** el mismo préstamo con principal pendiente 9132.95 BOB recibe el 2027-01-15 un pago extraordinario de 3000.00 BOB reduciendo la cuota
- **ENTONCES** la versión 2 tiene las cuotas 4 a 12 de 715.96 BOB con la cuota 12 de 715.99 BOB y la suma de su principal es 6132.95 BOB
- **Y** el interés restante baja de 462.71 BOB a 310.72 BOB (ahorro 151.99 BOB)

### Requirement: Nueva versión del cronograma sin reescribir cuotas pagadas
Todo recálculo (pago extraordinario, cambio de tasa, cronograma custom) DEBE (MUST) crear una versión nueva del cronograma con su motivo, fecha de vigencia y parámetros, que reemplaza solo las cuotas no pagadas desde la vigencia; las cuotas de la versión anterior DEBEN (MUST) conservarse como reemplazadas, consultables y sin cambios, y los pagos ya imputados NO DEBEN (MUST NOT) moverse; una cuota parcialmente pagada DEBE (MUST) completarse antes de recalcular (`LOAN_INSTALLMENTS_PENDING`).
Trace: FR-DEBT-008, FR-DEBT-009 · Priority: Should

#### Scenario: Historial de versiones
- **CUANDO** el préstamo de 12000.00 BOB recibió el prepago reduciendo el plazo del 2027-01-15
- **ENTONCES** el historial muestra la versión 1 (inicial, 12 cuotas, reemplazada desde la cuota 4) y la versión 2 (pago extraordinario, vigente desde 2027-01-15)
- **Y** las cuotas 1 a 3 de la versión 1 siguen pagadas con sus pagos originales

#### Scenario: Cuota parcial pendiente
- **CUANDO** la cuota 4 está parcialmente pagada y el EDITOR registra un pago extraordinario
- **ENTONCES** se rechaza con `LOAN_INSTALLMENTS_PENDING` y no se crea ninguna versión ni transacción

### Requirement: Vista previa del recálculo
Antes de confirmar un pago extraordinario o un cambio de tasa, el sistema DEBE (MUST) mostrar sin persistir el cronograma resultante de cada opción con su cuota, su fecha de fin y el interés restante, y el ahorro frente al cronograma vigente.
Trace: FR-DEBT-008, FR-DEBT-009 · Priority: Should

#### Scenario: Comparar las dos opciones del prepago
- **CUANDO** el EDITOR pide la vista previa de un pago extraordinario de 3000.00 BOB el 2027-01-15 en el préstamo de 12000.00 BOB con 3 cuotas pagadas
- **ENTONCES** ve reducir plazo: cuota 1066.19 BOB, fin 2027-07-15, ahorro 247.49 BOB; y reducir cuota: cuota 715.96 BOB, fin 2027-10-15, ahorro 151.99 BOB
- **Y** el cronograma vigente no cambia

### Requirement: Cambio de tasa variable con vigencia
En un préstamo de tasa variable el usuario DEBE (MUST) poder registrar una tasa nueva con fecha de vigencia; las cuotas cuyo periodo empieza en o después de la vigencia DEBEN (MUST) recalcularse con la tasa nueva conservando su número y sus fechas, como una nueva versión; un préstamo de tasa fija DEBE (MUST) rechazarlo con `LOAN_RATE_FIXED` y una vigencia anterior al inicio del periodo de la primera cuota no pagada con `LOAN_CHANGE_DATE_INVALID`; el historial de tasas con vigencia DEBE (MUST) conservarse.
Trace: FR-DEBT-009, INV-017 · Priority: Should

#### Scenario: Sube la tasa al 15 %
- **CUANDO** el préstamo francés variable de 12000.00 BOB al 12.00 % tiene pagadas las cuotas 1 a 6 (principal pendiente 6179.02 BOB) y el EDITOR registra 15.00 % vigente desde el 2027-04-15
- **ENTONCES** la versión 2 tiene las cuotas 7 a 12 de 1075.36 BOB con interés de la cuota 7 de 77.24 BOB y la suma de su principal es 6179.02 BOB
- **Y** el historial de tasas muestra 12.00 % desde el desembolso y 15.00 % desde el 2027-04-15

#### Scenario: Tasa fija
- **CUANDO** el EDITOR registra un cambio de tasa en el "Préstamo vehicular" de tasa fija
- **ENTONCES** se rechaza con `LOAN_RATE_FIXED` y el cronograma no cambia

#### Scenario: Vigencia en un periodo ya pagado
- **CUANDO** el EDITOR registra 15.00 % vigente desde el 2027-02-01 con las cuotas 1 a 6 pagadas
- **ENTONCES** se rechaza con `LOAN_CHANGE_DATE_INVALID` y el cronograma no cambia

### Requirement: Simulador de pagos extra en un préstamo
El simulador DEBE (MUST) proyectar, sin persistir nada, un préstamo con pagos extra únicos o recurrentes aplicados al principal después de la cuota programada del mismo mes con la opción reducir plazo, y mostrar frente al cronograma vigente el interés total, la fecha de fin y el ahorro de interés.
Trace: FR-DEBT-010 · Priority: Should

#### Scenario: Extra único
- **CUANDO** el VIEWER simula el préstamo de 12000.00 BOB al 12.00 % a 12 cuotas desde el 2026-11-15 con un extra único de 3000.00 BOB junto a la cuota 3
- **ENTONCES** el interés total es 546.74 BOB frente a 794.23 BOB, la fecha de fin es 2027-07-15 frente a 2027-10-15 y el ahorro es 247.49 BOB

#### Scenario: Extra recurrente
- **CUANDO** el VIEWER simula el mismo préstamo con 200.00 BOB extra cada mes desde la cuota 1
- **ENTONCES** el interés total es 670.30 BOB, la fecha de fin es 2027-09-15 y el ahorro es 123.93 BOB

### Requirement: Estrategias avalanche y snowball entre préstamos
El simulador DEBE (MUST) comparar, sin persistir nada, estrategias para un monto extra mensual entre los préstamos activos de una misma moneda: avalanche (el extra va al préstamo de mayor tasa), snowball (al de menor principal pendiente) y sin extra, aplicando el extra al principal después de las cuotas del mes y sumando al extra las cuotas de los préstamos ya saldados; DEBE (MUST) mostrar por estrategia el interés total, la fecha de fin de cada préstamo, la fecha libre de deudas y el ahorro frente a no pagar extra; los préstamos de otra moneda DEBEN (MUST) quedar fuera de la estrategia.
Trace: FR-DEBT-010 · Priority: Should

#### Scenario: Avalanche frente a snowball
- **CUANDO** hay dos préstamos franceses en BOB con primera cuota el 2026-11-15, "A" de 3000.00 BOB al 12.00 % a 12 cuotas de 266.55 BOB y "B" de 12000.00 BOB al 24.00 % a 24 cuotas de 634.45 BOB, y el VIEWER simula 500.00 BOB extra por mes
- **ENTONCES** sin extra el interés total es 3425.46 BOB y la fecha libre de deudas 2028-10-15
- **Y** avalanche da 1815.57 BOB de interés (ahorro 1609.89 BOB) y snowball 2000.08 BOB (ahorro 1425.38 BOB), ambos libres de deudas el 2027-11-15, con snowball saldando "A" el 2027-03-15

#### Scenario: Préstamo en otra moneda
- **CUANDO** además existe un préstamo de 5000.00 USD y el VIEWER simula 500.00 BOB extra por mes
- **ENTONCES** el préstamo en USD figura fuera de la estrategia y conserva su cronograma vigente

### Requirement: Simulación sin efectos
Las simulaciones NO DEBEN (MUST NOT) crear transacciones, versiones de cronograma, compromisos ni registros de auditoría y DEBEN (MUST) estar disponibles para VIEWER, EDITOR y OWNER.
Trace: FR-DEBT-010 · Priority: Should

#### Scenario: Simular no cambia nada
- **CUANDO** el VIEWER simula avalanche con 500.00 BOB extra por mes
- **ENTONCES** los cronogramas, las transacciones y el comprometido del periodo no cambian
