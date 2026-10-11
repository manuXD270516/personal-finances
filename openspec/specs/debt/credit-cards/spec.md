# debt/credit-cards Specification

## Purpose
TBD - created by archiving change add-credit-cards. Update Purpose after archive.

## Requirements

### Requirement: Registro de una tarjeta de crédito
El sistema DEBE (MUST) permitir registrar una tarjeta de crédito con nombre, al menos una cuenta de tipo `credit_card` activa del workspace (a lo sumo una por moneda), límite de crédito, día de cierre (1 a 31), día de vencimiento (1 a 31), ajuste de fin de semana del vencimiento (`NONE`, `PREVIOUS` o `NEXT`, por defecto `NONE`), tasa nominal anual opcional (informativa, de 0.00 % a 999.99 %) y una regla de pago mínimo por cuenta. DEBE (MUST) rechazar, sin crear nada, una cuenta que no sea `credit_card` o no esté activa o dos cuentas de la misma moneda (`CREDIT_CARD_ACCOUNT_INVALID`), una cuenta ya vinculada a otra tarjeta (`CREDIT_CARD_ACCOUNT_IN_USE`), un límite no positivo (`AMOUNT_NOT_POSITIVE`) o con más decimales que su moneda (`AMOUNT_SCALE_EXCEEDED`) y días fuera de rango (`VALIDATION_FAILED`). Registrar una tarjeta NO DEBE (MUST NOT) crear asientos ni cambiar saldos.
Trace: FR-DEBT-012, INV-030 · Priority: Must

#### Scenario: Tarjeta en bolivianos
- **CUANDO** el EDITOR registra "Visa Oro" con la cuenta "Visa Oro BOB" (`credit_card`, BOB, adeuda 1200.00 BOB), límite 10000.00 BOB, cierre el día 25, vencimiento el día 15 y pago mínimo del 5.00 % con piso de 50.00 BOB
- **ENTONCES** la tarjeta queda activa con esos términos
- **Y** "Visa Oro BOB" sigue adeudando 1200.00 BOB y no se registró ningún asiento

#### Scenario: Cuenta bancaria como tarjeta
- **CUANDO** el EDITOR registra una tarjeta con la cuenta "Banco BOB" (`bank`, BOB)
- **ENTONCES** se rechaza con `CREDIT_CARD_ACCOUNT_INVALID` y no se crea la tarjeta

#### Scenario: Cuenta ya vinculada
- **CUANDO** el EDITOR registra "Visa Oro 2" con la cuenta "Visa Oro BOB", que ya pertenece a "Visa Oro"
- **ENTONCES** se rechaza con `CREDIT_CARD_ACCOUNT_IN_USE`

#### Scenario: Día de cierre inválido
- **CUANDO** el EDITOR registra una tarjeta con cierre el día 32
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y no se crea la tarjeta

### Requirement: Tarjeta bimoneda con una cuenta por moneda
Una tarjeta DEBE (MUST) poder agrupar una cuenta `credit_card` por moneda (por ejemplo BOB y USD) que comparten nombre, día de cierre, día de vencimiento y ajuste de fin de semana; cada cuenta DEBE (MUST) conservar su saldo, su regla de pago mínimo y su estado de cuenta por ciclo en su propia moneda, y NO DEBE (MUST NOT) sumarse nunca un monto de una moneda con otro de otra moneda en los cálculos del ciclo.
Trace: FR-DEBT-016 · Priority: Must

#### Scenario: Visa Oro en BOB y USD
- **CUANDO** el EDITOR registra "Visa Oro" con "Visa Oro BOB" (mínimo 5.00 % con piso 50.00 BOB) y "Visa Oro USD" (mínimo 5.00 % con piso 10.00 USD), cierre el día 25 y vencimiento el día 15
- **ENTONCES** la tarjeta tiene dos cuentas que cierran el 2026-10-25 y vencen el 2026-11-15
- **Y** el ciclo informa un estado de cuenta en BOB y otro en USD por separado

#### Scenario: Dos cuentas en la misma moneda
- **CUANDO** el EDITOR registra una tarjeta con "Visa Oro BOB" y "Visa Plata BOB", ambas en BOB
- **ENTONCES** se rechaza con `CREDIT_CARD_ACCOUNT_INVALID`

### Requirement: Límite compartido o separado
Una tarjeta DEBE (MUST) declarar su límite como separado (un límite positivo por cuenta, en la moneda de esa cuenta) o compartido (un único límite positivo en la moneda de una de sus cuentas); una tarjeta de una sola cuenta DEBE (MUST) tener límite separado. Un límite compartido en una moneda que no es la de ninguna de sus cuentas DEBE (MUST) rechazarse con `VALIDATION_FAILED`.
Trace: FR-DEBT-016, FR-DEBT-012 · Priority: Must

#### Scenario: Límite compartido en BOB
- **CUANDO** el EDITOR registra "Visa Oro" con "Visa Oro BOB" y "Visa Oro USD" y un límite compartido de 15000.00 BOB
- **ENTONCES** la tarjeta tiene un único límite de 15000.00 BOB para ambas cuentas

#### Scenario: Límite compartido en una moneda ajena
- **CUANDO** el EDITOR registra "Visa Oro" con "Visa Oro BOB" y "Visa Oro USD" y un límite compartido de 2000.00 USDT
- **ENTONCES** se rechaza con `VALIDATION_FAILED`

### Requirement: Regla de pago mínimo
Cada cuenta de una tarjeta DEBE (MUST) tener una regla de pago mínimo: porcentaje (0.01 % a 100.00 %) con un piso opcional en la moneda de la cuenta, o monto fijo. El pago mínimo de un estado de cuenta DEBE (MUST) ser 0 si el saldo facturado es menor o igual a 0; con porcentaje, el menor entre el saldo facturado y el mayor entre (saldo facturado × porcentaje, redondeado HALF_EVEN a la escala de la moneda) y el piso; con monto fijo, el menor entre el saldo facturado y ese monto.
Trace: FR-DEBT-012, FR-DEBT-013, INV-020 · Priority: Must

#### Scenario: Porcentaje con redondeo HALF_EVEN
- **CUANDO** el saldo facturado de "Visa Oro BOB" es 1120.50 BOB con mínimo del 5.00 % y piso de 50.00 BOB
- **ENTONCES** el pago mínimo es 56.02 BOB (1120.50 × 5.00 % = 56.025, redondeado HALF_EVEN)

#### Scenario: Piso mayor que el porcentaje
- **CUANDO** el saldo facturado es 333.33 BOB con mínimo del 5.00 % y piso de 50.00 BOB
- **ENTONCES** el pago mínimo es 50.00 BOB

#### Scenario: Saldo facturado menor que el piso
- **CUANDO** el saldo facturado es 40.00 BOB con mínimo del 5.00 % y piso de 50.00 BOB
- **ENTONCES** el pago mínimo es 40.00 BOB

#### Scenario: Monto fijo
- **CUANDO** el saldo facturado es 1120.50 BOB y la regla es un monto fijo de 300.00 BOB
- **ENTONCES** el pago mínimo es 300.00 BOB

### Requirement: Fechas de cierre y vencimiento del ciclo
La fecha de cierre de cada mes DEBE (MUST) ser el día de cierre de la tarjeta o, si ese día no existe en el mes, el último día del mes, sin omitir ningún mes; cada ciclo DEBE (MUST) abarcar desde el día siguiente al cierre anterior hasta su fecha de cierre, ambos incluidos. La fecha de vencimiento de un ciclo DEBE (MUST) ser la primera fecha posterior a su cierre cuyo día es el día de vencimiento (o el último día del mes si ese día no existe en él), desplazada luego por el ajuste de fin de semana de la tarjeta.
Trace: FR-DEBT-013 · Priority: Must

#### Scenario: Cierre 25 y vencimiento 15
- **CUANDO** "Visa Oro" cierra el día 25 y vence el día 15 sin ajuste de fin de semana
- **ENTONCES** el ciclo de octubre de 2026 va del 2026-09-26 al 2026-10-25 y vence el 2026-11-15

#### Scenario: Cierre el día 31 en meses cortos
- **CUANDO** una tarjeta cierra el día 31 y vence el día 20
- **ENTONCES** los cierres de 2027 de enero a marzo son 2027-01-31, 2027-02-28 y 2027-03-31
- **Y** el ciclo de marzo va del 2027-03-01 al 2027-03-31 y vence el 2027-04-20

#### Scenario: Cierre el día 30 en año bisiesto
- **CUANDO** una tarjeta cierra el día 30
- **ENTONCES** el cierre de febrero de 2028 es el 2028-02-29 y el ciclo de marzo va del 2028-03-01 al 2028-03-30

#### Scenario: Vencimiento el día 31
- **CUANDO** una tarjeta cierra el día 10 y vence el día 31
- **ENTONCES** el ciclo que cierra el 2026-10-10 vence el 2026-10-31 y el que cierra el 2026-11-10 vence el 2026-11-30

#### Scenario: Vencimiento en domingo con ajuste al lunes
- **CUANDO** "Visa Oro" cierra el día 25, vence el día 15 y su ajuste de fin de semana es `NEXT`
- **ENTONCES** el ciclo que cierra el 2026-10-25 vence el lunes 2026-11-16, porque el 2026-11-15 es domingo

### Requirement: Ciclo según la zona horaria del workspace
Un movimiento DEBE (MUST) pertenecer al ciclo que contiene su fecha de negocio; "hoy" para decidir si un ciclo ya cerró, si un vencimiento ya pasó y qué ciclo está abierto DEBE (MUST) calcularse en la zona horaria del workspace, con independencia de la zona del proceso.
Trace: FR-DEBT-013 · Priority: Must

#### Scenario: Cierre a medianoche de La Paz
- **CUANDO** el workspace usa America/La_Paz, el proceso corre en UTC y son las 2026-10-26T03:30Z (23:30 del 2026-10-25 en La Paz)
- **ENTONCES** el ciclo de "Visa Oro BOB" que cierra el 2026-10-25 sigue abierto y una compra con fecha 2026-10-25 registrada en ese momento le pertenece
- **Y** a las 2026-10-26T04:05Z (00:05 del 2026-10-26 en La Paz) ese ciclo está cerrado y su estado de cuenta emitido

### Requirement: Resumen del ciclo y saldo al cierre
Para cada cuenta de la tarjeta y cada ciclo, el sistema DEBE (MUST) calcular a partir de las transacciones posteadas: saldo anterior (saldo al cierre previo), compras (gastos cargados a la cuenta, incluidos intereses y comisiones), reembolsos, pagos (transferencias y conversiones recibidas por la cuenta), otros movimientos (ajustes y saldos iniciales) y saldo al cierre, que DEBE (MUST) ser igual al saldo adeudado de la cuenta a la fecha de cierre y cumplir saldo anterior + compras − reembolsos − pagos ± otros = saldo al cierre. Las transacciones pendientes NO DEBEN (MUST NOT) contarse en el ciclo.
Trace: FR-DEBT-013, FR-LEDGER-012 · Priority: Must

#### Scenario: Ciclo de octubre de Visa Oro BOB
- **CUANDO** "Visa Oro BOB" tenía un saldo de 1200.00 BOB al cierre del 2026-09-25, se pagaron 1200.00 BOB el 2026-10-10, se compraron 350.00 BOB el 2026-10-03 y 820.50 BOB el 2026-10-18, hubo un reembolso de 50.00 BOB el 2026-10-20 y una compra de 400.00 BOB el 2026-10-26
- **ENTONCES** el ciclo del 2026-09-26 al 2026-10-25 informa saldo anterior 1200.00 BOB, compras 1170.50 BOB, reembolsos 50.00 BOB, pagos 1200.00 BOB y saldo al cierre 1120.50 BOB
- **Y** la compra de 400.00 BOB del 2026-10-26 pertenece al ciclo siguiente

#### Scenario: Compra pendiente fuera del ciclo
- **CUANDO** además existe una compra pendiente de 75.00 BOB del 2026-10-22 en "Visa Oro BOB"
- **ENTONCES** el saldo al cierre del 2026-10-25 sigue siendo 1120.50 BOB y las compras del ciclo siguen siendo 1170.50 BOB

### Requirement: Pago para no generar intereses y saldo pendiente
Para cada estado de cuenta emitido, el sistema DEBE (MUST) informar la fecha de vencimiento, el pago para no generar intereses (el saldo facturado si es positivo, si no 0) y el pago mínimo, y DEBE (MUST) informar cuánto falta de cada uno restando los pagos recibidos por la cuenta con fecha posterior al cierre y hasta hoy, sin bajar de 0. Un saldo facturado negativo DEBE (MUST) informarse como saldo a favor, con pago mínimo y pago para no generar intereses en 0.
Trace: FR-DEBT-013 · Priority: Must

#### Scenario: Estado de cuenta de octubre
- **CUANDO** el estado de cuenta de "Visa Oro BOB" cerrado el 2026-10-25 tiene saldo facturado 1120.50 BOB y mínimo del 5.00 % con piso 50.00 BOB
- **ENTONCES** informa vencimiento 2026-11-15, pago para no generar intereses 1120.50 BOB y pago mínimo 56.02 BOB

#### Scenario: Pago parcial después del cierre
- **CUANDO** además se pagan 500.00 BOB desde "Banco BOB" el 2026-11-01
- **ENTONCES** faltan 620.50 BOB para no generar intereses y 0.00 BOB del pago mínimo

#### Scenario: Saldo a favor
- **CUANDO** el saldo al cierre del 2026-10-25 de "Visa Oro USD" es un crédito de 30.00 USD
- **ENTONCES** el estado de cuenta informa un saldo a favor de 30.00 USD, pago mínimo 0.00 USD y pago para no generar intereses 0.00 USD

### Requirement: Estado del estado de cuenta
Cada estado de cuenta emitido DEBE (MUST) estar `ISSUED` hasta su vencimiento; `PAID` en cuanto no falte nada para no generar intereses; y, si al terminar el día de vencimiento en la zona del workspace falta algo, `PARTIALLY_PAID` si se cubrió el pago mínimo u `OVERDUE` si no. El ciclo en curso DEBE (MUST) informarse como `OPEN`.
Trace: FR-DEBT-013 · Priority: Should

#### Scenario: Pagado completo antes del vencimiento
- **CUANDO** se pagan 1120.50 BOB a "Visa Oro BOB" el 2026-11-10
- **ENTONCES** el estado de cuenta cerrado el 2026-10-25 queda `PAID`

#### Scenario: Pago parcial al vencer
- **CUANDO** solo se pagaron 500.00 BOB el 2026-11-01 y es el 2026-11-16 en La Paz
- **ENTONCES** el estado de cuenta queda `PARTIALLY_PAID` con 620.50 BOB pendientes

#### Scenario: Mínimo no cubierto
- **CUANDO** solo se pagaron 30.00 BOB el 2026-11-01 y es el 2026-11-16 en La Paz
- **ENTONCES** el estado de cuenta queda `OVERDUE` con 26.02 BOB pendientes del pago mínimo

### Requirement: Emisión única y recálculo del estado de cuenta
Al cerrar un ciclo, el sistema DEBE (MUST) emitir una sola vez el estado de cuenta de cada cuenta de la tarjeta, conservar las cifras con que se emitió y publicar el hecho de emisión una sola vez aunque el proceso se repita. Si después se registra, corrige o anula una transacción con fecha dentro de un ciclo ya cerrado, el sistema DEBE (MUST) mostrar las cifras recalculadas junto con la diferencia respecto de las emitidas, sin volver a publicar la emisión.
Trace: FR-DEBT-013, FR-NOTIFY-005 · Priority: Should

#### Scenario: Emisión repetida
- **CUANDO** el proceso de emisión corre dos veces el 2026-10-26 para "Visa Oro BOB"
- **ENTONCES** existe un único estado de cuenta cerrado el 2026-10-25 con saldo facturado 1120.50 BOB y un único hecho de emisión

#### Scenario: Compra retroactiva en un ciclo cerrado
- **CUANDO** el 2026-10-28 se registra una compra de 45.00 BOB con fecha 2026-10-24 en "Visa Oro BOB"
- **ENTONCES** el estado de cuenta cerrado el 2026-10-25 muestra saldo facturado recalculado 1165.50 BOB, pago mínimo 58.28 BOB y una diferencia de 45.00 BOB respecto de lo emitido
- **Y** no se publica un segundo hecho de emisión

### Requirement: Montos informados por el banco
El EDITOR DEBE (MUST) poder registrar en un estado de cuenta emitido el saldo facturado y el pago mínimo que informa el banco; cuando existen, DEBEN (MUST) usarse para el pago para no generar intereses, el pago mínimo, lo que falta pagar y el estado, y la diferencia con el cálculo del sistema DEBE (MUST) mostrarse. Registrarlos NO DEBE (MUST NOT) crear asientos.
Trace: FR-DEBT-013 · Priority: Could

#### Scenario: Extracto del banco con intereses no registrados
- **CUANDO** el EDITOR registra en el estado de cuenta cerrado el 2026-10-25 un saldo facturado de 1125.30 BOB y un mínimo de 56.30 BOB informados por el banco
- **ENTONCES** el pago para no generar intereses es 1125.30 BOB, el mínimo 56.30 BOB y se muestra una diferencia de 4.80 BOB con el cálculo del sistema
- **Y** no se registra ningún asiento

### Requirement: Pago de tarjeta como transferencia que no es gasto
El pago de una tarjeta DEBE (MUST) registrarse como transferencia de una cuenta de activo a la cuenta de la tarjeta (o como conversión si se paga desde otra moneda), DEBE (MUST) contarse como pago del ciclo en que ocurre y reducir lo que falta del estado de cuenta, y NO DEBE (MUST NOT) contarse como gasto en el resumen del mes, en los presupuestos ni en el ahorro; solo las comisiones explícitas del pago cuentan como gasto.
Trace: FR-DEBT-014, FR-TRANSACTIONS-018, INV-009, INV-030 · Priority: Must

#### Scenario: Pago del estado de cuenta desde el banco
- **CUANDO** el 2026-11-10 se transfieren 1120.50 BOB de "Banco BOB" (saldo 5000.00 BOB) a "Visa Oro BOB" (adeuda 1520.50 BOB)
- **ENTONCES** "Banco BOB" queda en 3879.50 BOB, "Visa Oro BOB" adeuda 400.00 BOB y el estado de cuenta cerrado el 2026-10-25 queda `PAID`
- **Y** los gastos de noviembre de 2026 no cambian y el patrimonio neto no cambia

#### Scenario: Parte en dólares pagada con bolivianos
- **CUANDO** "Visa Oro USD" adeuda 100.00 USD y el usuario convierte 980.00 BOB de "Banco BOB" en 100.00 USD hacia "Visa Oro USD" sin comisión
- **ENTONCES** "Visa Oro USD" adeuda 0.00 USD y el movimiento cuenta como pago del ciclo
- **Y** los gastos del mes no cambian

### Requirement: Pago de la tarjeta como compromiso administrado
El EDITOR DEBE (MUST) poder activar, para cada cuenta de la tarjeta, un plan de pago con cuenta de origen activa en la misma moneda, política (`NO_INTEREST`, por defecto, o `MINIMUM`) y modo de materialización; activarlo DEBE (MUST) crear un compromiso recurrente de pago de tarjeta administrado por la tarjeta, mensual en la fecha de vencimiento, desde el próximo vencimiento. El monto esperado de cada ocurrencia DEBE (MUST) ser: para un estado de cuenta emitido, lo que falta según la política, como monto exacto; para el ciclo abierto, una estimación igual al saldo adeudado de hoy menos lo que falta del estado de cuenta emitido aún no vencido y menos las cuotas que se facturarán en ciclos posteriores (con la política `MINIMUM`, la regla de pago mínimo aplicada a esa estimación); para ciclos posteriores, la suma de las cuotas programadas como estimación o sin monto si no hay cuotas. Una ocurrencia cuyo estado de cuenta no tiene nada que pagar DEBE (MUST) omitirse con ese motivo. Desactivar el plan DEBE (MUST) terminar el compromiso sin tocar las transacciones ya creadas.
Trace: FR-DEBT-013, FR-DEBT-014, FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Estimación antes del cierre
- **CUANDO** el 2026-10-20 "Visa Oro BOB" adeuda 1120.50 BOB, su estado de cuenta anterior está pagado y el plan tiene origen "Banco BOB" y política `NO_INTEREST`
- **ENTONCES** la ocurrencia del 2026-11-15 espera 1120.50 BOB como estimación

#### Scenario: Monto exacto después del cierre
- **CUANDO** el 2026-10-26 se emite el estado de cuenta con saldo facturado 1120.50 BOB
- **ENTONCES** la ocurrencia del 2026-11-15 espera exactamente 1120.50 BOB
- **Y** al aprobarla se crea una transferencia de 1120.50 BOB de "Banco BOB" a "Visa Oro BOB"

#### Scenario: Política de pago mínimo
- **CUANDO** la política del plan es `MINIMUM` y el estado de cuenta emitido tiene pago mínimo 56.02 BOB
- **ENTONCES** la ocurrencia del 2026-11-15 espera exactamente 56.02 BOB

#### Scenario: Nada que pagar
- **CUANDO** el estado de cuenta de "Visa Oro USD" cerrado el 2026-10-25 tiene saldo facturado 0.00 USD
- **ENTONCES** la ocurrencia del 2026-11-15 de su plan queda omitida con el motivo "sin saldo facturado" y no cuenta como comprometida

### Requirement: Transferencias recurrentes existentes hacia la tarjeta
Activar el plan de pago de una cuenta de la tarjeta DEBE (MUST) rechazarse con `CARD_PAYMENT_PLAN_CONFLICT`, indicando las definiciones en conflicto, mientras exista una definición recurrente activa del usuario de tipo transferencia cuyo destino sea esa cuenta; registrar la tarjeta sin plan DEBE (MUST) permitirse igual, y esas definiciones DEBEN (MUST) seguir generando, materializándose y contando en el comprometido sin ningún cambio.
Trace: FR-DEBT-013, FR-COMMITMENTS-001 · Priority: Must

#### Scenario: Pago Visa ya cargado como transferencia
- **CUANDO** existe la transferencia recurrente activa "Pago Visa" de 1450.00 BOB de "Banco BOB" a "Visa Oro BOB" el día 6 y el EDITOR registra "Visa Oro" pidiendo el plan de pago
- **ENTONCES** la tarjeta se registra sin plan y el plan se rechaza con `CARD_PAYMENT_PLAN_CONFLICT` indicando "Pago Visa"
- **Y** "Pago Visa" sigue activa y su ocurrencia del 2026-11-06 sigue esperando 1450.00 BOB

#### Scenario: Plan tras terminar la transferencia del usuario
- **CUANDO** el EDITOR termina "Pago Visa" y luego activa el plan de pago de "Visa Oro BOB"
- **ENTONCES** el plan queda activo con su primera ocurrencia en el próximo vencimiento

### Requirement: Recordatorio de vencimiento de la tarjeta
Para cada estado de cuenta emitido al que le falta algo para no generar intereses, el sistema DEBE (MUST) publicar un recordatorio de vencimiento cuando hoy, en la zona del workspace, está entre N días antes del vencimiento y el vencimiento (N de 1 a 30 por tarjeta, por defecto 3), una sola vez por cuenta y fecha de cierre aunque el proceso se repita, con o sin plan de pago; un estado de cuenta `PAID` NO DEBE (MUST NOT) recordarse.
Trace: FR-DEBT-013, FR-NOTIFY-004, FR-NOTIFY-005 · Priority: Must

#### Scenario: Tres días antes
- **CUANDO** el estado de cuenta de "Visa Oro BOB" vence el 2026-11-15 con 1120.50 BOB sin pagar y es el 2026-11-12 en La Paz
- **ENTONCES** se publica un recordatorio de vencimiento de "Visa Oro BOB" para el 2026-11-15 con 1120.50 BOB para no generar intereses y 56.02 BOB de mínimo

#### Scenario: Proceso repetido
- **CUANDO** el proceso de recordatorios corre otra vez el 2026-11-13
- **ENTONCES** no se publica un segundo recordatorio para el estado de cuenta cerrado el 2026-10-25

#### Scenario: Ya pagado
- **CUANDO** el estado de cuenta se pagó completo el 2026-11-10
- **ENTONCES** no se publica ningún recordatorio para él

### Requirement: Utilización y crédito disponible
El sistema DEBE (MUST) calcular el crédito usado como el saldo adeudado más las compras pendientes de la cuenta, la utilización como crédito usado ÷ límite × 100 (presentada con 2 decimales HALF_EVEN) y el disponible como límite − crédito usado; con límite separado, por cuenta; con límite compartido, sumando los saldos convertidos a la moneda del límite con la tasa de valoración de hoy. Sin tasa para alguna moneda, la utilización compartida NO DEBE (MUST NOT) calcularse con 1:1: se informa como no disponible indicando la moneda sin tasa.
Trace: FR-DEBT-015, FR-DEBT-016 · Priority: Should

#### Scenario: Límite compartido
- **CUANDO** "Visa Oro" tiene límite compartido de 15000.00 BOB, "Visa Oro BOB" adeuda 3600.00 BOB, "Visa Oro USD" adeuda 100.00 USD y la tasa de valoración USD/BOB de hoy es 9.80
- **ENTONCES** el crédito usado es 4580.00 BOB, la utilización 30.53 % y el disponible 10420.00 BOB

#### Scenario: Compra pendiente usa crédito
- **CUANDO** "Visa Oro BOB" con límite separado de 10000.00 BOB adeuda 1120.50 BOB y tiene una compra pendiente de 75.00 BOB
- **ENTONCES** el crédito usado es 1195.50 BOB, la utilización 11.96 % y el disponible 8804.50 BOB

#### Scenario: Sin tasa para el dólar
- **CUANDO** "Visa Oro" tiene límite compartido en BOB, "Visa Oro USD" adeuda 100.00 USD y no hay tasa de valoración USD/BOB
- **ENTONCES** la utilización compartida se informa como no disponible por falta de tasa USD
- **Y** no se informa un disponible

### Requirement: Alertas de utilización
Cada tarjeta DEBE (MUST) tener de 1 a 3 umbrales de utilización distintos entre 0.01 % y 100.00 % (por defecto 30.00 % y 80.00 %), editables; cuando la utilización pasa de estar por debajo de un umbral a ser mayor o igual a él, el sistema DEBE (MUST) publicar un único hecho por cambio con el umbral más alto cruzado y los demás cruzados en el mismo cambio; un umbral DEBE (MUST) volver a avisar solo después de que la utilización baje de él. Mientras la utilización no pueda calcularse por falta de tasa NO DEBE (MUST NOT) evaluarse ningún umbral.
Trace: FR-DEBT-015, FR-NOTIFY-005 · Priority: Should

#### Scenario: Cruce del 30 %
- **CUANDO** "Visa Oro" (límite compartido 15000.00 BOB, tasa USD/BOB 9.80) tenía una utilización de 26.53 % y se postea una compra de 600.00 BOB en "Visa Oro BOB"
- **ENTONCES** la utilización pasa a 30.53 % y se publica un hecho de umbral 30.00 % alcanzado

#### Scenario: Dos umbrales en un solo cambio
- **CUANDO** "Visa Oro USD" con límite separado de 1000.00 USD adeuda 200.00 USD y se postea una compra de 650.00 USD
- **ENTONCES** la utilización pasa a 85.00 % y se publica un único hecho con el umbral 80.00 % y también cruzado el 30.00 %

#### Scenario: Sin repetir mientras sigue arriba
- **CUANDO** la utilización de "Visa Oro" está en 30.53 % y una compra de 100.00 BOB la sube a 31.20 %
- **ENTONCES** no se publica ningún hecho nuevo

#### Scenario: Vuelve a avisar tras bajar
- **CUANDO** un pago baja la utilización de "Visa Oro" a 12.00 % y luego compras la suben a 30.10 %
- **ENTONCES** se publica de nuevo un hecho de umbral 30.00 % alcanzado

### Requirement: Compras en cuotas sin interés
El EDITOR DEBE (MUST) poder asociar a un gasto posteado de una cuenta de la tarjeta un plan de 2 a 60 cuotas sin interés que se facturan una por ciclo desde el ciclo de la compra (o desde el siguiente, si se indica); el capital de cada cuota DEBE (MUST) ser el monto ÷ cuotas redondeado HALF_EVEN a la escala de la moneda y la última cuota DEBE (MUST) absorber el residuo para que la suma de las cuotas sea exactamente el monto de la compra. Un gasto que no es de una cuenta de la tarjeta, no está posteado o ya tiene plan DEBE (MUST) rechazarse con `INSTALLMENT_PLAN_INVALID`. El plan NO DEBE (MUST NOT) crear asientos: la compra ya adeuda su monto completo.
Trace: FR-DEBT-017, INV-020 · Priority: Could

#### Scenario: Laptop en 3 cuotas
- **CUANDO** el EDITOR asocia a la compra "Laptop" de 1000.00 BOB del 2026-10-05 en "Visa Oro BOB" un plan de 3 cuotas sin interés
- **ENTONCES** las cuotas son 333.33 BOB, 333.33 BOB y 333.34 BOB en los ciclos que cierran el 2026-10-25, 2026-11-25 y 2026-12-25
- **Y** la suma de las cuotas es 1000.00 BOB y "Visa Oro BOB" sigue adeudando 1000.00 BOB

#### Scenario: Gasto de otra cuenta
- **CUANDO** el EDITOR asocia un plan de cuotas a un gasto de "Banco BOB"
- **ENTONCES** se rechaza con `INSTALLMENT_PLAN_INVALID`

### Requirement: Compras en cuotas con interés
Un plan de cuotas DEBE (MUST) poder tener una tasa nominal anual positiva; entonces la cuota DEBE (MUST) calcularse con el sistema francés a la tasa mensual (tasa anual ÷ 12), con interés de cada cuota = saldo de capital × tasa mensual redondeado HALF_EVEN, capital = cuota − interés y la última cuota ajustada para que la suma del capital sea exactamente el monto de la compra. El interés de las cuotas es una proyección: NO DEBE (MUST NOT) registrarse como gasto hasta que el usuario lo registre con el estado de cuenta.
Trace: FR-DEBT-017, INV-017, INV-020 · Priority: Could

#### Scenario: 1200.00 BOB en 3 cuotas al 24 % anual
- **CUANDO** el EDITOR asocia a una compra de 1200.00 BOB un plan de 3 cuotas con tasa nominal anual de 24.00 %
- **ENTONCES** las cuotas son 416.11 BOB (capital 392.11, interés 24.00), 416.11 BOB (capital 399.95, interés 16.16) y 416.10 BOB (capital 407.94, interés 8.16)
- **Y** la suma del capital es 1200.00 BOB y el interés proyectado total es 48.32 BOB

### Requirement: Cuotas en el saldo facturado y calendario de cargos futuros
El saldo facturado de un ciclo DEBE (MUST) ser el saldo al cierre menos el capital de las cuotas que se facturarán en ciclos posteriores; la utilización DEBE (MUST) seguir usando el saldo adeudado completo. El sistema DEBE (MUST) listar el calendario de cargos futuros de la tarjeta: por cada fecha de vencimiento, las cuotas que se facturarán en ese ciclo con su capital, su interés proyectado y su total.
Trace: FR-DEBT-017, FR-DEBT-013 · Priority: Could

#### Scenario: Primer ciclo de la laptop
- **CUANDO** "Visa Oro BOB" (límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB) solo tiene la compra "Laptop" de 1000.00 BOB en 3 cuotas sin interés y cierra el 2026-10-25
- **ENTONCES** el saldo al cierre es 1000.00 BOB, el saldo facturado 333.33 BOB y el pago mínimo 50.00 BOB
- **Y** la utilización es 10.00 %

#### Scenario: Calendario de cargos futuros
- **CUANDO** se consulta el calendario de cargos futuros de "Visa Oro" el 2026-10-20
- **ENTONCES** lista 333.33 BOB al 2026-11-15, 333.33 BOB al 2026-12-15 y 333.34 BOB al 2027-01-15

### Requirement: Anular la compra cancela su plan de cuotas
Cuando la compra de un plan de cuotas se anula o se corrige con otro monto, el plan DEBE (MUST) cancelarse con ese motivo y sus cuotas pendientes DEBEN (MUST) dejar de restarse del saldo facturado y de figurar en el calendario de cargos futuros; las cuotas de ciclos ya cerrados DEBEN (MUST) conservarse en el historial.
Trace: FR-DEBT-017 · Priority: Could

#### Scenario: Laptop devuelta
- **CUANDO** el 2026-11-02 se anula la compra "Laptop" de 1000.00 BOB, cuya primera cuota se facturó en el ciclo cerrado el 2026-10-25
- **ENTONCES** el plan queda cancelado con el motivo "compra anulada" y el calendario de cargos futuros ya no lista 333.33 BOB al 2026-12-15 ni 333.34 BOB al 2027-01-15

### Requirement: Cambio de los términos de la tarjeta
El EDITOR DEBE (MUST) poder cambiar nombre, límites, umbrales, recordatorio, tasa y regla de pago mínimo con efecto inmediato en los cálculos de ciclos aún no emitidos, y el día de cierre, el día de vencimiento o el ajuste de fin de semana con efecto desde el ciclo abierto; los estados de cuenta emitidos NO DEBEN (MUST NOT) cambiar sus fechas ni las cifras emitidas, y el compromiso del plan de pago DEBE (MUST) revisarse desde su primera ocurrencia no resuelta.
Trace: FR-DEBT-012 · Priority: Should

#### Scenario: Cierre pasa del 25 al 20
- **CUANDO** el 2026-10-27, con el estado de cuenta del 2026-10-25 ya emitido, el EDITOR cambia el cierre de "Visa Oro" del día 25 al 20 y el vencimiento del 15 al 10
- **ENTONCES** el estado de cuenta del 2026-10-25 conserva su vencimiento 2026-11-15
- **Y** el ciclo abierto va del 2026-10-26 al 2026-11-20 y vence el 2026-12-10

### Requirement: Archivar una tarjeta
El EDITOR DEBE (MUST) poder archivar una tarjeta: sus planes de pago DEBEN (MUST) terminar, sus estados de cuenta y planes de cuotas DEBEN (MUST) conservarse para consulta, dejan de emitirse estados de cuenta, recordatorios y alertas, y sus cuentas NO DEBEN (MUST NOT) cambiar de estado ni de saldo; una cuenta de una tarjeta archivada PUEDE vincularse a otra tarjeta.
Trace: FR-DEBT-012 · Priority: Should

#### Scenario: Tarjeta reemplazada por el banco
- **CUANDO** el EDITOR archiva "Visa Oro" con plan de pago activo en "Visa Oro BOB"
- **ENTONCES** el plan termina, los estados de cuenta anteriores siguen consultables y "Visa Oro BOB" conserva su saldo y su estado activo

### Requirement: Permisos, auditoría y aislamiento de las tarjetas
Todo miembro activo DEBE (MUST) poder consultar las tarjetas, sus estados de cuenta, su utilización y sus cuotas; solo OWNER y EDITOR DEBEN (MUST) poder registrarlas, editarlas, archivarlas, activar o desactivar planes de pago, registrar montos del banco y gestionar planes de cuotas (un VIEWER recibe `INSUFFICIENT_ROLE`). Cada cambio, incluidos los del proceso de emisión, DEBE (MUST) auditarse en la misma unidad de trabajo con actor y diff, y las creaciones DEBEN (MUST) ser idempotentes con `Idempotency-Key`. Una tarjeta de otro workspace DEBE (MUST) responder `RESOURCE_NOT_FOUND`.
Trace: FR-DEBT-012, FR-AUDIT-001, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta cambiar el límite
- **CUANDO** un VIEWER cambia el límite de "Visa Oro" a 20000.00 BOB
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y el límite sigue en 10000.00 BOB

#### Scenario: Cambio de límite auditado
- **CUANDO** el EDITOR cambia el límite de "Visa Oro BOB" de 10000.00 BOB a 12000.00 BOB
- **ENTONCES** la auditoría de "Visa Oro" registra al EDITOR como actor y el límite 10000.00 → 12000.00 BOB

#### Scenario: Tarjeta de otro workspace
- **CUANDO** un miembro del workspace B consulta "Visa Oro" del workspace A
- **ENTONCES** la respuesta es `RESOURCE_NOT_FOUND`
