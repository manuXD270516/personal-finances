# Spec Delta

## Purpose

Responde en el Home, con números honestos y explicables, las preguntas habilitadas en Phase 1: ¿cuánto dinero tengo?, ¿cuánto ingresó?, ¿cuánto gasté?, ¿cuánto ahorré? y ¿cómo estoy respecto al mes pasado?, por moneda original y consolidado en la moneda de reporte (BOB), valorando USD y USDT con la tasa paralela obtenida de los providers de mercado (con fallback a la tasa manual) e indicando siempre la tasa usada, su fuente con atribución y su antigüedad, sin inventar valores.

## ADDED Requirements

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
Cada pregunta del Home que aún no puede responderse (fase no habilitada o sin datos suficientes) DEBE (MUST) indicarlo explícitamente con la acción que la habilita y NO DEBE (MUST NOT) mostrar un número inventado ni un cero sustituto.
Trace: FR-REPORTING-001 · Priority: Must

#### Scenario: Pagos próximos aún no disponibles
- **CUANDO** el usuario abre el Home en Phase 1
- **ENTONCES** los widgets de pagos comprometidos, disponible para gastar, próximos pagos y metas indican que aún no están disponibles, sin montos

#### Scenario: Workspace sin cuentas
- **CUANDO** el workspace no tiene cuentas
- **ENTONCES** la pregunta "¿Cuánto dinero tengo?" indica que no hay cuentas y ofrece crear una, sin mostrar 0.00 BOB

### Requirement: Frescura y lectura inmediata del resumen
El resumen DEBE (MUST) declarar el periodo, la moneda de reporte, el instante de generación y la frescura de los datos, y DEBE (MUST) reflejar en la siguiente consulta toda transacción que el usuario acaba de postear.
Trace: FR-REPORTING-007, FR-REPORTING-002 · Priority: Must

#### Scenario: Gasto recién registrado
- **CUANDO** el usuario postea un gasto de 50.00 BOB y consulta el resumen inmediatamente después
- **ENTONCES** los gastos del mes incluyen los 50.00 BOB
- **Y** la respuesta indica periodo, moneda de reporte BOB, instante de generación y frescura
