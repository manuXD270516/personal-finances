## ADDED Requirements

### Requirement: Catálogo de reportes con su disponibilidad
El sistema DEBE (MUST) exponer el catálogo de los 16 reportes de Reporting con su número, nombre, propósito y estado: disponible, parcial (otra vista existente cubre parte del reporte y se enlaza) o planificado (con la fase o el change en que llega). Un reporte planificado NO DEBE (MUST NOT) mostrar cifras, gráficos ni ceros de relleno.
Trace: FR-REPORTING-008, FR-REPORTING-001 · Priority: Must

#### Scenario: Catálogo al terminar este change
- **CUANDO** un miembro consulta el catálogo de reportes
- **ENTONCES** recibe 16 reportes, con "Ingresos vs gastos", "Presupuesto vs real", "Gastos por categoría", "Flujo de caja", "Patrimonio neto" e "Historial de saldo de cuenta" disponibles
- **Y** "Pronóstico vs real" figura como planificado para Phase 8, sin cifras

#### Scenario: Reporte cubierto en parte por una vista existente
- **CUANDO** el reporte "Conversiones de moneda y cripto" aún no está completo y existe la vista de costo de conversiones
- **ENTONCES** el catálogo lo informa como parcial con el enlace a esa vista

### Requirement: Filtros comunes de los reportes
Todo reporte basado en flujos DEBE (MUST) aceptar los filtros de rango de fechas, cuentas, monedas, categorías (una categoría incluye sus subcategorías), etiquetas (coincidencia con cualquiera) y contrapartes, y DEBE (MUST) aplicar los mismos filtros a cada lado de una comparación y a su drill-down. Un filtro con un identificador de otro workspace o inexistente NO DEBE (MUST NOT) revelar su existencia y no coincide con ningún movimiento.
Trace: FR-REPORTING-008, FR-REPORTING-010 · Priority: Must

#### Scenario: Filtro por cuenta
- **CUANDO** en 2026-10 se gastaron 3300.00 BOB desde "Banco BOB" y 500.00 BOB con "Tarjeta Andina" y se pide el reporte de ingresos y gastos filtrado por "Tarjeta Andina"
- **ENTONCES** el gasto de 2026-10 es 500.00 BOB

#### Scenario: Filtro por categoría con subcategorías
- **CUANDO** "Supermercado" tiene la subcategoría "Mayorista" con 1000.00 BOB de gasto y "Supermercado" tiene 2300.00 BOB propios en 2026-10, y se filtra por "Supermercado"
- **ENTONCES** el gasto de 2026-10 es 3300.00 BOB

### Requirement: Periodos de los reportes
Los reportes temporales DEBEN (MUST) agrupar por periodo financiero del workspace por defecto o por mes calendario si se pide, asignando cada movimiento por su fecha de negocio en la zona horaria del workspace; el rango NO DEBE (MUST NOT) superar 24 periodos y un rango mayor DEBE (MUST) rechazarse con `VALIDATION_FAILED`. El periodo que contiene hoy DEBE (MUST) marcarse como parcial.
Trace: FR-REPORTING-009, FR-PLANNING-001 · Priority: Must

#### Scenario: Mes financiero que empieza el día 25
- **CUANDO** el mes financiero del workspace empieza el día 25 y hay un gasto de 120.00 BOB con fecha de negocio 2026-10-27
- **ENTONCES** por periodo financiero el gasto pertenece al periodo del 2026-10-25 al 2026-11-24
- **Y** por mes calendario pertenece a octubre de 2026

#### Scenario: Rango de 25 periodos
- **CUANDO** se pide un reporte mensual desde 2024-10 hasta 2026-10
- **ENTONCES** la petición se rechaza con `VALIDATION_FAILED`

### Requirement: Reglas de flujos comunes a los reportes
Los reportes de ingresos y gastos DEBEN (MUST) contar solo movimientos de transacciones posteadas, conciliadas o confirmadas; NO DEBEN (MUST NOT) contar como ingreso ni gasto el principal de transferencias, conversiones, pagos de tarjeta ni pagos de principal de préstamos, ni saldos iniciales, ajustes o transacciones pendientes; DEBEN (MUST) contar como gasto las comisiones de transferencias y conversiones y los intereses y cargos de préstamos; y un reembolso DEBE (MUST) restar del gasto de su categoría en el periodo de la fecha del reembolso.
Trace: FR-REPORTING-008, FR-TRANSACTIONS-016 · Priority: Must

#### Scenario: Movimientos que no son ingreso ni gasto
- **CUANDO** en 2026-10 hay un sueldo de 12000.00 BOB, una transferencia de 1000.00 BOB a "Plazo fijo", un pago de tarjeta de 500.00 BOB, una conversión de 100.000000 USDT a 1190.00 BOB con comisión de 2.00 BOB y un gasto pendiente de 300.00 BOB
- **ENTONCES** el ingreso de 2026-10 es 12000.00 BOB y el gasto es 2.00 BOB en la categoría de comisiones

#### Scenario: Reembolso en el mes siguiente
- **CUANDO** un gasto de 400.00 BOB en "Supermercado" es del 2026-09-28 y su reembolso de 400.00 BOB es del 2026-10-02
- **ENTONCES** "Supermercado" suma 400.00 BOB en 2026-09 y −400.00 BOB en 2026-10

### Requirement: Reporte de ingresos y gastos
El sistema DEBE (MUST) informar por cada periodo del rango (o por semana ISO de lunes a domingo si se pide) el ingreso, el gasto, el ahorro (ingreso menos gasto) y la tasa de ahorro (ahorro sobre ingreso, en porcentaje con 1 decimal HALF_EVEN), por moneda nativa y consolidados en la moneda de reporte. Con ingreso cero o negativo la tasa de ahorro DEBE (MUST) informarse como sin definir, nunca como 0 % ni como un valor infinito.
Trace: FR-REPORTING-008 · Priority: Must

#### Scenario: Octubre con un gasto en dólares
- **CUANDO** en 2026-10 de un workspace con moneda de reporte BOB hubo un sueldo de 12000.00 BOB, gastos de 3500.00 BOB en "Supermercado", un reembolso de 200.00 BOB en "Supermercado" y un gasto de 50.00 USD en "Restaurantes" el 2026-10-15 con tasa USD/BOB de 10.00 al cierre de ese día
- **ENTONCES** el reporte de 2026-10 informa en BOB nativo ingreso 12000.00 y gasto 3300.00, en USD nativo gasto 50.00
- **Y** consolidado en BOB ingreso 12000.00, gasto 3800.00, ahorro 8200.00 y tasa de ahorro 68.3 %

#### Scenario: Mes sin ingresos
- **CUANDO** en 2026-11 no hubo ingresos y se gastaron 150.00 BOB
- **ENTONCES** el ahorro de 2026-11 es −150.00 BOB y la tasa de ahorro se informa como sin definir

#### Scenario: Granularidad semanal
- **CUANDO** se pide el reporte de 2026-10 por semana y el único gasto de la semana del 2026-10-12 al 2026-10-18 es el de 50.00 USD
- **ENTONCES** esa semana informa un gasto consolidado de 500.00 BOB

### Requirement: Reporte de gastos por categoría
El sistema DEBE (MUST) informar el gasto del rango por grupo de categorías, categoría y subcategoría (una categoría suma sus subcategorías), por moneda nativa y consolidado, ordenado de mayor a menor, con la opción de mostrar solo las N primeras categorías y agrupar el resto en "Otras categorías"; un neto negativo por reembolsos DEBE (MUST) mostrarse con su signo y NO DEBE (MUST NOT) ocultarse ni llevarse a cero. Las categorías archivadas DEBEN (MUST) seguir apareciendo con sus movimientos históricos.
Trace: FR-REPORTING-008 · Priority: Must

#### Scenario: Grupo Alimentación en octubre
- **CUANDO** en 2026-10 el gasto consolidado fue 3300.00 BOB en "Supermercado" y 500.00 BOB en "Restaurantes", ambas del grupo "Alimentación"
- **ENTONCES** el grupo "Alimentación" informa 3800.00 BOB con "Supermercado" 3300.00 BOB y "Restaurantes" 500.00 BOB

#### Scenario: Top 1 con el resto agrupado
- **CUANDO** se pide el reporte de 2026-10 con las 1 primeras categorías
- **ENTONCES** informa "Supermercado" 3300.00 BOB y "Otras categorías" 500.00 BOB

#### Scenario: Neto negativo
- **CUANDO** en 2026-10 "Electrónica" tiene un gasto de 100.00 BOB y un reembolso de 300.00 BOB
- **ENTONCES** "Electrónica" informa −200.00 BOB marcado como neto negativo

### Requirement: Reporte de presupuesto vs real por periodos
El sistema DEBE (MUST) informar, para cada periodo financiero del rango, las líneas del presupuesto con su referencia, su real y su estado tal como los calcula la planificación, sin recalcularlos; un periodo sin presupuesto DEBE (MUST) informarse como "Sin presupuesto" y NO DEBE (MUST NOT) mostrar referencias en cero. Este reporte DEBE (MUST) agrupar siempre por periodo financiero y rechazar el mes calendario con `VALIDATION_FAILED`.
Trace: FR-REPORTING-008, FR-PLANNING-024 · Priority: Must

#### Scenario: Septiembre con presupuesto y octubre sin presupuesto
- **CUANDO** el periodo 2026-09 tiene un presupuesto con la línea "Supermercado" de máximo 3000.00 BOB y un real de 3200.00 BOB, y el periodo 2026-10 no tiene presupuesto
- **ENTONCES** el reporte informa en 2026-09 la línea "Supermercado" con referencia 3000.00 BOB, real 3200.00 BOB y estado excedido
- **Y** informa 2026-10 como "Sin presupuesto"

#### Scenario: Agrupación por mes calendario
- **CUANDO** se pide el reporte de presupuesto vs real agrupado por mes calendario
- **ENTONCES** la petición se rechaza con `VALIDATION_FAILED`

### Requirement: Reporte de flujo de caja histórico
El sistema DEBE (MUST) informar, por periodo y por moneda, el saldo inicial y final de las cuentas líquidas seleccionadas (por defecto todas las líquidas no archivadas) y el flujo del periodo clasificado por la contrapartida de cada movimiento en: operativo (ingresos y gastos), deuda (pasivos), ahorro e inversión (activos no líquidos), cambio de moneda (conversiones) y ajustes (saldos iniciales y ajustes). Por moneda DEBE (MUST) cumplirse saldo inicial + Σ componentes = saldo final; las transferencias entre cuentas líquidas NO DEBEN (MUST NOT) aparecer como flujo. En el consolidado, la diferencia de valoración entre saldos y flujos DEBE (MUST) informarse como una línea de revalorización propia.
Trace: FR-REPORTING-008 · Priority: Must

#### Scenario: Octubre con deuda, ahorro y transferencia interna
- **CUANDO** "Banco BOB" y "Efectivo" son líquidas, el saldo líquido al 2026-09-30 es 10000.00 BOB y en 2026-10 hubo un sueldo de 12000.00 BOB, gastos netos de 3300.00 BOB, un pago de tarjeta de 500.00 BOB, una transferencia de 1000.00 BOB a "Plazo fijo" (no líquida) y una transferencia de 200.00 BOB de "Banco BOB" a "Efectivo"
- **ENTONCES** el flujo de caja de 2026-10 en BOB informa saldo inicial 10000.00, operativo 8700.00, deuda −500.00, ahorro e inversión −1000.00, cambio de moneda 0.00 y saldo final 17200.00

#### Scenario: Cuota de préstamo
- **CUANDO** desde "Banco BOB" se paga una cuota de 1500.00 BOB con 1100.00 BOB de principal, 320.00 BOB de interés y 80.00 BOB de cargos
- **ENTONCES** la cuota aporta −1100.00 BOB a deuda y −400.00 BOB a operativo

#### Scenario: Conversión entre cuentas líquidas
- **CUANDO** se venden 100.000000 USDT de "Wallet USDT" (líquida) por 1190.00 BOB depositados en "Banco BOB" y la tasa USDT/BOB de valoración de ese día es 12.00
- **ENTONCES** el componente cambio de moneda informa 1190.00 BOB en BOB y −100.000000 USDT en USDT
- **Y** consolidado en BOB el componente cambio de moneda es −10.00 BOB

### Requirement: Reporte de historial de saldo de una cuenta
El sistema DEBE (MUST) informar el saldo diario de una cuenta en su moneda para un rango de hasta 731 días, con el saldo de cierre de cada día con movimientos y el del día anterior sin movimientos, opcionalmente valorado en la moneda de reporte con la tasa de cada fecha, y DEBE (MUST) marcar los días en que cierra una conciliación de la cuenta. El saldo de cada día DEBE (MUST) ser igual al saldo contable de la cuenta a esa fecha.
Trace: FR-REPORTING-008, FR-LEDGER-012 · Priority: Must

#### Scenario: Octubre de Banco BOB
- **CUANDO** "Banco BOB" tenía 10000.00 BOB al 2026-09-30, recibió 12000.00 BOB el 2026-10-05, pagó 3500.00 BOB el 2026-10-10 y recibió un reembolso de 200.00 BOB el 2026-10-12
- **ENTONCES** el historial de 2026-10 informa 10000.00 BOB del 2026-10-01 al 2026-10-04, 22000.00 BOB del 2026-10-05 al 2026-10-09, 18500.00 BOB el 2026-10-10 y el 2026-10-11 y 18700.00 BOB desde el 2026-10-12 hasta el 2026-10-31

#### Scenario: Día con conciliación
- **CUANDO** una conciliación de "Banco BOB" con fecha de extracto 2026-10-10 está cerrada
- **ENTONCES** el día 2026-10-10 del historial lleva la marca de conciliación

### Requirement: Comparación con el periodo anterior y con el mismo periodo del año anterior
Los reportes temporales DEBEN (MUST) poder compararse con el periodo inmediatamente anterior del mismo tipo (MoM) o con el periodo que contiene la misma fecha de inicio un año antes (YoY), informando por cada cifra el valor comparado, la variación absoluta y la variación porcentual (2 decimales HALF_EVEN sobre el valor absoluto del comparado); con un valor comparado cero la variación porcentual DEBE (MUST) informarse como "nuevo" y no como un porcentaje.
Trace: FR-REPORTING-009 · Priority: Must

#### Scenario: Octubre contra septiembre
- **CUANDO** el gasto consolidado fue 3000.00 BOB en 2026-09 y 3800.00 BOB en 2026-10 y se compara 2026-10 con el periodo anterior
- **ENTONCES** la variación del gasto es 800.00 BOB y 26.67 %

#### Scenario: Octubre contra octubre del año anterior
- **CUANDO** el gasto consolidado de 2025-10 fue 4000.00 BOB y se compara 2026-10 con el año anterior
- **ENTONCES** la variación del gasto es −200.00 BOB y −5.00 %

#### Scenario: Categoría nueva
- **CUANDO** "Mascotas" no tuvo gasto en 2026-09 y tuvo 150.00 BOB en 2026-10
- **ENTONCES** la variación de "Mascotas" es 150.00 BOB y se informa como nuevo

### Requirement: Comparación con un rango personalizado
Los reportes temporales DEBEN (MUST) poder compararse con un rango personalizado de hasta 24 periodos; si los dos rangos tienen distinta cantidad de días el reporte DEBE (MUST) indicarlo y, si se pide, normalizar las cifras por día (cifra dividida por los días del rango, sin redondeo intermedio).
Trace: FR-REPORTING-009 · Priority: Must

#### Scenario: Diez días contra un mes normalizados por día
- **CUANDO** el gasto del 2026-10-01 al 2026-10-10 fue 1000.00 BOB, el del 2026-09-01 al 2026-09-30 fue 3000.00 BOB y se comparan normalizando por día
- **ENTONCES** ambos rangos informan 100.00 BOB por día y la variación es 0.00 BOB

#### Scenario: Sin normalizar
- **CUANDO** se comparan los mismos rangos sin normalizar
- **ENTONCES** la variación es −2000.00 BOB y el reporte indica que los rangos tienen 10 y 30 días

### Requirement: Promedio móvil de periodos completos
Los reportes temporales DEBEN (MUST) poder informar, para cada periodo, el promedio de los 3, 6 o 12 periodos completos inmediatamente anteriores como línea base y la variación contra ella; los periodos anteriores al primer movimiento del workspace NO DEBEN (MUST NOT) contarse y, con menos periodos completos que los pedidos, la línea base DEBE (MUST) informarse como historial insuficiente.
Trace: FR-REPORTING-009 · Priority: Must

#### Scenario: Promedio de tres meses
- **CUANDO** el gasto consolidado fue 3000.00 BOB en 2026-07, 3300.00 BOB en 2026-08 y 3000.00 BOB en 2026-09, y 3800.00 BOB en 2026-10, con promedio móvil de 3
- **ENTONCES** la línea base de 2026-10 es 3100.00 BOB y la variación es 700.00 BOB y 22.58 %

#### Scenario: Historial insuficiente
- **CUANDO** el primer movimiento del workspace es del 2026-08-03 y se pide el promedio móvil de 3 para 2026-10
- **ENTONCES** la línea base de 2026-10 se informa como historial insuficiente

### Requirement: Comparación a la fecha del periodo en curso
Cuando se compara el periodo que contiene hoy, el reporte DEBE (MUST) poder comparar los días transcurridos del periodo actual con la misma cantidad de días desde el inicio del periodo comparado, acotada a su último día.
Trace: FR-REPORTING-009, FR-REPORTING-018 · Priority: Should

#### Scenario: Quince días de octubre
- **CUANDO** hoy es 2026-10-15, el gasto del 2026-10-01 al 2026-10-15 es 1800.00 BOB y el del 2026-09-01 al 2026-09-15 fue 1500.00 BOB, y se compara a la fecha
- **ENTONCES** la variación es 300.00 BOB y 20.00 %

#### Scenario: Día 31 contra un mes de 30 días
- **CUANDO** hoy es 2026-10-31 y se compara a la fecha con septiembre
- **ENTONCES** el tramo comparado es del 2026-09-01 al 2026-09-30

### Requirement: Política de conversión explícita en cada reporte
Cada reporte DEBE (MUST) declarar en su respuesta y en su vista la política de conversión aplicada, la moneda de reporte, la ventana de vigencia de tasas y cada tasa usada con su tipo, fuente y fecha: los flujos (ingresos, gastos, ahorro, componentes del flujo de caja) DEBEN (MUST) convertirse con la tasa vigente al cierre del día de negocio de cada movimiento, agregando por moneda y día antes de convertir, y los saldos con la tasa de su fecha de valoración; el redondeo HALF_EVEN DEBE (MUST) aplicarse solo al presentar.
Trace: FR-REPORTING-011 · Priority: Must

#### Scenario: Gasto en dólares a la tasa de su fecha
- **CUANDO** el gasto de 50.00 USD es del 2026-10-15 con tasa USD/BOB de 10.00 al cierre de ese día y la tasa al 2026-10-31 es 10.50
- **ENTONCES** el reporte de 2026-10 lo valora en 500.00 BOB
- **Y** declara la política de tasa de la fecha de cada movimiento y la tasa USD/BOB 10.00 usada con su tipo, su fuente y su fecha

### Requirement: Moneda de reporte seleccionable
Un reporte DEBE (MUST) poder pedirse en cualquier moneda habilitada del workspace como moneda de reporte, por defecto la moneda base; una moneda no habilitada DEBE (MUST) rechazarse con `CURRENCY_NOT_ENABLED`. Cambiar la moneda de reporte NO DEBE (MUST NOT) cambiar las cifras por moneda nativa.
Trace: FR-REPORTING-011 · Priority: Must

#### Scenario: Reporte en dólares
- **CUANDO** USD está habilitada y el sueldo de 12000.00 BOB del 2026-10-05 se consulta con moneda de reporte USD y tasa USD/BOB de 10.00 al cierre de ese día
- **ENTONCES** el ingreso consolidado de 2026-10 es 1200.00 USD y el ingreso nativo sigue siendo 12000.00 BOB

#### Scenario: Moneda no habilitada
- **CUANDO** se pide un reporte con moneda de reporte EUR y EUR no está habilitada en el workspace
- **ENTONCES** la petición se rechaza con `CURRENCY_NOT_ENABLED`

### Requirement: Montos sin tasa fuera del consolidado
Un monto sin tasa vigente dentro de la ventana de vigencia NO DEBE (MUST NOT) convertirse 1:1 ni estimarse: DEBE (MUST) quedar fuera del consolidado, que se marca incompleto e informa los montos excluidos por moneda, y DEBE (MUST) seguir visible en la vista por moneda nativa.
Trace: FR-REPORTING-011, FR-FX-006 · Priority: Must

#### Scenario: Gasto en USDT sin tasa
- **CUANDO** el 2026-10-20 hubo un gasto de 20.000000 USDT y no hay tasa USDT/BOB en los 7 días anteriores al cierre de ese día
- **ENTONCES** el gasto consolidado de 2026-10 no incluye ese monto, el consolidado se marca incompleto e informa 20.000000 USDT excluidos
- **Y** la vista por moneda nativa informa 20.000000 USDT de gasto

### Requirement: Flujos valorados a la fecha de corte a pedido
Cuando se pida, un reporte de flujos DEBE (MUST) valorar todos los flujos con la tasa vigente al cierre de la fecha de corte del rango (último día, o hoy si el rango no terminó) y declararlo como política de fecha de corte; la vista por moneda nativa NO DEBE (MUST NOT) cambiar.
Trace: FR-REPORTING-011 · Priority: Should

#### Scenario: Gasto en dólares a la fecha de corte
- **CUANDO** se pide el reporte de 2026-10 valorado a la fecha de corte y la tasa USD/BOB al cierre del 2026-10-31 es 10.50
- **ENTONCES** el gasto de 50.00 USD se valora en 525.00 BOB y el reporte declara la política de fecha de corte 2026-10-31

### Requirement: Drill-down de una celda a sus porciones
Desde cualquier cifra de un reporte de ingresos y gastos, de gastos por categoría o de presupuesto vs real, el sistema DEBE (MUST) listar las porciones de transacción que la componen, cada una con su transacción, fecha, cuenta, categoría, contraparte, descripción, monto nativo con signo y monto valorado con la misma política del reporte, y un enlace al detalle de la transacción; la suma de las porciones DEBE (MUST) ser igual a la cifra, por moneda nativa y consolidada.
Trace: FR-REPORTING-010 · Priority: Must

#### Scenario: Supermercado de octubre
- **CUANDO** "Supermercado" informa 3300.00 BOB en 2026-10 por un gasto de 3500.00 BOB y un reembolso de 200.00 BOB, y se abre su drill-down
- **ENTONCES** se listan 2 porciones de 3500.00 BOB y −200.00 BOB cuya suma es 3300.00 BOB

#### Scenario: Transacción repartida en dos categorías
- **CUANDO** una compra de 600.00 BOB del 2026-11-03 se reparte 400.00 BOB en "Supermercado" y 200.00 BOB en "Farmacia" y se abre el drill-down de "Supermercado" de 2026-11
- **ENTONCES** se lista la porción de 400.00 BOB con el enlace a la transacción de 600.00 BOB

### Requirement: Drill-down con los mismos filtros y paginado
El drill-down DEBE (MUST) aplicar los filtros del reporte de origen, ordenar por fecha de negocio descendente y luego por identificador, paginar por cursor con hasta 200 filas por página y devolver en cada página los totales de toda la celda.
Trace: FR-REPORTING-010, NFR-PERF-006 · Priority: Must

#### Scenario: Celda filtrada por cuenta
- **CUANDO** el reporte de 2026-10 está filtrado por "Tarjeta Andina" y se abre el drill-down del gasto de 500.00 BOB
- **ENTONCES** todas las porciones listadas son de "Tarjeta Andina" y suman 500.00 BOB

#### Scenario: Ciento veinte porciones
- **CUANDO** la celda tiene 120 porciones y se piden páginas de 50
- **ENTONCES** se obtienen páginas de 50, 50 y 20 filas sin repetidos ni faltantes y las tres informan los mismos totales

### Requirement: Drill-down del flujo de caja y del historial de saldo
Desde un componente del flujo de caja el sistema DEBE (MUST) listar los movimientos de las cuentas líquidas que lo componen con su transacción, y desde un día del historial de saldo, los movimientos de la cuenta en ese día; en ambos la suma de los movimientos DEBE (MUST) ser igual a la cifra de origen.
Trace: FR-REPORTING-010 · Priority: Must

#### Scenario: Componente deuda de octubre
- **CUANDO** el componente deuda de 2026-10 informa −500.00 BOB por un pago de tarjeta y se abre su drill-down
- **ENTONCES** se lista el movimiento de −500.00 BOB de "Banco BOB" con el enlace al pago de tarjeta

#### Scenario: Día del historial de saldo
- **CUANDO** se abre el drill-down del 2026-10-10 del historial de "Banco BOB"
- **ENTONCES** se lista el movimiento de −3500.00 BOB de ese día

### Requirement: Exportación CSV de un reporte
Un miembro del workspace DEBE (MUST) poder exportar cada reporte como CSV UTF-8 con BOM, separador coma y punto decimal, con una fila por periodo (y dimensión) y moneda nativa más las filas consolidadas en la moneda de reporte, las columnas de política de conversión y de completitud, montos como texto decimal exacto y celdas de texto neutralizadas contra fórmulas; una exportación que supere 50 000 filas DEBE (MUST) rechazarse con `REPORT_EXPORT_TOO_LARGE`.
Trace: FR-REPORTING-012, NFR-SEC-015 · Priority: Must

#### Scenario: Exportar ingresos y gastos de octubre
- **CUANDO** un VIEWER exporta el reporte de ingresos y gastos de 2026-10
- **ENTONCES** obtiene un CSV con una fila BOB nativa (ingreso "12000.00", gasto "3300.00"), una fila USD nativa (gasto "50.00") y una fila consolidada en BOB (ingreso "12000.00", gasto "3800.00", ahorro "8200.00", tasa de ahorro "68.3", completo)

#### Scenario: Exportación demasiado grande
- **CUANDO** la exportación pedida tendría 50 001 filas
- **ENTONCES** se rechaza con `REPORT_EXPORT_TOO_LARGE` y no se genera ningún archivo

### Requirement: Exportación CSV de un drill-down
Un miembro del workspace DEBE (MUST) poder exportar como CSV todas las filas de un drill-down (no solo la página visible) con las mismas reglas de formato, neutralización y tope que la exportación de reportes.
Trace: FR-REPORTING-012, NFR-SEC-015 · Priority: Must

#### Scenario: Descripción con fórmula
- **CUANDO** una porción del drill-down tiene la descripción "=HYPERLINK(1)" y un monto de −200.00 BOB
- **ENTONCES** el CSV muestra la descripción como texto y no como fórmula, y el monto como "-200.00"

### Requirement: Exportaciones de reportes auditadas
Cada exportación de un reporte o de un drill-down DEBE (MUST) registrarse en la auditoría del workspace con el actor, el reporte, los filtros y la cantidad de filas, sin el contenido del archivo.
Trace: FR-REPORTING-012, FR-AUDIT-013 · Priority: Should

#### Scenario: Exportación registrada
- **CUANDO** un VIEWER exporta el reporte de gastos por categoría de 2026-10 con 12 filas
- **ENTONCES** la auditoría registra la exportación con el actor, el reporte, el rango 2026-10 y 12 filas, sin montos ni descripciones

### Requirement: Frescura y lectura condicional de los reportes
Cada reporte DEBE (MUST) informar la versión de los datos del workspace, el instante del último asiento considerado y el instante de generación, y DEBE (MUST) responder sin cuerpo cuando el cliente ya tiene la misma versión del mismo reporte con los mismos parámetros; tras registrar una transacción, la siguiente lectura del reporte DEBE (MUST) incluirla.
Trace: FR-REPORTING-007 · Priority: Must

#### Scenario: Lectura repetida sin cambios
- **CUANDO** un cliente pide dos veces el reporte de 2026-10 con los mismos parámetros sin cambios en los datos
- **ENTONCES** la segunda respuesta no repite el cuerpo e indica que no hubo cambios

#### Scenario: Lectura inmediata tras registrar
- **CUANDO** se registra un gasto de 80.00 BOB en "Supermercado" con fecha 2026-10-20 y se vuelve a pedir el reporte de 2026-10
- **ENTONCES** el gasto de "Supermercado" de 2026-10 aumenta en 80.00 BOB

### Requirement: Reportes de solo lectura para todos los miembros y aislados por workspace
Todo miembro activo del workspace (OWNER, EDITOR o VIEWER) DEBE (MUST) poder consultar y exportar los reportes; consultar un reporte NO DEBE (MUST NOT) modificar datos financieros y NO DEBE (MUST NOT) incluir movimientos, cuentas ni tasas manuales de otro workspace.
Trace: FR-REPORTING-008, NFR-SEC-003 · Priority: Must

#### Scenario: Otro workspace
- **CUANDO** "W2" tiene gastos en 2026-10 y un miembro de "W1" consulta el reporte de gastos por categoría de 2026-10
- **ENTONCES** el resultado de "W1" no incluye ningún movimiento de "W2"

#### Scenario: Usuario que no es miembro
- **CUANDO** un usuario que no es miembro de "W1" pide un reporte de "W1"
- **ENTONCES** la petición se rechaza sin revelar datos de "W1"

### Requirement: Sección de reportes en la aplicación
La aplicación DEBE (MUST) ofrecer una sección de reportes con el catálogo, una barra de filtros común (rango, agrupación, comparación, moneda de reporte, cuentas, monedas, categorías, etiquetas y contrapartes), cada reporte disponible con su gráfico y una tabla de datos equivalente, la política de conversión y las tasas usadas visibles, la variación con texto además del color, el drill-down en un panel y la exportación CSV, en español, inglés y portugués, accesible y usable en móvil.
Trace: FR-REPORTING-008, FR-REPORTING-010, FR-REPORTING-011, NFR-USAB-101, NFR-USAB-105 · Priority: Must

#### Scenario: Del gráfico a la transacción
- **CUANDO** el owner abre "Gastos por categoría" de 2026-10, toca "Supermercado" y luego una porción del panel
- **ENTONCES** ve las porciones que suman 3300.00 BOB y llega al detalle de la transacción

#### Scenario: Variación sin depender del color
- **CUANDO** el gasto subió 26.67 % contra el periodo anterior
- **ENTONCES** la vista lo indica con texto e icono además del color

### Requirement: Reconciliación de los reportes con el ledger
Las cifras de los reportes DEBEN (MUST) cuadrar con el ledger: por periodo y moneda nativa, el ingreso y el gasto DEBEN (MUST) ser iguales a los movimientos sobre las cuentas de ingreso y de gasto de esa moneda; la suma de las categorías DEBE (MUST) ser igual al gasto; el flujo de caja DEBE (MUST) cumplir saldo inicial + componentes = saldo final con los saldos contables; el historial de saldo DEBE (MUST) ser igual al saldo contable de cada día; y todo drill-down DEBE (MUST) sumar su cifra. La verificación DEBE (MUST) correr sobre ledgers generados al azar, sobre el dataset Demo y en cada nightly sobre los 60 meses del dataset grande, y fallar indicando el reporte, el periodo y la moneda de cualquier diferencia, por mínima que sea.
Trace: FR-REPORTING-008, FR-REPORTING-010, NFR-DATA-008 · Priority: Must

#### Scenario: Octubre cuadra con el ledger
- **CUANDO** en 2026-10 los movimientos sobre la cuenta de ingresos en BOB suman −12000.00 BOB y los de la cuenta de gastos en BOB suman 3300.00 BOB
- **ENTONCES** el reporte de ingresos y gastos informa en BOB nativo ingreso 12000.00 y gasto 3300.00, y las categorías de 2026-10 en BOB suman 3300.00

#### Scenario: Diferencia detectada
- **CUANDO** un reporte informara en 2026-10 un gasto en BOB de 3300.01 frente a 3300.00 del ledger
- **ENTONCES** la verificación falla indicando el reporte de ingresos y gastos, el periodo 2026-10 y la moneda BOB

### Requirement: Rendimiento de los reportes con el dataset grande
Con el dataset grande (al menos 50 000 transacciones en el workspace), cada reporte de 12 periodos DEBE (MUST) responder con p95 ≤ 800 ms y la primera página de su drill-down más grande con p95 ≤ 300 ms, medidos en cada nightly sin caché condicional; la medición NO DEBE (MUST NOT) requerir consumidores de eventos adicionales.
Trace: NFR-PERF-006 · Priority: Must

#### Scenario: Doce meses del dataset grande
- **CUANDO** el nightly pide cada reporte de los 12 meses completos más recientes del dataset grande
- **ENTONCES** el p95 de cada reporte es como máximo 800 ms

#### Scenario: Drill-down de la celda más grande
- **CUANDO** el nightly abre la primera página de 50 filas del drill-down de la categoría con más porciones de esos 12 meses
- **ENTONCES** el p95 es como máximo 300 ms

### Requirement: Métrica de duración y alerta de evolución a read models
Cada reporte DEBE (MUST) exponer su duración en una métrica por reporte de baja cardinalidad, y una alerta DEBE (MUST) recomendar introducir read models cuando el p95 de un reporte supere el 75 % de su presupuesto de latencia durante 7 días.
Trace: FR-REPORTING-007, NFR-OBS-004 · Priority: Should

#### Scenario: Reporte cerca del presupuesto
- **CUANDO** el p95 del reporte de gastos por categoría es 640 ms durante 7 días
- **ENTONCES** se dispara la alerta que recomienda un read model para ese reporte
