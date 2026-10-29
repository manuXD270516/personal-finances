## MODIFIED Requirements

### Requirement: Formatos de archivo detectados por contenido
El sistema DEBE (MUST) importar archivos CSV, OFX (1.x y 2.x), QIF, JSON del esquema propio y extractos PDF con texto, eligiendo el lector por el formato detectado en el contenido del documento y no por su nombre; un documento de un formato no importable DEBE (MUST) rechazarse al crear la importación con `IMPORT_UNSUPPORTED_FORMAT`. Un PDF DEBE (MUST) aceptarse al crear la importación y su lectura DEBE (MUST) decidirse en el worker: si no tiene texto o no corresponde a un diseño de extracto conocido, la importación DEBE (MUST) fallar en la etapa de lectura con el código correspondiente.
Trace: FR-IMPORTS-004, FR-IMPORTS-016 · Priority: Must

#### Scenario: Formato tomado del contenido
- **CUANDO** un EDITOR crea una importación con un documento disponible detectado como QIF sin indicar el formato
- **ENTONCES** la importación se procesa con el lector de QIF

#### Scenario: Extracto PDF con texto
- **CUANDO** un EDITOR crea una importación para "Banco BOB" con un extracto PDF disponible
- **ENTONCES** la importación se crea en "subida" con el formato PDF
- **Y** se procesa con el lector de extractos PDF

#### Scenario: Documento de imagen
- **CUANDO** un EDITOR crea una importación con un documento disponible detectado como PNG
- **ENTONCES** se rechaza con `IMPORT_UNSUPPORTED_FORMAT` y no se crea ninguna importación

## ADDED Requirements

### Requirement: Extracción del texto de un PDF en un proceso aislado
El sistema DEBE (MUST) extraer el texto de un extracto PDF con la posición de cada fragmento en un hilo aislado del proceso del worker, con límites configurables de memoria, tiempo, páginas y fragmentos de texto, sin renderizar páginas, sin ejecutar código del documento y sin cargar recursos externos. Exceder un límite o no poder leer el documento DEBE (MUST) dejar la importación en "falló la lectura" con `IMPORT_PDF_EXTRACTION_FAILED` y el motivo, sin filas, y el worker DEBE (MUST) seguir procesando las importaciones siguientes. Un PDF con contraseña solo de propietario DEBE (MUST) leerse como cualquier otro. Los metadatos del documento (autor, creador, productor, título) NO DEBEN (MUST NOT) guardarse ni registrarse.
Trace: FR-IMPORTS-016, FR-IMPORTS-002, NFR-SEC-012, NFR-SEC-013 · Priority: Must

#### Scenario: Extracto con texto leído en el hilo aislado
- **CUANDO** un EDITOR importa en "Banco BOB" el extracto PDF sintético de una página de "Banco Cumbre Demo" con 4 movimientos
- **ENTONCES** la importación queda "en revisión" con 4 filas

#### Scenario: Tiempo de extracción excedido
- **CUANDO** la extracción de un PDF supera el tiempo máximo configurado de 30 segundos
- **ENTONCES** el hilo aislado se termina y la importación queda en "falló la lectura" con `IMPORT_PDF_EXTRACTION_FAILED` y el motivo de tiempo, sin filas
- **Y** la importación siguiente de la cola se procesa normalmente

#### Scenario: Memoria del hilo aislado excedida
- **CUANDO** la extracción de un PDF supera el límite de memoria del hilo aislado
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PDF_EXTRACTION_FAILED` y el motivo de memoria, sin filas
- **Y** el proceso del worker sigue activo

#### Scenario: Demasiadas páginas
- **CUANDO** un EDITOR importa un PDF de 201 páginas con el máximo configurado de 200
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PDF_EXTRACTION_FAILED` y el motivo de páginas, sin leer el contenido de ninguna página

#### Scenario: PDF dañado
- **CUANDO** el documento de una importación es un PDF cuya tabla de referencias está truncada y no se puede reconstruir
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PDF_EXTRACTION_FAILED`, sin filas

#### Scenario: Contraseña solo de propietario
- **CUANDO** el extracto PDF sintético de "Banco Cumbre Demo" tiene contraseña de propietario que restringe la impresión y no tiene contraseña de apertura
- **ENTONCES** la importación queda "en revisión" con sus 4 filas

#### Scenario: Metadatos del PDF descartados
- **CUANDO** el PDF importado declara como autor "PERSONA FICTICIA ALFA"
- **ENTONCES** ese texto no aparece en la importación, en sus filas, en la auditoría, en los eventos ni en los logs

### Requirement: Rechazo explícito de un PDF escaneado sin texto
Un PDF sin texto extraíble —un extracto escaneado o fotografiado— NO DEBE (MUST NOT) procesarse con reconocimiento óptico de caracteres ni interpretarse por aproximación: la importación DEBE (MUST) quedar en "falló la lectura" con `IMPORT_PDF_NO_TEXT`, sin filas, y la interfaz DEBE (MUST) indicar que se descargue el extracto digital desde la banca por internet o se registren los movimientos a mano. Una página sin texto entre páginas con texto, que no sea una página en blanco declarada por el diseño, DEBE (MUST) producir el mismo rechazo indicando el número de página.
Trace: FR-IMPORTS-016, FR-IMPORTS-002 · Priority: Must

#### Scenario: Extracto escaneado
- **CUANDO** un EDITOR importa un PDF de 2 páginas que solo contienen imágenes
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PDF_NO_TEXT` y sin filas
- **Y** la interfaz indica descargar el extracto digital o registrar los movimientos a mano

#### Scenario: Una página escaneada entre páginas con texto
- **CUANDO** un EDITOR importa un PDF de 3 páginas cuya página 2 es solo una imagen
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PDF_NO_TEXT` indicando la página 2, sin filas

### Requirement: Diseños de extracto PDF por institución, versionados
El sistema DEBE (MUST) leer los extractos PDF con diseños declarativos por institución, cada uno con identificador y versión, derivados de las fichas de formato registradas; una versión publicada de un diseño NO DEBE (MUST NOT) modificarse, y un cambio de formato del banco DEBE (MUST) publicarse como una versión nueva. Al leer, el sistema DEBE (MUST) usar la versión fijada en el perfil PDF de la cuenta o de su institución si existe y, si no, detectar el diseño por los rótulos fijos de la primera página, probando primero la versión más reciente; la importación DEBE (MUST) registrar el diseño y la versión aplicados. Un PDF con texto que no corresponde a ningún diseño DEBE (MUST) quedar en "falló la lectura" con `IMPORT_PDF_LAYOUT_UNKNOWN`, sin filas. La detección NO DEBE (MUST NOT) depender del nombre del banco ni de datos del titular.
Trace: FR-IMPORTS-016, FR-IMPORTS-005 · Priority: Must

#### Scenario: Diseño detectado por los rótulos del encabezado
- **CUANDO** un EDITOR importa el extracto PDF sintético de "Banco Pampa Demo" y "Banco BOB" no tiene perfil PDF
- **ENTONCES** la importación registra el diseño `bo.ganadero.cuenta` en su versión 1 y queda "en revisión"

#### Scenario: Versión fijada en el perfil de la cuenta
- **CUANDO** existen las versiones 1 y 2 de `bo.ganadero.cuenta` y el perfil PDF de "Banco BOB" fija la versión 1
- **ENTONCES** la importación se lee con la versión 1 y la registra

#### Scenario: Diseño desconocido
- **CUANDO** un EDITOR importa un PDF con texto que no tiene los rótulos de ningún diseño
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PDF_LAYOUT_UNKNOWN` y sin filas

#### Scenario: Versión publicada modificada
- **CUANDO** un cambio altera el contenido de la versión 1 publicada de `bo.bcp.cuenta`
- **ENTONCES** la verificación de diseños falla y nombra el diseño y la versión alterados

### Requirement: Reconstrucción de la tabla del extracto por posición
El sistema DEBE (MUST) reconstruir las filas de movimientos a partir de la posición de cada fragmento de texto y no del orden en que el documento los dibuja: DEBE (MUST) agrupar los fragmentos por línea, asignarlos a la columna cuyo rango, derivado de los rótulos del encabezado de la tabla, los contiene, unir las líneas de continuación de una glosa a su movimiento con un espacio y conservar el orden impreso de las filas aunque no sea cronológico. Un fragmento que cae entre dos columnas NO DEBE (MUST NOT) asignarse por aproximación: su fila DEBE (MUST) quedar inválida con `IMPORT_PDF_AMBIGUOUS_CELL` y su número de línea.
Trace: FR-IMPORTS-016, FR-IMPORTS-006 · Priority: Must

#### Scenario: Orden de dibujo distinto del orden visual
- **CUANDO** el extracto PDF sintético de "Banco Altiplano Demo" dibuja sus fragmentos en orden aleatorio
- **ENTONCES** la vista previa tiene los mismos 6 movimientos, con las mismas fechas, horas, montos y referencias, que cuando los dibuja en orden de lectura

#### Scenario: Glosa en dos líneas
- **CUANDO** un movimiento de "Banco Pampa Demo" trae la glosa "Transferencia a 0000000003. COMERCIO DEMO" y en la línea siguiente, sin fecha ni monto, "TRES Qr Pedido 15"
- **ENTONCES** la fila tiene la descripción "Transferencia a 0000000003. COMERCIO DEMO TRES Qr Pedido 15" y una salida de 1200.50 BOB

#### Scenario: Texto dibujado carácter por carácter
- **CUANDO** el extracto PDF sintético de "Banco Cumbre Demo" dibuja cada carácter por separado y los espacios como separaciones sin carácter
- **ENTONCES** la vista previa tiene los mismos 4 movimientos que el extracto dibujado por celdas

#### Scenario: Fragmento entre dos columnas
- **CUANDO** el monto de un movimiento empieza dentro de la columna de descripción y termina dentro de la columna de débito
- **ENTONCES** esa fila es inválida con `IMPORT_PDF_AMBIGUOUS_CELL` y su número de línea
- **Y** las demás filas son válidas

#### Scenario: Filas fuera de orden cronológico
- **CUANDO** el extracto de "Banco Pampa Demo" imprime el 31/03/2026 una fila de las 23:10:00 antes de una de las 03:12:07
- **ENTONCES** la vista previa conserva el orden impreso y no advierte `IMPORT_RUNNING_BALANCE_GAP`

#### Scenario: Fecha y hora en una línea distinta de la glosa
- **CUANDO** en el extracto de "Banco Altiplano Demo" la fecha "21/03/2026" y la hora "13:40" de un retiro de 1,325.00 están una línea por encima de su glosa
- **ENTONCES** la fila es una salida de 1325.00 BOB con fecha 2026-03-21, hora 13:40 y esa glosa completa

### Requirement: Saltos de página, encabezados y pies del extracto PDF
El sistema DEBE (MUST) descartar los encabezados y pies que el diseño declara en cada página, sin que aparezcan como filas ni como inválidas; una glosa cortada por un salto de página DEBE (MUST) unirse al último movimiento de la página anterior; una página en blanco declarada por el diseño DEBE (MUST) omitirse; y si el extracto declara su número total de páginas, el sistema DEBE (MUST) verificar que leyó todas y, si no, dejar la importación en "falló la lectura" con `IMPORT_PDF_PAGE_COUNT_MISMATCH`, sin filas.
Trace: FR-IMPORTS-016, FR-IMPORTS-006 · Priority: Must

#### Scenario: Glosa cortada por el salto de página
- **CUANDO** la glosa de un movimiento de "Banco Pampa Demo" empieza en la última línea de la página 1 y sigue en la página 2 después del encabezado repetido de la tabla
- **ENTONCES** la vista previa tiene una sola fila con la glosa completa
- **Y** el encabezado repetido no aparece como fila

#### Scenario: Pie de página y totales descartados
- **CUANDO** cada página termina con "Página Actual: N" y "Total Páginas: 2" y la última con "TOTAL SALDO ACTUAL"
- **ENTONCES** esas líneas no aparecen como filas ni como inválidas

#### Scenario: Página faltante
- **CUANDO** el extracto declara "Total Páginas: 3" y el PDF tiene 2 páginas
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PDF_PAGE_COUNT_MISMATCH` y sin filas

#### Scenario: Página en blanco intencional
- **CUANDO** el extracto de "Banco Altiplano Demo" tiene una página con el texto "Esta página se dejó en blanco intencionalmente"
- **ENTONCES** la página se omite sin advertencias y el número de páginas leídas la incluye

### Requirement: Montos y fechas exactos del extracto PDF
El sistema DEBE (MUST) interpretar los montos con los separadores de miles y decimal que declara el diseño, convirtiendo el texto a decimal exacto sin pasar por un número de coma flotante y sin redondear: un monto con más decimales que la escala de la moneda o con separadores distintos de los declarados DEBE (MUST) marcar la fila inválida con `IMPORT_INVALID_AMOUNT` o `IMPORT_AMBIGUOUS_NUMBER`. El signo DEBE (MUST) salir de la columna con signo, de la diferencia entre crédito y débito o de la sección del movimiento según el diseño; una fila con débito y crédito distintos de cero DEBE (MUST) quedar inválida con `IMPORT_PDF_BOTH_DEBIT_AND_CREDIT`. Las fechas DEBEN (MUST) leerse con el formato del diseño y los meses en texto con una tabla de meses en español propia, sin depender del idioma ni de la zona del sistema; la hora sin zona DEBE (MUST) interpretarse en la zona del workspace.
Trace: FR-IMPORTS-006, FR-IMPORTS-016 · Priority: Must

#### Scenario: Miles con coma y decimal con punto
- **CUANDO** un movimiento de "Banco Pampa Demo" trae "0.00" en débito y "10,500.75" en crédito
- **ENTONCES** la fila es un ingreso de 10500.75 BOB

#### Scenario: Decimal con coma
- **CUANDO** un diseño declara la coma como separador decimal y el punto como separador de miles y un movimiento trae "1.250,75" en créditos
- **ENTONCES** la fila es un ingreso de 1250.75

#### Scenario: Más decimales que la escala
- **CUANDO** un movimiento en BOB trae el monto "-12.345"
- **ENTONCES** la fila es inválida con `IMPORT_INVALID_AMOUNT` y no se redondea

#### Scenario: Débito y crédito a la vez
- **CUANDO** un movimiento de "Banco Pampa Demo" trae "26.00" en débito y "5.00" en crédito
- **ENTONCES** la fila es inválida con `IMPORT_PDF_BOTH_DEBIT_AND_CREDIT`

#### Scenario: Fecha compacta y mes del periodo en texto
- **CUANDO** el extracto de "Banco Cumbre Demo" trae el periodo "Marzo 2026" y un movimiento con fecha "20260305" y hora "09:40:10", y el sistema corre con idioma en-US y zona UTC
- **ENTONCES** el periodo del extracto es del 2026-03-01 al 2026-03-31 y la fila tiene la fecha de negocio 2026-03-05 y la hora 09:40:10 en America/La_Paz

#### Scenario: Montos generados en ida y vuelta
- **CUANDO** se genera cualquier monto decimal de hasta 2 decimales, se escribe con los separadores de un diseño y se vuelve a leer
- **ENTONCES** el monto leído es igual al generado

### Requirement: Saldos del extracto PDF y coherencia interna
El sistema DEBE (MUST) tomar del extracto PDF el saldo inicial, el saldo final y el periodo que declara el diseño, que NO DEBEN (MUST NOT) aparecer como movimientos, y registrarlos como saldo del extracto para la reconciliación al terminar la importación. Antes de la vista previa DEBE (MUST) verificar que el saldo inicial más la suma de los movimientos leídos sea igual al saldo final y, cuando el extracto imprime totales por sección o por columna, que coincidan con la suma de sus filas; si no se cumple, la importación DEBE (MUST) quedar en "falló la lectura" con `IMPORT_PDF_TOTALS_MISMATCH` y la diferencia, sin filas, en lugar de mostrar una vista previa incompleta.
Trace: FR-IMPORTS-011, FR-IMPORTS-016 · Priority: Must

#### Scenario: Extracto coherente
- **CUANDO** el extracto de "Banco Cumbre Demo" declara saldo inicial 155.00 y saldo final 1019.32 y sus movimientos son 0.07, 1250.00, -85.50 y -300.25
- **ENTONCES** la importación registra el saldo del extracto de 155.00 a 1019.32 BOB del 2026-03-01 al 2026-03-31
- **Y** queda "en revisión" con 4 filas

#### Scenario: Movimiento no leído
- **CUANDO** el extracto de "Banco Cumbre Demo" declara saldo inicial 155.00 y final 1019.32 y solo se reconocen los movimientos 0.07, 1250.00 y -85.50
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PDF_TOTALS_MISMATCH` y una diferencia de 300.25 BOB, sin filas

#### Scenario: Total de una sección distinto de sus filas
- **CUANDO** la sección de retiros de "Banco Altiplano Demo" imprime "Total retiros 4,510.79" y sus filas suman 4501.79
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PDF_TOTALS_MISMATCH` y una diferencia de 9.00 BOB, sin filas

#### Scenario: Saldo anterior en la tabla y saldo final en el pie
- **CUANDO** el extracto de "Banco Pampa Demo" trae la fila "Saldo anterior" con saldo 2,640.00 y el pie "TOTAL SALDO ACTUAL: 12,050.66" con 11 movimientos que suman 9410.66
- **ENTONCES** la importación registra el saldo del extracto de 2640.00 a 12050.66 BOB y tiene 11 filas, sin la fila "Saldo anterior"

### Requirement: Saldo inicial del extracto PDF contra el saldo de la cuenta
Cuando el extracto PDF declara su saldo inicial y su periodo, la vista previa DEBERÍA (SHOULD) mostrar la diferencia entre ese saldo inicial y el saldo de la cuenta destino al cierre del día anterior al periodo, para advertir meses sin importar o movimientos registrados a mano que faltan; esa diferencia NO DEBE (MUST NOT) bloquear la aprobación ni crear ajustes.
Trace: FR-IMPORTS-011 · Priority: Should

#### Scenario: Mes anterior sin importar
- **CUANDO** "Banco BOB" tiene un saldo de 2000.00 BOB al 2026-02-28 y el extracto de marzo de "Banco Pampa Demo" declara un saldo inicial de 2640.00
- **ENTONCES** la vista previa muestra una diferencia de saldo inicial de 640.00 BOB
- **Y** la importación se puede aprobar

#### Scenario: Meses consecutivos
- **CUANDO** "Banco BOB" tiene un saldo de 2640.00 BOB al 2026-02-28 y el extracto de marzo declara un saldo inicial de 2640.00
- **ENTONCES** la vista previa muestra una diferencia de saldo inicial de 0.00 BOB

### Requirement: Cuenta y moneda del extracto PDF verificadas
El sistema DEBE (MUST) comparar los últimos 4 dígitos del número de cuenta del encabezado del extracto con los registrados en la cuenta destino y, si difieren, dejar la importación en "falló la lectura" con `IMPORT_PDF_ACCOUNT_MISMATCH`, sin filas; si la cuenta no tiene esos dígitos registrados, DEBE (MUST) procesarla con la advertencia `IMPORT_PDF_ACCOUNT_UNVERIFIED`. Si la moneda del extracto no es la de la cuenta, todas las filas DEBEN (MUST) quedar inválidas con `IMPORT_CURRENCY_MISMATCH`. Los demás datos del encabezado —titular, dirección, operador, sucursal— y el número de cuenta completo NO DEBEN (MUST NOT) guardarse en la importación, en sus filas, en la auditoría, en los eventos ni en los logs.
Trace: FR-IMPORTS-016, NFR-SEC-015 · Priority: Must

#### Scenario: Extracto de otra cuenta
- **CUANDO** "Banco BOB" tiene registrados los últimos dígitos "0001" y el extracto PDF declara la cuenta "0000000002"
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PDF_ACCOUNT_MISMATCH` y sin filas

#### Scenario: Cuenta sin dígitos registrados
- **CUANDO** "Banco BOB" no tiene registrados los últimos dígitos de su número y el extracto es coherente
- **ENTONCES** la importación queda "en revisión" con la advertencia `IMPORT_PDF_ACCOUNT_UNVERIFIED`

#### Scenario: Moneda del extracto distinta de la cuenta
- **CUANDO** el extracto declara "EXPRESADO EN BOLIVIANOS" y la cuenta destino "Caja USD" está en USD
- **ENTONCES** todas sus filas quedan inválidas con `IMPORT_CURRENCY_MISMATCH`

#### Scenario: Datos del titular descartados
- **CUANDO** el encabezado del extracto trae "CLIENTE: TITULAR FICTICIO UNO DEMO", "Procesado por 00000001" y la cuenta "0000000001"
- **ENTONCES** ni el nombre del titular, ni el operador, ni el número de cuenta completo aparecen en la importación, sus filas, la auditoría, los eventos ni los logs

### Requirement: Huella de las filas de un extracto PDF
Las filas de un extracto PDF DEBEN (MUST) identificarse con la huella de fila vigente, de modo que volver a descargar el mismo periodo, aunque el archivo tenga otros bytes por su fecha de consulta, clasifique como ya importadas las filas que ya tienen transacción; los fragmentos de glosa que el diseño declara como variables —anotaciones de estado que el banco recalcula al generar el PDF— NO DEBEN (MUST NOT) formar parte de la descripción usada en la huella, aunque la transacción conserve la glosa completa.
Trace: FR-IMPORTS-010, FR-IMPORTS-007, FR-IMPORTS-016 · Priority: Must

#### Scenario: Mismo mes descargado otra vez
- **CUANDO** el extracto de marzo de "Banco Pampa Demo" ya se importó con 11 transacciones y el usuario sube el mismo mes descargado otro día, con otra fecha de consulta
- **ENTONCES** la vista previa informa 11 filas ya importadas y 0 nuevas
- **Y** al aprobar se crean 0 transacciones

#### Scenario: Anotación variable en la glosa
- **CUANDO** una transferencia recibida se importó con la glosa "Transferencia de 0000000002. PERSONA FICTICIA BETA Aún falta 350" y la nueva descarga trae la misma transferencia con "Transferencia de 0000000002. PERSONA FICTICIA BETA Completado"
- **ENTONCES** la fila se clasifica como ya importada

### Requirement: Extractos PDF de prueba generados por código
Las pruebas del lector de PDF DEBEN (MUST) usar extractos generados por código a partir de datos sintéticos marcados como tales y NO DEBEN (MUST NOT) usar extractos reales; el repositorio NO DEBE (MUST NOT) contener archivos PDF, y la verificación de la entrega DEBE (MUST) fallar si se versiona uno. Para cada diseño soportado, el extracto generado desde sus movimientos sintéticos DEBE (MUST) leerse exactamente igual a esos movimientos.
Trace: FR-IMPORTS-016, NFR-SEC-015 · Priority: Must

#### Scenario: PDF versionado
- **CUANDO** un cambio agrega un archivo con extensión .pdf al repositorio
- **ENTONCES** la verificación de la entrega falla y nombra el archivo

#### Scenario: Lectura igual a los movimientos sintéticos
- **CUANDO** se generan los extractos PDF de "Banco Cumbre Demo", "Banco Pampa Demo" y "Banco Altiplano Demo" desde sus movimientos sintéticos
- **ENTONCES** la lectura de cada uno produce exactamente esos movimientos, con sus fechas, horas, descripciones, montos, saldos y el saldo del extracto

### Requirement: Rendimiento de la lectura de un extracto PDF
Una importación desde un extracto PDF de 100 páginas con 5 000 movimientos DEBERÍA (SHOULD) llegar a la vista previa en 30 segundos o menos en el entorno de referencia, incluida la extracción en el hilo aislado, y el benchmark de imports DEBE (MUST) medirlo y reportarlo.
Trace: NFR-PERF-007, FR-IMPORTS-016 · Priority: Should

#### Scenario: Extracto PDF de 5 000 movimientos
- **CUANDO** un EDITOR importa un extracto PDF sintético de 100 páginas con 5 000 movimientos nuevos
- **ENTONCES** la importación queda "en revisión" en 30 segundos o menos desde su creación

### Requirement: Diagnóstico local de un extracto PDF sin revelar datos
El repositorio PUEDE (MAY) ofrecer una herramienta local que lea un extracto PDF fuera del repositorio y muestre solo su estructura —diseño y versión detectados, páginas, filas reconocidas, resultado de la coherencia y números de línea no reconocidos—; esa salida NO DEBE (MUST NOT) incluir montos, saldos, descripciones, nombres ni números de cuenta.
Trace: FR-IMPORTS-016, NFR-SEC-015 · Priority: Could

#### Scenario: Diagnóstico de un extracto
- **CUANDO** el owner ejecuta el diagnóstico sobre el extracto PDF sintético de "Banco Pampa Demo"
- **ENTONCES** la salida informa el diseño `bo.ganadero.cuenta` versión 1, 2 páginas, 11 filas y la coherencia correcta
- **Y** no contiene ningún monto, descripción, nombre ni número de cuenta del extracto
