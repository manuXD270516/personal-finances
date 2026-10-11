# reporting/cash-flow-calendar Specification

## Purpose
Responde en el Home, en su versión simple de Phase 3 (sin calendario), "¿Qué pagos vienen?" (Q8) y "¿Cuánto está comprometido?" (Q4): la lista de próximos pagos conocidos (ocurrencias recurrentes no resueltas y transacciones pendientes de egreso), el total comprometido del periodo financiero, el saldo proyectado por cuenta (saldo contable más pendientes) y un indicador de pagos sorpresa por periodo, con montos honestos según el tipo de monto y valorados en la moneda de reporte sin inventar tasas. El calendario de flujo de caja con saldo esperado diario y riesgo de déficit (FR-REPORTING-014/015) llega en Phase 7.

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
