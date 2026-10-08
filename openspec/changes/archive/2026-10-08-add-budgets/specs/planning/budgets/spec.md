# Spec Delta

## Purpose

Permite planificar cada periodo financiero con un plan mensual (ingresos esperados y presupuestos por categoría, grupo o tag) y responder "¿estoy dentro del plan?": planificado, gastado, restante, porcentaje y proyección por presupuesto, un "disponible para gastar" agregado y umbrales de alerta emitidos una sola vez, con el gasto real derivado de las transacciones posteadas y convertido a la moneda base con las mismas reglas de valoración de flujos que Reporting.

## ADDED Requirements

### Requirement: Un plan mensual por periodo financiero
El sistema DEBE (MUST) permitir crear un plan mensual para un periodo financiero en estado borrador, activo o reabierto, expresado en la moneda base del workspace; DEBE (MUST) existir a lo sumo un plan por periodo y un segundo intento DEBE (MUST) rechazarse con `BUDGET_ALREADY_EXISTS` sin modificar el plan existente.
Trace: FR-PLANNING-008, FR-PLANNING-015 · Priority: Must

#### Scenario: Plan vacío creado para noviembre
- **CUANDO** el EDITOR crea un plan vacío para el periodo "2026-11" (2026-11-01 a 2026-11-30) de un workspace con moneda base BOB
- **ENTONCES** el plan queda creado en BOB, sin líneas y con origen "vacío"

#### Scenario: Segundo plan para el mismo periodo rechazado
- **CUANDO** ya existe el plan del periodo "2026-11" y se intenta crear otro
- **ENTONCES** la operación se rechaza con `BUDGET_ALREADY_EXISTS`
- **Y** el plan existente no cambia

#### Scenario: Periodo cerrado no admite plan nuevo
- **CUANDO** se intenta crear el plan del periodo "2026-09", que está cerrado
- **ENTONCES** la operación se rechaza con `PERIOD_CLOSED`

### Requirement: Presupuesto por categoría con sus subcategorías
Un presupuesto de categoría de gasto DEBE (MUST) medir el gasto real de la categoría y de todas sus subcategorías dentro del rango de fechas del periodo, y NO DEBE (MUST NOT) incluir el gasto de otras categorías.
Trace: FR-PLANNING-015, FR-PLANNING-024 · Priority: Must

#### Scenario: Gasto de la subcategoría incluido
- **CUANDO** el plan de "2026-11" tiene "Supermercado" con máximo 1500.00 BOB, y en noviembre hay gastos de 400.00 BOB en "Supermercado", 150.00 BOB en su subcategoría "Carnes" y 200.00 BOB en "Restaurantes"
- **ENTONCES** el gastado de "Supermercado" es 550.00 BOB

#### Scenario: Gasto fuera del periodo excluido
- **CUANDO** además hay un gasto de 90.00 BOB en "Supermercado" con fecha de negocio 2026-10-31
- **ENTONCES** el gastado de "Supermercado" en "2026-11" sigue siendo 550.00 BOB

### Requirement: Ingresos esperados en el plan
El plan DEBE (MUST) admitir líneas de ingreso esperado por categoría de ingreso con un monto fijo, y DEBE (MUST) mostrar para cada una el ingreso real del periodo y su diferencia con lo esperado; las líneas de ingreso NO DEBEN (MUST NOT) admitir otro tipo que el fijo ni umbrales de alerta, que se rechazan con `BUDGET_INVALID_LINE_KIND`.
Trace: FR-PLANNING-008 · Priority: Must

#### Scenario: Salario esperado y recibido parcialmente
- **CUANDO** el plan de "2026-11" espera 8000.00 BOB en "Salario" y en noviembre se registró un ingreso de 6500.00 BOB en "Salario"
- **ENTONCES** la línea muestra esperado 8000.00 BOB, real 6500.00 BOB y diferencia −1500.00 BOB

#### Scenario: Línea de ingreso con tipo máximo rechazada
- **CUANDO** se intenta agregar "Salario" con tipo máximo
- **ENTONCES** la operación se rechaza con `BUDGET_INVALID_LINE_KIND`

### Requirement: Presupuesto de tipo fijo
Una línea de tipo fijo DEBE (MUST) representar un monto exacto planificado y DEBE (MUST) informar si el gastado está por debajo, en el objetivo o por encima del monto planificado, con el restante igual a planificado menos gastado.
Trace: FR-PLANNING-018 · Priority: Must

#### Scenario: Alquiler pagado exacto
- **CUANDO** "Alquiler" tiene un fijo de 2800.00 BOB en "2026-11" y el gastado del periodo es 2800.00 BOB
- **ENTONCES** la línea está en el objetivo con restante 0.00 BOB y 100.0 %

#### Scenario: Alquiler pagado de menos
- **CUANDO** el gastado de "Alquiler" es 2700.00 BOB
- **ENTONCES** la línea está por debajo del objetivo con restante 100.00 BOB

### Requirement: Presupuesto de tipo máximo
Una línea de tipo máximo DEBE (MUST) representar un tope de gasto y DEBE (MUST) marcarse como excedida cuando el gastado supera el tope, mostrando el exceso como restante negativo; el estado excedido NO DEBE (MUST NOT) comunicarse solo con color.
Trace: FR-PLANNING-018, NFR-USAB-104 · Priority: Must

#### Scenario: Restaurantes excedido
- **CUANDO** "Restaurantes" tiene un máximo de 600.00 BOB en "2026-11" y el gastado es 650.00 BOB
- **ENTONCES** la línea está excedida con restante −50.00 BOB y 108.3 %
- **Y** el estado excedido se indica con texto e icono además del color

### Requirement: Montos y objetivos válidos en las líneas del plan
Cada línea DEBE (MUST) tener montos no negativos en la moneda del plan y con la escala de esa moneda, y un objetivo activo; un monto negativo o un mínimo mayor que el máximo DEBEN (MUST) rechazarse con `BUDGET_INVALID_AMOUNTS`, otra moneda con `CURRENCY_MISMATCH`, más decimales que la escala con `AMOUNT_SCALE_EXCEEDED`, una categoría archivada con `CATEGORY_ARCHIVED` y un objetivo repetido en el plan con `BUDGET_LINE_DUPLICATE_TARGET`.
Trace: FR-PLANNING-015, FR-PLANNING-018 · Priority: Must

#### Scenario: Monto negativo rechazado
- **CUANDO** se intenta agregar "Supermercado" con máximo −100.00 BOB
- **ENTONCES** la operación se rechaza con `BUDGET_INVALID_AMOUNTS` y el plan no cambia

#### Scenario: Monto en otra moneda rechazado
- **CUANDO** se intenta agregar "Supermercado" con máximo 100.00 USD en un plan en BOB
- **ENTONCES** la operación se rechaza con `CURRENCY_MISMATCH`

#### Scenario: Escala excedida rechazada
- **CUANDO** se intenta agregar "Supermercado" con máximo 100.005 BOB
- **ENTONCES** la operación se rechaza con `AMOUNT_SCALE_EXCEEDED`

#### Scenario: Categoría archivada rechazada
- **CUANDO** se intenta agregar la categoría archivada "Gimnasio" al plan
- **ENTONCES** la operación se rechaza con `CATEGORY_ARCHIVED`

#### Scenario: Objetivo repetido rechazado
- **CUANDO** el plan ya tiene una línea de "Supermercado" y se intenta agregar otra para "Supermercado"
- **ENTONCES** la operación se rechaza con `BUDGET_LINE_DUPLICATE_TARGET`

### Requirement: Sin solapamiento de objetivos en un plan
Un plan NO DEBE (MUST NOT) contener a la vez una línea de una categoría y otra de una de sus subcategorías, ni una línea de un grupo y otra de una categoría de ese grupo; el intento DEBE (MUST) rechazarse con `BUDGET_TARGET_OVERLAP` para que ningún gasto cuente en dos líneas del plan.
Trace: FR-PLANNING-015, FR-PLANNING-016, FR-PLANNING-024 · Priority: Must

#### Scenario: Subcategoría de una categoría presupuestada
- **CUANDO** el plan tiene "Supermercado" y se intenta agregar su subcategoría "Carnes"
- **ENTONCES** la operación se rechaza con `BUDGET_TARGET_OVERLAP`

#### Scenario: Categoría de un grupo presupuestado
- **CUANDO** el plan tiene el grupo "Alimentación" y se intenta agregar "Restaurantes", que pertenece a ese grupo
- **ENTONCES** la operación se rechaza con `BUDGET_TARGET_OVERLAP`

### Requirement: Gasto real derivado de transacciones posteadas
El gastado de una línea DEBE (MUST) derivarse solo de los movimientos de ingreso o gasto de transacciones posteadas, conciliadas o reconciliadas, neto de reembolsos y por fecha de negocio en la zona horaria del workspace; NO DEBE (MUST NOT) incluir transacciones pendientes o anuladas, el principal de transferencias y conversiones, saldos iniciales ni ajustes, y NO DEBE (MUST NOT) poder editarse a mano.
Trace: FR-PLANNING-023, FR-PLANNING-024 · Priority: Must

#### Scenario: Reembolso, pendiente y anulada
- **CUANDO** en noviembre "Restaurantes" tiene un gasto posteado de 300.00 BOB, un reembolso posteado de 50.00 BOB, un gasto pendiente de 80.00 BOB y un gasto anulado de 120.00 BOB
- **ENTONCES** el gastado de "Restaurantes" es 250.00 BOB

#### Scenario: Transferencia sin efecto en el plan
- **CUANDO** se transfieren 500.00 BOB de "Banco BOB" a "Caja BOB" el 2026-11-05 con comisión de 2.00 BOB
- **ENTONCES** ninguna línea de gasto cambia salvo la de la categoría de sistema de comisiones, que suma 2.00 BOB

#### Scenario: Gasto de medianoche asignado por fecha de negocio
- **CUANDO** un gasto de 40.00 BOB en "Restaurantes" tiene fecha de negocio 2026-11-30 y se registró el 2026-12-01T02:30:00Z (22:30 del 30 en La Paz)
- **ENTONCES** cuenta en el gastado de "2026-11" y no en el de "2026-12"

### Requirement: Gasto en otra moneda convertido con la tasa de su fecha
El gastado en una moneda distinta de la del plan DEBE (MUST) convertirse a la moneda del plan con la tasa de valoración vigente al cierre del día de negocio de cada movimiento, seleccionada con las mismas reglas que los flujos del resumen de Reporting (tipo preferido del par, provider con fallback y ventana de vigencia configurada en Reporting); NO DEBE (MUST NOT) recalcularse con tasas registradas después.
Trace: FR-PLANNING-023, FR-REPORTING-002 · Priority: Must

#### Scenario: Gasto en USD y en BOB
- **CUANDO** "Restaurantes" tiene un gasto de 20.00 USD el 2026-11-12, la tasa `PARALLEL` USD/BOB del provider vigente al cierre de ese día es 12.05, y otro gasto de 100.00 BOB el 2026-11-13
- **ENTONCES** el gastado de "Restaurantes" es 341.00 BOB (20.00 × 12.05 + 100.00)
- **Y** la respuesta informa la tasa 12.05 usada con su tipo, fuente y vigencia

#### Scenario: Tasa posterior no recalcula
- **CUANDO** el 2026-11-20 se registra la tasa `PARALLEL` USD/BOB 12.40
- **ENTONCES** el gastado de "Restaurantes" sigue siendo 341.00 BOB

### Requirement: Gasto sin tasa disponible informado sin convertir
Si un movimiento no tiene tasa de valoración dentro de la ventana de vigencia, el gastado DEBE (MUST) mostrar la parte convertida y, aparte, el monto sin convertir en su moneda original, marcado como incompleto; NO DEBE (MUST NOT) convertir a 1:1 ni omitir el monto en silencio.
Trace: FR-PLANNING-023, FR-REPORTING-002 · Priority: Must

#### Scenario: Gasto en EUR sin tasa
- **CUANDO** además de los 341.00 BOB convertidos, "Restaurantes" tiene un gasto de 5.00 EUR el 2026-11-14 y no existe tasa EUR/BOB en los 7 días previos
- **ENTONCES** el gastado de "Restaurantes" es 341.00 BOB marcado como incompleto con 5.00 EUR sin convertir
- **Y** el gastado no es 346.00 BOB

### Requirement: Progreso por línea con restante, porcentaje y proyección
Para cada línea el sistema DEBE (MUST) mostrar planificado efectivo, gastado, restante y porcentaje de uso (gastado / planificado × 100, un decimal HALF_EVEN); las líneas de máximo, rango y porcentaje de ingresos DEBEN (MUST) mostrar además la proyección lineal al fin del periodo (gastado / días transcurridos × días del periodo, en la zona del workspace), y las líneas fijas y de mínimo NO DEBEN (MUST NOT) proyectar: DEBEN (MUST) mostrarse como pendientes mientras el gastado no alcance su monto de referencia y como cumplidas cuando lo alcance; con planificado 0.00 el porcentaje DEBE (MUST) quedar sin definir y la línea marcarse "sin presupuesto".
Trace: FR-PLANNING-024 · Priority: Must

#### Scenario: Proyección a mitad de mes
- **CUANDO** "Supermercado" tiene máximo 1500.00 BOB, gastado 550.00 BOB y se consulta el 2026-11-10 (10 de 30 días transcurridos)
- **ENTONCES** la línea muestra restante 950.00 BOB, 36.7 % y proyección 1650.00 BOB
- **Y** se indica que la proyección supera el máximo

#### Scenario: Periodo terminado
- **CUANDO** se consulta "Supermercado" de "2026-10" el 2026-11-10 con gastado 1320.00 BOB
- **ENTONCES** la proyección es igual al gastado, 1320.00 BOB

#### Scenario: Línea fija sin proyección
- **CUANDO** "Alquiler" tiene un fijo de 2800.00 BOB, se pagaron 2800.00 BOB el 2026-11-01 y se consulta el 2026-11-02 (2 de 30 días transcurridos)
- **ENTONCES** la línea no muestra proyección (y no 42000.00 BOB) y se muestra cumplida, con restante 0.00 BOB y 100.0 %
- **Y** el 2026-11-01, antes del pago, la misma línea se mostraba pendiente, sin proyección

#### Scenario: Línea sin presupuesto con gasto
- **CUANDO** "Regalos" tiene planificado 0.00 BOB y gastado 40.00 BOB
- **ENTONCES** la línea se marca "sin presupuesto" con porcentaje sin definir y restante −40.00 BOB

### Requirement: Disponible para gastar agregado
El plan DEBE (MUST) mostrar un "disponible para gastar" igual a la suma, sobre las líneas de gasto de categoría y grupo, del máximo entre cero y (monto de referencia − gastado), donde la referencia es el planificado efectivo (fijo, máximo y porcentaje de ingresos), el máximo (rango) o el mínimo (mínimo); las líneas de tag NO DEBEN (MUST NOT) sumarse.
Trace: FR-PLANNING-024 · Priority: Must

#### Scenario: Disponible con una línea excedida
- **CUANDO** el plan tiene "Supermercado" máximo 1500.00 BOB con gastado 550.00 BOB, "Restaurantes" máximo 600.00 BOB con gastado 650.00 BOB y "Alquiler" fijo 2800.00 BOB con gastado 0.00 BOB
- **ENTONCES** el disponible para gastar es 3750.00 BOB (950.00 + 0.00 + 2800.00)

### Requirement: Umbrales de alerta por línea
Cada línea de gasto de tipo fijo, máximo, rango o porcentaje de ingresos DEBE (MUST) tener umbrales de alerta, por defecto 50, 75, 90 y 100 %, reemplazables por hasta 10 umbrales personalizados mayores que 0 y de hasta 1000 % con a lo sumo dos decimales; un umbral fuera de rango o repetido DEBE (MUST) rechazarse con `BUDGET_THRESHOLD_INVALID`.
Trace: FR-PLANNING-022 · Priority: Must

#### Scenario: Umbrales por defecto
- **CUANDO** se agrega "Restaurantes" con máximo 600.00 BOB sin indicar umbrales
- **ENTONCES** la línea tiene los umbrales 50, 75, 90 y 100 %

#### Scenario: Umbrales personalizados
- **CUANDO** se configuran los umbrales 80 y 110 % en "Restaurantes"
- **ENTONCES** la línea tiene exactamente los umbrales 80 y 110 %

#### Scenario: Umbral fuera de rango rechazado
- **CUANDO** se intenta configurar el umbral 0 % o 1001 %
- **ENTONCES** la operación se rechaza con `BUDGET_THRESHOLD_INVALID` y los umbrales no cambian

### Requirement: Cruce de umbral emitido una sola vez por umbral y periodo
Cuando el gastado de una línea alcanza o supera un umbral (gastado ≥ umbral × referencia / 100), el sistema DEBE (MUST) registrar el cruce y emitir el hecho de umbral alcanzado una sola vez por objetivo, umbral y periodo, aunque el gastado baje y vuelva a subir, se reprocesen eventos o la evaluación corra en paralelo.
Trace: FR-PLANNING-022 · Priority: Must

#### Scenario: Cruce del 50 %
- **CUANDO** "Restaurantes" (máximo 600.00 BOB) tiene gastado 280.00 BOB y se postea un gasto de 30.00 BOB
- **ENTONCES** se emite un único hecho de umbral 50 % con planificado 600.00 BOB y gastado 310.00 BOB

#### Scenario: Sin re-emisión tras bajar y volver a subir
- **CUANDO** luego un reembolso de 40.00 BOB baja el gastado a 270.00 BOB y un gasto de 60.00 BOB lo sube a 330.00 BOB
- **ENTONCES** no se emite ningún hecho nuevo de umbral 50 %

#### Scenario: Evento de transacción reprocesado
- **CUANDO** el evento del gasto de 30.00 BOB se entrega dos veces
- **ENTONCES** sigue existiendo un solo cruce del umbral 50 % y un solo hecho emitido

### Requirement: Cruce simultáneo de varios umbrales
Si un mismo cambio hace cruzar varios umbrales de una línea, el sistema DEBE (MUST) emitir un único hecho con el umbral más alto cruzado e indicar los umbrales menores cruzados a la vez, registrando todos como cruzados para que NO DEBAN (MUST NOT) emitirse después.
Trace: FR-PLANNING-022 · Priority: Must

#### Scenario: Del 46.7 % al 91.7 %
- **CUANDO** "Restaurantes" (máximo 600.00 BOB) tiene gastado 280.00 BOB y se postea un gasto de 270.00 BOB
- **ENTONCES** se emite un único hecho de umbral 90 % indicando también 50 y 75 % con gastado 550.00 BOB
- **Y** al llegar después a 600.00 BOB se emite solo el hecho de umbral 100 %

### Requirement: Cambio del planificado reevalúa los umbrales
Al cambiar el planificado o los umbrales de una línea de un periodo no cerrado, el sistema DEBE (MUST) reevaluar sus umbrales con el gastado vigente en la misma operación y emitir el hecho de los umbrales que queden cruzados por primera vez.
Trace: FR-PLANNING-022 · Priority: Must

#### Scenario: Bajar el máximo cruza el 90 %
- **CUANDO** "Restaurantes" tiene gastado 470.00 BOB con máximo 600.00 BOB (78.3 %, ya cruzados 50 y 75 %) y el EDITOR baja el máximo a 500.00 BOB
- **ENTONCES** se emite un único hecho de umbral 90 % con planificado 500.00 BOB y gastado 470.00 BOB

### Requirement: Plan de un periodo cerrado inmutable
Las líneas del plan de un periodo cerrado NO DEBEN (MUST NOT) modificarse: crear, editar o eliminar líneas DEBE (MUST) rechazarse con `PERIOD_CLOSED`; mientras el periodo esté cerrado NO DEBEN (MUST NOT) evaluarse umbrales, y al reabrirlo los cruces ya registrados se conservan.
Trace: FR-PLANNING-005, FR-PLANNING-022 · Priority: Must

#### Scenario: Editar una línea de octubre cerrado
- **CUANDO** el periodo "2026-10" está cerrado y se intenta cambiar el máximo de "Restaurantes" de 600.00 BOB a 700.00 BOB
- **ENTONCES** la operación se rechaza con `PERIOD_CLOSED` y la línea conserva 600.00 BOB

### Requirement: Permisos y auditoría del plan
Leer el plan y su progreso DEBE (MUST) estar permitido a todo miembro (incluido VIEWER); crear o modificar planes y líneas DEBE (MUST) exigir rol EDITOR u OWNER (si no, `INSUFFICIENT_ROLE`) y DEBE (MUST) quedar auditado con antes y después en la misma operación.
Trace: FR-IDENTITY-006, FR-AUDIT-001 · Priority: Must

#### Scenario: VIEWER lee pero no edita
- **CUANDO** un VIEWER consulta el plan de "2026-11" e intenta agregar una línea
- **ENTONCES** la consulta responde con el progreso y la escritura se rechaza con `INSUFFICIENT_ROLE`

#### Scenario: Cambio auditado
- **CUANDO** el EDITOR cambia el máximo de "Supermercado" de 1500.00 BOB a 1400.00 BOB
- **ENTONCES** el historial del plan registra al EDITOR, la línea y los valores antes 1500.00 BOB y después 1400.00 BOB

### Requirement: Presupuesto por grupo de categorías
El plan DEBE (MUST) admitir líneas por grupo de categorías de gasto cuyo gastado sea la suma de todas las categorías y subcategorías del grupo en el periodo.
Trace: FR-PLANNING-016 · Priority: Should

#### Scenario: Grupo Vivienda
- **CUANDO** el plan tiene el grupo "Vivienda" con máximo 3200.00 BOB y en noviembre hay 2800.00 BOB en "Alquiler", 250.00 BOB en "Servicios básicos" y 60.00 BOB en su subcategoría "Luz"
- **ENTONCES** el gastado del grupo "Vivienda" es 3110.00 BOB con restante 90.00 BOB

### Requirement: Presupuesto de tipo mínimo
Una línea de tipo mínimo DEBE (MUST) representar un gasto o aporte mínimo esperado e informar cuánto falta para alcanzarlo o que fue cumplido; NO DEBE (MUST NOT) tener umbrales de alerta.
Trace: FR-PLANNING-019 · Priority: Should

#### Scenario: Mínimo pendiente y cumplido
- **CUANDO** "Educación" tiene un mínimo de 400.00 BOB y gastado 250.00 BOB
- **ENTONCES** la línea indica que faltan 150.00 BOB para el mínimo
- **Y** con gastado 450.00 BOB indica mínimo cumplido

### Requirement: Presupuesto de tipo rango
Una línea de tipo rango DEBE (MUST) tener un mínimo y un máximo e informar si el gastado está por debajo, dentro o por encima del rango; sus umbrales DEBEN (MUST) evaluarse contra el máximo.
Trace: FR-PLANNING-019 · Priority: Should

#### Scenario: Rango de supermercado
- **CUANDO** "Supermercado" tiene un rango de 1200.00 a 1500.00 BOB
- **ENTONCES** con gastado 1100.00 BOB está por debajo, con 1350.00 BOB está dentro y con 1550.00 BOB está por encima con exceso de 50.00 BOB

### Requirement: Rollover del remanente al periodo siguiente
Una línea con rollover DEBE (MUST) sumar a su planificado del periodo siguiente el remanente del periodo anterior (solo positivo, o positivo y negativo según la política), acotado por el tope opcional, y el planificado efectivo NO DEBE (MUST NOT) quedar por debajo de 0.00.
Trace: FR-PLANNING-020 · Priority: Should

#### Scenario: Remanente positivo trasladado
- **CUANDO** "Restaurantes" tiene máximo 600.00 BOB con rollover solo positivo, en "2026-10" se gastaron 520.00 BOB y en "2026-11" el máximo es 600.00 BOB
- **ENTONCES** el planificado efectivo de "2026-11" es 680.00 BOB

#### Scenario: Remanente con tope
- **CUANDO** el rollover tiene tope de 50.00 BOB
- **ENTONCES** el planificado efectivo de "2026-11" es 650.00 BOB

#### Scenario: Exceso trasladado con política completa
- **CUANDO** en "2026-10" se gastaron 650.00 BOB y la política traslada positivo y negativo
- **ENTONCES** el planificado efectivo de "2026-11" es 550.00 BOB
- **Y** con la política solo positiva es 600.00 BOB

### Requirement: Rollover provisional hasta el cierre del periodo anterior
Mientras el periodo anterior no esté cerrado, el remanente trasladado DEBE (MUST) mostrarse como provisional y recalcularse con su gastado vigente; al cerrarse DEBE (MUST) quedar definitivo, y si se reabre y vuelve a cerrar DEBE (MUST) recalcularse para el periodo siguiente si este no está cerrado.
Trace: FR-PLANNING-020, FR-PLANNING-006 · Priority: Should

#### Scenario: Reapertura con gasto adicional
- **CUANDO** "2026-10" se cerró con remanente de 80.00 BOB en "Restaurantes", se reabre, se registra un gasto de 30.00 BOB del 2026-10-28 y se vuelve a cerrar
- **ENTONCES** el remanente trasladado a "2026-11" pasa a 50.00 BOB y su planificado efectivo a 650.00 BOB

### Requirement: Presupuesto como porcentaje de ingresos
Una línea de porcentaje de ingresos DEBE (MUST) calcular su planificado como el porcentaje sobre los ingresos esperados del plan o sobre los ingresos reales del periodo a la fecha, según la política elegida, redondeado HALF_EVEN a la escala de la moneda del plan.
Trace: FR-PLANNING-020 · Priority: Should

#### Scenario: 10 % de los ingresos esperados
- **CUANDO** el plan espera ingresos por 8000.00 BOB y "Donaciones" es el 10 % de los ingresos esperados
- **ENTONCES** el planificado de "Donaciones" es 800.00 BOB

#### Scenario: 10 % de los ingresos reales
- **CUANDO** la política es ingresos reales y a la fecha ingresaron 6500.00 BOB
- **ENTONCES** el planificado de "Donaciones" es 650.00 BOB

#### Scenario: Redondeo del porcentaje
- **CUANDO** el plan espera 8000.50 BOB y "Donaciones" es el 12.5 % de los ingresos esperados
- **ENTONCES** el planificado de "Donaciones" es 1000.06 BOB (1000.0625 redondeado HALF_EVEN)

### Requirement: Plan base cero con monto por asignar
Un plan en modo base cero DEBE (MUST) mostrar el monto "por asignar" igual a los ingresos esperados menos la suma de los planificados de gasto, que es 0.00 cuando todo el ingreso esperado está asignado y negativo si se asignó de más.
Trace: FR-PLANNING-021 · Priority: Could

#### Scenario: Por asignar hasta cero
- **CUANDO** un plan base cero espera 8000.00 BOB y sus líneas de gasto planifican 7500.00 BOB
- **ENTONCES** el monto por asignar es 500.00 BOB
- **Y** al agregar "Ahorro programado" con fijo 500.00 BOB el monto por asignar es 0.00 BOB

### Requirement: Presupuesto por tag
El plan DEBE (MUST) admitir líneas por tag cuyo gastado sea la suma de los movimientos de gasto con ese tag en el periodo, de cualquier categoría; estas líneas NO DEBEN (MUST NOT) entrar en el disponible para gastar.
Trace: FR-PLANNING-017 · Priority: Could

#### Scenario: Tag de viaje
- **CUANDO** el plan tiene el tag "Viaje Santa Cruz" con máximo 2000.00 BOB y en noviembre hay gastos con ese tag de 1200.00 BOB en "Transporte" y 300.00 BOB en "Restaurantes"
- **ENTONCES** el gastado del tag es 1500.00 BOB
- **Y** el disponible para gastar no incluye esa línea
