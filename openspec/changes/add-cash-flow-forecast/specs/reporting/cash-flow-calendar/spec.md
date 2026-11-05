## ADDED Requirements

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
