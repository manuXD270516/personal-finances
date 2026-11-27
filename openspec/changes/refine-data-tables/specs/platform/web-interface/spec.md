## ADDED Requirements

### Requirement: Tablas desplazables con nombre y alcanzables por teclado
Toda tabla de datos de la interfaz DEBE (MUST) estar dentro de una región cuyo nombre es el título de la tabla. Cuando el contenido de la tabla no entra a lo ancho o a lo alto, la región DEBE (MUST) poder recibir el foco con el teclado y desplazarse con las flechas. El análisis automático de accesibilidad NO DEBE (MUST NOT) informar regiones desplazables inalcanzables con el teclado.
Trace: NFR-USAB-102, NFR-USAB-101 · Priority: Must

#### Scenario: Cronograma de un préstamo en el teléfono
- **CUANDO** a 360 px el OWNER abre el cronograma de un préstamo de 12000.00 BOB a 36 cuotas
- **ENTONCES** la tabla está en una región con el nombre de su título, que recibe el foco con Tab
- **Y** con la flecha derecha la región se desplaza a lo ancho

#### Scenario: Todas las tablas pasan por la región común
- **CUANDO** se revisan los componentes de la interfaz que dibujan tablas de datos
- **ENTONCES** todas las tablas están dentro de la región común con nombre y ninguna usa un envoltorio propio

#### Scenario: Análisis de accesibilidad de las tablas
- **CUANDO** se analizan a 360 px Transacciones, Presupuestos, un reporte, el cronograma de un préstamo y la vista previa de un import
- **ENTONCES** el análisis no informa regiones desplazables inalcanzables ni otras violaciones serias o críticas

### Requirement: Cabecera fija en tablas de mucho volumen
Las tablas de mucho volumen, al menos la vista previa de un import, el cronograma de un préstamo y los cargos de un estado de cuenta de tarjeta, DEBEN (MUST) tener un alto máximo con desplazamiento propio y mantener visible su fila de encabezados, alineada con las columnas y con fondo opaco, mientras se desplazan. Las demás tablas NO DEBEN (MUST NOT) tener desplazamiento vertical propio.
Trace: NFR-USAB-006, NFR-USAB-101 · Priority: Should

#### Scenario: Vista previa con 200 filas
- **CUANDO** el OWNER desplaza la vista previa de un import de 200 filas hasta la fila 150
- **ENTONCES** los encabezados Fecha, Descripción y Monto siguen visibles en el borde superior de la tabla, alineados con sus columnas, y las filas no se ven a través de ellos

#### Scenario: Tabla corta sin desplazamiento propio
- **CUANDO** el OWNER abre el presupuesto de un periodo con 6 líneas
- **ENTONCES** la tabla no tiene desplazamiento vertical propio y se lee completa con el desplazamiento de la página

### Requirement: Columna de identificación fija en tablas anchas
En la vista previa de un import y en el cronograma de un préstamo, la columna que identifica cada fila (la fecha o el número de cuota) DEBE (MUST) quedar fija al desplazar la tabla a lo ancho y DEBE (MUST) estar marcada como encabezado de su fila.
Trace: NFR-USAB-006, NFR-USAB-108 · Priority: Could

#### Scenario: Desplazar la vista previa a lo ancho
- **CUANDO** a 360 px el OWNER desplaza a lo ancho la vista previa de un import hasta la última columna
- **ENTONCES** la columna Fecha sigue visible a la izquierda
- **Y** al leer una celda de monto, las tecnologías de asistencia anuncian la fecha de su fila como encabezado

### Requirement: Tablas completas al imprimir
Al imprimir, toda tabla DEBE (MUST) mostrarse completa, sin alto máximo ni desplazamiento propio, y su fila de encabezados DEBE (MUST) repetirse en cada página impresa.
Trace: NFR-USAB-101 · Priority: Should

#### Scenario: Imprimir el cronograma de un préstamo
- **CUANDO** el OWNER imprime el cronograma de un préstamo de 12000.00 BOB a 36 cuotas
- **ENTONCES** la impresión contiene las 36 cuotas, sin ninguna recortada
- **Y** cada página impresa empieza con la fila de encabezados

### Requirement: Semántica de tabla en pantallas angostas
En pantallas angostas las tablas DEBEN (MUST) conservar su estructura de filas, columnas y encabezados para las tecnologías de asistencia y desplazarse a lo ancho dentro de su propia región. NO DEBEN (MUST NOT) convertirse en listas apiladas ni producir desplazamiento horizontal de la página.
Trace: NFR-USAB-006, NFR-USAB-107, NFR-USAB-108 · Priority: Should

#### Scenario: Transacciones a 360 px
- **CUANDO** el OWNER abre Transacciones con un ancho de 360 px
- **ENTONCES** las tecnologías de asistencia reciben una tabla con encabezados de columna y filas
- **Y** la página no se desplaza a lo ancho; solo la región de la tabla lo hace

### Requirement: Pista de desplazamiento horizontal
Cuando una tabla tiene columnas fuera de la vista a la derecha, su región DEBE (MUST) mostrar una pista visual de que hay más contenido en ese borde, y la pista DEBE (MUST) desaparecer al llegar al final. Si el navegador no admite la pista, la barra de desplazamiento DEBE (MUST) seguir visible.
Trace: NFR-USAB-006 · Priority: Could

#### Scenario: Columnas fuera de la vista
- **CUANDO** a 360 px el OWNER abre el cronograma de un préstamo con más columnas que las que entran
- **ENTONCES** el borde derecho de la tabla muestra la pista de que hay más contenido

#### Scenario: Al final de la tabla
- **CUANDO** el OWNER desplaza esa tabla hasta la última columna
- **ENTONCES** la pista del borde derecho desaparece

### Requirement: Orden por columna en tablas comparativas
Las tablas comparativas (los reportes, el presupuesto contra lo real y el costo de las suscripciones) DEBEN (MUST) permitir ordenar por columna con un botón en el encabezado. Solo la columna activa DEBE (MUST) declarar su sentido de orden. Los montos DEBEN (MUST) ordenarse por su valor y no por el texto formateado. El nuevo orden DEBE (MUST) anunciarse una sola vez, y el foco DEBE (MUST) quedar en el botón del encabezado.
Trace: NFR-USAB-102, NFR-USAB-108 · Priority: Could

#### Scenario: Ordenar montos por su valor
- **CUANDO** el reporte de gastos por categoría tiene Alimentación con 1234.56 BOB, Transporte con 999.00 BOB y Salud con 45.30 BOB, y el OWNER ordena por Monto de mayor a menor
- **ENTONCES** el orden es Alimentación, Transporte y Salud

#### Scenario: Indicador y anuncio del orden
- **CUANDO** el OWNER ordena esa tabla por Monto
- **ENTONCES** solo el encabezado Monto declara el sentido del orden
- **Y** se anuncia una sola vez "Ordenado por Monto, de mayor a menor"

#### Scenario: Ordenar con el teclado
- **CUANDO** el OWNER llega con Tab al botón del encabezado Categoría y pulsa Enter
- **ENTONCES** la tabla queda ordenada por Categoría y el foco sigue en ese botón

### Requirement: Medidas y procesos con su rol propio
La utilización de una tarjeta de crédito y el avance de una meta DEBEN (MUST) exponerse como medidas, no como progreso de un proceso, con su valor y su texto visible. El avance del procesamiento de un import DEBE (MUST) exponerse como progreso de un proceso.
Trace: NFR-USAB-101, NFR-USAB-104, NFR-USAB-108 · Priority: Could

#### Scenario: Utilización de una tarjeta
- **CUANDO** el OWNER abre una tarjeta con 850.00 BOB usados de un límite de 1000.00 BOB
- **ENTONCES** la utilización se expone como una medida de 85 % con el texto "85 %" visible y sin rol de barra de progreso

#### Scenario: Avance de una meta
- **CUANDO** el OWNER abre una meta con 5000.00 BOB ahorrados de 15000.00 BOB
- **ENTONCES** el avance se expone como una medida de 33,33 % con su texto visible

#### Scenario: Procesamiento de un import
- **CUANDO** un import está en procesamiento
- **ENTONCES** su avance se expone como progreso de un proceso con un nombre que dice qué se procesa

### Requirement: Medición de la respuesta a interacciones
La suite E2E DEBE (MUST) medir el tiempo de respuesta a la interacción (INP) en abrir una fila de la vista previa de un import, filtrar la vista previa, aprobar el import y aplicar una edición masiva de transacciones, con un extracto sintético de 2 000 filas. DEBE (MUST) informar el valor por flujo junto al objetivo de 200 ms y el aviso de 500 ms, y NO DEBE (MUST NOT) hacer fallar la suite por el valor medido.
Trace: NFR-PERF-004 · Priority: Should

#### Scenario: Informe de la medición
- **CUANDO** corre la medición con el extracto sintético de 2 000 filas
- **ENTONCES** el informe de la suite incluye el INP de los cuatro flujos en milisegundos, con el objetivo y el aviso

#### Scenario: Valor por encima del aviso
- **CUANDO** un flujo mide 650 ms
- **ENTONCES** el informe lo marca como por encima del aviso y la suite no falla por eso

### Requirement: Filas de tabla dibujadas completas
Las filas y los grupos de filas de las tablas NO DEBEN (MUST NOT) diferir su dibujo con contención de contenido: esa técnica no actúa sobre filas de tabla, y el costo de las tablas largas se reduce con páginas.
Trace: NFR-PERF-004 · Priority: Should

#### Scenario: Sin contención en filas de tabla
- **CUANDO** se revisan las hojas de estilo y los componentes de la interfaz
- **ENTONCES** ninguna regla difiere el dibujo de una fila o de un grupo de filas de tabla

### Requirement: Detalle de un préstamo sin desbordamiento horizontal
A 360 px de ancho, el detalle de un préstamo, incluida su sección «Detalle» con los saldos y los totales pagados, NO DEBE (MUST NOT) producir desplazamiento horizontal de la página: los montos y sus rótulos DEBEN (MUST) acomodarse al ancho disponible sin recortarse y sin dejar de leerse completos.
Trace: NFR-USAB-006, NFR-USAB-107 · Priority: Should

#### Scenario: Saldos de un préstamo a 360 px
- **CUANDO** a 360 px el OWNER abre el detalle de un préstamo de 12000.00 BOB con una diferencia no registrada de 150.00 BOB
- **ENTONCES** la página no se desplaza a lo ancho
- **Y** el principal pendiente, el saldo de la cuenta, la diferencia y los totales pagados se leen completos
