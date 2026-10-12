## MODIFIED Requirements

### Requirement: Preguntas del Home sin datos o no disponibles
Cada pregunta del Home que aún no puede responderse (fase no habilitada o sin datos suficientes) DEBE (MUST) indicarlo explícitamente con la acción que la habilita y NO DEBE (MUST NOT) mostrar un número inventado ni un cero sustituto. Las preguntas "¿Cuánto está comprometido?" (Q4) y "¿Qué pagos vienen?" (Q8) se habilitan en Phase 3 y las responde la capability `reporting/cash-flow-calendar`; solo mientras el workspace no tiene cuentas, definiciones recurrentes activas ni transacciones pendientes de egreso declaran que no hay datos, con la acción de crear una cuenta o un compromiso. La pregunta "¿Voy a cumplir mis metas?" (Q9) se habilita en Phase 4 con las metas de ahorro; solo mientras el workspace no tiene metas activas, pausadas ni alcanzadas declara que no hay datos, con la acción de crear una meta. La pregunta "¿Cuánto puedo gastar?" (Q5) se habilita en Phase 4 con el disponible para gastar; solo mientras el workspace no tiene cuentas líquidas declara que no hay datos, con la acción de crear una cuenta.
Trace: FR-REPORTING-001 · Priority: Must

#### Scenario: Pagos próximos aún no disponibles
- **CUANDO** el usuario abre el Home con cuentas líquidas
- **ENTONCES** ninguna de las nueve preguntas se declara no disponible por fase
- **Y** las preguntas de comprometido (Q4) y próximos pagos (Q8) las responde `reporting/cash-flow-calendar` y la de disponible para gastar (Q5) muestra un monto

#### Scenario: Workspace sin cuentas
- **CUANDO** el workspace no tiene cuentas
- **ENTONCES** la pregunta "¿Cuánto dinero tengo?" indica que no hay cuentas y ofrece crear una, sin mostrar 0.00 BOB
- **Y** las preguntas de comprometido, próximos pagos y disponible para gastar indican que no hay datos y ofrecen crear la primera cuenta, sin montos

#### Scenario: Workspace sin metas
- **CUANDO** el workspace tiene cuentas pero ninguna meta activa, pausada ni alcanzada
- **ENTONCES** la pregunta "¿Voy a cumplir mis metas?" indica que no hay metas y ofrece crear una, sin mostrar 0 %

## ADDED Requirements

### Requirement: Disponible para gastar libre de compromisos
El Home DEBE (MUST) responder "¿Cuánto puedo gastar?" (Q5) para el periodo financiero que contiene hoy con el disponible para gastar, calculado por moneda como el saldo de las cuentas líquidas menos lo reservado por metas en ellas, menos lo comprometido pagadero desde cuentas líquidas, menos los aportes planificados pendientes a metas del periodo y menos la reserva mínima de liquidez del workspace, mostrando cada término por separado; los ingresos esperados NO DEBEN (MUST NOT) sumarse.
Trace: FR-PLANNING-024, FR-GOALS-009, FR-COMMITMENTS-011, FR-REPORTING-002 · Priority: Must

#### Scenario: Disponible de octubre
- **CUANDO** el 2026-10-20, con periodos que empiezan el día 1, las cuentas líquidas son "Banco BOB" 12000.00 BOB, "Efectivo BOB" 800.00 BOB y "Ahorro BOB" 3000.00 BOB; las metas reservan 3000.00 BOB de aportes reales en "Ahorro BOB" y 2000.00 BOB en "Banco BOB"; lo comprometido desde cuentas líquidas es 3179.00 BOB; "Fondo de emergencia" tiene 600.00 BOB pendientes de su aporte planificado del periodo; y la reserva mínima es 1500.00 BOB
- **ENTONCES** el disponible para gastar es 5521.00 BOB
- **Y** se muestran los términos 15800.00 BOB líquidos, −5000.00 BOB reservados para metas, −3179.00 BOB comprometidos, −600.00 BOB de aportes planificados y −1500.00 BOB de reserva mínima

#### Scenario: Ingreso esperado no suma
- **CUANDO** además existe la ocurrencia de ingreso "Sueldo" de 8000.00 BOB del 2026-10-30
- **ENTONCES** el disponible para gastar sigue siendo 5521.00 BOB

#### Scenario: Sin reserva mínima
- **CUANDO** el workspace no tiene reserva mínima de liquidez
- **ENTONCES** el disponible para gastar es 7021.00 BOB y no se muestra el término de reserva mínima

### Requirement: Compromisos descontados del disponible
El término comprometido del disponible DEBE (MUST) sumar, solo cuando se pagan desde una cuenta líquida: las ocurrencias de egreso no resueltas con vencimiento en el periodo (incluidas las vencidas del periodo, `MIN_MAX` por su máximo), las transferencias recurrentes no resueltas del periodo de una cuenta líquida a una no líquida (pagos de tarjeta y cuotas de préstamo incluidas), las transacciones pendientes de egreso con fecha hasta el fin del periodo y las ocurrencias vencidas de periodos anteriores aún sin resolver. NO DEBE (MUST NOT) sumar los egresos cargados a cuentas no líquidas (una compra con tarjeta se descuenta al pagar la tarjeta), las transferencias entre cuentas líquidas, las ocurrencias de compromisos administrados por una meta (se descuentan como aportes planificados) ni las ocurrencias sin monto, cuya cantidad DEBE (MUST) informarse.
Trace: FR-COMMITMENTS-011, FR-PLANNING-024, FR-REPORTING-016 · Priority: Must

#### Scenario: Comprometido desde cuentas líquidas
- **CUANDO** en el periodo "2026-10" quedan sin resolver "Internet" 199.00 BOB y "Luz" `ESTIMATED` 180.00 BOB desde "Banco BOB", la transferencia "Pago Tarjeta X" de 2500.00 BOB de "Banco BOB" a "Tarjeta X", "Netflix" 49.00 BOB cargado a "Tarjeta X" y "Agua" `VARIABLE` desde "Banco BOB", y la transacción pendiente "Cena" de 300.00 BOB es de "Banco BOB"
- **ENTONCES** el término comprometido es 3179.00 BOB
- **Y** no incluye "Netflix" e informa 1 pago sin monto no descontado

#### Scenario: Aporte programado de una meta contado una sola vez
- **CUANDO** además la ocurrencia "Aporte Fondo de emergencia" de 1500.00 BOB, de "Banco BOB" a "Plazo fijo" (no líquida) y administrada por la meta, vence el 2026-10-28, y el pendiente planificado de "Fondo de emergencia" del periodo es 1500.00 BOB
- **ENTONCES** el término comprometido sigue siendo 3179.00 BOB, el de aportes planificados es 1500.00 BOB y el disponible para gastar es 4621.00 BOB

#### Scenario: Vencido de un periodo anterior
- **CUANDO** además la ocurrencia "Seguro" de 120.00 BOB del 2026-09-28 desde "Banco BOB" sigue sin resolver
- **ENTONCES** el término comprometido es 3299.00 BOB y el disponible para gastar 5401.00 BOB

#### Scenario: Transferencia entre cuentas líquidas
- **CUANDO** existe la ocurrencia de transferencia "Ahorro mensual" de 500.00 BOB de "Banco BOB" a "Efectivo BOB", ambas líquidas, no administrada por una meta
- **ENTONCES** no suma al término comprometido

### Requirement: Reservas de metas descontadas del disponible
El término reservado para metas DEBE (MUST) sumar, por cada cuenta líquida, lo reservado por metas en ella (reservas vigentes y aportes reales que siguen en la cuenta, de metas activas, pausadas o alcanzadas) hasta un máximo igual a su saldo cuando el saldo es positivo, y cero cuando no lo es; lo reservado sobre cuentas no líquidas NO DEBE (MUST NOT) descontarse.
Trace: FR-GOALS-004, FR-GOALS-002, FR-PLANNING-024 · Priority: Must

#### Scenario: Cuenta sobre-asignada descuenta como máximo su saldo
- **CUANDO** la única cuenta líquida es "Banco BOB" con 1500.00 BOB y reservas de metas por 2000.00 BOB, sin compromisos, aportes planificados ni reserva mínima
- **ENTONCES** el término reservado para metas es 1500.00 BOB y el disponible para gastar es 0.00 BOB

#### Scenario: Reserva sobre una cuenta no líquida
- **CUANDO** además hay 4000.00 BOB reservados para "Auto" en "Inversión", una cuenta no líquida
- **ENTONCES** el término reservado para metas sigue siendo 1500.00 BOB

### Requirement: Aportes planificados pendientes a metas descontados
El término de aportes planificados DEBE (MUST) sumar, por moneda de la meta, el pendiente del periodo (planificado menos aportado neto, no negativo) de cada meta activa con aporte mensual planificado; las metas pausadas, alcanzadas, cerradas o canceladas NO DEBEN (MUST NOT) sumar.
Trace: FR-GOALS-009, FR-PLANNING-024 · Priority: Should

#### Scenario: Aporte parcial del periodo
- **CUANDO** "Fondo de emergencia" planifica 1500.00 BOB por mes y lleva aportados 900.00 BOB en "2026-10", y "Laptop" planifica 800.00 BOB pero está pausada
- **ENTONCES** el término de aportes planificados es 600.00 BOB

### Requirement: Disponible por moneda y consolidado
El disponible para gastar DEBE (MUST) calcularse por moneda (agregando cada término por moneda antes de convertir) y consolidarse en la moneda de reporte con la tasa de valoración vigente al consultar, con su tipo, fuente y antigüedad; una moneda sin tasa vigente DEBE (MUST) mostrarse sin convertir y el consolidado marcarse incompleto, NUNCA convertirse 1:1; el consolidado DEBE (MUST) redondearse HALF_EVEN solo al presentar. Si una moneda queda negativa mientras el consolidado es positivo, el Home DEBE (MUST) indicar el faltante en esa moneda y que conviene convertir.
Trace: FR-REPORTING-001, FR-FX-006, FR-PLANNING-024 · Priority: Must

#### Scenario: BOB y USD consolidados
- **CUANDO** además "Caja USD" es líquida con 50.00 USD, "Spotify" de 5.99 USD se paga desde "Caja USD" en el periodo y la tasa `PARALLEL` USD/BOB vigente es 12.00
- **ENTONCES** el disponible es 5521.00 BOB y 44.01 USD, y el consolidado 6049.12 BOB con la tasa 12.00 y su fuente

#### Scenario: Sin tasa vigente
- **CUANDO** ninguna tasa USD/BOB está dentro de la ventana de vigencia
- **ENTONCES** el consolidado es 5521.00 BOB marcado incompleto, con 44.01 USD sin convertir

#### Scenario: Faltante en BOB con excedente en USD
- **CUANDO** el disponible es −200.00 BOB y 100.00 USD, con tasa USD/BOB 12.00
- **ENTONCES** el consolidado es 1000.00 BOB
- **Y** el Home indica que en BOB faltan 200.00 BOB y que conviene convertir

### Requirement: Disponible negativo explicado
Un disponible para gastar consolidado negativo DEBE (MUST) mostrarse con su valor y signo, marcado como alerta y con el desglose de los términos; NO DEBE (MUST NOT) mostrarse como 0.00 ni ocultarse.
Trace: FR-REPORTING-001, FR-PLANNING-024 · Priority: Must

#### Scenario: Más comprometido que líquido
- **CUANDO** las cuentas líquidas suman 2000.00 BOB, lo comprometido desde ellas es 2600.00 BOB y no hay reservas, aportes planificados ni reserva mínima
- **ENTONCES** el disponible para gastar es −600.00 BOB, marcado como alerta, con el desglose 2000.00 BOB líquidos y −2600.00 BOB comprometidos

### Requirement: Disponible según el presupuesto del periodo
Junto al disponible libre de compromisos, el Home DEBE (MUST) mostrar el disponible para gastar del plan del periodo (suma de restantes no negativos de sus líneas de gasto, `planning/budgets`) como segunda vista, rotulada como "según tu presupuesto"; sin plan del periodo DEBE (MUST) indicar que no hay plan y ofrecer crearlo, sin mostrar 0.00 y sin dejar de mostrar la primera vista.
Trace: FR-PLANNING-024 · Priority: Should

#### Scenario: Las dos vistas
- **CUANDO** el plan de "2026-10" tiene un disponible para gastar de 3750.00 BOB y el disponible libre de compromisos es 5521.00 BOB
- **ENTONCES** el Home muestra 5521.00 BOB y, como segunda vista, 3750.00 BOB según el presupuesto

#### Scenario: Periodo sin plan
- **CUANDO** el periodo "2026-10" no tiene plan
- **ENTONCES** la segunda vista indica que no hay presupuesto del periodo y ofrece crearlo
- **Y** el Home sigue mostrando 5521.00 BOB

### Requirement: Periodo del disponible en la zona del workspace
El periodo del disponible para gastar DEBE (MUST) ser el periodo financiero que contiene la fecha de hoy en la zona horaria del workspace, según el día de inicio del mes financiero; las ocurrencias con vencimiento posterior al fin de ese periodo NO DEBEN (MUST NOT) descontarse.
Trace: FR-PLANNING-024, NFR-USAB-004 · Priority: Must

#### Scenario: Mes financiero que empieza el día 25
- **CUANDO** el día de inicio es 25, hoy es 2026-10-20 (periodo del 2026-09-25 al 2026-10-24) y, con los datos del disponible de octubre, "Pago Tarjeta X" vence el 2026-10-25 y "Luz" el 2026-10-28
- **ENTONCES** el término comprometido es 499.00 BOB y el disponible para gastar 8201.00 BOB

### Requirement: Frescura y lectura inmediata del disponible
El disponible para gastar DEBE (MUST) declarar el periodo, la moneda de reporte, el instante de generación y la frescura, y DEBE (MUST) reflejar en la siguiente consulta toda acción del usuario sobre cuentas, transacciones, ocurrencias, metas o el plan del periodo.
Trace: FR-REPORTING-007, FR-PLANNING-024 · Priority: Must

#### Scenario: Reserva recién registrada
- **CUANDO** el disponible es 5521.00 BOB y el EDITOR reserva 500.00 BOB de "Banco BOB" para "Laptop" y consulta inmediatamente después
- **ENTONCES** el disponible para gastar es 5021.00 BOB
- **Y** la respuesta indica el periodo "2026-10", la moneda BOB, el instante de generación y la frescura

### Requirement: Disponible para todos los miembros y aislado por workspace
Todo miembro del workspace, incluido el VIEWER, DEBE (MUST) poder consultar el disponible para gastar con su desglose, que DEBE (MUST) contener solo datos de ese workspace.
Trace: FR-IDENTITY-006, FR-REPORTING-001 · Priority: Must

#### Scenario: VIEWER consulta
- **CUANDO** un VIEWER de "W1" abre el Home
- **ENTONCES** ve el mismo disponible para gastar y el mismo desglose que el OWNER

#### Scenario: Otro workspace aislado
- **CUANDO** "W2" tiene una reserva de 1000.00 BOB y un miembro de "W1" consulta su disponible
- **ENTONCES** el disponible de "W1" no cambia por los datos de "W2"

### Requirement: Rendimiento y métricas del disponible
El cálculo del disponible para gastar DEBE (MUST) leer directamente los contratos de Ledger, Accounts, Commitments, Transactions, Goals, Planning, Identity y FX dentro del presupuesto del Home (p95 ≤ 300 ms) y exponer la métrica de duración `reporting_spendable_duration_seconds` sin etiquetas de alta cardinalidad.
Trace: NFR-PERF-004, NFR-OBS-004 · Priority: Should

#### Scenario: Workspace grande
- **CUANDO** el workspace tiene 40 cuentas, 300 ocurrencias no resueltas en el periodo y 20 metas
- **ENTONCES** el p95 de `reporting_spendable_duration_seconds` es como máximo 0.30 s
