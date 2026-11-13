## ADDED Requirements

### Requirement: Pronóstico opcional y aislado del núcleo
El pronóstico DEBE (MUST) ser una función opcional: con el servicio de pronósticos apagado, deshabilitado o sin responder, registrar y consultar transacciones, el Home, el calendario de flujo de caja, los reportes, el cierre de mes y las demás funciones del núcleo DEBEN (MUST) responder igual que sin la función, y ninguna operación financiera DEBE (MUST) esperar al servicio. Mientras el servicio no responda, el sistema DEBE (MUST) seguir mostrando el último pronóstico publicado con su instante de generación, o ninguno si nunca hubo uno. La función DEBE (MUST) poder deshabilitarse por instalación; deshabilitada, el sistema NO DEBE (MUST NOT) programar corridas y la consulta del pronóstico DEBE (MUST) informar que la función no está habilitada.
Trace: FR-FORECAST-006, NFR-REL-010 · Priority: Must

#### Scenario: Servicio de pronósticos apagado
- **CUANDO** el servicio de pronósticos está detenido y un EDITOR registra un gasto de 150.00 BOB en "Banco BOB" y consulta el Home
- **ENTONCES** el gasto se registra y el Home responde con las mismas cifras que sin la función de pronóstico
- **Y** la consulta del pronóstico devuelve el último pronóstico publicado con su instante de generación

#### Scenario: Función deshabilitada en la instalación
- **CUANDO** la función de pronóstico está deshabilitada y un miembro consulta el pronóstico del workspace
- **ENTONCES** la respuesta informa que la función no está habilitada, sin series
- **Y** el trabajo programado no crea corridas

### Requirement: Corrida de pronóstico con ciclo de vida
Cada pronóstico DEBE (MUST) producirse en una corrida del workspace con los estados solicitada, en curso, completada, sin datos suficientes, fallida y reemplazada, y solo las transiciones solicitada → en curso, en curso → completada, en curso → sin datos suficientes, en curso → solicitada (reintento), en curso → fallida y completada → reemplazada. Un workspace NO DEBE (MUST NOT) tener más de una corrida solicitada o en curso a la vez. Al completarse una corrida, la corrida completada anterior del mismo workspace DEBE (MUST) pasar a reemplazada, y el pronóstico vigente DEBE (MUST) ser el de la corrida completada más reciente. Una corrida sin ninguna serie con datos suficientes DEBE (MUST) terminar como sin datos suficientes, sin reemplazar a la completada vigente.
Trace: FR-FORECAST-001, FR-FORECAST-002 · Priority: Must

#### Scenario: Corrida completada reemplaza a la anterior
- **CUANDO** el workspace tiene la corrida completada "R1" del 2026-10-01 y la corrida "R2" se completa el 2026-11-01
- **ENTONCES** "R1" queda reemplazada y "R2" es el pronóstico vigente

#### Scenario: Corrida sin datos suficientes no reemplaza la vigente
- **CUANDO** la corrida "R3" termina sin ninguna serie con datos suficientes porque el workspace eliminó su historia importada
- **ENTONCES** "R3" queda sin datos suficientes con el motivo de cada serie
- **Y** "R2" sigue siendo el pronóstico vigente

### Requirement: Solicitud manual de una corrida
Un OWNER o un EDITOR DEBE (MUST) poder solicitar una corrida del workspace; la solicitud DEBE (MUST) responder de inmediato con la operación asíncrona que la sigue y quedar auditada con su actor. Una solicitud con otra corrida solicitada o en curso DEBE (MUST) rechazarse con `FORECAST_RUN_IN_PROGRESS`; una solicitud con la función deshabilitada, con `FORECASTING_DISABLED`; una solicitud de un VIEWER, con `INSUFFICIENT_ROLE`.
Trace: FR-FORECAST-001, FR-FORECAST-006 · Priority: Should

#### Scenario: EDITOR solicita una corrida
- **CUANDO** un EDITOR solicita una corrida y el workspace no tiene ninguna activa
- **ENTONCES** la respuesta es aceptada con la operación de la corrida en estado pendiente
- **Y** la auditoría registra la solicitud con el EDITOR como actor

#### Scenario: Corrida ya en curso
- **CUANDO** un OWNER solicita una corrida mientras otra está en curso
- **ENTONCES** la solicitud se rechaza con `FORECAST_RUN_IN_PROGRESS`

#### Scenario: VIEWER no solicita corridas
- **CUANDO** un VIEWER solicita una corrida
- **ENTONCES** la solicitud se rechaza con `INSUFFICIENT_ROLE`

### Requirement: Corridas programadas sin consumidores nuevos
Con la función habilitada, el sistema DEBE (MUST) crear una corrida programada para cada workspace cuando su último periodo financiero terminado sea posterior al de su última corrida completada, o cuando la última corrida completada tenga más días que la antigüedad máxima configurada (por omisión 7), y como máximo una corrida programada por workspace y por día. Las corridas DEBEN (MUST) ejecutarse en el worker de a un workspace por vez, sin consumir eventos de otros contextos ni sumar consumidores o conexiones al presupuesto vigente, y sin retener una conexión a la base de datos mientras esperan al servicio de pronósticos.
Trace: FR-FORECAST-001, NFR-PERF-012 · Priority: Must

#### Scenario: Periodo nuevo terminado
- **CUANDO** la última corrida completada es del 2026-10-03 con el periodo 2026-09 como último terminado y el 2026-11-01 termina el periodo 2026-10
- **ENTONCES** el trabajo del 2026-11-01 crea una corrida programada para el workspace

#### Scenario: Pronóstico reciente sin periodo nuevo
- **CUANDO** la última corrida completada es del 2026-11-01 y el 2026-11-05 no terminó ningún periodo nuevo
- **ENTONCES** el trabajo del 2026-11-05 no crea ninguna corrida

#### Scenario: Presupuesto de conexiones intacto
- **CUANDO** el worker arranca con la configuración de la plantilla del host y la función habilitada
- **ENTONCES** la cantidad de consumidores y las conexiones validadas al arrancar son las mismas que sin la función

### Requirement: Series mensuales por periodo financiero
El sistema DEBE (MUST) construir la historia de cada serie por periodo financiero del workspace (según su día de inicio del mes financiero vigente), solo con periodos terminados y hasta el máximo configurado (por omisión 60 periodos): el gasto total, el gasto por grupo de categorías, el gasto por categoría y el ingreso total, en la moneda de reporte, con cada flujo convertido con la tasa de su fecha. El gasto DEBE (MUST) contarse neto de reembolsos y sin transferencias, conversiones ni capital de deudas, con el mismo criterio que la pregunta "¿Cuánto gasté?" del Home. Un flujo sin tasa para su fecha DEBE (MUST) excluirse y contarse en la calidad de datos del periodo, nunca convertirse 1:1.
Trace: FR-FORECAST-001, NFR-DATA-002 · Priority: Must

#### Scenario: Periodo con gastos en dos monedas y un reembolso
- **CUANDO** el workspace tiene día de inicio del mes financiero 25 y en el periodo 2026-10 (del 2026-09-25 al 2026-10-24) registró gastos de 1200.00 BOB y 50.00 USD el 2026-10-02 con tasa 6.96 BOB por USD, y un reembolso de 100.00 BOB
- **ENTONCES** la historia del gasto total tiene 1448.00 BOB en el periodo 2026-10

#### Scenario: Flujo sin tasa
- **CUANDO** además registró un gasto de 20.000000 USDT en una fecha sin tasa USDT a BOB
- **ENTONCES** el periodo 2026-10 sigue con 1448.00 BOB y su calidad de datos informa 1 flujo sin valorar

#### Scenario: Periodo en curso fuera de la historia
- **CUANDO** el 2026-11-10 se construye la historia con día de inicio 1
- **ENTONCES** el último periodo de la historia es 2026-10 y el periodo 2026-11 no se incluye

### Requirement: Preparación de datos por serie
Cada serie DEBE (MUST) evaluarse antes de pronosticarse: con 6 o más periodos terminados con datos DEBE (MUST) admitir modelos estadísticos; con 3 a 5, solo una estimación simple marcada como tal; con menos de 3, NO DEBE (MUST NOT) pronosticarse y DEBE (MUST) informar cuántos periodos faltan para la estimación simple y para el modelo. Los umbrales DEBEN (MUST) ser configurables. Una serie sin modelo DEBE (MUST) marcarse con datos insuficientes y su respuesta DEBE (MUST) incluir solo la estimación simple (si la hay) y los costos conocidos.
Trace: FR-FORECAST-005 · Priority: Must

#### Scenario: Historia de 4 periodos
- **CUANDO** la categoría "Restaurantes" tiene datos en los periodos 2026-07 a 2026-10
- **ENTONCES** su serie queda como estimación simple con datos insuficientes
- **Y** informa que faltan 2 periodos para un modelo estadístico

#### Scenario: Historia de 2 periodos
- **CUANDO** la categoría "Gimnasio" tiene datos solo en 2026-09 y 2026-10
- **ENTONCES** su serie no se pronostica e informa que falta 1 periodo para la estimación simple y 4 para un modelo

#### Scenario: Historia de 8 periodos
- **CUANDO** el gasto total tiene datos en los periodos 2026-03 a 2026-10
- **ENTONCES** su serie admite modelos estadísticos

### Requirement: Categorías con pocos movimientos agrupadas
Una categoría de gasto con menos de 3 transacciones en más del 25 % de sus periodos y con menos de 30 transacciones en toda la historia NO DEBE (MUST NOT) tener serie propia: su gasto DEBE (MUST) sumarse en la serie "Otras categorías" de su grupo, que se evalúa como cualquier otra serie, y la respuesta DEBE (MUST) listar las categorías agrupadas.
Trace: FR-FORECAST-001, FR-FORECAST-005 · Priority: Should

#### Scenario: Categoría esporádica
- **CUANDO** la categoría "Regalos" del grupo "Personal" tiene 1 transacción en 6 de sus 8 periodos y 9 transacciones en total
- **ENTONCES** "Regalos" no tiene serie propia y su gasto se suma en "Otras categorías" de "Personal"

### Requirement: Huecos en la historia
Un periodo sin ninguna transacción en el workspace DEBE (MUST) considerarse un hueco; con más de un hueco consecutivo, la historia de todas las series DEBE (MUST) empezar en el periodo siguiente al último hueco. Un periodo sin gasto en una categoría, con transacciones en otras, DEBE (MUST) contarse como cero y no como hueco.
Trace: FR-FORECAST-005 · Priority: Should

#### Scenario: Dos periodos sin registros
- **CUANDO** el workspace tiene transacciones de 2025-11 a 2026-02, ninguna en 2026-03 y 2026-04, y de nuevo desde 2026-05 hasta 2026-10
- **ENTONCES** la historia de todas las series empieza en 2026-05 con 6 periodos

#### Scenario: Categoría sin gasto en un periodo
- **CUANDO** "Restaurantes" no tiene gasto en 2026-08 pero el workspace sí tiene transacciones ese periodo
- **ENTONCES** la serie de "Restaurantes" tiene 0.00 BOB en 2026-08

### Requirement: Calidad de la clasificación para las series por categoría
Cuando en más del 20 % de los periodos de la historia el gasto sin categoría supere el 10 % del gasto del periodo, las series por categoría y por grupo DEBEN (MUST) marcarse con datos insuficientes por clasificación incompleta; el gasto total y el ingreso total DEBEN (MUST) pronosticarse igual.
Trace: FR-FORECAST-005 · Priority: Should

#### Scenario: Historia con mucho gasto sin categoría
- **CUANDO** en 3 de 8 periodos el gasto sin categoría supera el 10 % del gasto del periodo
- **ENTONCES** las series por categoría y por grupo quedan con datos insuficientes por clasificación incompleta
- **Y** el gasto total se pronostica

### Requirement: Datos mínimos enviados al servicio de pronósticos
La petición al servicio de pronósticos DEBE (MUST) contener solo series de montos por periodo con referencias opacas generadas para esa corrida, la moneda, los periodos y los parámetros de la corrida. NO DEBE (MUST NOT) contener el identificador del workspace ni de sus miembros, nombres de categorías, cuentas o contrapartes, descripciones, notas ni identificadores de transacciones; las referencias opacas NO DEBEN (MUST NOT) repetirse entre corridas. El servicio NO DEBE (MUST NOT) conservar las peticiones ni registrar sus montos.
Trace: NFR-COMP-001, NFR-COMP-002, FR-FORECAST-006 · Priority: Must

#### Scenario: Petición sin datos identificables
- **CUANDO** se arma la petición de la corrida "R2" con la serie de "Restaurantes"
- **ENTONCES** la serie viaja con una referencia opaca como "s7" y sus montos por periodo, sin el nombre ni el identificador de la categoría
- **Y** la petición no contiene el identificador del workspace

#### Scenario: Referencias distintas en cada corrida
- **CUANDO** se arman las peticiones de las corridas "R2" y "R3" del mismo workspace
- **ENTONCES** la serie de "Restaurantes" tiene referencias opacas distintas en cada una

### Requirement: Resultado validado antes de publicarse
Cada serie devuelta por el servicio DEBE (MUST) validarse contra el contrato antes de guardarse: montos decimales en la escala de la moneda, sin valores no numéricos ni infinitos, límite inferior ≤ valor esperado ≤ límite superior en el intervalo del 80 %, el intervalo del 95 % conteniendo al del 80 %, valores no negativos en gasto e ingreso, periodos y moneda iguales a los pedidos y versión de modelo informada. Una serie que no cumple DEBE (MUST) descartarse con el motivo de salida inválida y las demás series de la corrida DEBEN (MUST) publicarse; una corrida sin ninguna serie válida DEBE (MUST) terminar fallida.
Trace: FR-FORECAST-002, FR-FORECAST-006 · Priority: Must

#### Scenario: Intervalo desordenado
- **CUANDO** el servicio devuelve para "Restaurantes" en 2026-11 un valor esperado de 900.00 BOB con intervalo del 80 % de 950.00 BOB a 1100.00 BOB
- **ENTONCES** la serie de "Restaurantes" se descarta por salida inválida
- **Y** las demás series de la corrida se publican

#### Scenario: Escala de la moneda excedida
- **CUANDO** el servicio devuelve 2350.005 BOB como valor esperado del gasto total
- **ENTONCES** la serie del gasto total se descarta por salida inválida

### Requirement: Contenido de cada pronóstico publicado
Cada punto pronosticado DEBE (MUST) informar el periodo, la cantidad de periodos hacia adelante, el valor esperado, el intervalo del 80 % y el del 95 %, el método y el valor del pronóstico de referencia, el nombre y la versión del modelo, la moneda, el primer y el último periodo de la historia usada, el identificador del conjunto de datos y el instante de generación. Los montos DEBEN (MUST) expresarse como decimales con la escala de la moneda.
Trace: FR-FORECAST-002 · Priority: Must

#### Scenario: Punto del gasto total
- **CUANDO** la corrida "R2" del 2026-11-01 publica el gasto total de 2026-11 con historia de 2025-11 a 2026-10
- **ENTONCES** el punto informa 2026-11, 1 periodo hacia adelante, valor esperado 4350.00 BOB, intervalo del 80 % de 3980.00 BOB a 4790.00 BOB, intervalo del 95 % de 3810.00 BOB a 5050.00 BOB, referencia "promedio de 6 periodos" de 4210.00 BOB, modelo y versión, historia de 2025-11 a 2026-10, conjunto de datos e instante de generación

### Requirement: Horizonte de las series
El gasto total y el ingreso total DEBEN (MUST) pronosticarse para los 12 periodos siguientes al último terminado; los grupos y las categorías, para los 6 siguientes, o los 12 siguientes cuando la serie tiene 24 o más periodos de historia. El primer periodo pronosticado DEBE (MUST) ser el periodo en curso. La consulta DEBE (MUST) permitir elegir un horizonte de 1, 3, 6 o 12 periodos y DEBE (MUST) rechazar otro valor con `INVALID_FILTER`.
Trace: FR-FORECAST-001 · Priority: Must

#### Scenario: Horizonte del gasto total y de una categoría
- **CUANDO** el 2026-11-05 el último periodo terminado es 2026-10 y "Restaurantes" tiene 14 periodos de historia
- **ENTONCES** el gasto total se pronostica de 2026-11 a 2027-10 y "Restaurantes" de 2026-11 a 2027-04

#### Scenario: Horizonte no admitido
- **CUANDO** se consulta el pronóstico con horizonte 4
- **ENTONCES** la consulta se rechaza con `INVALID_FILTER`

### Requirement: Reintentos y falla de una corrida
Si el servicio de pronósticos no responde, rechaza la petición o excede el tiempo configurado (por omisión 300 segundos), la corrida DEBE (MUST) volver a solicitada y reintentarse con espera creciente hasta 5 intentos dentro de las 24 horas siguientes a la solicitud; agotados, DEBE (MUST) terminar fallida con el motivo, y el pronóstico vigente DEBE (MUST) seguir siendo el de la última corrida completada, mostrado con su instante de generación y una marca de que no pudo actualizarse.
Trace: FR-FORECAST-006, NFR-REL-010 · Priority: Must

#### Scenario: Servicio caído durante toda la ventana
- **CUANDO** la corrida "R3" se solicita el 2026-12-01 y el servicio no responde en ninguno de los 5 intentos
- **ENTONCES** "R3" termina fallida con el motivo servicio no disponible
- **Y** la consulta muestra el pronóstico de "R2" con su instante de generación y la marca de que no pudo actualizarse

#### Scenario: Servicio recuperado en el tercer intento
- **CUANDO** el servicio no responde en los dos primeros intentos de "R3" y responde en el tercero
- **ENTONCES** "R3" se completa y reemplaza a "R2"

### Requirement: Consulta del pronóstico vigente
Todo miembro del workspace DEBE (MUST) poder consultar el pronóstico vigente con sus series, su preparación de datos y sus puntos, filtrando por serie y por horizonte, y el historial de corridas con su estado. La consulta DEBE (MUST) informar si no hay pronóstico, si la función no está habilitada o si el pronóstico vigente tiene más de 35 días. Un miembro NO DEBE (MUST NOT) ver corridas ni pronósticos de otro workspace.
Trace: FR-FORECAST-001, FR-FORECAST-002, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER consulta el pronóstico
- **CUANDO** un VIEWER consulta el pronóstico vigente con horizonte 3
- **ENTONCES** recibe las series con sus 3 primeros periodos pronosticados y la preparación de datos de cada una

#### Scenario: Workspace sin corridas
- **CUANDO** un miembro consulta el pronóstico de un workspace que nunca completó una corrida
- **ENTONCES** la respuesta informa que no hay pronóstico

#### Scenario: Corrida de otro workspace
- **CUANDO** un miembro de "W1 Personal Demo" pide una corrida de "W2 Familia Demo"
- **ENTONCES** la consulta responde que el recurso no existe

### Requirement: Servicio de pronósticos autenticado y sin acceso a datos
El servicio de pronósticos DEBE (MUST) aceptar peticiones solo de la red interna y con la credencial de servicio vigente, y rechazar las demás sin procesarlas. NO DEBE (MUST NOT) tener credenciales de la base de datos ni del almacenamiento de objetos, ni salida a Internet, y sus registros NO DEBEN (MUST NOT) contener montos de las series.
Trace: NFR-SEC-007, NFR-SEC-014, NFR-COMP-001 · Priority: Must

#### Scenario: Petición sin credencial
- **CUANDO** un proceso de la red interna llama al servicio sin la credencial de servicio
- **ENTONCES** el servicio responde no autorizado sin procesar la petición

#### Scenario: Registros sin montos
- **CUANDO** el servicio procesa una petición con la serie del gasto total
- **ENTONCES** sus registros informan la cantidad de series y puntos y la duración, sin ningún monto

### Requirement: Hecho de pronóstico generado
Al completarse una corrida, el sistema DEBE (MUST) publicar el hecho de pronóstico generado con la corrida, el último periodo terminado, la cantidad de series publicadas y con datos insuficientes y la versión de los modelos, en la misma unidad de trabajo que guarda la corrida y sin montos.
Trace: FR-FORECAST-002, NFR-REL-008 · Priority: Should

#### Scenario: Corrida completada
- **CUANDO** la corrida "R2" se completa con 18 series publicadas y 4 con datos insuficientes
- **ENTONCES** se publica una sola vez el hecho de pronóstico generado de "R2" con esas cantidades y sin montos

### Requirement: Rendimiento de una corrida
Una corrida de un workspace con 5 años de historia (el conjunto de datos de rendimiento) y todas sus series DEBE (MUST) completarse en 5 minutos o menos desde que pasa a en curso, con el conjunto de modelos vigente, sin afectar el tiempo de respuesta de las consultas en línea.
Trace: NFR-PERF-012 · Priority: Should

#### Scenario: Benchmark nocturno de la corrida
- **CUANDO** el benchmark nocturno ejecuta una corrida sobre el conjunto de datos de rendimiento con el servicio real
- **ENTONCES** la corrida se completa en 300 segundos o menos

### Requirement: Métricas de las corridas
El sistema DEBE (MUST) exponer la duración de las corridas por resultado, las fallas por motivo (sin respuesta, rechazo, tiempo excedido y salida inválida) y las series con datos insuficientes, sin identificadores de workspace ni montos, y alertar cuando fallen 3 corridas seguidas.
Trace: NFR-OBS-009, NFR-OBS-004 · Priority: Should

#### Scenario: Tres corridas fallidas seguidas
- **CUANDO** las corridas de tres días seguidos terminan fallidas por servicio no disponible
- **ENTONCES** la métrica de fallas suma 3 con el motivo sin respuesta y se dispara la alerta de pronósticos fallidos

### Requirement: Retención de las corridas
El sistema DEBE (MUST) conservar la corrida vigente y, de cada periodo terminado de los últimos 24, la última corrida completada antes de que ese periodo empezara; las demás corridas reemplazadas DEBEN (MUST) purgarse a los 30 días y las fallidas o sin datos suficientes a los 90 días, por el rol de mantenimiento.
Trace: FR-FORECAST-009, NFR-COMP-002 · Priority: Should

#### Scenario: Corridas reemplazadas del mismo periodo
- **CUANDO** el periodo 2026-11 tuvo las corridas completadas del 2026-11-01 y del 2026-11-08, ambas reemplazadas, y hoy es 2026-12-15
- **ENTONCES** la corrida del 2026-11-08 se purga y la del 2026-11-01 se conserva para evaluar el periodo 2026-11

### Requirement: Pronósticos fuera de la portabilidad del workspace
La exportación del workspace NO DEBE (MUST NOT) incluir corridas ni pronósticos, porque se recalculan desde los datos exportados; importar un workspace DEBE (MUST) dejarlo sin corridas, y su primer pronóstico DEBE (MUST) generarse con el trabajo programado o una solicitud manual.
Trace: FR-IDENTITY-010, NFR-COMP-002 · Priority: Should

#### Scenario: Workspace importado
- **CUANDO** se importa en un workspace nuevo la exportación de "W1 Personal Demo", que tenía 12 corridas
- **ENTONCES** el workspace nuevo no tiene corridas y la consulta informa que no hay pronóstico
