# reporting/dashboard Specification

## Purpose
Responde en el Home, con números honestos y explicables, las preguntas habilitadas en Phase 1: ¿cuánto dinero tengo?, ¿cuánto ingresó?, ¿cuánto gasté?, ¿cuánto ahorré? y ¿cómo estoy respecto al mes pasado?, por moneda original y consolidado en la moneda de reporte (BOB), valorando USD y USDT con la tasa paralela obtenida de los providers de mercado (con fallback a la tasa manual) e indicando siempre la tasa usada, su fuente con atribución y su antigüedad, sin inventar valores.

## Requirements

### Requirement: Saldos por cuenta y totales por moneda
El resumen DEBE (MUST) mostrar el saldo de cada cuenta no archivada (activa o cerrada) en su moneda original, calculado solo con transacciones posteadas, conciliadas o reconciliadas, y el total por moneda sin conversión.
Trace: FR-REPORTING-003, FR-LEDGER-012 · Priority: Must

#### Scenario: Tres cuentas en dos monedas
- **CUANDO** "Banco BOB" tiene 685.00 BOB, "Caja BOB" 120.50 BOB y "Wallet USDT" 50.000000 USDT
- **ENTONCES** el resumen lista cada cuenta con esos saldos
- **Y** los totales por moneda son 805.50 BOB y 50.000000 USDT

#### Scenario: Gasto pendiente no altera el saldo
- **CUANDO** existe un gasto pendiente de 30.00 BOB en "Banco BOB"
- **ENTONCES** el saldo mostrado de "Banco BOB" sigue siendo 685.00 BOB

#### Scenario: Cuenta cerrada incluida y archivada excluida
- **CUANDO** además existen "Banco Viejo" cerrada con saldo 0.00 BOB y "Caja Antigua" archivada con saldo 0.00 BOB
- **ENTONCES** el resumen lista "Banco Viejo" con 0.00 BOB y su estado cerrada
- **Y** no lista "Caja Antigua" y los totales por moneda siguen siendo 805.50 BOB y 50.000000 USDT

### Requirement: Dinero disponible consolidado en la moneda de reporte
El resumen DEBE (MUST) mostrar el dinero disponible como la suma de los saldos de las cuentas no archivadas de naturaleza activo con liquidez `LIQUID`, convertida a la moneda de reporte con la tasa vigente a la fecha del tipo preferido del par; para USD/BOB y USDT/BOB el tipo por defecto es `PARALLEL` y DEBE (MUST) usarse la última tasa no obsoleta del provider de mercado; para cada moneda DEBE (MUST) indicarse la tasa, su tipo, su fuente con la atribución del provider, su instante de vigencia y su antigüedad.
Trace: FR-REPORTING-003, FR-REPORTING-002, FR-FX-006, FR-FX-010, FR-FX-014, FR-ACCOUNTS-011 · Priority: Must

#### Scenario: BOB y USDT consolidados
- **CUANDO** las cuentas líquidas suman 805.50 BOB y 50.000000 USDT, la última tasa `PARALLEL` USDT/BOB de paralelo.bo es 12.02 con vigencia 2026-09-30T21:53:07Z y se consulta el 2026-09-30T18:00:00-04:00
- **ENTONCES** el dinero disponible consolidado es 1406.50 BOB
- **Y** se informa la tasa USDT/BOB 12.02 `PARALLEL` con "Fuente: paralelo.bo", su vigencia 2026-09-30T21:53:07Z y una antigüedad de 6 minutos

#### Scenario: Cuenta no líquida excluida
- **CUANDO** además existe una cuenta de inversión no líquida con 5000.00 BOB
- **ENTONCES** el dinero disponible sigue siendo 1406.50 BOB

### Requirement: Valoración de USD y USDT con fallback a la última tasa conocida o manual
Si no hay tasa `PARALLEL` no obsoleta de ningún provider para USD/BOB o USDT/BOB, el resumen DEBE (MUST) valorar con la tasa más reciente dentro de la ventana de vigencia entre la última de provider, marcada como obsoleta con su antigüedad, y la última tasa manual del par, indicando su origen y su tipo; una tasa manual de un tipo distinto del preferido solo DEBE (MUST) competir si es fresca (no más antigua que el máximo de frescura de manuales) y confiable (no reemplazada, no anómala y con desvío de hasta 5 % frente a la última tasa de provider aceptada del tipo preferido); NO DEBE (MUST NOT) dejar de mostrar el consolidado por la caída de un provider.
Trace: FR-REPORTING-003, FR-FX-010, FR-FX-006 · Priority: Must

#### Scenario: Providers caídos con última tasa obsoleta
- **CUANDO** los providers fallan desde el 2026-09-30T14:00:00Z, la última tasa `PARALLEL` USDT/BOB es 12.02 de paralelo.bo con vigencia 2026-09-30T13:53:07Z, no hay tasas manuales posteriores y se consulta el 2026-09-30T18:00:00-04:00
- **ENTONCES** el dinero disponible consolidado es 1406.50 BOB
- **Y** la tasa 12.02 se muestra marcada como obsoleta con una antigüedad de 8 horas y "Fuente: paralelo.bo"

#### Scenario: Tasa manual más reciente que la de provider
- **CUANDO** los providers fallan desde el 2026-09-30T14:00:00Z y el usuario registró a las 2026-09-30T20:00:00Z la tasa manual USDT/BOB `P2P` 11.98 con fuente "Casa de cambio centro"
- **Y** se consulta el 2026-09-30T18:00:00-04:00
- **ENTONCES** el dinero disponible consolidado es 1404.50 BOB (805.50 + 50.000000 × 11.98)
- **Y** se informa la tasa manual 11.98 `P2P` con fuente "Casa de cambio centro" y origen manual

#### Scenario: Tasa manual de otro tipo no fresca descartada
- **CUANDO** los providers fallan desde el 2026-09-29T14:00:00Z, la última tasa `PARALLEL` USDT/BOB es 12.02 de paralelo.bo con vigencia 2026-09-29T13:53:07Z, el máximo de frescura de manuales es 24 horas y la única tasa manual es USDT/BOB `P2P` 11.98 registrada el 2026-09-29T15:00:00Z (más reciente que la de provider, pero con 31 horas de antigüedad)
- **Y** se consulta el 2026-09-30T18:00:00-04:00
- **ENTONCES** el dinero disponible consolidado es 1406.50 BOB con la tasa 12.02 de paralelo.bo marcada como obsoleta
- **Y** la tasa manual `P2P` 11.98 no se usa

#### Scenario: Tasa manual de otro tipo con desvío excesivo descartada
- **CUANDO** los providers fallan desde el 2026-09-30T14:00:00Z, la última tasa `PARALLEL` USDT/BOB es 12.02 de paralelo.bo con vigencia 2026-09-30T13:53:07Z y el usuario registró a las 2026-09-30T20:00:00Z la tasa manual USDT/BOB `P2P` 11.00 (desvío de 8.49 %)
- **Y** se consulta el 2026-09-30T18:00:00-04:00
- **ENTONCES** el dinero disponible consolidado es 1406.50 BOB con la tasa 12.02 de paralelo.bo marcada como obsoleta
- **Y** la tasa manual `P2P` 11.00 no se usa

### Requirement: Montos sin tasa vigente se muestran sin convertir
Si una moneda no tiene tasa hacia la moneda de reporte dentro de la ventana de vigencia, el resumen DEBE (MUST) mostrar esos saldos en su moneda original, excluirlos del consolidado, marcar el consolidado como incompleto y advertirlo con la acción de registrar la tasa; NO DEBE (MUST NOT) convertir con 1:1 ni con una tasa fuera de la ventana.
Trace: FR-REPORTING-001, FR-FX-004, FR-FX-006 · Priority: Must

#### Scenario: BTC sin tasa
- **CUANDO** además de 805.50 BOB y 50.000000 USDT existe "Wallet BTC" con 0.01000000 BTC y no hay tasa BTC/BOB vigente
- **ENTONCES** el consolidado es 1406.50 BOB marcado como incompleto
- **Y** se muestra 0.01000000 BTC como monto no convertido con la advertencia de registrar la tasa

#### Scenario: Tasa fuera de la ventana
- **CUANDO** la última tasa USDT/BOB de cualquier origen (provider o manual) es del 2026-09-20 y se consulta el 2026-09-30 con ventana de 7 días
- **ENTONCES** los 50.000000 USDT se muestran sin convertir y el consolidado es 805.50 BOB marcado como incompleto

### Requirement: Ingresos del mes
El resumen DEBE (MUST) informar los ingresos del mes como la suma de las partes de ingreso de las transacciones del mes, excluyendo transferencias, conversiones, saldos iniciales, ajustes y reembolsos.
Trace: FR-REPORTING-004, FR-REPORTING-002 · Priority: Must

#### Scenario: Solo el salario cuenta como ingreso
- **CUANDO** en septiembre 2026 se registran un salario de 8000.00 BOB, una transferencia de 1000.00 BOB entre cuentas propias, la conversión de 100.000000 USDT a 685.00 BOB y un saldo inicial de 500.00 BOB
- **ENTONCES** los ingresos de septiembre son 8000.00 BOB

### Requirement: Gastos del mes netos de reembolsos
El resumen DEBE (MUST) informar los gastos del mes como la suma de las partes de gasto del mes, incluidas las comisiones de conversión, menos los reembolsos del mes; NO DEBE (MUST NOT) incluir transferencias ni pagos de tarjeta de crédito.
Trace: FR-REPORTING-004, FR-TRANSACTIONS-016, FR-TRANSACTIONS-023 · Priority: Must

#### Scenario: Gastos con reembolso, fee y pago de tarjeta
- **CUANDO** en septiembre 2026 hay gastos de 1200.00 BOB (Supermercado) y 300.00 BOB (Restaurantes), un reembolso de 200.00 BOB de Restaurantes, un fee de conversión de 5.00 BOB y un pago de tarjeta de 400.00 BOB
- **ENTONCES** los gastos de septiembre son 1305.00 BOB

#### Scenario: Reembolso mayor que el gasto de la categoría
- **CUANDO** en el mes la categoría Restaurantes tiene 50.00 BOB de gasto y 80.00 BOB de reembolso
- **ENTONCES** la categoría se informa con −30.00 BOB como neto negativo, sin ocultarlo

### Requirement: Flujos convertidos con la tasa de su fecha
Los ingresos y gastos DEBEN (MUST) informarse por moneda original y, consolidados, convertidos con la tasa vigente a la fecha de cada transacción; una tasa registrada después NO DEBE (MUST NOT) cambiar los totales de meses anteriores.
Trace: FR-REPORTING-004, FR-FX-006 · Priority: Must

#### Scenario: Gasto en USD y en BOB
- **CUANDO** en septiembre hay un gasto de 20.00 USD el 2026-09-10 (tasa `PARALLEL` USD/BOB 11.96 de paralelo.bo vigente al cierre de ese día) y otro de 100.00 BOB
- **ENTONCES** los gastos por moneda son 20.00 USD y 100.00 BOB
- **Y** el consolidado es 339.20 BOB

#### Scenario: Tasa nueva posterior
- **CUANDO** luego el provider registra USD/BOB `PARALLEL` 12.02 para el 2026-10-02
- **ENTONCES** el consolidado de gastos de septiembre sigue siendo 339.20 BOB

### Requirement: Ahorro del mes y tasa de ahorro
El resumen DEBE (MUST) informar el ahorro del mes como ingresos menos gastos y la tasa de ahorro como ahorro dividido por ingresos con un decimal; si los ingresos del mes son cero, la tasa DEBE (MUST) mostrarse como no definida, nunca como 0 % ni infinito.
Trace: FR-REPORTING-002 · Priority: Must

#### Scenario: Mes con ingresos
- **CUANDO** los ingresos del mes son 8000.00 BOB y los gastos 1305.00 BOB
- **ENTONCES** el ahorro es 6695.00 BOB y la tasa de ahorro 83.7 %

#### Scenario: Mes sin ingresos
- **CUANDO** los ingresos del mes son 0.00 BOB y los gastos 300.00 BOB
- **ENTONCES** el ahorro es −300.00 BOB y la tasa de ahorro se muestra como "—"

### Requirement: Solo transacciones posteadas en las cifras
Las cifras del resumen DEBEN (MUST) considerar solo transacciones en estado posteada, conciliada o reconciliada; las pendientes y las anuladas NO DEBEN (MUST NOT) sumar en saldos, ingresos, gastos ni categorías.
Trace: FR-REPORTING-002, FR-TRANSACTIONS-006 · Priority: Must

#### Scenario: Pendiente y anulada excluidas
- **CUANDO** en el mes hay un gasto posteado de 1200.00 BOB, uno conciliado de 100.00 BOB, uno pendiente de 300.00 BOB y uno anulado de 50.00 BOB
- **ENTONCES** los gastos del mes son 1300.00 BOB

### Requirement: Principales categorías de gasto del mes
El resumen DEBE (MUST) listar las N categorías con mayor gasto neto del mes (por defecto 5, máximo 20), en la moneda de reporte, ordenadas de mayor a menor y con desempate por nombre.
Trace: FR-REPORTING-004 · Priority: Must

#### Scenario: Top 2 categorías
- **CUANDO** el mes tiene Supermercado 1200.00 BOB, Restaurantes 100.00 BOB (neto de reembolso), Transporte 80.00 BOB y Fees 5.00 BOB, y se piden 2 categorías
- **ENTONCES** se listan Supermercado 1200.00 BOB y Restaurantes 100.00 BOB en ese orden

### Requirement: Comparación básica con el mes anterior
El resumen DEBE (MUST) comparar ingresos, gastos y ahorro con el mes anterior en valor absoluto y porcentaje; para el mes en curso la comparación DEBE (MUST) ser a la misma fecha (días 1 a N de ambos meses); si el valor anterior es cero, la variación porcentual se informa como "nuevo".
Trace: FR-REPORTING-004, FR-REPORTING-018 · Priority: Must

#### Scenario: Gastos a la fecha contra agosto
- **CUANDO** el 2026-09-15 los gastos del 1 al 15 de septiembre son 1305.00 BOB y los del 1 al 15 de agosto fueron 1200.00 BOB
- **ENTONCES** la variación de gastos es +105.00 BOB y +8.75 %, indicada como aumento de gasto

#### Scenario: Sin ingresos en el mes anterior
- **CUANDO** los ingresos del mes anterior fueron 0.00 BOB y los del mes actual 8000.00 BOB
- **ENTONCES** la variación es +8000.00 BOB y la porcentual se muestra como "nuevo"

### Requirement: Mes según la fecha de negocio en la zona del workspace
La pertenencia de una transacción a un mes DEBE (MUST) determinarse por su fecha de negocio interpretada en la zona horaria del workspace (por defecto America/La_Paz), no por el instante de registro en UTC.
Trace: FR-REPORTING-004, NFR-USAB-004 · Priority: Must

#### Scenario: Gasto de fin de mes registrado de madrugada en UTC
- **CUANDO** un gasto de 150.00 BOB con fecha de negocio 2026-09-30 se registra el 2026-10-01T02:30:00Z
- **ENTONCES** cuenta en los gastos de septiembre y no en los de octubre

### Requirement: Redondeo solo al presentar
Los consolidados DEBEN (MUST) calcularse sin redondeo intermedio, agregando por moneda antes de convertir, y redondearse HALF_EVEN a la escala de la moneda de reporte solo al presentar.
Trace: FR-REPORTING-003, NFR-DATA-002 · Priority: Must

#### Scenario: Dos wallets USDT
- **CUANDO** dos cuentas líquidas tienen 33.333333 USDT cada una y la tasa USDT/BOB es 12.02
- **ENTONCES** el consolidado de esas cuentas es 801.33 BOB (66.666666 × 12.02 = 801.33332532)
- **Y** no 801.34 BOB, que resultaría de sumar 400.67 BOB redondeados por cuenta

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

### Requirement: Frescura y lectura inmediata del resumen
El resumen DEBE (MUST) declarar el periodo, la moneda de reporte, el instante de generación y la frescura de los datos, y DEBE (MUST) reflejar en la siguiente consulta toda transacción que el usuario acaba de postear.
Trace: FR-REPORTING-007, FR-REPORTING-002 · Priority: Must

#### Scenario: Gasto recién registrado
- **CUANDO** el usuario postea un gasto de 50.00 BOB y consulta el resumen inmediatamente después
- **ENTONCES** los gastos del mes incluyen los 50.00 BOB
- **Y** la respuesta indica periodo, moneda de reporte BOB, instante de generación y frescura

### Requirement: Principales categorías de ingreso del mes
El resumen DEBE (MUST) listar también las N categorías con mayor ingreso neto del mes (mismo N, orden descendente y desempate por nombre que el top de gasto), en la moneda de reporte, en la misma respuesta.
Trace: FR-REPORTING-004 · Priority: Must

#### Scenario: Salario y freelance
- **CUANDO** el mes tiene Salario 8000.00 BOB y Freelance 1500.00 BOB de ingresos y Supermercado 1200.00 BOB de gasto
- **ENTONCES** el top de ingresos lista Salario 8000.00 BOB y Freelance 1500.00 BOB en ese orden y el top de gastos solo Supermercado

### Requirement: Monto anterior por categoría del top
Cada categoría de los tops de gasto e ingreso DEBE (MUST) traer su neto en el periodo de comparación (cero si no tuvo flujos), convertido con la tasa de la fecha de cada flujo; sin comparación, o si algún monto anterior queda sin tasa, el monto anterior DEBE (MUST) informarse como no disponible (nunca inventado).
Trace: FR-REPORTING-004 · Priority: Must

#### Scenario: Supermercado contra el mismo tramo de agosto
- **CUANDO** el 2026-09-15 Supermercado suma 1305.00 BOB del 1 al 15 de septiembre y 1200.00 BOB del 1 al 15 de agosto, y Fees 5.00 BOB solo en septiembre
- **ENTONCES** Supermercado trae 1200.00 BOB como monto anterior y Fees 0.00 BOB

### Requirement: Metas en curso en el Home
El Home DEBE (MUST) responder "¿Voy a cumplir mis metas?" (Q9) con hasta 3 metas `active`, `paused` o `achieved` no archivadas, ordenadas por prioridad y luego por fecha objetivo (las que no tienen fecha al final), cada una con porcentaje completado, saldo acumulado y objetivo, estado de avance o de ciclo de vida, aporte mensual requerido y fecha esperada cuando existan, y la marca de sobre-asignada; DEBE (MUST) indicar cuántas metas más hay y enlazar a la vista de metas, con los mismos cálculos que la capability `goals/savings-goals`.
Trace: FR-REPORTING-001, FR-REPORTING-002, FR-GOALS-003 · Priority: Must

#### Scenario: Cuatro metas activas
- **CUANDO** el workspace tiene "Fondo de emergencia" (prioridad 1, 33.33 %, `behind`), "Viaje a Cusco" (prioridad 2, 45.00 %), "Laptop" (prioridad 2, sin fecha objetivo, 22.22 %) y "Auto" (prioridad 3)
- **ENTONCES** la tarjeta de Q9 muestra "Fondo de emergencia", "Viaje a Cusco" y "Laptop" en ese orden, indica 1 meta más y enlaza a la vista de metas
- **Y** "Fondo de emergencia" muestra 33.33 %, `behind`, el aporte mensual requerido y la fecha esperada

#### Scenario: Meta sobre-asignada en el Home
- **CUANDO** "Laptop" está marcada sobre-asignada
- **ENTONCES** la tarjeta de Q9 muestra "Laptop" con la marca de sobre-asignada

### Requirement: Aportes a metas del mes en el ahorro
Junto al ahorro del mes (Q6), el Home DEBE (MUST) informar los aportes netos a metas del periodo (aportes y reservas menos retiros, liberaciones e inversos con fecha en el periodo, sin contar reasignaciones), por moneda y consolidados en la moneda de reporte con la tasa de la fecha de cada movimiento, sin cambiar el cálculo del ahorro ni de la tasa de ahorro.
Trace: FR-REPORTING-002, FR-GOALS-003 · Priority: Should

#### Scenario: Aportes de octubre
- **CUANDO** en el periodo "2026-10" hubo un aporte real de 1000.00 BOB, una reserva de 2000.00 BOB, una liberación de 500.00 BOB y una reasignación de 1000.00 BOB entre dos metas
- **ENTONCES** los aportes netos a metas del mes son 2500.00 BOB
- **Y** el ahorro y la tasa de ahorro del mes no cambian

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
