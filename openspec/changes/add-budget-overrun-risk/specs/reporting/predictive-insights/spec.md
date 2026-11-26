## ADDED Requirements

### Requirement: Riesgo de exceder una línea de gasto
Para cada línea de gasto de categoría o de grupo de tipo máximo, rango o porcentaje de ingresos del plan del periodo en curso, el sistema DEBE (MUST) proyectar el gasto al fin del periodo como el gastado más los pagos conocidos pendientes más el gasto variable restante, y comparar esa proyección con la referencia de la línea (el planificado efectivo, o el máximo en un rango): el riesgo DEBE (MUST) ser «probable» si la proyección supera la referencia, y «improbable» si no. Sin pronóstico, el gasto variable restante DEBE (MUST) ser el gastado variable dividido por los días transcurridos (incluido hoy) y multiplicado por los días que faltan, en la zona del workspace. Los cálculos DEBEN (MUST) hacerse con Decimal y los montos mostrados redondearse con HALF_EVEN a la escala de la moneda del plan.
Trace: FR-REPORTING-020, FR-PLANNING-024, NFR-DATA-001, NFR-DATA-002 · Priority: Should

#### Scenario: Restaurantes al ritmo del periodo
- **CUANDO** el periodo va del 2026-11-01 al 2026-11-30, "Restaurantes" tiene máximo 600.00 BOB, gastado 280.00 BOB, sin pagos conocidos pendientes, y se consulta el 2026-11-10
- **ENTONCES** la proyección es 840.00 BOB y el riesgo es «probable»

#### Scenario: Ritmo dentro del tope
- **CUANDO** con el mismo periodo "Supermercado" tiene máximo 1500.00 BOB y gastado 400.00 BOB el 2026-11-10
- **ENTONCES** la proyección es 1200.00 BOB y el riesgo es «improbable»

### Requirement: Pagos conocidos en la proyección
La proyección DEBE (MUST) sumar como pagos conocidos pendientes las ocurrencias de compromisos pendientes con la categoría de la línea (o de una categoría del grupo) que vencen hasta el fin del periodo, y NO DEBE (MUST NOT) extrapolar el gasto ya resuelto por ocurrencias de compromisos: el gastado variable DEBE (MUST) ser el gastado menos lo pagado en el periodo por esas ocurrencias. Un pago conocido en otra moneda DEBE (MUST) convertirse con la tasa vigente; sin tasa NO DEBE (MUST NOT) sumarse y la línea DEBE (MUST) indicar que la proyección está incompleta.
Trace: FR-REPORTING-020, FR-COMMITMENTS-010 · Priority: Should

#### Scenario: Una factura pendiente que lleva al exceso
- **CUANDO** "Servicios" tiene máximo 500.00 BOB, gastado variable 100.00 BOB y una ocurrencia pendiente de "Luz" de 300.00 BOB que vence el 2026-11-20, y se consulta el 2026-11-10
- **ENTONCES** la proyección es 600.00 BOB y el riesgo es «probable»

#### Scenario: Un pago fijo no se extrapola
- **CUANDO** "Servicios" tiene máximo 600.00 BOB y gastado 300.00 BOB, de los cuales 250.00 BOB son el pago de la ocurrencia "Internet" del 2026-11-02, y se consulta el 2026-11-10
- **ENTONCES** la proyección es 400.00 BOB (300.00 + 50.00 / 10 × 20) y el riesgo es «improbable»

### Requirement: Banda del pronóstico en el riesgo
Con los pronósticos habilitados y un pronóstico vigente con la serie de la categoría de la línea para el periodo en curso, el gasto variable restante DEBE (MUST) ser el esperado del periodo menos el gastado variable (nunca negativo), y DEBE (MUST) calcularse además una proyección alta con el límite superior del intervalo del 80 %; el riesgo DEBE (MUST) ser «posible» cuando solo la proyección alta supera la referencia. Sin ese pronóstico, o en una línea de grupo, DEBE (MUST) usarse el ritmo del periodo y el riesgo «posible» NO DEBE (MUST NOT) informarse.
Trace: FR-REPORTING-020, FR-FORECAST-001, FR-FORECAST-004 · Priority: Should

#### Scenario: Riesgo posible con la banda
- **CUANDO** "Supermercado" tiene máximo 1500.00 BOB y gastado variable 560.00 BOB el 2026-11-10, y el pronóstico vigente espera para "Supermercado" en 2026-11 1400.00 BOB con límite superior del 80 % de 1620.00 BOB
- **ENTONCES** la proyección es 1400.00 BOB, la proyección alta 1620.00 BOB y el riesgo es «posible»

#### Scenario: Pronósticos deshabilitados
- **CUANDO** los pronósticos están deshabilitados y "Supermercado" tiene máximo 1500.00 BOB y gastado 560.00 BOB el 2026-11-10
- **ENTONCES** la proyección es 1680.00 BOB por el ritmo del periodo, el riesgo es «probable» y no hay proyección alta

### Requirement: Fecha estimada del exceso
Con riesgo «probable» o «posible», el sistema DEBE (MUST) informar la fecha estimada del exceso: el primer día en que el gastado más los pagos conocidos vencidos hasta ese día más el gasto variable restante repartido por igual entre los días que faltan supera la referencia, usando la proyección esperada para «probable» y la alta para «posible».
Trace: FR-REPORTING-020 · Priority: Should

#### Scenario: Exceso el día 22
- **CUANDO** "Restaurantes" tiene máximo 600.00 BOB y gastado 280.00 BOB el 2026-11-10 en un periodo de 30 días
- **ENTONCES** la fecha estimada del exceso es el 2026-11-22 (280.00 + 28.00 × 12 = 616.00)

#### Scenario: Exceso por la factura pendiente
- **CUANDO** "Servicios" tiene máximo 500.00 BOB, gastado variable 100.00 BOB y la ocurrencia de "Luz" de 300.00 BOB vence el 2026-11-20, consultado el 2026-11-10
- **ENTONCES** la fecha estimada del exceso es el 2026-11-21

### Requirement: Líneas sin riesgo calculable
El riesgo DEBE (MUST) informarse como no disponible, con el motivo, en las líneas fijas y de mínimo, en las líneas con planificado 0.00 y cuando no hay plan para el periodo en curso; y, sin pronóstico, mientras hayan transcurrido menos de 7 días del periodo, salvo que el gastado más los pagos conocidos ya superen la referencia. Una línea cuyo gastado ya supera la referencia DEBE (MUST) informarse como «excedida», sin fecha estimada. Las líneas de etiqueta y de ingreso NO DEBEN (MUST NOT) evaluarse.
Trace: FR-REPORTING-020, FR-PLANNING-024 · Priority: Should

#### Scenario: Demasiado temprano
- **CUANDO** "Restaurantes" tiene máximo 600.00 BOB y gastado 90.00 BOB el 2026-11-03, sin pronóstico
- **ENTONCES** el riesgo no está disponible con el motivo «faltan datos del periodo» (en vez de proyectar 900.00 BOB)

#### Scenario: Línea fija
- **CUANDO** "Alquiler" es una línea fija de 2800.00 BOB
- **ENTONCES** el riesgo no está disponible con el motivo «tipo de línea»

#### Scenario: Línea ya excedida
- **CUANDO** "Restaurantes" tiene máximo 600.00 BOB y gastado 650.00 BOB
- **ENTONCES** la línea se informa como «excedida», sin fecha estimada

### Requirement: Riesgo en el plan del periodo
El plan del periodo en curso DEBE (MUST) mostrar en cada línea evaluada su riesgo, la proyección (y la alta si existe), la fecha estimada del exceso y si la proyección usó el pronóstico o el ritmo del periodo; el riesgo NO DEBE (MUST NOT) cambiar el planificado, el gastado, los umbrales, el disponible para gastar ni ninguna otra cifra del plan.
Trace: FR-REPORTING-020, FR-PLANNING-024 · Priority: Must

#### Scenario: Plan con una línea en riesgo
- **CUANDO** un miembro abre el plan de 2026-11 el 2026-11-10 con "Restaurantes" en riesgo «probable»
- **ENTONCES** la línea "Restaurantes" muestra riesgo probable, proyección 840.00 BOB, exceso estimado el 22/11/2026 y «según el ritmo del periodo»
- **Y** el planificado, el gastado, el restante y el disponible para gastar son los mismos que sin el riesgo

### Requirement: Textos del riesgo por plantilla y sin certeza
Los textos del riesgo DEBEN (MUST) generarse por plantilla, sin modelos de lenguaje, en el idioma del usuario, y NO DEBEN (MUST NOT) presentar la proyección como certeza: DEBEN (MUST) hablar de ritmo o tendencia y de fecha estimada.
Trace: FR-REPORTING-020, FR-FORECAST-004, NFR-USAB-001 · Priority: Should

#### Scenario: Texto del riesgo probable
- **CUANDO** "Restaurantes" tiene riesgo «probable» con exceso estimado el 2026-11-22 y el usuario tiene locale es-BO
- **ENTONCES** el texto dice que con el ritmo actual "Restaurantes" superaría su tope alrededor del 22/11/2026

### Requirement: Evaluación periódica del riesgo sin consumidores nuevos
El riesgo DEBE (MUST) calcularse en cada lectura del plan y del Home, y evaluarse para los avisos en el trabajo periódico existente del flujo de caja, de a un workspace por vez, sin consumir eventos ni sumar consumidores o conexiones al presupuesto vigente; con el servicio de pronósticos apagado DEBE (MUST) calcularse con el ritmo del periodo, y DEBE (MUST) poder deshabilitarse por instalación.
Trace: FR-REPORTING-020, FR-FORECAST-006, NFR-REL-010 · Priority: Must

#### Scenario: Servicio de pronósticos apagado
- **CUANDO** el servicio de pronósticos está detenido y un miembro abre el plan de 2026-11
- **ENTONCES** el plan muestra el riesgo de cada línea calculado con el ritmo del periodo

#### Scenario: Presupuesto de conexiones intacto
- **CUANDO** el worker arranca con la plantilla del host y el riesgo de presupuesto habilitado
- **ENTONCES** la cantidad de consumidores y las conexiones validadas al arrancar son las mismas que sin la función

### Requirement: Permisos y aislamiento del riesgo
Todo miembro del workspace DEBE (MUST) poder ver el riesgo de las líneas del plan; el riesgo de un workspace NO DEBE (MUST NOT) leerse desde otro (404 `RESOURCE_NOT_FOUND` con un periodo de otro workspace), y los avisos registrados DEBEN (MUST) quedar aislados por workspace con seguridad a nivel de fila forzada.
Trace: FR-REPORTING-020, FR-IDENTITY-006, NFR-SEC-003 · Priority: Must

#### Scenario: Periodo de otro workspace
- **CUANDO** el OWNER de "W1" pide el riesgo de un periodo de "W2"
- **ENTONCES** se responde 404 `RESOURCE_NOT_FOUND`

### Requirement: Rendimiento del riesgo
El riesgo de un plan de 40 líneas DEBE (MUST) responder en a lo sumo 300 ms p95, y el resumen del Home con las líneas en riesgo DEBE (MUST) seguir en a lo sumo 300 ms p95.
Trace: FR-REPORTING-020, NFR-PERF-004 · Priority: Should

#### Scenario: Plan grande
- **CUANDO** el plan del periodo en curso tiene 40 líneas con 3000 gastos y 20 ocurrencias pendientes
- **ENTONCES** el riesgo del plan responde en a lo sumo 300 ms p95
