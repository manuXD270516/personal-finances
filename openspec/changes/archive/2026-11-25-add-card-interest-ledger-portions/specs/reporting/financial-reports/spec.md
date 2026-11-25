## MODIFIED Requirements

### Requirement: Reporte de comisiones
El sistema DEBE (MUST) informar el gasto en comisiones del rango por tipo (comisión de conversión, comisión de transferencia, interés y cargos de préstamos, intereses y cargos de tarjetas y gastos en las categorías de comisiones) y por mes, por moneda nativa y consolidado, más el total de los últimos 12 meses completos; cada porción DEBE (MUST) contarse en un solo tipo, y una porción identificada como cargo de una tarjeta DEBE (MUST) contarse como interés y cargos de tarjetas aunque su categoría sea de comisiones. Los gastos de una tarjeta que no son cargos registrados o adoptados NO DEBEN (MUST NOT) contarse como intereses y cargos de tarjetas, aunque estén en "Intereses pagados".
Trace: FR-REPORTING-008, FR-DEBT-013 · Priority: Should

#### Scenario: Comisiones de octubre
- **CUANDO** en 2026-10 hubo una comisión de conversión de 2.00 BOB, una comisión de transferencia de 5.00 BOB, una cuota con 320.00 BOB de interés y 80.00 BOB de cargos y un gasto de 15.00 BOB en "Comisiones bancarias"
- **ENTONCES** el reporte de 2026-10 informa conversión 2.00 BOB, transferencia 5.00 BOB, préstamos 400.00 BOB, categorías de comisiones 15.00 BOB y un total de 422.00 BOB

#### Scenario: Intereses y cargos de tarjeta en octubre
- **CUANDO** además en 2026-10 se registró en "Visa Oro BOB" el cargo del 2026-10-25 de 4.00 BOB de interés y 0.80 BOB de seguro
- **ENTONCES** el reporte de 2026-10 informa tarjetas 4.80 BOB y un total de 426.80 BOB, sin cambiar los demás tipos

#### Scenario: Cargo de tarjeta en la categoría de comisiones
- **CUANDO** en 2026-10 el único gasto en comisiones es un cargo de "Visa Oro BOB" de 12.00 BOB de comisiones, con su porción en "Comisiones"
- **ENTONCES** el reporte de 2026-10 informa tarjetas 12.00 BOB, categorías de comisiones 0.00 BOB y un total de 12.00 BOB

#### Scenario: Interés cargado a mano sin adoptar
- **CUANDO** en 2026-10 el único gasto de "Visa Oro BOB" en "Intereses pagados" es un gasto manual de 4.80 BOB que no se adoptó como cargo
- **ENTONCES** el reporte de 2026-10 informa tarjetas 0.00 BOB y un total de 0.00 BOB

#### Scenario: Cargo anulado
- **CUANDO** el cargo de 4.80 BOB del 2026-10-25 de "Visa Oro BOB" se anula
- **ENTONCES** el reporte de 2026-10 informa tarjetas 0.00 BOB

### Requirement: Reporte de evolución de deudas
El sistema DEBE (MUST) informar por deuda (préstamo o tarjeta) y por mes el saldo pendiente al cierre del mes según el ledger; para los préstamos, el principal y el interés pagados en el mes según el desglose de sus pagos; y para las tarjetas, el interés y los demás cargos (comisiones, seguro e impuestos) cargados en el mes según sus cargos vigentes. Todo DEBE (MUST) informarse por moneda nativa y consolidado en la moneda de reporte con la tasa de cada cierre para saldos y de la fecha de cada pago o cargo para lo pagado y lo cargado; lo pagado NO DEBE (MUST NOT) informarse para las tarjetas ni lo cargado para los préstamos.
Trace: FR-REPORTING-008, FR-DEBT-013 · Priority: Should

#### Scenario: Crédito auto en dos meses
- **CUANDO** "Crédito auto" tenía 20000.00 BOB pendientes al 2026-08-31 y se pagaron en septiembre 1100.00 BOB de principal y 320.00 BOB de interés y en octubre 1110.00 BOB de principal y 310.00 BOB de interés
- **ENTONCES** el reporte informa pendiente 18900.00 BOB al cierre de septiembre y 17790.00 BOB al cierre de octubre, con interés pagado de 320.00 BOB y 310.00 BOB

#### Scenario: Tarjeta con intereses cargados
- **CUANDO** "Visa Oro BOB" tiene el cargo vigente del 2026-10-25 de 4.00 BOB de interés y 0.80 BOB de seguro y ningún otro cargo en 2026-09 ni 2026-10
- **ENTONCES** el reporte informa para "Visa Oro BOB" interés cargado 0.00 BOB y otros cargos 0.00 BOB en septiembre, e interés cargado 4.00 BOB y otros cargos 0.80 BOB en octubre
- **Y** lo pagado de "Visa Oro BOB" no se informa en ningún mes

### Requirement: Reconciliación de los reportes ampliados con el ledger
Los reportes ampliados DEBEN (MUST) cuadrar con el ledger: la suma por cuenta y la suma por tipo de comisión no superan el gasto y la primera es igual a él; el saldo pendiente de cada deuda al cierre de cada mes es el saldo contable de su cuenta; el interés y los cargos de las tarjetas del reporte de deudas suman, por mes y moneda, lo mismo que el tipo de intereses y cargos de tarjetas del reporte de comisiones; el acumulado de cada meta es la suma de sus movimientos; y todo drill-down suma su cifra. La verificación DEBE (MUST) sumarse a la del núcleo sobre ledgers aleatorios, el dataset Demo y el nightly con el dataset grande.
Trace: FR-REPORTING-008, FR-REPORTING-010, NFR-DATA-008 · Priority: Should

#### Scenario: Gasto por cuenta igual al total
- **CUANDO** el gasto en BOB de 2026-10 según el ledger es 3800.00 BOB
- **ENTONCES** la suma de las cuentas del reporte de gastos por cuenta en BOB es 3800.00 BOB

#### Scenario: Cargos de tarjeta iguales en los dos reportes
- **CUANDO** en 2026-10 "Visa Oro BOB" tiene cargos vigentes por 4.80 BOB y "Visa Oro USD" por 1.25 USD
- **ENTONCES** el reporte de deudas suma 4.80 BOB y 1.25 USD de interés y cargos de tarjetas en 2026-10 y el tipo tarjetas del reporte de comisiones informa 4.80 BOB y 1.25 USD en 2026-10
