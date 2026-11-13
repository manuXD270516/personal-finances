## ADDED Requirements

### Requirement: Costos futuros conocidos separados de los variables predichos
Cada punto pronosticado de gasto y de ingreso DEBE (MUST) descomponerse en costos (o ingresos) futuros conocidos, calculados de forma determinista por el sistema y nunca por un modelo, y la parte variable predicha por el modelo con su intervalo; el valor esperado DEBE (MUST) ser la suma exacta de ambas partes y los límites de cada intervalo, la parte conocida más los límites del intervalo de la parte variable.
Trace: FR-FORECAST-003, FR-FORECAST-002 · Priority: Must

#### Scenario: Gasto total de diciembre
- **CUANDO** para el periodo 2026-12 los costos conocidos son "Alquiler" 2500.00 BOB, "Internet" 199.00 BOB y "Netflix" 49.00 BOB, y el modelo predice para la parte variable 1660.00 BOB con intervalo del 80 % de 1290.00 BOB a 2040.00 BOB
- **ENTONCES** el gasto total esperado de 2026-12 es 4408.00 BOB con intervalo del 80 % de 4038.00 BOB a 4788.00 BOB
- **Y** el punto informa costos conocidos 2748.00 BOB y variable predicho 1660.00 BOB

### Requirement: Historia variable sin doble conteo de lo recurrente
El modelo DEBE (MUST) entrenarse con la historia variable de cada serie: el gasto (o ingreso) del periodo menos lo que en ese periodo se pagó o cobró por ocurrencias recurrentes resueltas (materializadas o emparejadas) y por los componentes de gasto de las cuotas de préstamo. Las transferencias a metas, los pagos de tarjeta y el capital de las cuotas NO DEBEN (MUST NOT) restarse porque no son gasto.
Trace: FR-FORECAST-003 · Priority: Must

#### Scenario: Periodo con recurrentes resueltos
- **CUANDO** en el periodo 2026-10 el gasto total fue 4300.00 BOB y las ocurrencias resueltas de gasto suman 2748.00 BOB
- **ENTONCES** la historia variable del gasto total en 2026-10 es 1552.00 BOB

#### Scenario: Categoría solo recurrente
- **CUANDO** en el periodo 2026-10 el único gasto de "Vivienda" fue el "Alquiler" de 2500.00 BOB, emparejado con su ocurrencia
- **ENTONCES** la historia variable de "Vivienda" en 2026-10 es 0.00 BOB

### Requirement: Costos conocidos de todo el horizonte
Los costos e ingresos conocidos de cada periodo pronosticado DEBEN (MUST) incluir las ocurrencias no resueltas ya generadas y la proyección, sin guardarla, de las definiciones recurrentes activas más allá del horizonte de generación, con el monto según su tipo (el monto de `FIXED` y `ESTIMATED`, el máximo de `MIN_MAX` en gastos y el mínimo en ingresos) y sin las ocurrencias omitidas o canceladas ni las posteriores al fin de su definición. Las ocurrencias `VARIABLE` DEBEN (MUST) contarse y listarse sin monto. Un monto en otra moneda DEBE (MUST) convertirse a la moneda de reporte con la tasa de hoy, declarada en la respuesta; sin tasa, DEBE (MUST) listarse sin convertir y sin sumarse.
Trace: FR-FORECAST-003, FR-COMMITMENTS-011 · Priority: Must

#### Scenario: Seguro anual fuera del horizonte de generación
- **CUANDO** el 2026-11-05 el horizonte de generación de ocurrencias llega al 2027-02-03 y la definición "Seguro anual" de 900.00 BOB vence cada 15 de marzo
- **ENTONCES** los costos conocidos de 2027-03 incluyen "Seguro anual" por 900.00 BOB

#### Scenario: Suscripción en dólares
- **CUANDO** "Spotify" cuesta 9.99 USD por mes y la tasa de hoy es 6.96 BOB por USD
- **ENTONCES** los costos conocidos de cada periodo incluyen "Spotify" por 69.53 BOB con la tasa declarada

#### Scenario: Factura variable sin monto
- **CUANDO** "Luz" es una definición `VARIABLE` mensual
- **ENTONCES** cada periodo lista "Luz" como costo conocido sin monto y la cantidad de costos sin monto es 1

### Requirement: Intereses de préstamos como costo conocido
Para cada cuota de préstamo futura, los costos conocidos DEBEN (MUST) incluir sus componentes de gasto (interés, cargos, seguro e impuestos) según el cronograma vigente del préstamo y NO DEBEN (MUST NOT) incluir el capital.
Trace: FR-FORECAST-003, FR-DEBT-003 · Priority: Should

#### Scenario: Cuota con interés y seguro
- **CUANDO** la cuota de 2026-12 del préstamo "Auto" es de 1500.00 BOB con 1064.65 BOB de capital, 420.35 BOB de interés y 15.00 BOB de seguro
- **ENTONCES** los costos conocidos de 2026-12 incluyen 435.35 BOB por esa cuota

### Requirement: Modelos candidatos según la historia
El servicio DEBE (MUST) evaluar para cada serie con datos suficientes los modelos que su historia admite: último periodo y promedio móvil de 3, 6 o 12 periodos siempre; mismo periodo del año anterior con 13 o más periodos; suavizado exponencial con tendencia amortiguada con 6 o más; y suavizado exponencial estacional con 24 o más.
Trace: FR-FORECAST-007 · Priority: Should

#### Scenario: Serie de 14 periodos
- **CUANDO** el gasto total tiene 14 periodos de historia
- **ENTONCES** los candidatos son último periodo, promedio de 3, 6 y 12 periodos, mismo periodo del año anterior y suavizado exponencial con tendencia amortiguada, sin el estacional

### Requirement: Selección del modelo por backtesting temporal
La selección DEBE (MUST) hacerse con validación de origen móvil con ventana creciente: con n periodos de historia, se toman como cortes los últimos min(6, n − 6) periodos; en cada corte cada candidato se entrena solo con la historia anterior al corte y se mide su error a 1 y 3 periodos; el modelo elegido es el de menor error escalado medio (ponderado 0.5 a 1 periodo y 0.5 a 3 periodos). Ningún dato posterior a un corte DEBE (MUST) usarse para pronosticar desde ese corte.
Trace: FR-FORECAST-007 · Priority: Should

#### Scenario: Cortes de una serie de 10 periodos
- **CUANDO** el gasto total tiene historia de 2026-01 a 2026-10
- **ENTONCES** los cortes son 2026-07, 2026-08, 2026-09 y 2026-10, y desde el corte 2026-07 los candidatos se entrenan solo con 2026-01 a 2026-06

### Requirement: Publicación solo si el modelo supera al de referencia
Un modelo distinto de los de referencia (último periodo, promedio móvil y mismo periodo del año anterior) DEBE (MUST) publicarse para una serie solo si su error escalado medio en el backtesting es al menos un 5 % menor que el del mejor modelo de referencia; si no, DEBE (MUST) publicarse el mejor modelo de referencia, informado como tal. El resultado del backtesting de cada candidato DEBE (MUST) quedar guardado con la corrida.
Trace: FR-FORECAST-007 · Priority: Should

#### Scenario: El suavizado exponencial supera a la referencia
- **CUANDO** en el backtesting de "Supermercado" el suavizado exponencial obtiene 0.78 y el mejor de referencia 0.90
- **ENTONCES** se publica el suavizado exponencial para "Supermercado"

#### Scenario: Mejora insuficiente
- **CUANDO** el suavizado exponencial obtiene 0.88 y el mejor de referencia 0.90
- **ENTONCES** se publica el modelo de referencia informado como tal

### Requirement: Motivos del pronóstico
Cada punto DEBE (MUST) informar sus motivos: el promedio de los últimos 6 periodos de la historia variable, el efecto de la estacionalidad (solo con modelo estacional), el efecto de la tendencia y del nivel reciente, los periodos atípicos detectados y los costos conocidos con sus referencias; el promedio más los efectos DEBE (MUST) igualar la parte variable predicha.
Trace: FR-FORECAST-003 · Priority: Must

#### Scenario: Motivos del gasto de diciembre
- **CUANDO** el gasto total de 2026-12 tiene promedio variable 1552.00 BOB, el modelo estacional suma 120.00 BOB por diciembre y la parte variable predicha es 1660.00 BOB
- **ENTONCES** los motivos informan promedio 1552.00 BOB, estacionalidad +120.00 BOB, tendencia y nivel reciente −12.00 BOB y costos conocidos 2748.00 BOB con sus tres compromisos

### Requirement: Nivel de confianza del pronóstico
Cada serie publicada DEBE (MUST) informar un nivel de confianza: baja con menos de 12 periodos, con estimación simple o con error escalado del modelo publicado mayor que 1; alta con 24 o más periodos, error escalado menor que 0.8 y cobertura del intervalo del 80 % en el backtesting entre el 75 % y el 85 %; media en los demás casos.
Trace: FR-FORECAST-002, FR-FORECAST-007 · Priority: Should

#### Scenario: Serie corta
- **CUANDO** "Restaurantes" tiene 9 periodos y error escalado 0.70
- **ENTONCES** su confianza es baja

#### Scenario: Serie larga y calibrada
- **CUANDO** el gasto total tiene 30 periodos, error escalado 0.72 y cobertura del 80 % de 0.79
- **ENTONCES** su confianza es alta

### Requirement: Pronóstico presentado como rango
La API y la interfaz NO DEBEN (MUST NOT) presentar un pronóstico como una cifra cierta: todo valor esperado DEBE (MUST) mostrarse junto con su rango probable y el nivel del intervalo, con el texto "Esperado" y "Rango probable", y nunca con expresiones como "vas a gastar" o "exactamente".
Trace: FR-FORECAST-004 · Priority: Must

#### Scenario: Tarjeta del gasto total en es-BO
- **CUANDO** un miembro con locale es-BO ve el gasto total de 2026-12 con valor esperado 4408.00 BOB e intervalo del 80 % de 4038.00 BOB a 4788.00 BOB
- **ENTONCES** la vista muestra "Esperado: ~Bs 4.408,00 · Rango probable: Bs 4.038,00 – Bs 4.788,00 (80 %)"

### Requirement: Aviso de no asesoría financiera
La vista de pronósticos y toda respuesta de la API de pronósticos DEBEN (MUST) incluir el aviso de que son estimaciones estadísticas y no asesoría financiera, en el idioma del usuario.
Trace: NFR-COMP-004 · Priority: Must

#### Scenario: Aviso en la vista
- **CUANDO** un miembro abre la vista de pronósticos en inglés
- **ENTONCES** la vista muestra el aviso de estimación estadística sin asesoría financiera en inglés

### Requirement: Aviso claro de datos insuficientes
Para cada serie con datos insuficientes la vista DEBE (MUST) explicar qué falta, con la cantidad de periodos y el nombre de la serie, y mostrar solo la estimación simple (si la hay) marcada como tal y los costos conocidos; con clasificación incompleta, DEBE (MUST) indicar el porcentaje de gasto sin categoría y enlazar las transacciones sin categoría.
Trace: FR-FORECAST-005 · Priority: Must

#### Scenario: Categoría con 4 periodos
- **CUANDO** "Restaurantes" tiene 4 periodos de historia
- **ENTONCES** la vista indica que se necesitan 2 periodos más de historia en "Restaurantes" para un pronóstico estadístico
- **Y** muestra la estimación simple marcada como tal y sus costos conocidos

### Requirement: Vista de pronósticos en la aplicación
Todo miembro del workspace DEBE (MUST) poder ver en la vista de pronósticos, para cada serie, la historia, el valor esperado y la banda del 80 % por periodo con el horizonte elegido (1, 3, 6 o 12 periodos), el intervalo del 95 % en el detalle, la lista de costos conocidos con fechas y montos separada de la banda variable, los motivos, el nivel de confianza, el modelo con su versión y el instante de generación, con una tabla accesible equivalente al gráfico y en español, inglés y portugués. Un OWNER o un EDITOR DEBE (MUST) poder solicitar una corrida desde la vista.
Trace: FR-FORECAST-001, FR-FORECAST-002, FR-FORECAST-003, NFR-USAB-001 · Priority: Must

#### Scenario: Horizonte de 3 periodos
- **CUANDO** un VIEWER abre la vista con horizonte 3 el 2026-11-05
- **ENTONCES** ve el gasto total y las categorías de 2026-11 a 2027-01 con la banda del 80 %, los costos conocidos de cada periodo, el modelo y el instante de generación
- **Y** no ve el botón para solicitar una corrida

### Requirement: Pronóstico del ingreso total
El ingreso total DEBE (MUST) pronosticarse con la misma descomposición: ingresos esperados conocidos de las ocurrencias de ingreso y la parte variable predicha.
Trace: FR-FORECAST-001, FR-FORECAST-003 · Priority: Must

#### Scenario: Sueldo conocido y extras variables
- **CUANDO** para 2026-12 el "Sueldo" esperado es 8000.00 BOB y el modelo predice 350.00 BOB de ingreso variable con intervalo del 80 % de 0.00 BOB a 900.00 BOB
- **ENTONCES** el ingreso total esperado de 2026-12 es 8350.00 BOB con intervalo del 80 % de 8000.00 BOB a 8900.00 BOB

### Requirement: Diferencia entre categorías y total
Cuando la suma de los valores esperados de las categorías de un periodo difiera en más de un 5 % del valor esperado del gasto total, la vista DEBE (MUST) informar la diferencia y aclarar que cada serie se pronostica por separado.
Trace: FR-FORECAST-001 · Priority: Could

#### Scenario: Categorías que suman más que el total
- **CUANDO** para 2026-12 las categorías suman 4700.00 BOB y el gasto total esperado es 4408.00 BOB
- **ENTONCES** la vista informa una diferencia de 292.00 BOB entre las categorías y el total

### Requirement: Pronósticos reproducibles
Con el mismo conjunto de datos, la misma versión de los modelos y la misma semilla, el servicio DEBE (MUST) devolver exactamente los mismos valores en la escala de la moneda; cada corrida DEBE (MUST) guardar el identificador del conjunto de datos, la versión de los modelos y la semilla.
Trace: FR-FORECAST-002, FR-FORECAST-007 · Priority: Should

#### Scenario: Mismo conjunto procesado dos veces
- **CUANDO** se envía dos veces la misma petición con la semilla 42
- **ENTONCES** las dos respuestas tienen los mismos valores esperados e intervalos en todos los puntos

### Requirement: Periodos atípicos señalados
Un periodo de la historia variable cuyo valor se aleja de la mediana más de 3.5 desvíos absolutos medianos escalados DEBE (MUST) señalarse como atípico en los motivos, y el modelo DEBE (MUST) entrenarse con ese valor recortado al límite, sin modificar la historia mostrada.
Trace: FR-FORECAST-003 · Priority: Could

#### Scenario: Mes de viaje
- **CUANDO** la historia variable de "Viajes y ocio" tiene 2026-07 con 4800.00 BOB y los demás periodos entre 300.00 BOB y 500.00 BOB
- **ENTONCES** los motivos señalan 2026-07 como atípico y la historia mostrada conserva 4800.00 BOB
