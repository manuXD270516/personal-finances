# reporting/financial-reports Specification

## Purpose
Ofrece los reportes financieros de PFOS en la moneda de reporte, conciliados con el ledger y exportables: por etiqueta, por cuenta, tendencias, comisiones, progreso de metas, evolución de deudas, costos recurrentes, suscripciones y costo de conversiones, más las vistas guardadas por usuario (add-financial-reports-extended, Phase 7). Los reportes núcleo de `add-financial-reports` se suman a esta capability cuando ese change se archive.

## Requirements

### Requirement: Reporte de gastos por etiqueta
El sistema DEBE (MUST) informar el gasto del rango por etiqueta, por moneda nativa y consolidado, con coincidencia de las porciones con cualquiera de las etiquetas pedidas o con todas; como una porción con varias etiquetas suma en cada una, el reporte DEBE (MUST) avisar que los totales por etiqueta no son aditivos y NO DEBE (MUST NOT) presentar su suma como gasto total. El drill-down DEBE (MUST) llevar de la etiqueta a sus categorías y a sus porciones.
Trace: FR-REPORTING-008 · Priority: Should

#### Scenario: Viaje con un gasto compartido con trabajo
- **CUANDO** en 2026-10 un hotel de 800.00 BOB lleva las etiquetas "Viaje Cusco" y "Trabajo" y una comida de 200.00 BOB lleva solo "Viaje Cusco"
- **ENTONCES** el reporte informa "Viaje Cusco" 1000.00 BOB y "Trabajo" 800.00 BOB con el aviso de no aditividad

#### Scenario: Coincidencia con todas las etiquetas
- **CUANDO** se pide el reporte con coincidencia con todas de "Viaje Cusco" y "Trabajo"
- **ENTONCES** el gasto informado es 800.00 BOB

### Requirement: Reporte de gastos por cuenta
El sistema DEBE (MUST) informar el gasto del rango por cuenta desde la que se pagó, con su tipo y su institución, desglosado por categoría, por moneda nativa y consolidado; la suma de las cuentas DEBE (MUST) ser igual al gasto total del rango con los mismos filtros.
Trace: FR-REPORTING-008 · Priority: Should

#### Scenario: Banco y tarjeta en octubre
- **CUANDO** en 2026-10 se gastaron 3300.00 BOB desde "Banco BOB" en "Supermercado" y 500.00 BOB con "Tarjeta Andina" en "Restaurantes"
- **ENTONCES** el reporte informa "Banco BOB" 3300.00 BOB y "Tarjeta Andina" 500.00 BOB (tipo tarjeta de crédito), que suman el gasto total de 3800.00 BOB

### Requirement: Reporte de tendencias mensuales
El sistema DEBE (MUST) informar el gasto por categoría y por periodo para 6, 12 o 24 periodos, mostrando como series las 7 categorías con mayor gasto del rango y agrupando el resto en "Otras categorías", con la opción de normalizar cada periodo por sus días; cada celda (categoría y periodo) DEBE (MUST) ofrecer drill-down.
Trace: FR-REPORTING-008, FR-REPORTING-009 · Priority: Should

#### Scenario: Febrero y marzo normalizados por día
- **CUANDO** "Supermercado" tuvo 2800.00 BOB en 2026-02 (28 días) y 3100.00 BOB en 2026-03 (31 días) y se normaliza por día
- **ENTONCES** ambos periodos informan 100.00 BOB por día para "Supermercado"

#### Scenario: Nueve categorías
- **CUANDO** el rango tiene gasto en 9 categorías
- **ENTONCES** el reporte informa 7 series de categoría y una serie "Otras categorías" con la suma de las 2 restantes

### Requirement: Reporte de comisiones
El sistema DEBE (MUST) informar el gasto en comisiones del rango por tipo (comisión de conversión, comisión de transferencia, interés y cargos de préstamos y gastos en las categorías de comisiones) y por mes, por moneda nativa y consolidado, más el total de los últimos 12 meses completos; cada porción DEBE (MUST) contarse en un solo tipo.
Trace: FR-REPORTING-008 · Priority: Should

#### Scenario: Comisiones de octubre
- **CUANDO** en 2026-10 hubo una comisión de conversión de 2.00 BOB, una comisión de transferencia de 5.00 BOB, una cuota con 320.00 BOB de interés y 80.00 BOB de cargos y un gasto de 15.00 BOB en "Comisiones bancarias"
- **ENTONCES** el reporte de 2026-10 informa conversión 2.00 BOB, transferencia 5.00 BOB, préstamos 400.00 BOB, categorías de comisiones 15.00 BOB y un total de 422.00 BOB

### Requirement: Reporte de metas de ahorro
El sistema DEBE (MUST) informar por meta y por mes los aportes, los retiros y el acumulado al cierre del mes en la moneda de la meta, junto con el acumulado esperado según la línea recta desde la fecha de inicio hasta la fecha objetivo y el estado de avance; las reasignaciones entre metas NO DEBEN (MUST NOT) contarse como aportes nuevos. El drill-down DEBE (MUST) listar los movimientos de la meta del mes.
Trace: FR-REPORTING-008, FR-GOALS-003 · Priority: Should

#### Scenario: Meta de viaje
- **CUANDO** la meta "Viaje" tiene objetivo 5000.00 BOB, inicio 2026-07-01, fecha objetivo 2027-06-30 y aportes de 500.00 BOB en julio, 500.00 BOB en agosto, ninguno en septiembre y 1000.00 BOB en octubre de 2026 con un retiro de 200.00 BOB en octubre
- **ENTONCES** el reporte informa acumulados de 500.00, 1000.00, 1000.00 y 1800.00 BOB al cierre de julio, agosto, septiembre y octubre
- **Y** el acumulado esperado y el estado de avance de cada mes son los que calcula la regla de seguimiento de la meta a ese cierre

### Requirement: Reporte de evolución de deudas
El sistema DEBE (MUST) informar por deuda (préstamo o tarjeta) y por mes el saldo pendiente al cierre del mes según el ledger y, para los préstamos, el principal y el interés pagados en el mes según el desglose de sus pagos, por moneda nativa y consolidados en la moneda de reporte con la tasa de cada cierre para saldos y de la fecha de cada pago para lo pagado.
Trace: FR-REPORTING-008, FR-DEBT-013 · Priority: Should

#### Scenario: Crédito auto en dos meses
- **CUANDO** "Crédito auto" tenía 20000.00 BOB pendientes al 2026-08-31 y se pagaron en septiembre 1100.00 BOB de principal y 320.00 BOB de interés y en octubre 1110.00 BOB de principal y 310.00 BOB de interés
- **ENTONCES** el reporte informa pendiente 18900.00 BOB al cierre de septiembre y 17790.00 BOB al cierre de octubre, con interés pagado de 320.00 BOB y 310.00 BOB

### Requirement: Reporte de costos recurrentes
El sistema DEBE (MUST) informar el costo mensual y anual normalizado de cada compromiso recurrente de egreso activo, con su categoría y frecuencia, ordenado por costo mensual, y el total mensual y anualizado, valorados con la tasa vigente al consultar; los compromisos pausados o cancelados NO DEBEN (MUST NOT) sumar y los de monto variable DEBEN (MUST) contarse aparte sin monto. El drill-down DEBE (MUST) llevar del compromiso a sus ocurrencias y a las transacciones emparejadas.
Trace: FR-REPORTING-008, FR-COMMITMENTS-011 · Priority: Should

#### Scenario: Tres compromisos en dos monedas
- **CUANDO** hay un servicio de streaming de 69.00 BOB mensual, un seguro de 1200.00 BOB anual y un gimnasio de 50.00 USD mensual activos, una suscripción pausada de 30.00 BOB mensual y la tasa USD/BOB vigente es 10.00
- **ENTONCES** el costo mensual total es 669.00 BOB y el anualizado 8028.00 BOB, sin la suscripción pausada

### Requirement: Reporte de evolución de suscripciones
El sistema DEBE (MUST) informar por mes el costo mensual normalizado de las suscripciones activas al cierre del mes, valorado con la tasa de ese cierre, junto con los eventos del mes: altas, bajas y cambios de precio con el precio anterior y el nuevo.
Trace: FR-REPORTING-008, FR-COMMITMENTS-011 · Priority: Should

#### Scenario: Aumento, alta y baja
- **CUANDO** al cierre de julio de 2026 están activas una suscripción de música de 25.00 BOB y una de video de 69.00 BOB mensuales, la de música sube a 30.00 BOB el 2026-08-01, se da de alta una de 50.00 BOB mensual el 2026-09-10 y se da de baja la de video el 2026-10-05
- **ENTONCES** el costo mensual al cierre es 94.00 BOB en julio, 99.00 BOB en agosto, 149.00 BOB en septiembre y 80.00 BOB en octubre
- **Y** los eventos son el aumento de 25.00 a 30.00 BOB en agosto, el alta en septiembre y la baja en octubre

### Requirement: Reporte de conversiones de moneda y cripto
El sistema DEBE (MUST) informar por conversión posteada del rango su tasa efectiva y su tasa de referencia registrada (para comparar en el tiempo) y por mes el costo de convertir (spread más comisiones) con las mismas reglas del análisis de costo de conversiones; las conversiones sin referencia DEBEN (MUST) listarse sin punto de comparación y NO DEBEN (MUST NOT) estimarse.
Trace: FR-REPORTING-008, FR-FX-011 · Priority: Should

#### Scenario: Octubre con dos ventas por Binance P2P
- **CUANDO** en 2026-10 se vendieron 100.000000 USDT a 11.90 y 300.000000 USDT a 11.94, ambas con referencia 12.00, y la segunda con comisión de 2.00 BOB
- **ENTONCES** el reporte lista los dos puntos (11.90 frente a 12.00 y 11.94 frente a 12.00) y un costo de 2026-10 de 30.00 BOB

### Requirement: Reportes ampliados en el catálogo
Con este change, los reportes de gastos por etiqueta, gastos por cuenta, tendencias mensuales, metas de ahorro, evolución de deudas, costos recurrentes, evolución de suscripciones, conversiones de moneda y cripto y comisiones DEBEN (MUST) figurar como disponibles en el catálogo; el reporte de pronóstico vs real DEBE (MUST) seguir planificado para Phase 8.
Trace: FR-REPORTING-008, FR-REPORTING-001 · Priority: Should

#### Scenario: Catálogo completo de Phase 7
- **CUANDO** un miembro consulta el catálogo
- **ENTONCES** 15 reportes figuran como disponibles y "Pronóstico vs real" como planificado para Phase 8

### Requirement: Vistas de los reportes ampliados en la aplicación
La aplicación DEBE (MUST) ofrecer cada reporte ampliado en la sección de reportes con la barra de filtros común, su gráfico con una tabla de datos equivalente, su drill-down y su exportación, en español, inglés y portugués, accesible y usable en móvil.
Trace: FR-REPORTING-008, NFR-USAB-101, NFR-USAB-105 · Priority: Should

#### Scenario: De la etiqueta a la porción
- **CUANDO** el owner abre "Gastos por etiqueta" de 2026-10, toca "Viaje Cusco" y luego "Alojamiento"
- **ENTONCES** ve la porción del hotel de 800.00 BOB y llega al detalle de la transacción

### Requirement: Vistas guardadas de reportes
Un miembro del workspace DEBE (MUST) poder guardar con un nombre una combinación de reporte, rango relativo o fijo, agrupación, comparación, moneda de reporte y filtros, y luego listarla, abrirla con los mismos parámetros, renombrarla y borrarla. El nombre DEBE (MUST) ser único por usuario y reporte (`SAVED_VIEW_NAME_TAKEN`) y cada usuario DEBE (MUST) tener como máximo 50 vistas por workspace (`SAVED_VIEW_LIMIT_EXCEEDED`). Una vista guardada NO DEBE (MUST NOT) guardar montos ni resultados.
Trace: FR-REPORTING-019 · Priority: Should

#### Scenario: Guardar y abrir los gastos del viaje
- **CUANDO** el owner guarda "Gastos del viaje" con el reporte de gastos por etiqueta, la etiqueta "Viaje Cusco" y el rango "últimos 3 meses"
- **ENTONCES** la vista aparece en su lista y al abrirla el reporte se pide con esos parámetros, con el rango calculado desde hoy

#### Scenario: Nombre repetido
- **CUANDO** el owner guarda otra vista del mismo reporte con el nombre "Gastos del viaje"
- **ENTONCES** se rechaza con `SAVED_VIEW_NAME_TAKEN`

#### Scenario: Vista 51
- **CUANDO** el owner ya tiene 50 vistas en el workspace y guarda otra
- **ENTONCES** se rechaza con `SAVED_VIEW_LIMIT_EXCEEDED`

### Requirement: Vistas guardadas personales y aisladas
Las vistas guardadas DEBEN (MUST) ser visibles solo para el usuario que las creó dentro de su workspace; otro miembro del mismo workspace o un usuario de otro workspace NO DEBE (MUST NOT) listarlas, abrirlas ni modificarlas. Un filtro de una vista que apunte a una categoría, cuenta, etiqueta o contraparte archivada o inexistente DEBE (MUST) avisarse al abrirla sin fallar.
Trace: FR-REPORTING-019, NFR-SEC-003 · Priority: Should

#### Scenario: Vista de otro miembro
- **CUANDO** un EDITOR del mismo workspace intenta abrir la vista "Gastos del viaje" del owner
- **ENTONCES** la petición se rechaza como inexistente

#### Scenario: Etiqueta archivada
- **CUANDO** la etiqueta "Viaje Cusco" se archiva y el owner abre "Gastos del viaje"
- **ENTONCES** el reporte se muestra con el aviso de que el filtro usa una etiqueta archivada

### Requirement: Exportación PDF de un reporte
Un miembro del workspace DEBE (MUST) poder exportar un reporte como PDF con su título, rango, filtros, la tabla de datos, la política de conversión y las tasas usadas, generado en el momento sin almacenarse.
Trace: FR-REPORTING-013 · Priority: Could

#### Scenario: PDF de ingresos y gastos
- **CUANDO** un VIEWER exporta como PDF el reporte de ingresos y gastos de 2026-10
- **ENTONCES** obtiene un PDF con ingreso 12000.00 BOB, gasto 3800.00 BOB, ahorro 8200.00 BOB, la política de tasa de la fecha de cada movimiento y la tasa USD/BOB 10.00 usada

### Requirement: Reconciliación de los reportes ampliados con el ledger
Los reportes ampliados DEBEN (MUST) cuadrar con el ledger: la suma por cuenta y la suma por tipo de comisión no superan el gasto y la primera es igual a él; el saldo pendiente de cada deuda al cierre de cada mes es el saldo contable de su cuenta; el acumulado de cada meta es la suma de sus movimientos; y todo drill-down suma su cifra. La verificación DEBE (MUST) sumarse a la del núcleo sobre ledgers aleatorios, el dataset Demo y el nightly con el dataset grande.
Trace: FR-REPORTING-008, FR-REPORTING-010, NFR-DATA-008 · Priority: Should

#### Scenario: Gasto por cuenta igual al total
- **CUANDO** el gasto en BOB de 2026-10 según el ledger es 3800.00 BOB
- **ENTONCES** la suma de las cuentas del reporte de gastos por cuenta en BOB es 3800.00 BOB

### Requirement: Rendimiento de los reportes ampliados
Con el dataset grande, cada reporte ampliado de 12 periodos (24 para tendencias) DEBE (MUST) responder con p95 ≤ 800 ms y su drill-down con p95 ≤ 300 ms, medidos en el nightly sin consumidores de eventos adicionales.
Trace: NFR-PERF-006 · Priority: Should

#### Scenario: Tendencias de 24 meses
- **CUANDO** el nightly pide las tendencias mensuales de los 24 meses completos más recientes del dataset grande
- **ENTONCES** el p95 es como máximo 800 ms
