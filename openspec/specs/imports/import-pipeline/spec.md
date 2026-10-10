# imports/import-pipeline Specification

## Purpose
Convierte archivos externos en transacciones del dominio de forma segura, idempotente, auditable y revisada por el usuario. Esta versión es el **subconjunto CSV básico** (FR-IMPORTS-003, Could, Phase 3): un archivo CSV de una sola cuenta, con mapeo manual de columnas, formato de fecha y separador decimal explícitos, vista previa y aprobación, idempotencia por archivo y por fila y deduplicación básica contra los movimientos existentes. El pipeline completo (documentos, perfiles de mapeo, reglas, otros formatos, reconciliación contra extracto y deshacer) lo amplía en Phase 6.

## Requirements

### Requirement: Importación CSV para una cuenta
Un OWNER o EDITOR DEBE (MUST) poder iniciar la importación de un archivo CSV indicando una única cuenta destino activa del workspace; el sistema DEBE (MUST) leer el archivo, detectar su codificación (UTF-8 con o sin BOM, o windows-1252) y su delimitador (coma, punto y coma, tabulación o barra vertical) y devolver la importación en estado "esperando mapeo" con el encabezado y hasta 20 filas de muestra, sin crear ninguna transacción. Una cuenta cerrada o archivada DEBE (MUST) rechazarse con `ACCOUNT_CLOSED` o `ACCOUNT_ARCHIVED`.
Trace: FR-IMPORTS-003, FR-IMPORTS-001 · Priority: Must

#### Scenario: Subida de un extracto
- **CUANDO** un EDITOR sube para "Banco BOB" el archivo "extracto-octubre.csv" en windows-1252 con delimitador punto y coma, el encabezado "Fecha;Descripción;Monto" y 4 filas de datos
- **ENTONCES** se crea una importación en estado "esperando mapeo" que informa la codificación windows-1252, el delimitador punto y coma, las columnas "Fecha", "Descripción" y "Monto" y las 4 filas de muestra
- **Y** no se crea ninguna transacción

#### Scenario: Cuenta cerrada
- **CUANDO** un EDITOR sube un archivo para la cuenta cerrada "Banco Viejo"
- **ENTONCES** se rechaza con `ACCOUNT_CLOSED` y no se crea ninguna importación

### Requirement: Límites de tamaño y contenido del archivo
El sistema DEBE (MUST) rechazar sin crear nada un archivo mayor que el tamaño máximo configurado (por defecto 2 MiB) con `UPLOAD_TOO_LARGE`, uno con más filas de datos que el máximo (por defecto 5 000) con `IMPORT_TOO_MANY_ROWS` y uno que no sea texto delimitado legible (contenido binario, codificación no soportada o más de 50 columnas) con `IMPORT_UNSUPPORTED_FORMAT`.
Trace: FR-IMPORTS-003, NFR-SEC-012 · Priority: Must

#### Scenario: Archivo demasiado grande
- **CUANDO** un EDITOR sube un CSV de 2.5 MiB
- **ENTONCES** la respuesta es 413 con `UPLOAD_TOO_LARGE`
- **Y** no se crea ninguna importación

#### Scenario: Demasiadas filas
- **CUANDO** un EDITOR sube un CSV de 1.2 MiB con 5 001 filas de datos
- **ENTONCES** se rechaza con `IMPORT_TOO_MANY_ROWS` y no se crea ninguna importación

#### Scenario: Imagen renombrada como CSV
- **CUANDO** un EDITOR sube una imagen PNG con el nombre "extracto.csv"
- **ENTONCES** se rechaza con `IMPORT_UNSUPPORTED_FORMAT` y no se crea ninguna importación

### Requirement: Mapeo manual de columnas
El usuario DEBE (MUST) indicar qué columna es la fecha, cuál la descripción y cómo se lee el monto —una columna con signo y su convención ("negativo es salida" o "positivo es salida") o dos columnas de débito (salida) y crédito (entrada)—, si la primera fila es encabezado y cuántas filas iniciales se saltan; cada fila DEBE (MUST) convertirse en una salida (gasto) o una entrada (ingreso) en la moneda de la cuenta. Un mapeo que referencia columnas inexistentes o deja sin asignar fecha, descripción o monto DEBE (MUST) rechazarse con `IMPORT_MAPPING_INVALID`, dejando la importación esperando mapeo. El mapeo PUEDE (MAY) volver a enviarse mientras la importación no esté aprobada.
Trace: FR-IMPORTS-003 · Priority: Must

#### Scenario: Monto con signo
- **CUANDO** para "extracto-octubre.csv" con las filas "01/10/2026;COMPRA SUPERMERCADO;-245,30", "02/10/2026;PAGO QR CAFÉ;-18,00", "02/10/2026;PAGO QR CAFÉ;-18,00" y "05/10/2026;ABONO SUELDO;8.000,00" el usuario asigna fecha, descripción y monto con signo "negativo es salida", formato `dd/MM/yyyy` y coma decimal
- **ENTONCES** la vista previa muestra 3 salidas por un total de 281.30 BOB y 1 entrada de 8000.00 BOB

#### Scenario: Columnas de débito y crédito
- **CUANDO** el archivo tiene columnas "Débito" y "Crédito", la fila 3 trae "245,30" en "Débito" y nada en "Crédito", y la fila 4 trae valores en ambas
- **ENTONCES** la fila 3 es una salida de 245.30 BOB
- **Y** la fila 4 es inválida con `IMPORT_INVALID_AMOUNT`

#### Scenario: Cargos positivos de una tarjeta
- **CUANDO** el extracto de la cuenta "Visa" trae el cargo "120,00" y el usuario elige "positivo es salida"
- **ENTONCES** la fila es una salida de 120.00 BOB

#### Scenario: Columna inexistente
- **CUANDO** el usuario asigna el monto a la columna 7 de un archivo de 3 columnas
- **ENTONCES** el mapeo se rechaza con `IMPORT_MAPPING_INVALID` y la importación sigue esperando mapeo

### Requirement: Formato de fecha y separador decimal explícitos
El usuario DEBE (MUST) elegir el formato de fecha (`dd/MM/yyyy`, `dd-MM-yyyy`, `dd/MM/yy`, `yyyy-MM-dd` o `MM/dd/yyyy`) y el separador decimal (coma o punto, con el otro carácter como separador de miles opcional); el sistema DEBE (MUST) interpretar cada valor exactamente con esa elección, sin adivinar por fila, y DEBE (MUST) producir montos decimales exactos a la escala de la moneda de la cuenta. Un monto con más decimales que la escala o no interpretable DEBE (MUST) marcar la fila inválida con `IMPORT_INVALID_AMOUNT` y NO DEBE (MUST NOT) redondearse; una fecha inexistente o no interpretable DEBE (MUST) marcarla con `IMPORT_INVALID_DATE` y su número de línea.
Trace: FR-IMPORTS-003, FR-IMPORTS-006 · Priority: Must

#### Scenario: Coma decimal con punto de miles
- **CUANDO** con coma decimal la fila trae "8.000,00"
- **ENTONCES** el monto es 8000.00 BOB

#### Scenario: Exceso de escala nunca se redondea
- **CUANDO** con punto decimal una fila de la cuenta en BOB trae "1.234"
- **ENTONCES** la fila es inválida con `IMPORT_INVALID_AMOUNT` por tener 3 decimales en una moneda de escala 2
- **Y** no se convierte en 1.23 BOB

#### Scenario: Día y mes según el formato elegido
- **CUANDO** una fila trae la fecha "03/04/2026"
- **ENTONCES** con el formato `dd/MM/yyyy` su fecha es 2026-04-03
- **Y** con el formato `MM/dd/yyyy` su fecha es 2026-03-04

#### Scenario: Fecha inexistente
- **CUANDO** la línea 6 del archivo trae la fecha "31/02/2026" con el formato `dd/MM/yyyy`
- **ENTONCES** esa fila es inválida con `IMPORT_INVALID_DATE` en la línea 6

### Requirement: Validación de cada fila
Cada fila DEBE (MUST) validarse antes de la vista previa: monto distinto de cero, fecha no posterior a hoy más 3 días en la zona del workspace y fecha fuera de periodos cerrados (`PERIOD_CLOSED`); las filas inválidas DEBEN (MUST) mostrarse con su número de línea y su código y NO DEBEN (MUST NOT) importarse nunca.
Trace: FR-IMPORTS-006, FR-PLANNING-005, NFR-DATA-016 · Priority: Must

#### Scenario: Monto cero y fecha futura
- **CUANDO** el 2026-10-20 un archivo trae una fila de "0,00" del 2026-10-10, una de "-50,00" del 2026-10-25 y una de "-30,00" del 2026-10-22
- **ENTONCES** la primera es inválida con `IMPORT_INVALID_AMOUNT` y la segunda con `IMPORT_FUTURE_DATE`
- **Y** la tercera es válida

#### Scenario: Fila en un periodo cerrado
- **CUANDO** el periodo "2026-08" está cerrado y una fila es del 2026-08-15
- **ENTONCES** la fila es inválida con `PERIOD_CLOSED` y no se importará

### Requirement: Vista previa sin efectos antes de aprobar
Tras aplicar el mapeo, el sistema DEBE (MUST) ofrecer una vista previa paginada de todas las filas con su clasificación (nueva, ya importada, posible duplicado o inválida), los conteos por clasificación, el total de salidas y de entradas de las filas a crear y el saldo contable actual y resultante de la cuenta; hasta la aprobación NO DEBE (MUST NOT) existir ninguna transacción, asiento ni cambio de saldo derivado del archivo.
Trace: NFR-DATA-016, FR-IMPORTS-009, FR-IMPORTS-003 · Priority: Must

#### Scenario: Resumen de la vista previa
- **CUANDO** "Banco BOB" tiene saldo contable 4000.00 BOB y se aplica el mapeo de "Monto con signo" a "extracto-octubre.csv"
- **ENTONCES** la vista previa informa 4 filas nuevas, 0 ya importadas, 0 posibles duplicados y 0 inválidas, salidas por 281.30 BOB, entradas por 8000.00 BOB y saldo resultante 11718.70 BOB
- **Y** el saldo contable de "Banco BOB" sigue siendo 4000.00 BOB y no existe ninguna transacción importada

#### Scenario: Cambiar el mapeo antes de aprobar
- **CUANDO** el usuario vuelve a enviar el mapeo con el formato `MM/dd/yyyy`
- **ENTONCES** la vista previa se recalcula con las fechas nuevas
- **Y** sigue sin existir ninguna transacción importada

### Requirement: Idempotencia por fila
Cada fila válida DEBE (MUST) identificarse por una huella determinista de la cuenta, la fecha, el monto con signo, la moneda, la descripción normalizada y su ordinal entre filas idénticas del mismo archivo; una fila cuya huella ya está vinculada a una transacción no anulada de la cuenta DEBE (MUST) clasificarse como ya importada y NO DEBE (MUST NOT) crearse de nuevo. Dos filas idénticas del mismo archivo DEBEN (MUST) crear dos transacciones; si la transacción vinculada se anula, la fila DEBE (MUST) volver a poder importarse.
Trace: FR-IMPORTS-010, FR-IMPORTS-007 · Priority: Must

#### Scenario: Mismo archivo dos veces
- **CUANDO** "extracto-octubre.csv" ya se importó (4 transacciones) y el usuario lo sube de nuevo con el mismo mapeo
- **ENTONCES** la vista previa informa 4 filas ya importadas y 0 nuevas
- **Y** al aprobar se crean 0 transacciones y el saldo de "Banco BOB" sigue siendo 11718.70 BOB

#### Scenario: Rangos solapados
- **CUANDO** se importó "1-15-octubre.csv" con 10 filas y luego se sube "octubre-completo.csv" con 25 filas que incluyen esas 10 sin cambios
- **ENTONCES** la vista previa informa 10 ya importadas y 15 nuevas
- **Y** al aprobar se crean 15 transacciones

#### Scenario: Dos cafés idénticos el mismo día
- **CUANDO** el archivo trae dos veces "02/10/2026;PAGO QR CAFÉ;-18,00"
- **ENTONCES** ambas filas son nuevas y al aprobar se crean dos gastos de 18.00 BOB

#### Scenario: Transacción importada anulada
- **CUANDO** uno de los dos cafés importados se anula y el usuario vuelve a subir el mismo archivo
- **ENTONCES** esa fila es nueva y las otras 3 son ya importadas

### Requirement: Aviso de archivo ya importado
Si el contenido exacto del archivo (SHA-256) ya se importó en la misma cuenta, el sistema DEBERÍA (SHOULD) advertirlo con `IMPORT_FILE_ALREADY_IMPORTED`, la fecha y la importación anterior, sin bloquear: la idempotencia por fila DEBE (MUST) seguir evitando duplicados.
Trace: FR-IMPORTS-010 · Priority: Should

#### Scenario: Re-subida del mismo archivo
- **CUANDO** "extracto-octubre.csv" se importó en "Banco BOB" el 2026-10-20 y el usuario lo vuelve a subir para la misma cuenta
- **ENTONCES** la importación nueva se crea con la advertencia `IMPORT_FILE_ALREADY_IMPORTED` que indica el 2026-10-20 y la importación anterior

### Requirement: Deduplicación básica con movimientos existentes
Cada fila nueva DEBE (MUST) compararse con los movimientos no anulados de la cuenta —gastos, ingresos y patas de transferencias y conversiones— del mismo monto y moneda, en la misma dirección y con fecha a ±3 días; si hay candidatos, la fila DEBE (MUST) clasificarse como posible duplicado mostrando el candidato y exigir que el usuario decida crearla u omitirla. Omitirla DEBE (MUST) vincularla al movimiento existente, de modo que una importación posterior la clasifique como ya importada. Cada movimiento existente DEBE (MUST) emparejarse con una sola fila.
Trace: FR-IMPORTS-007, FR-TRANSACTIONS-031, FR-TRANSACTIONS-032 · Priority: Must

#### Scenario: Gasto registrado a mano
- **CUANDO** "Banco BOB" tiene un gasto manual posteado de 245.30 BOB "Supermercado" del 2026-10-02 y el archivo trae "01/10/2026;COMPRA SUPERMERCADO;-245,30"
- **ENTONCES** la fila es un posible duplicado con ese gasto como candidato

#### Scenario: Pago de tarjeta registrado como transferencia
- **CUANDO** existe la transferencia manual de 400.00 BOB de "Banco BOB" a "Visa" del 2026-10-10 y el archivo de "Banco BOB" trae "10/10/2026;PAGO TARJETA;-400,00"
- **ENTONCES** la fila es un posible duplicado con la transferencia como candidato

#### Scenario: Omitir recuerda el vínculo
- **CUANDO** el usuario omite la fila del supermercado, aprueba la importación y luego vuelve a subir el mismo archivo
- **ENTONCES** la fila del supermercado no se creó en la primera importación
- **Y** en la segunda se clasifica como ya importada

#### Scenario: Fuera de la ventana de días
- **CUANDO** el gasto manual de 245.30 BOB es del 2026-10-06 y la fila es del 2026-10-01
- **ENTONCES** la fila es nueva, sin candidatos

### Requirement: Aprobación y creación de las transacciones
La aprobación DEBE (MUST) exigir clave de idempotencia y la versión vigente de la importación, y DEBE (MUST) rechazarse con `IMPORT_REVIEW_INCOMPLETE` y el conteo de pendientes mientras haya posibles duplicados sin decisión. Aprobada, el sistema DEBE (MUST) crear, de forma asíncrona y por lotes, una transacción posteada por cada fila a crear —gasto con la categoría "Sin categoría" para una salida, ingreso con "Ingreso sin categoría" para una entrada—, con origen import, su asiento, su auditoría y su recorrido, y DEBE (MUST) informar el avance y al terminar los conteos de filas totales, creadas, omitidas, ya importadas e inválidas. Las filas inválidas, excluidas, omitidas o ya importadas NO DEBEN (MUST NOT) crear transacciones.
Trace: FR-IMPORTS-003, FR-IMPORTS-001, NFR-DATA-016 · Priority: Must

#### Scenario: Decisión pendiente
- **CUANDO** la vista previa tiene 1 posible duplicado sin decidir y el usuario aprueba
- **ENTONCES** se rechaza con `IMPORT_REVIEW_INCOMPLETE` indicando 1 decisión pendiente
- **Y** no se crea ninguna transacción

#### Scenario: Aprobación con filas omitidas e inválidas
- **CUANDO** "Banco BOB" tiene saldo contable 4000.00 BOB y la vista previa de 5 filas tiene dos cafés nuevos de 18.00 BOB de salida, un sueldo nuevo de 8000.00 BOB de entrada, el supermercado de 245.30 BOB como posible duplicado omitido y 1 fila inválida, y el usuario aprueba
- **ENTONCES** al terminar existen 2 gastos posteados de 18.00 BOB "Sin categoría" y 1 ingreso posteado de 8000.00 BOB "Ingreso sin categoría" con origen import
- **Y** el saldo contable de "Banco BOB" es 11964.00 BOB
- **Y** la importación termina completada con 5 filas, 3 creadas, 1 omitida y 1 inválida

#### Scenario: Aprobación repetida con la misma clave
- **CUANDO** el usuario repite la aprobación con la misma clave de idempotencia
- **ENTONCES** recibe la misma respuesta y no se crea ninguna transacción adicional

### Requirement: Fallo parcial y reintento
Si un lote es rechazado por una regla del dominio durante la persistencia (por ejemplo un periodo cerrado después de la vista previa), el sistema DEBERÍA (SHOULD) conservar los lotes ya creados, dejar la importación como parcialmente fallida con las filas afectadas y su código, y permitir reintentar esas filas o aceptar el resultado; el reintento DEBE (MUST) ser idempotente y NO DEBE (MUST NOT) duplicar las filas ya creadas.
Trace: FR-IMPORTS-003, FR-PLANNING-005, FR-IMPORTS-010 · Priority: Should

#### Scenario: Periodo cerrado entre la vista previa y la persistencia
- **CUANDO** una importación aprobada de 450 filas se persiste en lotes de 200, 200 y 50, y el periodo "2026-09" se cierra después de la vista previa afectando a las 200 filas del segundo lote
- **ENTONCES** se crean 250 transacciones de los lotes 1 y 3 y la importación queda parcialmente fallida con 200 filas en `PERIOD_CLOSED`
- **CUANDO** el OWNER reabre "2026-09" y el usuario reintenta
- **ENTONCES** se crean las 200 restantes y la importación queda completada con 450 transacciones creadas y ninguna duplicada

#### Scenario: Aceptar el resultado parcial
- **CUANDO** el usuario acepta el resultado parcial sin reintentar
- **ENTONCES** la importación termina "completada con errores" con 250 transacciones creadas y 200 filas fallidas listadas

### Requirement: Cancelación de una importación
El usuario PUEDE (MAY) cancelar una importación no aprobada; la cancelación DEBE (MUST) quedar auditada, no crear transacciones y descartar las celdas crudas del archivo. Una importación aprobada o terminada NO DEBE (MUST NOT) cancelarse (`INVALID_STATUS_TRANSITION`).
Trace: FR-IMPORTS-003 · Priority: Could

#### Scenario: Cancelar durante la revisión
- **CUANDO** el usuario cancela una importación en revisión con 4 filas nuevas
- **ENTONCES** la importación queda cancelada, no se crea ninguna transacción y sus celdas crudas se descartan

#### Scenario: Cancelar una importación completada
- **CUANDO** el usuario intenta cancelar una importación completada
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION`

### Requirement: Textos importados como datos no confiables
Las descripciones importadas DEBEN (MUST) tratarse como datos no confiables: el sistema DEBE (MUST) eliminar los caracteres de control, colapsar espacios, truncar a 500 caracteres con la advertencia `IMPORT_DESCRIPTION_TRUNCATED` y guardar el texto sin interpretarlo; todo CSV que el sistema exporte DEBE (MUST) neutralizar las celdas que empiezan con `=`, `+`, `-`, `@`, tabulación o retorno de carro, y la UI DEBE (MUST) mostrarlas escapadas. Los logs NO DEBEN (MUST NOT) contener montos ni descripciones de filas.
Trace: FR-IMPORTS-003, NFR-SEC-010, NFR-SEC-015 · Priority: Must

#### Scenario: Fórmula en la descripción
- **CUANDO** una fila importada trae la descripción `=HYPERLINK("http://example.test","clic")` y luego el OWNER exporta el workspace
- **ENTONCES** la transacción guarda esa descripción literal
- **Y** en el CSV de transacciones del export la celda empieza con un apóstrofo y no se interpreta como fórmula

#### Scenario: Caracteres de control y descripción larga
- **CUANDO** una fila trae una descripción de 620 caracteres con una tabulación y espacios repetidos
- **ENTONCES** la descripción importada no tiene la tabulación ni espacios repetidos, tiene 500 caracteres y la fila lleva la advertencia `IMPORT_DESCRIPTION_TRUNCATED`

### Requirement: Permisos y auditoría del import
Solo OWNER y EDITOR DEBEN (MUST) poder crear, mapear, decidir, aprobar, reintentar o cancelar importaciones; un VIEWER DEBE (MUST) poder consultarlas y recibir `INSUFFICIENT_ROLE` al modificarlas. La creación, la aprobación, la cancelación, la expiración y la aceptación de errores DEBEN (MUST) auditarse con el actor en la misma unidad de trabajo, y cada transacción creada DEBE (MUST) auditarse con origen import y como actor quien aprobó.
Trace: FR-IDENTITY-006, FR-AUDIT-002, FR-IMPORTS-003 · Priority: Must

#### Scenario: VIEWER intenta importar
- **CUANDO** un VIEWER sube un CSV para "Banco BOB"
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y no se crea ninguna importación

#### Scenario: Auditoría de la aprobación
- **CUANDO** el EDITOR "Ana" aprueba una importación que crea 3 transacciones
- **ENTONCES** el registro de auditoría contiene la creación y la aprobación de la importación con "Ana" como actor
- **Y** cada una de las 3 transacciones tiene su registro de creación con origen import y actor "Ana"

### Requirement: Cuota de operaciones costosas en el import
Subir un archivo, aplicar un mapeo, aprobar y reintentar DEBERÍAN (SHOULD) consumir la cuota de operaciones costosas del usuario (por defecto 10 por minuto) además de la general; al excederla la API DEBE (MUST) responder 429 `RATE_LIMITED` con `Retry-After` sin efectos, y una reproducción idempotente NO DEBE (MUST NOT) consumir cuota.
Trace: NFR-SEC-011 · Priority: Should

#### Scenario: Ráfaga de subidas
- **CUANDO** un EDITOR sube 11 archivos con claves de idempotencia distintas en menos de un minuto con la cuota costosa de 10 por minuto
- **ENTONCES** la subida 11 responde 429 con `RATE_LIMITED` y `Retry-After`
- **Y** no se crea la importación 11

#### Scenario: Reproducción de una aprobación
- **CUANDO** el usuario repite una aprobación con la misma clave y el mismo contenido
- **ENTONCES** recibe la respuesta original sin consumir cuota costosa

### Requirement: Volumen de eventos de un import grande
Un import de 5 000 filas DEBERÍA (SHOULD) llegar a la vista previa en 30 segundos o menos y persistirse en 20 segundos o menos en el entorno de referencia, y los eventos que generan sus transacciones DEBEN (MUST) quedar procesados por cada consumidor en 120 segundos o menos; el import NO DEBE (MUST NOT) publicar eventos propios por fila (solo la aprobación y el fin de la importación).
Trace: NFR-PERF-007, NFR-PERF-008 · Priority: Should

#### Scenario: Extracto de 5 000 filas
- **CUANDO** un EDITOR importa un CSV de 5 000 filas nuevas y lo aprueba
- **ENTONCES** la vista previa estuvo disponible en 30 segundos o menos desde la subida y las 5 000 transacciones existen en 20 segundos o menos desde la aprobación
- **Y** cada consumidor de eventos termina de procesar los eventos de esas transacciones en 120 segundos o menos
- **Y** la importación publicó exactamente 2 eventos propios

### Requirement: Retención del contenido importado
Las celdas crudas del archivo DEBERÍAN (SHOULD) descartarse 90 días después de terminar la importación, o al cancelarla o expirar, conservando la importación, sus conteos y los vínculos de idempotencia; una importación sin aprobar DEBE (MUST) expirar a los 30 días, quedando cancelada por el sistema con auditoría.
Trace: FR-IMPORTS-003, FR-IMPORTS-010 · Priority: Should

#### Scenario: Purga a los 90 días
- **CUANDO** una importación terminó el 2026-10-20
- **ENTONCES** el 2027-01-18 sus celdas crudas ya no existen
- **Y** la importación, sus conteos y sus vínculos de idempotencia se conservan

#### Scenario: Revisión abandonada
- **CUANDO** una importación espera revisión desde el 2026-10-20
- **ENTONCES** el 2026-11-19 queda cancelada por el sistema, con registro de auditoría, y sus celdas crudas se descartan
