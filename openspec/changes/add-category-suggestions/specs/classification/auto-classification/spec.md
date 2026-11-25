## ADDED Requirements

### Requirement: Sugerencia de categoría por historial
Para una transacción de ingreso, gasto o reembolso sin categoría elegida, el sistema DEBE (MUST) sugerir la categoría que el usuario eligió con más frecuencia para el mismo patrón en su historial, con una confianza igual a las transacciones del patrón en esa categoría divididas por el total de transacciones del patrón del mismo tipo, con 4 decimales HALF_EVEN. Solo DEBE (MUST) sugerir cuando el patrón tiene al menos 2 transacciones, la confianza es al menos 0.7000 y la categoría tiene más transacciones que cualquier otra; el nivel DEBE (MUST) ser «alta» con confianza de al menos 0.9000 y 5 o más transacciones, y «media» en otro caso.
Trace: FR-CLASSIFICATION-014 · Priority: Should

#### Scenario: Nueve de diez
- **CUANDO** hay 10 gastos "PEDIDOSYA" clasificados por el usuario, 9 en "Restaurantes" y 1 en "Supermercado", y se registra un gasto nuevo "PEDIDOSYA *8812"
- **ENTONCES** se sugiere "Restaurantes" con confianza 0.9000 y nivel «alta»

#### Scenario: Siete de diez
- **CUANDO** el patrón tiene 10 gastos, 7 en "Restaurantes" y 3 en "Supermercado"
- **ENTONCES** se sugiere "Restaurantes" con confianza 0.7000 y nivel «media»

#### Scenario: Seis de nueve no alcanza
- **CUANDO** el patrón tiene 9 gastos, 6 en "Restaurantes" y 3 en "Supermercado"
- **ENTONCES** no se sugiere ninguna categoría (confianza 0.6667)

#### Scenario: Empate o una sola transacción
- **CUANDO** un patrón tiene 2 gastos en "Taxi" y 2 en "Viajes", y otro tiene un solo gasto
- **ENTONCES** no se sugiere ninguna categoría para ninguno de los dos

### Requirement: Historial que cuenta para la sugerencia
Solo DEBEN (MUST) contar las transacciones de ingreso, gasto o reembolso no anuladas de los últimos 365 días, de un único split, no administradas por otro módulo, cuya categoría vigente fijó el usuario (origen manual, u origen desconocido en transacciones registradas a mano o importadas), con la misma regla de evidencia que las sugerencias de reglas, y hasta las 5000 más recientes. Una categoría archivada o «sin categoría» NO DEBE (MUST NOT) sugerirse.
Trace: FR-CLASSIFICATION-014, FR-RULES-011 · Priority: Should

#### Scenario: Clasificaciones hechas por una regla no cuentan
- **CUANDO** 6 gastos "HIPERMAXI SUC 12" tienen la categoría "Supermercado" fijada por una regla hoy desactivada
- **ENTONCES** esos gastos no cuentan y no se sugiere categoría para "HIPERMAXI SUC 12" por ellos

#### Scenario: Categoría archivada
- **CUANDO** los 5 gastos del patrón "GIMNASIO BODYTECH" están en "Gimnasio" y "Gimnasio" se archivó
- **ENTONCES** no se sugiere "Gimnasio"

### Requirement: Patrones por contraparte y por descripción
El sistema DEBE (MUST) evaluar dos patrones: la contraparte de la transacción y la clave de descripción normalizada de las sugerencias de reglas (sin acentos, en minúsculas, sin palabras con dígitos o asteriscos ni de un carácter, hasta 5 palabras y con al menos 3 letras). Si los dos sugieren la misma categoría, DEBE (MUST) mostrarse una sola sugerencia con los dos motivos y la confianza mayor; si sugieren categorías distintas, DEBE (MUST) ganar la de mayor confianza y, con la misma confianza, la de la contraparte.
Trace: FR-CLASSIFICATION-014, FR-RULES-011 · Priority: Should

#### Scenario: Contraparte frente a descripción
- **CUANDO** los 4 gastos con la contraparte "Farmacorp" están en "Farmacia" y de los 4 gastos con la clave `compra tarj farmacorp suc` 3 están en "Salud", y se registra un gasto "COMPRA TARJ ****1234 FARMACORP SUC 3" con la contraparte "Farmacorp"
- **ENTONCES** se sugiere "Farmacia" con confianza 1.0000 por la contraparte

#### Scenario: Los dos patrones coinciden
- **CUANDO** los dos patrones sugieren "Restaurantes", con confianzas 0.8000 por la descripción y 0.9000 por la contraparte
- **ENTONCES** se muestra una sola sugerencia de "Restaurantes" con confianza 0.9000 y los dos motivos

### Requirement: Las reglas y la elección del usuario siempre ganan
La sugerencia por historial NO DEBE (MUST NOT) calcularse ni mostrarse para una transacción o fila cuya categoría ya eligió el usuario, la fijó una regla o la propuso la categoría por defecto de su contraparte; en el alta manual, si una regla activa con el disparador de alta manual fijaría la categoría, DEBE (MUST) informarse que una regla la clasificará, sin sugerencia.
Trace: FR-CLASSIFICATION-014, FR-RULES-006, FR-RULES-009 · Priority: Must

#### Scenario: Una regla clasifica el gasto
- **CUANDO** la regla activa "Supermercado" (con alta manual) fija "Supermercado" para "HIPERMAXI" y el historial sugeriría "Hogar"
- **ENTONCES** la consulta de sugerencia responde que la regla "Supermercado" clasificará el gasto, sin sugerencia

#### Scenario: Fila del import ya clasificada
- **CUANDO** en la vista previa una regla propuso "Transporte" para la fila "UBER TRIP" y otra fila tiene la categoría "Hogar" elegida por el usuario
- **ENTONCES** ninguna de las dos filas muestra sugerencia por historial

### Requirement: Ninguna sugerencia se aplica sin confirmación
Una sugerencia por historial NO DEBE (MUST NOT) asignar la categoría ni cambiar ninguna transacción o fila sin una acción explícita del usuario: aceptarla en el formulario, aceptarla en una fila o aceptar en lote las sugerencias de un nivel en la vista previa. La categoría aceptada DEBE (MUST) quedar con origen manual; una fila o transacción con sugerencia no aceptada DEBE (MUST) crearse sin categoría.
Trace: FR-CLASSIFICATION-014 · Priority: Must

#### Scenario: Aprobar un import sin aceptar las sugerencias
- **CUANDO** la vista previa tiene 25 filas con sugerencia que el usuario no aceptó y el EDITOR aprueba la importación
- **ENTONCES** las 25 transacciones se crean «sin categoría»

#### Scenario: Aceptar en el formulario
- **CUANDO** el usuario acepta la sugerencia "Restaurantes" y guarda el gasto
- **ENTONCES** el gasto queda en "Restaurantes" con origen manual

### Requirement: Sugerencia en el alta manual
En el formulario de alta de una transacción de ingreso, gasto o reembolso, mientras la categoría esté vacía, el sistema DEBE (MUST) mostrar la sugerencia por historial para la descripción y la contraparte ingresadas, con su categoría, su nivel de confianza y su motivo, y permitir aceptarla o elegir otra; la consulta DEBE (MUST) enviar la descripción en el cuerpo de la petición, nunca en la URL.
Trace: FR-CLASSIFICATION-014, NFR-SEC-009 · Priority: Should

#### Scenario: Sugerencia al escribir la descripción
- **CUANDO** el EDITOR escribe "PEDIDOSYA *8812" en un gasto nuevo sin categoría y el historial es el del scenario «Nueve de diez»
- **ENTONCES** el formulario muestra "Restaurantes" con confianza alta y el motivo, sin asignarla

### Requirement: Sugerencia en la vista previa del import
En la vista previa de una importación, cada fila de ingreso, gasto o reembolso que quede sin categoría después de las reglas y de la categoría por defecto de la contraparte DEBE (MUST) mostrar su sugerencia por historial, si la hay. El OWNER o EDITOR DEBE (MUST) poder aceptarla en una fila y aceptar en lote las sugerencias de nivel «alta» (o de nivel «alta» y «media») de todas las filas o de las elegidas, con la versión vigente de la importación (412 `PRECONDITION_FAILED` si cambió); reevaluar las reglas DEBE (MUST) recalcular las sugerencias de las filas que el usuario no editó. Una falla del cálculo de sugerencias DEBE (MUST) dejar las filas sin sugerencia, sin impedir la revisión ni la aprobación.
Trace: FR-CLASSIFICATION-014, FR-IMPORTS-009 · Priority: Should

#### Scenario: Aceptar las sugerencias de confianza alta
- **CUANDO** de 40 filas sin categoría después de las reglas, 25 tienen sugerencia alta, 10 media y 5 ninguna, y el EDITOR acepta en lote las de nivel «alta»
- **ENTONCES** las 25 filas quedan con la categoría sugerida y origen manual
- **Y** las otras 15 filas no cambian

#### Scenario: Versión vencida
- **CUANDO** el EDITOR acepta en lote con una versión de la importación que otra edición ya cambió
- **ENTONCES** se rechaza con 412 `PRECONDITION_FAILED` y ninguna fila cambia

#### Scenario: Sugerencias no disponibles
- **CUANDO** el cálculo de sugerencias falla al procesar una importación
- **ENTONCES** las filas quedan sin sugerencia y la importación llega a "en revisión" y se puede aprobar

### Requirement: Motivo de la sugerencia
Cada sugerencia DEBE (MUST) mostrar su motivo por plantilla, sin modelos de lenguaje: cuántas de cuántas transacciones del patrón el usuario puso en esa categoría y el patrón (la contraparte o la clave de descripción), en el idioma del usuario.
Trace: FR-CLASSIFICATION-014, NFR-USAB-001 · Priority: Should

#### Scenario: Motivo por descripción
- **CUANDO** se sugiere "Restaurantes" por 9 de 10 gastos con la clave `pedidosya`
- **ENTONCES** el motivo dice que elegiste "Restaurantes" en 9 de 10 gastos parecidos a "pedidosya"

### Requirement: Tasa de aceptación de las sugerencias
El sistema DEBE (MUST) registrar, por cada sugerencia mostrada en una transacción guardada o en una fila aprobada, si el usuario la aceptó, eligió otra categoría o la dejó sin categoría, con el canal (alta manual o import) y el nivel, sin descripciones ni montos, y DEBE (MUST) informar por rango de fechas la cantidad de sugerencias mostradas, aceptadas, corregidas e ignoradas y la tasa de aceptación con 4 decimales HALF_EVEN.
Trace: FR-CLASSIFICATION-014 · Priority: Should

#### Scenario: Tasa del mes
- **CUANDO** en noviembre de 2026 se mostraron 20 sugerencias: 15 aceptadas, 3 corregidas y 2 ignoradas
- **ENTONCES** el informe de noviembre indica 20 mostradas, 15 aceptadas, 3 corregidas, 2 ignoradas y tasa de aceptación 0.7500

### Requirement: Backtesting temporal de las sugerencias
El sistema DEBE (MUST) ofrecer un backtesting temporal sin efectos que, para cada uno de los últimos meses elegidos (al menos 3), calcule las sugerencias con el historial hasta el fin del mes anterior y las compare con la categoría que el usuario eligió en las transacciones del mes, e informe la precisión top-1 (aciertos sobre sugerencias) y la cobertura (sugerencias sobre transacciones) con 4 decimales HALF_EVEN, sin descripciones ni montos. El nightly DEBE (MUST) correrlo sobre el workspace principal del Large Seed y fallar con una precisión menor que 0.8500.
Trace: FR-CLASSIFICATION-014 · Priority: Should

#### Scenario: Tres meses sobre el umbral
- **CUANDO** el backtesting de julio a septiembre de 2026 hace 300 sugerencias sobre 400 transacciones y acierta 264
- **ENTONCES** informa precisión 0.8800 y cobertura 0.7500, y la fila del nightly pasa

#### Scenario: Menos de 3 meses
- **CUANDO** se pide el backtesting de 2 meses
- **ENTONCES** se rechaza indicando que hacen falta al menos 3

### Requirement: Sugerencias sin el servicio de pronósticos ni procesos nuevos
Las sugerencias DEBEN (MUST) calcularse a pedido en la API y en la etapa de clasificación del import, sin el servicio de pronósticos, sin trabajos ni consumidores nuevos y sin conexiones adicionales; la función DEBE (MUST) poder deshabilitarse por instalación, y deshabilitada la consulta DEBE (MUST) responder que no está habilitada y la vista previa no mostrar sugerencias.
Trace: FR-CLASSIFICATION-014, FR-FORECAST-006, NFR-REL-010 · Priority: Should

#### Scenario: Servicio de pronósticos apagado
- **CUANDO** el servicio de pronósticos está detenido y el EDITOR escribe "PEDIDOSYA" en un gasto nuevo
- **ENTONCES** el formulario muestra la sugerencia igual

#### Scenario: Función deshabilitada
- **CUANDO** la instalación tiene las sugerencias de categoría deshabilitadas
- **ENTONCES** la consulta responde que no están habilitadas y la vista previa del import no muestra sugerencias

### Requirement: Permisos y aislamiento de las sugerencias
Consultar sugerencias y su tasa de aceptación DEBE (MUST) estar permitido a todo miembro; registrar el resultado de una sugerencia del alta manual y aceptar sugerencias en la vista previa, solo al OWNER y al EDITOR (403 para el VIEWER). El historial de un workspace NO DEBE (MUST NOT) influir en las sugerencias de otro, y los resultados registrados DEBEN (MUST) quedar aislados por workspace con seguridad a nivel de fila forzada.
Trace: FR-CLASSIFICATION-014, FR-IDENTITY-006, NFR-SEC-003 · Priority: Must

#### Scenario: Historial de otro workspace
- **CUANDO** "W2" tiene 10 gastos "PEDIDOSYA" en "Delivery" y "W1" no tiene historial para ese patrón
- **ENTONCES** la consulta de "W1" para "PEDIDOSYA" no sugiere ninguna categoría

#### Scenario: VIEWER acepta en lote
- **CUANDO** un VIEWER intenta aceptar en lote las sugerencias de una vista previa
- **ENTONCES** se rechaza con 403 y ninguna fila cambia

### Requirement: Rendimiento de las sugerencias
La consulta de sugerencia del alta manual DEBE (MUST) responder en a lo sumo 150 ms p95 con el historial en caché y 400 ms p95 sin caché, con 5000 transacciones de historial, y el cálculo de sugerencias NO DEBE (MUST NOT) llevar la importación de 5000 filas hasta la vista previa por encima de 30 s.
Trace: FR-CLASSIFICATION-014, NFR-PERF-007 · Priority: Should

#### Scenario: Import de 5000 filas
- **CUANDO** se importa un CSV de 5000 filas sin reglas que clasifiquen y con 5000 transacciones de historial
- **ENTONCES** la importación llega a la vista previa en a lo sumo 30 s con las sugerencias calculadas
