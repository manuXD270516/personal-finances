# reporting/cash-flow-calendar Specification

## Purpose
Responde en el Home "¿Qué pagos vienen?" (Q8) y "¿Cuánto está comprometido?" (Q4): la lista de próximos pagos conocidos (ocurrencias recurrentes no resueltas y transacciones pendientes de egreso), el total comprometido del periodo financiero, el saldo proyectado por cuenta (saldo contable más pendientes) y un indicador de pagos sorpresa por periodo, con montos honestos según el tipo de monto y valorados en la moneda de reporte sin inventar tasas. Desde Phase 7 (add-cash-flow-forecast) también ofrece el calendario de flujo de caja por moneda con saldo esperado diario, riesgo de déficit con su episodio y alerta, el disponible con categorías esenciales y reserva, y la variación por categoría (FR-REPORTING-014/015/018).

## Requirements

### Requirement: Lista de próximos pagos
El sistema DEBE (MUST) listar los pagos conocidos de una ventana de N días desde hoy (por defecto 30, de 1 a 90, ambos extremos incluidos): las ocurrencias recurrentes de egreso (gasto y transferencia saliente) que Commitments informa como no resueltas y las transacciones pendientes de egreso, ordenadas por fecha ascendente y luego por nombre; cada ítem DEBE (MUST) indicar fecha, nombre o descripción, cuenta, monto con su moneda, origen (compromiso o transacción pendiente) y estado. Las ocurrencias resueltas (materializadas en una transacción posteada, vinculadas a una transacción existente, omitidas o canceladas) y las ocurrencias de ingreso NO DEBEN (MUST NOT) listarse; una ventana fuera de 1 a 90 días DEBE (MUST) rechazarse con `INVALID_FILTER`.
Trace: FR-REPORTING-016, FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Próximos 30 días
- **CUANDO** el 2026-10-20 el workspace tiene las ocurrencias de egreso no resueltas "Internet" 199.00 BOB del 2026-10-22, "Luz" 180.00 BOB del 2026-10-28, "Alquiler" 2500.00 BOB del 2026-11-01 y "Seguro anual" 900.00 BOB del 2026-12-15, y la transacción pendiente "Cena" de 300.00 BOB del 2026-10-18 en "Banco BOB"
- **ENTONCES** la lista de 30 días contiene, en este orden, "Cena", "Internet", "Luz" y "Alquiler"
- **Y** no contiene "Seguro anual", que vence después del 2026-11-19
- **Y** el total de la lista es 3179.00 BOB

#### Scenario: Ocurrencias resueltas excluidas
- **CUANDO** además "Internet" se aprobó y su transacción está posteada, y la ocurrencia "Agua" del 2026-10-27 fue omitida
- **ENTONCES** la lista de 30 días contiene "Cena", "Luz" y "Alquiler" con un total de 2980.00 BOB
- **Y** no contiene "Internet" ni "Agua"

#### Scenario: Ingreso esperado no listado
- **CUANDO** existe la ocurrencia de ingreso "Sueldo" de 8000.00 BOB del 2026-10-25
- **ENTONCES** "Sueldo" no aparece en la lista de próximos pagos ni suma en su total

#### Scenario: Ventana fuera de rango
- **CUANDO** se piden los próximos pagos de 91 días
- **ENTONCES** la consulta se rechaza con `INVALID_FILTER`

### Requirement: Pagos vencidos sin resolver marcados
Una ocurrencia de egreso no resuelta cuya fecha es anterior a hoy DEBE (MUST) listarse aunque quede antes de la ventana, marcada como vencida con los días de atraso y sumada al total de la lista, hasta que se resuelva.
Trace: FR-REPORTING-016, FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Netflix vencido
- **CUANDO** el 2026-10-20 la ocurrencia "Netflix" de 49.00 BOB del 2026-10-15 sigue sin resolver y "Internet" 199.00 BOB del 2026-10-22 también
- **ENTONCES** la lista de 30 días muestra primero "Netflix" marcado como vencido con 5 días de atraso y luego "Internet"
- **Y** el total de la lista es 248.00 BOB

#### Scenario: Vencido resuelto deja la lista
- **CUANDO** luego el usuario vincula "Netflix" a un gasto posteado de 49.00 BOB del 2026-10-20
- **ENTONCES** la lista ya no contiene "Netflix" y su total es 199.00 BOB

### Requirement: Montos según el tipo de monto
Cada ocurrencia DEBE (MUST) mostrar su monto según el tipo: `FIXED` el monto exacto; `ESTIMATED` el monto esperado marcado como estimado; `MIN_MAX` el rango, sumando el máximo en los totales; `VARIABLE` sin monto, marcada como "monto variable". Las ocurrencias sin monto NO DEBEN (MUST NOT) sumarse con 0 ni con un monto inventado: los totales DEBEN (MUST) indicar cuántos pagos sin monto quedaron fuera.
Trace: FR-REPORTING-016, FR-COMMITMENTS-004 · Priority: Must

#### Scenario: Cuatro tipos de monto
- **CUANDO** las ocurrencias no resueltas de la ventana son "Internet" `FIXED` 199.00 BOB, "Luz" `ESTIMATED` 180.00 BOB, "Gimnasio" `MIN_MAX` de 150.00 a 200.00 BOB y "Agua" `VARIABLE`
- **ENTONCES** la lista muestra 199.00 BOB, 180.00 BOB marcado como estimado, el rango 150.00–200.00 BOB y "monto variable"
- **Y** el total de la lista es 579.00 BOB con la indicación de 1 pago sin monto

#### Scenario: Monto de la ocurrencia editado
- **CUANDO** el usuario edita solo la ocurrencia de octubre de "Luz" a 195.00 BOB
- **ENTONCES** la lista muestra "Luz" con 195.00 BOB y el total pasa a 594.00 BOB con 1 pago sin monto

### Requirement: Ocurrencia registrada como pendiente sin doble conteo
Cuando una ocurrencia se materializa como transacción pendiente, la lista y los totales DEBEN (MUST) contarla una sola vez, como la transacción pendiente con su monto real, indicando el compromiso de origen; cuando esa transacción se postea o se anula, el ítem DEBE (MUST) dejar la lista o volver a la ocurrencia liberada según lo que informe Commitments.
Trace: FR-COMMITMENTS-011, FR-REPORTING-016 · Priority: Must

#### Scenario: Luz creada como pendiente
- **CUANDO** el 2026-10-20 la ocurrencia "Luz" estimada en 180.00 BOB se materializa como gasto pendiente de 185.40 BOB, y la lista contiene además "Cena" 300.00 BOB pendiente, "Internet" 199.00 BOB y "Alquiler" 2500.00 BOB
- **ENTONCES** "Luz" aparece una sola vez, como transacción pendiente de 185.40 BOB del compromiso "Luz"
- **Y** el total de la lista es 3184.40 BOB

#### Scenario: Pendiente posteada
- **CUANDO** luego el gasto pendiente de "Luz" se postea
- **ENTONCES** "Luz" ya no aparece en la lista y el total es 2999.00 BOB

### Requirement: Valoración de los próximos pagos en la moneda de reporte
La lista y sus totales DEBEN (MUST) informarse por moneda original y consolidados en la moneda de reporte, agregando por moneda antes de convertir y convirtiendo cada agregado con la tasa del tipo preferido vigente al momento de la consulta, dentro de la ventana de vigencia de tasas de Reporting y con su fuente y antigüedad; un monto sin tasa vigente DEBE (MUST) mostrarse sin convertir, excluido del consolidado, que se marca incompleto; NO DEBE (MUST NOT) convertirse 1:1. El consolidado DEBE (MUST) redondearse HALF_EVEN a la escala de la moneda de reporte solo al presentar.
Trace: FR-REPORTING-016, FR-FX-006, FR-REPORTING-001 · Priority: Must

#### Scenario: Pago en USD consolidado
- **CUANDO** la lista contiene "Internet" 199.00 BOB y "Spotify" 5.99 USD del 2026-10-25, y la última tasa `PARALLEL` USD/BOB de paralelo.bo vigente al consultar es 12.00
- **ENTONCES** los totales por moneda son 199.00 BOB y 5.99 USD
- **Y** el consolidado es 270.88 BOB con la tasa USD/BOB 12.00 `PARALLEL` y "Fuente: paralelo.bo"

#### Scenario: Sin tasa vigente
- **CUANDO** la última tasa USD/BOB de cualquier origen tiene más días que la ventana de vigencia
- **ENTONCES** "Spotify" se muestra con 5.99 USD sin convertir
- **Y** el consolidado es 199.00 BOB marcado como incompleto, con 5.99 USD como monto no convertido

#### Scenario: Redondeo solo al presentar
- **CUANDO** la lista contiene dos pagos de 3.33 USD cada uno y la tasa USD/BOB vigente es 12.005
- **ENTONCES** el consolidado es 79.95 BOB (6.66 × 12.005 = 79.9533)
- **Y** no 79.96 BOB, que resultaría de sumar 39.98 BOB redondeados por pago

### Requirement: Ventana según la fecha en la zona del workspace
El "hoy" de la lista, la ventana de N días, los días de atraso y el periodo financiero vigente DEBEN (MUST) calcularse con la fecha local de la zona horaria del workspace (por defecto America/La_Paz), no con la fecha UTC del instante de la consulta.
Trace: FR-REPORTING-016, NFR-USAB-004 · Priority: Must

#### Scenario: Consulta de noche en La Paz
- **CUANDO** se consultan los próximos 7 días el 2026-10-20T23:30:00-04:00 (2026-10-21T03:30:00Z) y existen "Agua" `FIXED` 60.00 BOB del 2026-10-27 y "Luz" 180.00 BOB del 2026-10-28
- **ENTONCES** la ventana es del 2026-10-20 al 2026-10-27
- **Y** la lista contiene "Agua" y no contiene "Luz"

### Requirement: Total comprometido del periodo en el Home
El Home DEBE (MUST) mostrar para el periodo financiero que contiene hoy el total comprometido que informa Commitments (ocurrencias de egreso no resueltas con fecha en el periodo, incluidas las vencidas del periodo, más transacciones pendientes de egreso del periodo, sin doble conteo), por moneda y consolidado en la moneda de reporte con las reglas de valoración de esta capability, con el desglose de cuánto proviene de compromisos y cuánto de pendientes y la cantidad de pagos sin monto; las ocurrencias vencidas de periodos anteriores aún sin resolver DEBEN (MUST) mostrarse aparte como "vencido de periodos anteriores" y NO DEBEN (MUST NOT) sumarse al total del periodo.
Trace: FR-COMMITMENTS-011, FR-REPORTING-016 · Priority: Must

#### Scenario: Comprometido de octubre
- **CUANDO** el 2026-10-20, con periodos que empiezan el día 1, las ocurrencias no resueltas de egreso de octubre son "Netflix" 49.00 BOB (vencida el 2026-10-15), "Internet" 199.00 BOB, "Spotify" 5.99 USD, "Luz" `ESTIMATED` 180.00 BOB, "Gimnasio" `MIN_MAX` 150.00–200.00 BOB y "Agua" `VARIABLE`, la transacción pendiente "Cena" de 300.00 BOB es del 2026-10-18, "Alquiler" 2500.00 BOB vence el 2026-11-01 y la tasa USD/BOB vigente es 12.00
- **ENTONCES** el total comprometido del periodo "2026-10" es 999.88 BOB, de los cuales 699.88 BOB son compromisos y 300.00 BOB pendientes
- **Y** se indica 1 pago sin monto y "Alquiler" no suma

#### Scenario: Vencido de un periodo anterior mostrado aparte
- **CUANDO** además la ocurrencia "Seguro" de 120.00 BOB del 2026-09-28 sigue sin resolver
- **ENTONCES** el total comprometido de "2026-10" sigue siendo 999.88 BOB
- **Y** el Home muestra aparte 120.00 BOB vencidos de periodos anteriores

#### Scenario: Periodo financiero con día de inicio 25
- **CUANDO** el día de inicio del mes financiero es 25, el 2026-10-20 el periodo vigente es del 2026-09-25 al 2026-10-24, y existen "Seguro" 120.00 BOB del 2026-09-28 sin resolver, "Netflix" 49.00 BOB del 2026-10-15 sin resolver, "Cena" pendiente de 300.00 BOB del 2026-10-18, "Internet" 199.00 BOB del 2026-10-22 y "Spotify" 5.99 USD del 2026-10-25
- **ENTONCES** el total comprometido del periodo "2026-09" es 668.00 BOB
- **Y** no incluye "Spotify", cuya fecha cae en el periodo siguiente

### Requirement: Saldo proyectado por cuenta
El sistema DEBE (MUST) mostrar, para cada cuenta no archivada, el saldo proyectado igual al saldo contable más los ingresos pendientes menos los egresos pendientes de la cuenta, siempre junto al saldo contable y rotulado como proyección; el saldo contable NO DEBE (MUST NOT) cambiar por las transacciones pendientes y el saldo proyectado NO DEBE (MUST NOT) descontar ocurrencias recurrentes no materializadas.
Trace: FR-LEDGER-013, FR-LEDGER-012 · Priority: Must

#### Scenario: Banco con un gasto y un ingreso pendientes
- **CUANDO** "Banco BOB" tiene saldo contable 4000.00 BOB, un gasto pendiente "Cena" de 300.00 BOB y un ingreso pendiente "Reembolso seguro" de 150.00 BOB
- **ENTONCES** el saldo proyectado de "Banco BOB" es 3850.00 BOB
- **Y** su saldo contable sigue siendo 4000.00 BOB

#### Scenario: Ocurrencia no materializada no descuenta
- **CUANDO** además la ocurrencia "Internet" de 199.00 BOB de "Banco BOB" está programada y sin materializar
- **ENTONCES** el saldo proyectado de "Banco BOB" sigue siendo 3850.00 BOB

#### Scenario: Cuenta sin pendientes
- **CUANDO** "Wallet USDT" tiene saldo contable 50.000000 USDT y ninguna transacción pendiente
- **ENTONCES** su saldo proyectado es 50.000000 USDT

### Requirement: Preguntas Q4 y Q8 habilitadas en el Home
Las preguntas del Home "¿Cuánto está comprometido?" (Q4) y "¿Qué pagos vienen?" (Q8) DEBEN (MUST) dejar de declararse no disponibles: la tarjeta de Q8 DEBE (MUST) mostrar los pagos de los próximos 7 días, incluidos los vencidos sin resolver, hasta 5 ítems con la cantidad de los restantes y un enlace a la lista completa, y la de Q4 el total comprometido del periodo; si el workspace no tiene definiciones recurrentes activas ni transacciones pendientes, ambas DEBEN (MUST) indicar que no hay datos con la acción de crear un compromiso, sin mostrar montos en cero.
Trace: FR-REPORTING-016, FR-REPORTING-001, FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Seis pagos en la semana
- **CUANDO** el 2026-10-20 los pagos de los próximos 7 días son "Netflix" (vencido), "Cena" (pendiente), "Internet", "Spotify", "Luz" del 2026-10-26 y "Agua" del 2026-10-27
- **ENTONCES** la tarjeta de Q8 muestra "Netflix", "Cena", "Internet", "Spotify" y "Luz", indica 1 pago más y enlaza a la lista completa

#### Scenario: Sin compromisos ni pendientes
- **CUANDO** el workspace tiene cuentas pero ninguna definición recurrente activa ni transacciones pendientes
- **ENTONCES** las tarjetas de Q4 y Q8 indican que no hay datos y ofrecen crear un compromiso
- **Y** no muestran 0.00 BOB

#### Scenario: Semana sin pagos
- **CUANDO** el workspace tiene definiciones recurrentes activas pero ningún pago no resuelto ni pendiente en los próximos 7 días
- **ENTONCES** la tarjeta de Q8 indica que no hay pagos en los próximos 7 días, sin declararse no disponible

### Requirement: Frescura y lectura inmediata de los próximos pagos
La lista, el total comprometido y el saldo proyectado DEBEN (MUST) declarar la ventana, el periodo, la moneda de reporte, el instante de generación y la frescura, y DEBEN (MUST) reflejar en la siguiente consulta toda acción que el usuario acaba de hacer sobre una ocurrencia o una transacción pendiente (aprobar, omitir, vincular, editar, crear o postear).
Trace: FR-REPORTING-007, FR-REPORTING-016 · Priority: Must

#### Scenario: Ocurrencia omitida y consulta inmediata
- **CUANDO** la lista de 30 días contiene "Internet" 199.00 BOB y "Luz" 180.00 BOB, y el usuario omite "Luz" y consulta inmediatamente después
- **ENTONCES** la lista contiene solo "Internet" con un total de 199.00 BOB
- **Y** la respuesta indica la ventana 2026-10-20 a 2026-11-19, la moneda de reporte BOB, el instante de generación y la frescura

### Requirement: Consulta de próximos pagos para todos los miembros
Todo miembro del workspace, incluido el VIEWER, DEBE (MUST) poder consultar la lista de próximos pagos, el total comprometido, el saldo proyectado y el indicador de pagos sorpresa, que DEBEN (MUST) contener solo datos de ese workspace.
Trace: FR-REPORTING-016, FR-IDENTITY-006 · Priority: Must

#### Scenario: VIEWER consulta
- **CUANDO** un VIEWER de "W1" consulta los próximos pagos de 30 días
- **ENTONCES** recibe la misma lista y los mismos totales que el OWNER

#### Scenario: Otro workspace aislado
- **CUANDO** "W2" tiene la ocurrencia "Hosting" de 80.00 BOB del 2026-10-23 y un miembro de "W1" consulta los próximos pagos de "W1"
- **ENTONCES** la lista de "W1" no contiene "Hosting"

### Requirement: Indicador de pagos sorpresa por periodo
El sistema DEBERÍA (SHOULD) informar por periodo financiero, como medida de SM-07, la cantidad y el detalle de los pagos sorpresa: transacciones de egreso no anuladas con fecha en el periodo que resolvieron una ocurrencia (materializada o vinculada) cuya generación ocurrió el mismo día de la transacción o después, en la zona del workspace; las ocurrencias omitidas no cuentan, y un periodo aún no terminado DEBERÍA (SHOULD) informarse como parcial. El sistema DEBE (MUST) aclarar que los pagos no vinculados a ningún compromiso no se detectan.
Trace: FR-COMMITMENTS-011, FR-REPORTING-016 · Priority: Should

#### Scenario: Seguro modelado después de pagarlo
- **CUANDO** en el periodo "2026-10" el gasto "Seguro auto" de 350.00 BOB del 2026-10-05 se vinculó a la ocurrencia del 2026-10-05 de una definición creada el 2026-10-12, e "Internet" se pagó el 2026-10-22 resolviendo una ocurrencia generada el 2026-07-24
- **ENTONCES** el indicador de "2026-10" informa 1 pago sorpresa: "Seguro auto" 350.00 BOB del 2026-10-05
- **Y** "Internet" no cuenta como sorpresa

#### Scenario: Mes sin sorpresas
- **CUANDO** todos los pagos del periodo "2026-09", ya terminado, resolvieron ocurrencias generadas al menos un día antes de su fecha
- **ENTONCES** el indicador de "2026-09" informa 0 pagos sorpresa, sin marca de parcial

#### Scenario: Periodo en curso
- **CUANDO** se consulta el indicador de "2026-10" el 2026-10-20
- **ENTONCES** el resultado se marca como parcial hasta el fin del periodo

### Requirement: Métricas y alerta para evolucionar a un read model
La consulta de próximos pagos, total comprometido y saldo proyectado DEBE (MUST) leer directamente los contratos de Commitments, Transactions, Ledger y FX en Phase 3 y DEBE (MUST) exponer la métrica de duración de la consulta (`reporting_upcoming_payments_duration_seconds`) y la de ocurrencias leídas por consulta (`reporting_upcoming_payments_rows`), sin etiquetas de alta cardinalidad. Cuando el p95 de la duración supere 300 ms (presupuesto del Home, NFR-PERF-004) durante 15 minutos o una consulta lea más de 5 000 ocurrencias, el sistema DEBE (MUST) disparar la alerta `UpcomingPaymentsReadModelRecommended`, que indica que conviene migrar al read model alimentado por eventos descrito en el diseño.
Trace: NFR-PERF-004, NFR-OBS-004, NFR-OBS-005 · Priority: Must

#### Scenario: Consulta lenta sostenida
- **CUANDO** el p95 de `reporting_upcoming_payments_duration_seconds` es 0.42 s durante 15 minutos
- **ENTONCES** se dispara la alerta `UpcomingPaymentsReadModelRecommended`
- **Y** la alerta enlaza la sección "Evolución a read model" del diseño

#### Scenario: Volumen bajo
- **CUANDO** el p95 es 0.08 s y ninguna consulta lee más de 5 000 ocurrencias
- **ENTONCES** la alerta no se dispara

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

### Requirement: Calendario de flujo de caja por horizonte
El sistema DEBE (MUST) entregar el calendario de flujo de caja de las cuentas líquidas del workspace para un horizonte de 7, 30, 60 o 90 días desde hoy (por omisión 30), con un punto por día desde hoy hasta hoy más el horizonte, ambos incluidos; "hoy" y los límites del horizonte DEBEN (MUST) calcularse con la fecha local de la zona horaria del workspace. Un horizonte distinto de 7, 30, 60 o 90 DEBE (MUST) rechazarse con `INVALID_FILTER`.
Trace: FR-REPORTING-014, NFR-USAB-004 · Priority: Must

#### Scenario: Horizonte de 30 días
- **CUANDO** el 2026-10-20 se pide el calendario de 30 días
- **ENTONCES** el calendario va del 2026-10-20 al 2026-11-19 con 31 puntos diarios

#### Scenario: Horizonte no admitido
- **CUANDO** se pide el calendario de 45 días
- **ENTONCES** la consulta se rechaza con `INVALID_FILTER`

#### Scenario: Consulta de noche en La Paz
- **CUANDO** se pide el calendario de 7 días el 2026-10-20T23:30:00-04:00 (2026-10-21T03:30:00Z)
- **ENTONCES** el calendario va del 2026-10-20 al 2026-10-27

### Requirement: Saldo esperado diario por moneda
Para cada moneda de las cuentas líquidas (cuentas de activo con liquidez `LIQUID` no archivadas) el calendario DEBE (MUST) informar el saldo inicial igual a la suma de sus saldos contables (transacciones posteadas, conciliadas o reconciliadas) y el saldo esperado al cierre de cada día, igual al del día anterior más los movimientos esperados de ese día; las transacciones pendientes y las ocurrencias no resueltas con fecha anterior a hoy DEBEN (MUST) aplicarse en el día de hoy, las vencidas marcadas como tales con sus días de atraso. Una ocurrencia materializada como transacción pendiente DEBE (MUST) contarse una sola vez, como la pendiente con su monto real.
Trace: FR-REPORTING-014, FR-LEDGER-013 · Priority: Must

#### Scenario: Saldo esperado de octubre y noviembre
- **CUANDO** el 2026-10-20 "Banco BOB" tiene 4000.00 BOB y "Efectivo BOB" 500.00 BOB de saldo contable, la transacción pendiente "Cena" de 300.00 BOB del 2026-10-18 sale de "Banco BOB", y las ocurrencias no resueltas son "Internet" `FIXED` 199.00 BOB del 2026-10-22, "Luz" `ESTIMATED` 180.00 BOB del 2026-10-28, el ingreso "Sueldo" `FIXED` 8000.00 BOB del 2026-10-31, "Alquiler" `FIXED` 2500.00 BOB del 2026-11-01 y "Pago de tarjeta · Visa Oro" por exactamente 1120.50 BOB del 2026-11-15, todas de "Banco BOB"
- **ENTONCES** en BOB el calendario de 30 días informa saldo inicial 4500.00 BOB y saldos esperados de 4200.00 BOB el 2026-10-20, 4001.00 BOB el 2026-10-22, 3821.00 BOB el 2026-10-28, 11821.00 BOB el 2026-10-31, 9321.00 BOB el 2026-11-01 y 8200.50 BOB del 2026-11-15 al 2026-11-19
- **Y** el saldo final del horizonte es 8200.50 BOB

#### Scenario: Ocurrencia vencida aplicada hoy
- **CUANDO** además la ocurrencia "Netflix" de 49.00 BOB del 2026-10-15, pagadera desde "Banco BOB", sigue sin resolver
- **ENTONCES** el saldo esperado del 2026-10-20 es 4151.00 BOB
- **Y** "Netflix" figura en el día de hoy marcada como vencida con 5 días de atraso

#### Scenario: Ocurrencia fuera del horizonte
- **CUANDO** además existe "Seguro anual" de 900.00 BOB del 2026-12-15
- **ENTONCES** el calendario de 30 días no la incluye y el saldo final sigue siendo 8200.50 BOB

### Requirement: Movimientos esperados del calendario y su certeza
El calendario DEBE (MUST) construirse con las transacciones pendientes y las ocurrencias no resueltas de todos los tipos (ingreso, gasto, transferencia, pago de tarjeta y cuota de préstamo, incluidas las de compromisos administrados por una meta o por una deuda), aplicando a cada cuenta líquida el efecto de su movimiento: un ingreso suma, un gasto resta, una transferencia entre dos cuentas líquidas resta en la de origen y suma en la de destino, y una transferencia de una cuenta líquida a una no líquida resta en la de origen. Los movimientos sobre cuentas no líquidas (por ejemplo una compra cargada a una tarjeta) NO DEBEN (MUST NOT) afectar el saldo esperado. Cada movimiento DEBE (MUST) informar fecha, nombre, cuenta, monto, origen y certeza: conocido (transacción pendiente y ocurrencia `FIXED` de egreso, incluido el pago de tarjeta con estado de cuenta emitido y la cuota de préstamo), estimado (ocurrencia `ESTIMATED` o `MIN_MAX` de egreso y pago de tarjeta del ciclo abierto o de cuotas) o esperado (ocurrencia de ingreso).
Trace: FR-REPORTING-014, FR-DEBT-013, FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Transferencia entre cuentas líquidas
- **CUANDO** con los datos del saldo esperado de octubre y noviembre existe además la ocurrencia de transferencia "Ahorro mensual" de 500.00 BOB del 2026-10-25 de "Banco BOB" a "Efectivo BOB", ambas líquidas
- **ENTONCES** el saldo esperado en BOB de cada día no cambia y el saldo final sigue siendo 8200.50 BOB

#### Scenario: Aporte a una meta hacia una cuenta no líquida y cuota de préstamo
- **CUANDO** además existen la ocurrencia "Aporte Fondo de emergencia" de 1500.00 BOB del 2026-10-28 de "Banco BOB" a "Plazo fijo" (no líquida), administrada por la meta, y la cuota "Préstamo vehicular — cuota 7" de 1080.00 BOB del 2026-11-05 desde "Banco BOB"
- **ENTONCES** el saldo esperado del 2026-10-28 es 2321.00 BOB y el saldo final 5620.50 BOB
- **Y** el aporte figura con origen meta y la cuota con certeza conocida

#### Scenario: Compra con tarjeta sin efecto hasta el pago
- **CUANDO** además la ocurrencia "Streaming" de 69.00 BOB del 2026-10-26 se carga a "Visa Oro BOB", una cuenta no líquida
- **ENTONCES** el saldo esperado en BOB no cambia por "Streaming"

### Requirement: Montos conservadores según el tipo de monto
El calendario DEBE (MUST) usar en los egresos `MIN_MAX` el máximo del rango y en los ingresos `MIN_MAX` el mínimo; las ocurrencias `VARIABLE` DEBEN (MUST) listarse sin monto, sin aplicarse al saldo esperado y contarse aparte por moneda, NUNCA con 0 ni con un monto inventado.
Trace: FR-REPORTING-014, FR-COMMITMENTS-004 · Priority: Must

#### Scenario: Rangos y montos variables
- **CUANDO** el horizonte de 30 días contiene el egreso "Gimnasio" `MIN_MAX` de 150.00 a 200.00 BOB, el ingreso "Freelance" `MIN_MAX` de 1000.00 a 3000.00 BOB y el egreso "Agua" `VARIABLE`, todos en "Banco BOB"
- **ENTONCES** "Gimnasio" resta 200.00 BOB, "Freelance" suma 1000.00 BOB y "Agua" no cambia el saldo esperado
- **Y** el calendario informa 1 movimiento sin monto en BOB

### Requirement: Saldo más bajo esperado con orden conservador dentro del día
Dentro de un mismo día los egresos DEBEN (MUST) aplicarse antes que los ingresos: el saldo más bajo del día es el saldo del día anterior más los egresos del día, y el saldo más bajo esperado de cada moneda DEBE (MUST) ser el menor de esos valores en el horizonte, informado con su monto y la primera fecha en que se alcanza.
Trace: FR-REPORTING-015 · Priority: Must

#### Scenario: Sueldo y alquiler el mismo día
- **CUANDO** el 2026-10-20 "Banco BOB" tiene 2000.00 BOB y "Efectivo BOB" 500.00 BOB, existen "Cena" pendiente de 300.00 BOB, "Internet" 199.00 BOB del 2026-10-22, "Luz" 180.00 BOB del 2026-10-28, "Alquiler" 2500.00 BOB del 2026-11-01, el ingreso "Sueldo" 8000.00 BOB del 2026-11-01 y "Pago de tarjeta · Visa Oro" 1120.50 BOB del 2026-11-15
- **ENTONCES** el saldo más bajo esperado en BOB del calendario de 30 días es −679.00 BOB el 2026-11-01
- **Y** el saldo esperado al cierre del 2026-11-01 es 7321.00 BOB y el saldo final 6200.50 BOB

#### Scenario: Mínimo alcanzado varios días
- **CUANDO** con los datos del saldo esperado de octubre y noviembre el saldo de 3821.00 BOB se mantiene del 2026-10-28 al 2026-10-31 antes del sueldo
- **ENTONCES** el saldo más bajo esperado es 3821.00 BOB el 2026-10-28

### Requirement: Riesgo de déficit por moneda
Para cada moneda el calendario DEBE (MUST) informar el riesgo de déficit frente a un umbral igual a la reserva mínima de liquidez del workspace cuando está en esa moneda y a 0 en las demás: `HIGH` si el saldo más bajo esperado queda por debajo del umbral; `POSSIBLE` si no queda por debajo pero sí al sumar el gasto planificado del plan; `LOW` si queda por debajo del umbral más un margen del 10 % del total de egresos del horizonte; `NONE` en otro caso. Con riesgo `HIGH` o `POSSIBLE` DEBE (MUST) informar la primera fecha bajo el umbral y el faltante (umbral menos saldo más bajo), e indicar si el saldo más bajo es negativo.
Trace: FR-REPORTING-015, FR-IDENTITY-005 · Priority: Must

#### Scenario: Déficit por debajo de cero
- **CUANDO** con los datos de "Sueldo y alquiler el mismo día" la reserva mínima del workspace es 1500.00 BOB
- **ENTONCES** el riesgo en BOB es `HIGH` con primera fecha bajo el umbral 2026-11-01 y faltante 2179.00 BOB
- **Y** se indica que el saldo más bajo es negativo

#### Scenario: Sin reserva mínima
- **CUANDO** el workspace no tiene reserva mínima
- **ENTONCES** el umbral en BOB es 0.00 BOB y el riesgo es `HIGH` con faltante 679.00 BOB

#### Scenario: Por debajo de la reserva sin llegar a cero
- **CUANDO** con los mismos movimientos "Banco BOB" tiene 3300.00 BOB y la reserva mínima es 1500.00 BOB
- **ENTONCES** el saldo más bajo esperado es 621.00 BOB el 2026-11-01 y el riesgo es `HIGH` con faltante 879.00 BOB
- **Y** se indica que el saldo más bajo no es negativo

#### Scenario: Sin riesgo y riesgo bajo
- **CUANDO** con los datos del saldo esperado de octubre y noviembre (saldo más bajo 3821.00 BOB y egresos del horizonte por 4299.50 BOB) la reserva mínima es 1500.00 BOB
- **ENTONCES** el riesgo en BOB es `NONE`
- **Y** con una reserva mínima de 3500.00 BOB el riesgo es `LOW`, porque 3821.00 BOB queda por debajo de 3929.95 BOB

#### Scenario: Otra moneda con umbral cero
- **CUANDO** además "Caja USD" es líquida con 100.00 USD y "Spotify" de 5.99 USD del 2026-10-25 sale de ella, con la reserva mínima en BOB
- **ENTONCES** el umbral en USD es 0.00 USD, el saldo más bajo esperado en USD es 94.01 USD el 2026-10-25 y su riesgo es `NONE`

### Requirement: Gasto planificado restante del plan como estimación
El calendario DEBERÍA (SHOULD) informar, como segunda serie por moneda, el saldo esperado al sumar el gasto planificado restante de los planes de los periodos financieros del horizonte: para cada línea de gasto por categoría o grupo de categorías, lo planificado menos lo gastado menos las ocurrencias no resueltas y pendientes del periodo de esas categorías, no negativo, repartido en partes iguales sin redondeo intermedio entre los días del periodo desde la fecha mayor entre hoy y su inicio hasta su fin dentro del horizonte; las líneas por etiqueta NO DEBEN (MUST NOT) sumarse. Un periodo del horizonte sin plan DEBE (MUST) indicarse sin suponer gasto. Esta serie NO DEBE (MUST NOT) cambiar el saldo esperado principal.
Trace: FR-REPORTING-014, FR-PLANNING-024 · Priority: Should

#### Scenario: Supermercado restante repartido
- **CUANDO** con los datos del saldo esperado de octubre y noviembre y una reserva mínima de 3500.00 BOB, el plan de "2026-10" tiene la línea "Supermercado" con 1200.00 BOB planificados y 600.00 BOB gastados, y "2026-11" no tiene plan
- **ENTONCES** la serie con gasto planificado resta 50.00 BOB por día del 2026-10-20 al 2026-10-31 y su saldo más bajo es 3221.00 BOB el 2026-10-31
- **Y** el riesgo en BOB es `POSSIBLE` con primera fecha bajo el umbral 2026-10-28
- **Y** el periodo "2026-11" se indica sin plan

#### Scenario: Compromiso de la misma categoría sin doble conteo
- **CUANDO** además la ocurrencia no resuelta "Canasta" de 240.00 BOB del 2026-10-25 tiene la categoría "Supermercado"
- **ENTONCES** la serie con gasto planificado resta 30.00 BOB por día del 2026-10-20 al 2026-10-31
- **Y** "Canasta" resta 240.00 BOB en el saldo esperado principal

### Requirement: Serie sin ingresos esperados
El calendario DEBERÍA (SHOULD) informar por moneda el saldo más bajo y el saldo final del peor caso sin ingresos esperados (sin ocurrencias de ingreso ni ingresos pendientes); el riesgo de déficit DEBE (MUST) seguir calculándose con la serie principal.
Trace: FR-REPORTING-014 · Priority: Should

#### Scenario: Peor caso sin sueldo
- **CUANDO** con los datos del saldo esperado de octubre y noviembre se consulta el peor caso
- **ENTONCES** su saldo más bajo es 200.50 BOB el 2026-11-15 y su saldo final 200.50 BOB
- **Y** el riesgo en BOB sigue siendo el de la serie principal

### Requirement: Saldo esperado por cuenta
El calendario DEBE (MUST) informar para cada cuenta líquida su saldo inicial, su saldo final, su saldo más bajo esperado con fecha y, al pedir una cuenta, su serie diaria, con los mismos movimientos y el mismo orden dentro del día que la serie de su moneda; la suma de las series de las cuentas de una moneda DEBE (MUST) ser igual a la serie de esa moneda. Una cuenta no líquida o de otro workspace pedida DEBE (MUST) rechazarse con `INVALID_FILTER`.
Trace: FR-REPORTING-014 · Priority: Must

#### Scenario: Banco y efectivo con transferencia
- **CUANDO** con los datos del saldo esperado de octubre y noviembre y la transferencia "Ahorro mensual" de 500.00 BOB del 2026-10-25 de "Banco BOB" a "Efectivo BOB" se pide la serie de cada cuenta
- **ENTONCES** "Banco BOB" termina el horizonte con 7200.50 BOB y su saldo más bajo es 2821.00 BOB el 2026-10-28
- **Y** "Efectivo BOB" pasa de 500.00 BOB a 1000.00 BOB el 2026-10-25
- **Y** la suma de ambas series es igual a la serie en BOB de cada día

#### Scenario: Cuenta no líquida pedida
- **CUANDO** se pide la serie de "Plazo fijo", una cuenta no líquida
- **ENTONCES** la consulta se rechaza con `INVALID_FILTER`

### Requirement: Consolidado informativo del calendario
El calendario DEBE (MUST) informar el saldo más bajo esperado consolidado en la moneda de reporte, convirtiendo el saldo más bajo del día de cada moneda con la tasa de valoración vigente al consultar, dentro de la ventana de vigencia de Reporting, con su tipo, fuente y antigüedad; una moneda sin tasa vigente DEBE (MUST) excluirse y marcar el consolidado incompleto, NUNCA convertirse 1:1. El consolidado DEBE (MUST) redondearse HALF_EVEN solo al presentar y NO DEBE (MUST NOT) definir el riesgo de déficit, que es por moneda.
Trace: FR-REPORTING-014, FR-FX-006, FR-REPORTING-001 · Priority: Must

#### Scenario: BOB y USD consolidados
- **CUANDO** con los datos del saldo esperado de octubre y noviembre, "Caja USD" con 100.00 USD y "Spotify" de 5.99 USD del 2026-10-25, la tasa `PARALLEL` USD/BOB vigente es 12.00
- **ENTONCES** el saldo más bajo consolidado es 4949.12 BOB el 2026-10-28 con la tasa USD/BOB 12.00 y su fuente

#### Scenario: Sin tasa vigente
- **CUANDO** ninguna tasa USD/BOB está dentro de la ventana de vigencia
- **ENTONCES** el saldo más bajo consolidado es 3821.00 BOB el 2026-10-28 marcado incompleto, con USD como moneda no convertida

### Requirement: Cobertura de los compromisos en el horizonte
Cuando el horizonte termina después de la fecha hasta la que el motor de recurrencia genera ocurrencias, el calendario DEBE (MUST) informar la fecha de cobertura y marcarse con cobertura incompleta, sin inventar ocurrencias después de esa fecha.
Trace: FR-REPORTING-014, FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Horizonte de generación de 60 días
- **CUANDO** el horizonte de generación de ocurrencias es de 60 días y el 2026-10-20 se pide el calendario de 90 días
- **ENTONCES** el calendario va hasta el 2027-01-18 con cobertura hasta el 2026-12-19 marcada incompleta

### Requirement: Sugerencia de conversión ante un déficit cubrible
Cuando una moneda tiene riesgo `HIGH` y otra moneda tiene un saldo más bajo esperado por encima de su umbral que cubre el faltante convertido con la tasa de valoración vigente, el calendario PUEDE (MAY) sugerir convertir el equivalente aproximado antes de la primera fecha bajo el umbral, sin ejecutar ninguna acción; el monto sugerido DEBE (MUST) redondearse HALF_EVEN y rotularse como aproximado.
Trace: FR-REPORTING-015 · Priority: Could

#### Scenario: Convertir dólares antes del alquiler
- **CUANDO** con los datos de "Sueldo y alquiler el mismo día", una reserva mínima de 1500.00 BOB, "Caja USD" con 400.00 USD sin egresos y la tasa USD/BOB vigente 12.00
- **ENTONCES** el calendario sugiere convertir aproximadamente 181.58 USD a BOB antes del 2026-11-01

### Requirement: Saldo esperado y riesgo en la tarjeta de Q8
La tarjeta "¿Qué pagos vienen?" (Q8) del Home DEBE (MUST) mostrar, junto a los pagos de los próximos 7 días, el resultado del calendario de 30 días: la moneda con el riesgo más alto y su saldo más bajo esperado con fecha, o, si ninguna tiene riesgo, el saldo más bajo consolidado con fecha, con un enlace al calendario completo; sin cuentas líquidas la tarjeta NO DEBE (MUST NOT) mostrar saldo esperado ni riesgo.
Trace: FR-REPORTING-014, FR-REPORTING-015, FR-REPORTING-001 · Priority: Must

#### Scenario: Riesgo alto en el Home
- **CUANDO** el calendario de 30 días tiene riesgo `HIGH` en BOB con saldo más bajo −679.00 BOB el 2026-11-01 y riesgo `NONE` en USD
- **ENTONCES** la tarjeta de Q8 muestra riesgo alto en BOB con −679.00 BOB el 2026-11-01 y el enlace al calendario

#### Scenario: Sin riesgo en el Home
- **CUANDO** ninguna moneda tiene riesgo y el saldo más bajo consolidado es 4949.12 BOB el 2026-10-28
- **ENTONCES** la tarjeta de Q8 muestra 4949.12 BOB el 2026-10-28 como saldo más bajo esperado de los próximos 30 días

#### Scenario: Sin cuentas líquidas
- **CUANDO** el workspace solo tiene una tarjeta de crédito y definiciones recurrentes
- **ENTONCES** la tarjeta de Q8 lista los pagos sin saldo esperado ni riesgo

### Requirement: Detección periódica del riesgo de déficit
Un proceso del worker DEBE (MUST) evaluar al menos una vez por hora el calendario de 30 días de cada workspace con cuentas líquidas y, por cada moneda, abrir un episodio de riesgo cuando el riesgo pasa a `HIGH`, publicando el hecho de riesgo de déficit detectado una sola vez por episodio con la moneda, el saldo más bajo, su fecha, la primera fecha bajo el umbral, el umbral y si el saldo más bajo es negativo; mientras el riesgo siga `HIGH` NO DEBE (MUST NOT) publicarse otro hecho, y cuando una evaluación posterior da `NONE` o `LOW` el episodio DEBE (MUST) cerrarse publicando el hecho de riesgo resuelto. Los riesgos `POSSIBLE` y `LOW` NO DEBEN (MUST NOT) abrir episodios.
Trace: FR-REPORTING-015, FR-NOTIFY-004 · Priority: Must

#### Scenario: Primer riesgo alto
- **CUANDO** a las 08:25 del 2026-10-20 en La Paz la evaluación da riesgo `HIGH` en BOB con saldo más bajo −679.00 BOB el 2026-11-01 y umbral 1500.00 BOB
- **ENTONCES** se abre un episodio de BOB y se publica una vez el hecho de riesgo de déficit detectado

#### Scenario: Riesgo sostenido sin repetir
- **CUANDO** las evaluaciones de las 09:25 y las 10:25 siguen dando riesgo `HIGH` en BOB
- **ENTONCES** no se publica ningún hecho nuevo y el episodio sigue abierto

#### Scenario: Riesgo resuelto y nuevo episodio
- **CUANDO** el usuario registra un ingreso pendiente de 3000.00 BOB, la evaluación siguiente da riesgo `NONE` en BOB y días después otra evaluación vuelve a dar `HIGH`
- **ENTONCES** el primer episodio se cierra con el hecho de riesgo resuelto
- **Y** se abre un episodio nuevo con un hecho de riesgo detectado nuevo

#### Scenario: Riesgo posible sin episodio
- **CUANDO** la evaluación da riesgo `POSSIBLE` en BOB
- **ENTONCES** no se abre ningún episodio ni se publica ningún hecho

### Requirement: Frescura, lectura inmediata y acceso al calendario
El calendario DEBE (MUST) declarar el horizonte, la fecha de hoy, la moneda de reporte, el instante de generación y la frescura, DEBE (MUST) reflejar en la siguiente consulta toda acción del usuario sobre transacciones, ocurrencias o planes, y DEBE (MUST) poder consultarlo todo miembro del workspace, incluido el VIEWER, solo con datos de ese workspace.
Trace: FR-REPORTING-007, FR-REPORTING-014, FR-IDENTITY-006 · Priority: Must

#### Scenario: Ocurrencia omitida y consulta inmediata
- **CUANDO** con los datos del saldo esperado de octubre y noviembre el usuario omite "Luz" y consulta inmediatamente después
- **ENTONCES** el saldo esperado del 2026-10-28 es 4001.00 BOB y el saldo final 8380.50 BOB
- **Y** la respuesta indica el horizonte 2026-10-20 a 2026-11-19, la moneda de reporte BOB, el instante de generación y la frescura

#### Scenario: VIEWER y otro workspace
- **CUANDO** un VIEWER de "W1" pide el calendario de 30 días y "W2" tiene la ocurrencia "Hosting" de 80.00 BOB del 2026-10-23
- **ENTONCES** recibe el mismo calendario que el OWNER de "W1"
- **Y** el calendario no contiene "Hosting"

### Requirement: Rendimiento y métricas del calendario
El calendario de 90 días DEBERÍA (SHOULD) responder con un p95 de 500 ms o menos en un workspace con 40 cuentas líquidas y 300 ocurrencias no resueltas en el horizonte, leyendo directamente las fuentes de verdad, y DEBE (MUST) exponer la métrica de duración `reporting_cash_flow_calendar_duration_seconds` sin etiquetas de alta cardinalidad.
Trace: NFR-PERF-010, NFR-OBS-004 · Priority: Should

#### Scenario: Workspace grande
- **CUANDO** el workspace tiene 40 cuentas líquidas y 300 ocurrencias no resueltas en los próximos 90 días
- **ENTONCES** el p95 de `reporting_cash_flow_calendar_duration_seconds` del calendario de 90 días es como máximo 0.50 s
