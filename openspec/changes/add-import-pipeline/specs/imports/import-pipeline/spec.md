## MODIFIED Requirements

### Requirement: Deduplicación básica con movimientos existentes
Cada fila nueva DEBE (MUST) compararse con los movimientos no anulados de la cuenta —gastos, ingresos y patas de transferencias y conversiones— del mismo monto y moneda, en la misma dirección y con fecha a ±3 días; si hay candidatos, la fila DEBE (MUST) clasificarse como posible duplicado mostrando los candidatos ordenados por su puntaje y exigir una decisión: crearla, omitirla vinculándola a un movimiento existente o excluirla. La vinculación que el sistema preselecciona para un candidato único de confianza alta DEBE (MUST) contar como decisión y el usuario PUEDE (MAY) cambiarla. Omitirla DEBE (MUST) vincularla al movimiento existente, de modo que una importación posterior la clasifique como ya importada. Cada movimiento existente DEBE (MUST) emparejarse con una sola fila.
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

#### Scenario: Vinculación preseleccionada cuenta como decisión
- **CUANDO** la única fila con candidato tiene un solo candidato de puntaje 0.9000 y el usuario aprueba sin tocarla
- **ENTONCES** la aprobación no se rechaza por decisiones pendientes
- **Y** la fila queda vinculada al movimiento existente sin crear una transacción

### Requirement: Aprobación y creación de las transacciones
La aprobación DEBE (MUST) exigir clave de idempotencia y la versión vigente de la importación, y DEBE (MUST) rechazarse con `IMPORT_REVIEW_INCOMPLETE` y el conteo de pendientes mientras haya posibles duplicados sin decisión. Aprobada, el sistema DEBE (MUST) crear, de forma asíncrona y por lotes, una transacción posteada por cada fila a crear con lo que mostró la vista previa: un gasto o un ingreso con la categoría, la contraparte, las etiquetas y la descripción de la fila —"Sin categoría" para una salida e "Ingreso sin categoría" para una entrada cuando la fila no tiene categoría—, o una transferencia o una conversión si la fila se marcó así; cada una con origen import, su asiento, su auditoría y su recorrido. Al terminar, DEBE (MUST) informar el avance y los conteos de filas totales, creadas, omitidas, ya importadas e inválidas. Las filas inválidas, excluidas, omitidas o ya importadas NO DEBEN (MUST NOT) crear transacciones.
Trace: FR-IMPORTS-003, FR-IMPORTS-001, FR-IMPORTS-009, NFR-DATA-016 · Priority: Must

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

#### Scenario: Clasificación tomada de la vista previa
- **CUANDO** la vista previa muestra la fila "TAXI AEROPUERTO" de 60.00 BOB de salida con la categoría "Transporte" que eligió el usuario y el usuario aprueba
- **ENTONCES** se crea un gasto posteado de 60.00 BOB con la categoría "Transporte" y origen import

## ADDED Requirements

### Requirement: Importación desde un documento subido
Un OWNER o EDITOR DEBE (MUST) poder iniciar la importación de un documento del workspace subido con el propósito "extracto para importar" indicando una única cuenta destino activa; el documento DEBE (MUST) estar disponible y la importación DEBE (MUST) quedar vinculada a él en la misma unidad de trabajo que la crea, sin leer todavía su contenido ni crear ninguna transacción. Un documento que no está disponible DEBE (MUST) rechazarse con `DOCUMENT_NOT_AVAILABLE`, uno con otro propósito con `VALIDATION_FAILED` y uno de otro workspace o inexistente con `REFERENCE_NOT_FOUND`, sin crear la importación.
Trace: FR-IMPORTS-001, FR-IMPORTS-002, FR-DOCUMENTS-003, NFR-SEC-012 · Priority: Must

#### Scenario: Extracto OFX subido como documento
- **CUANDO** un EDITOR crea una importación para "Banco BOB" con el documento disponible "extracto-marzo.ofx" de propósito extracto para importar
- **ENTONCES** la importación queda en estado "subida" con el documento vinculado y la suma SHA-256 del documento como suma del archivo
- **Y** no existe ninguna transacción importada

#### Scenario: Documento no disponible
- **CUANDO** un EDITOR crea una importación con un documento que sigue "pendiente de subida"
- **ENTONCES** se rechaza con `DOCUMENT_NOT_AVAILABLE` y no se crea ninguna importación

#### Scenario: Documento con otro propósito
- **CUANDO** un EDITOR crea una importación con el documento disponible "factura-luz-octubre.pdf" de propósito comprobante
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y no se crea ninguna importación

### Requirement: Etapas del import en el worker, reanudables
El procesamiento de una importación creada desde un documento DEBE (MUST) correr fuera de la petición, en etapas —lectura, normalización, validación, clasificación, duplicados y coincidencias con compromisos— y DEBE (MUST) informar el estado ("subida", "procesando" con la etapa y las filas procesadas, "esperando mapeo", "en revisión" o "falló la lectura"). Una interrupción del procesamiento DEBE (MUST) reanudarse desde la última etapa confirmada sin duplicar filas; un error estructural del archivo DEBE (MUST) dejar la importación en "falló la lectura" con `IMPORT_PARSE_FAILED`, la línea o la ubicación y la causa, sin filas. El usuario PUEDE (MAY) cancelar una importación en "subida" o "procesando", y el procesamiento DEBE (MUST) detenerse antes de la etapa siguiente.
Trace: FR-IMPORTS-001, FR-IMPORTS-002 · Priority: Must

#### Scenario: Progreso por etapa
- **CUANDO** se procesa una importación de 3000 filas y el usuario consulta su estado durante la normalización
- **ENTONCES** la importación informa "procesando", la etapa de normalización y la cantidad de filas procesadas
- **Y** al terminar queda "en revisión"

#### Scenario: Interrupción durante el procesamiento
- **CUANDO** el procesamiento se interrumpe después de leer 2000 de 3000 filas y se reanuda
- **ENTONCES** la importación llega a "en revisión" con exactamente 3000 filas, una por línea del archivo

#### Scenario: Archivo estructuralmente ilegible
- **CUANDO** el documento de una importación es un OFX cuyo bloque de movimientos no cierra
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PARSE_FAILED` y la ubicación del error
- **Y** no tiene filas

#### Scenario: Cancelar durante el procesamiento
- **CUANDO** el usuario cancela una importación "procesando"
- **ENTONCES** la importación queda cancelada, sin filas y sin transacciones

### Requirement: Formatos de archivo detectados por contenido
El sistema DEBE (MUST) importar archivos CSV, OFX (1.x y 2.x), QIF y JSON del esquema propio, eligiendo el lector por el formato detectado en el contenido del documento y no por su nombre; un documento de un formato no importable DEBE (MUST) rechazarse al crear la importación con `IMPORT_UNSUPPORTED_FORMAT`.
Trace: FR-IMPORTS-004 · Priority: Must

#### Scenario: Formato tomado del contenido
- **CUANDO** un EDITOR crea una importación con un documento disponible detectado como QIF sin indicar el formato
- **ENTONCES** la importación se procesa con el lector de QIF

#### Scenario: Documento PDF
- **CUANDO** un EDITOR crea una importación con un extracto PDF disponible
- **ENTONCES** se rechaza con `IMPORT_UNSUPPORTED_FORMAT` y no se crea ninguna importación

### Requirement: Lectura de extractos OFX
El lector de OFX DEBE (MUST) tomar de cada movimiento su identificador del banco como identificador externo, su monto con signo, su fecha convertida a fecha de negocio en la zona del workspace y su nombre y memo como descripción; DEBE (MUST) tomar el saldo contable final del extracto y su fecha como saldo del extracto; y si la moneda del extracto no es la de la cuenta destino, todas las filas DEBEN (MUST) quedar inválidas con `IMPORT_CURRENCY_MISMATCH`.
Trace: FR-IMPORTS-004, FR-IMPORTS-006, FR-IMPORTS-010, FR-IMPORTS-011 · Priority: Must

#### Scenario: Fecha con hora y desfase
- **CUANDO** un movimiento OFX trae la fecha 20260301020000[0:UTC] y el workspace usa America/La_Paz
- **ENTONCES** la fila tiene la fecha de negocio 2026-02-28

#### Scenario: Identificador del banco
- **CUANDO** un movimiento OFX trae el identificador "2026030100017", el monto -245.30 y el nombre "COMPRA SUPERMERCADO"
- **ENTONCES** la fila es una salida de 245.30 BOB con identificador externo "2026030100017" y descripción "COMPRA SUPERMERCADO"

#### Scenario: Saldo del extracto
- **CUANDO** el OFX trae como saldo contable 1019.32 al 2026-03-31
- **ENTONCES** la importación registra el saldo final del extracto 1019.32 BOB al 2026-03-31

#### Scenario: Moneda distinta de la cuenta
- **CUANDO** el OFX declara la moneda USD y la cuenta destino es "Banco BOB" en BOB
- **ENTONCES** todas sus filas quedan inválidas con `IMPORT_CURRENCY_MISMATCH`

### Requirement: Lectura de archivos QIF
El lector de QIF DEBE (MUST) admitir los tipos de cuenta bancaria y de tarjeta, leer fecha, monto, beneficiario y memo de cada movimiento y verificar que sus líneas de división sumen el monto del movimiento; como QIF no declara el orden de día y mes, una fecha ambigua NO DEBE (MUST NOT) interpretarse sin un formato de fecha elegido en el perfil o en el mapeo, y mientras falte la importación DEBE (MUST) quedar esperando mapeo con `IMPORT_AMBIGUOUS_DATE`.
Trace: FR-IMPORTS-004, FR-IMPORTS-006 · Priority: Must

#### Scenario: Fecha ambigua sin perfil
- **CUANDO** un QIF sin perfil trae la fecha "D03/04'26"
- **ENTONCES** la importación queda esperando mapeo con `IMPORT_AMBIGUOUS_DATE` y ninguna fila tiene fecha

#### Scenario: QIF de tarjeta con formato elegido
- **CUANDO** el usuario elige el formato día primero para un QIF de tarjeta con "D03/04'26" y "T-120.00"
- **ENTONCES** la fila es una salida de 120.00 BOB con fecha 2026-04-03

#### Scenario: Líneas de división que no suman
- **CUANDO** un movimiento QIF de -100.00 trae dos líneas de división de -60.00 y -30.00
- **ENTONCES** la fila queda inválida con `IMPORT_INVALID_AMOUNT`

### Requirement: Lectura del formato JSON propio versionado
El sistema DEBE (MUST) importar archivos JSON que declaren el esquema propio versionado de archivo de importación y validarlos contra ese esquema antes de normalizar; los montos DEBEN (MUST) venir como texto decimal, y un archivo que no cumple el esquema DEBE (MUST) dejar la importación en "falló la lectura" con `IMPORT_PARSE_FAILED` y la ubicación del primer error.
Trace: FR-IMPORTS-004, FR-IMPORTS-006 · Priority: Must

#### Scenario: Archivo JSON válido
- **CUANDO** un EDITOR importa un JSON del esquema propio versión 1 con 3 movimientos en BOB
- **ENTONCES** la importación llega a "en revisión" con 3 filas

#### Scenario: Monto escrito como número
- **CUANDO** el segundo movimiento de un JSON trae el monto 18.5 como número y no como texto
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_PARSE_FAILED` en la ubicación del monto del segundo movimiento

### Requirement: Lectura de hojas de cálculo XLSX
El sistema DEBERÍA (SHOULD) importar hojas de cálculo XLSX leyendo la hoja indicada en el perfil como una tabla delimitada, con el mismo mapeo que un CSV; una celda numérica DEBE (MUST) leerse como su representación decimal más corta y, si excede la escala de la moneda, la fila DEBE (MUST) quedar inválida con `IMPORT_INVALID_AMOUNT` sin redondear; las fórmulas NO DEBEN (MUST NOT) evaluarse: se usa el último valor guardado en la celda.
Trace: FR-IMPORTS-017, FR-IMPORTS-006 · Priority: Could

#### Scenario: Celda numérica
- **CUANDO** la hoja "Movimientos" de un XLSX para "Banco BOB" trae en la columna del monto la celda numérica 1234.5
- **ENTONCES** la fila tiene el monto 1234.50 BOB

#### Scenario: Celda con fórmula
- **CUANDO** una celda del monto contiene una fórmula con el valor guardado -60
- **ENTONCES** la fila es una salida de 60.00 BOB y la fórmula no se evalúa

#### Scenario: Valor numérico fuera de escala
- **CUANDO** una celda del monto guarda el valor numérico 0.30000000000000004
- **ENTONCES** la fila queda inválida con `IMPORT_INVALID_AMOUNT` y no se convierte en 0.30 BOB

### Requirement: Perfiles de mapeo por institución, versionados
Un OWNER o EDITOR DEBE (MUST) poder guardar un mapeo como perfil con nombre, formato, la institución del workspace a la que aplica y opcionalmente una cuenta, con sus opciones de lectura; editar un perfil DEBE (MUST) crear una versión nueva sin modificar las anteriores, y cada importación DEBE (MUST) conservar el perfil y la versión con que se procesó. Un perfil sin fecha, descripción o monto asignados, o con columnas inexistentes en su formato, DEBE (MUST) rechazarse con `IMPORT_MAPPING_INVALID`. Un perfil archivado NO DEBE (MUST NOT) sugerirse ni aplicarse a importaciones nuevas.
Trace: FR-IMPORTS-005 · Priority: Must

#### Scenario: Guardar el mapeo como perfil
- **CUANDO** tras mapear "extracto-octubre.csv" de "Banco BOB", cuya institución es "Banco Cumbre Demo", el EDITOR guarda el mapeo como el perfil "Cumbre caja de ahorro CSV"
- **ENTONCES** existe ese perfil en su versión 1 para "Banco Cumbre Demo" con formato CSV y las columnas, el formato de fecha y el separador decimal del mapeo

#### Scenario: Editar crea una versión
- **CUANDO** una importación completada usó la versión 1 del perfil y el EDITOR cambia el formato de fecha del perfil
- **ENTONCES** el perfil queda en su versión 2
- **Y** la importación completada sigue mostrando la versión 1 con su formato de fecha original

#### Scenario: Perfil sin monto
- **CUANDO** el EDITOR guarda un perfil sin columna de monto
- **ENTONCES** se rechaza con `IMPORT_MAPPING_INVALID`

#### Scenario: Perfil archivado
- **CUANDO** el EDITOR archiva el perfil "Cumbre caja de ahorro CSV" y luego importa un extracto de "Banco BOB"
- **ENTONCES** ese perfil no se sugiere ni se aplica

### Requirement: Aplicación automática del perfil de la institución
Al procesar una importación, el sistema DEBE (MUST) buscar el perfil vigente de la cuenta destino y, si no hay, los de su institución, del mismo formato, y aplicar automáticamente el primero cuyas columnas obligatorias existen en el encabezado del archivo (sin distinguir mayúsculas ni acentos), dejando la importación en revisión con el perfil y la versión aplicados; si ninguno coincide, la importación DEBE (MUST) quedar esperando mapeo con los perfiles candidatos y las columnas que faltan.
Trace: FR-IMPORTS-005 · Priority: Must

#### Scenario: Perfil de la institución aplicado
- **CUANDO** "Banco BOB" es de "Banco Cumbre Demo", el perfil "Cumbre caja de ahorro CSV" versión 2 espera "Fecha", "Descripción" y "Monto", y el extracto trae esas columnas
- **ENTONCES** la importación queda en revisión con ese perfil en su versión 2, sin pasar por el mapeo

#### Scenario: Perfil de la cuenta antes que el de la institución
- **CUANDO** "Banco BOB" tiene su propio perfil vigente y su institución tiene otro, y ambos coinciden con el encabezado
- **ENTONCES** se aplica el perfil de la cuenta

#### Scenario: Encabezado que cambió
- **CUANDO** el banco renombró la columna "Monto" a "Importe" y el único perfil de la institución espera "Monto"
- **ENTONCES** la importación queda esperando mapeo con ese perfil como candidato y la columna "Monto" como faltante

### Requirement: Opciones de lectura de extractos bancarios
El perfil o el mapeo DEBEN (MUST) poder declarar filas de encabezado y de pie que se omiten, la columna de un indicador de débito o crédito, una descripción formada por varias columnas, una columna de moneda con sus alias (como "Bs." para BOB) y una columna de referencia con la indicación de si es única; las filas omitidas NO DEBEN (MUST NOT) aparecer como filas ni como inválidas, y una fila cuya moneda no es la de la cuenta DEBE (MUST) quedar inválida con `IMPORT_CURRENCY_MISMATCH`.
Trace: FR-IMPORTS-005, FR-IMPORTS-006 · Priority: Must

#### Scenario: Pie del extracto omitido
- **CUANDO** el perfil omite 2 filas de pie y el extracto termina con "Total débitos" y "Saldo final"
- **ENTONCES** esas dos líneas no aparecen como filas ni como inválidas

#### Scenario: Indicador de débito o crédito
- **CUANDO** el perfil usa la columna "D/C" como indicador y una fila trae "245,30" con "D"
- **ENTONCES** la fila es una salida de 245.30 BOB

#### Scenario: Descripción en dos columnas
- **CUANDO** el perfil forma la descripción con "Descripción" y "Glosa" y una fila trae "PAGO QR" y "CAFÉ CENTRAL"
- **ENTONCES** la descripción de la fila es "PAGO QR CAFÉ CENTRAL"

#### Scenario: Alias de moneda
- **CUANDO** la columna de moneda de "Banco BOB" trae "Bs." en una fila y "$us" en otra
- **ENTONCES** la primera fila es válida en BOB y la segunda queda inválida con `IMPORT_CURRENCY_MISMATCH`

### Requirement: Saldo corrido y saldo del extracto
Si el archivo trae un saldo por fila, el sistema DEBERÍA (SHOULD) verificar en el orden del archivo que cada saldo sea el anterior más el monto de la fila y advertir con `IMPORT_RUNNING_BALANCE_GAP`, en la línea exacta y con la diferencia, cuando no lo es, sin bloquear la importación; si se conoce el saldo final del extracto, por el archivo o porque lo ingresa el usuario, la vista previa DEBE (MUST) mostrar su diferencia con el saldo resultante.
Trace: FR-IMPORTS-011, FR-IMPORTS-006 · Priority: Should

#### Scenario: Ruptura del saldo corrido
- **CUANDO** el extracto trae una fila de -245.30 con saldo 754.70 seguida de una de -18.00 con saldo 726.70
- **ENTONCES** la segunda fila lleva la advertencia `IMPORT_RUNNING_BALANCE_GAP` con una diferencia de 10.00 BOB
- **Y** la importación se puede aprobar

#### Scenario: Diferencia contra el saldo final en la vista previa
- **CUANDO** la vista previa de "extracto-octubre.csv" da un saldo resultante de 11718.70 BOB y el usuario ingresa como saldo final del extracto 11700.70 BOB
- **ENTONCES** la vista previa muestra una diferencia de 18.00 BOB

### Requirement: Orden de la clasificación y de los duplicados en la vista previa
El sistema DEBE (MUST) evaluar las reglas sobre cada fila normalizada y válida antes de calcular sus duplicados probables y sus coincidencias con compromisos, de modo que la contraparte y el tipo propuestos participen de esos cálculos; reevaluar las reglas desde la vista previa DEBE (MUST) conservar los campos que el usuario editó; y una falla de la evaluación de reglas DEBE (MUST) dejar las filas sin propuesta con la advertencia `IMPORT_RULES_UNAVAILABLE`, sin impedir la revisión ni la aprobación.
Trace: FR-IMPORTS-002, FR-IMPORTS-008, FR-RULES-009 · Priority: Must

#### Scenario: Contraparte propuesta en el puntaje
- **CUANDO** una regla propone la contraparte "Supermercado Demo" para la fila "COMPRA SUPERMERCADO" de 245.30 BOB y existe un gasto manual de 245.30 BOB con esa contraparte del día anterior
- **ENTONCES** el candidato de esa fila se puntúa con las contrapartes coincidentes

#### Scenario: Reevaluar reglas conserva lo editado
- **CUANDO** el usuario cambió la categoría de una fila a "Hogar", luego se edita una regla que también la clasificaría y el usuario pide reevaluar las reglas
- **ENTONCES** esa fila conserva "Hogar" con origen manual
- **Y** las filas que el usuario no editó muestran la propuesta de la regla editada

#### Scenario: Evaluación de reglas no disponible
- **CUANDO** la evaluación de reglas falla al procesar una importación
- **ENTONCES** las filas quedan sin propuesta de reglas con la advertencia `IMPORT_RULES_UNAVAILABLE`
- **Y** la importación llega a "en revisión" y se puede aprobar

### Requirement: Vista previa editable por fila y en lote
Antes de aprobar, el OWNER o EDITOR DEBE (MUST) poder cambiar en cada fila la categoría, la contraparte, las etiquetas, la descripción y la nota, y excluirla o volver a incluirla, y DEBE (MUST) poder aplicar el mismo cambio a todas las filas de un filtro de la vista previa; cada edición DEBE (MUST) exigir la versión vigente de la importación (`CONCURRENCY_CONFLICT` si cambió), dejar el campo con origen manual y NO DEBE (MUST NOT) crear ni modificar ninguna transacción.
Trace: FR-IMPORTS-009 · Priority: Must

#### Scenario: Edición de una fila
- **CUANDO** el EDITOR cambia la descripción de la fila "DEB AUT 0412" a "Seguro del auto" y su categoría a "Seguros"
- **ENTONCES** la vista previa muestra esa fila con la descripción y la categoría nuevas con origen manual
- **Y** no existe ninguna transacción importada

#### Scenario: Edición en lote de las filas filtradas
- **CUANDO** el EDITOR filtra las 40 filas sin categoría y les asigna "Transporte"
- **ENTONCES** las 40 filas muestran "Transporte" con origen manual y las demás filas no cambian

#### Scenario: Edición con una versión vencida
- **CUANDO** el EDITOR edita una fila con una versión de la importación que otra edición ya cambió
- **ENTONCES** se rechaza con `CONCURRENCY_CONFLICT` y la fila no cambia

### Requirement: Filas como transferencia o conversión entre cuentas propias
El OWNER o EDITOR DEBERÍA (SHOULD) poder marcar en la vista previa una fila como transferencia hacia o desde otra cuenta propia de la misma moneda, o como conversión con otra cuenta propia de otra moneda indicando el monto recibido o entregado en ella; al aprobar, la fila DEBE (MUST) crear esa transferencia o conversión en lugar de un gasto o ingreso, la conversión DEBE (MUST) quedar vinculada a la tasa de referencia vigente al instante del movimiento y la pata creada en la otra cuenta DEBE (MUST) ser candidata de duplicado cuando se importe el extracto de esa cuenta. Una transferencia entre monedas distintas DEBE (MUST) rechazarse con `TRANSFER_CURRENCY_MISMATCH`.
Trace: FR-IMPORTS-009, FR-TRANSACTIONS-021, FR-FX-008 · Priority: Should

#### Scenario: Pago de tarjeta como transferencia
- **CUANDO** el EDITOR marca la fila "PAGO TARJETA" de 400.00 BOB de salida de "Banco BOB" del 2026-10-10 como transferencia a "Visa" en BOB y aprueba
- **ENTONCES** se crea una transferencia de 400.00 BOB de "Banco BOB" a "Visa" y ningún gasto
- **Y** la deuda de "Visa" baja 400.00 BOB

#### Scenario: Transferencia a una cuenta de otra moneda
- **CUANDO** el EDITOR marca una fila de "Banco BOB" como transferencia a "Caja USD"
- **ENTONCES** se rechaza con `TRANSFER_CURRENCY_MISMATCH` y la fila no cambia

#### Scenario: Compra de dólares como conversión
- **CUANDO** el EDITOR marca la fila "COMPRA DIVISAS" de 696.00 BOB de salida de "Banco BOB" del 2026-03-10 a las 14:05 como conversión con "Caja USD" que recibe 100.00 USD y aprueba
- **ENTONCES** se crea una conversión con "Banco BOB" −696.00 BOB y "Caja USD" +100.00 USD y tasa efectiva USD/BOB 6.96
- **Y** la conversión queda vinculada a la tasa de referencia vigente el 2026-03-10 a las 14:05 en America/La_Paz

#### Scenario: Pata de la conversión en un import posterior
- **CUANDO** después se importa el extracto de "Caja USD" con un ingreso de 100.00 USD del 2026-03-10
- **ENTONCES** esa fila es un posible duplicado con la conversión como candidato

### Requirement: Coincidencias con compromisos confirmadas en la vista previa
La vista previa DEBERÍA (SHOULD) mostrar para cada fila las ocurrencias de compromisos candidatas con su puntaje y confianza, y permitir que el OWNER o EDITOR confirme el vínculo de una fila o, con una acción explícita, el de todas las filas con un único candidato de confianza alta; al persistir, cada fila confirmada DEBE (MUST) vincular su transacción a la ocurrencia con quien aprobó como actor. Ninguna ocurrencia DEBE (MUST) vincularse sin esa confirmación, y si la ocurrencia ya se resolvió por otra vía la transacción DEBE (MUST) crearse igual, sin vínculo y con la advertencia `IMPORT_OCCURRENCE_LINK_SKIPPED`.
Trace: FR-COMMITMENTS-010, FR-IMPORTS-009 · Priority: Should

#### Scenario: Internet confirmado en la vista previa
- **CUANDO** la fila "TIGO INTERNET" de 199.00 BOB de salida de "Banco BOB" del 2026-10-20 tiene como candidata la ocurrencia del "Internet" de ese día con confianza alta, el EDITOR confirma el vínculo y aprueba
- **ENTONCES** se crea el gasto de 199.00 BOB y la ocurrencia queda vinculada a él por el EDITOR
- **Y** la ocurrencia sale del total comprometido de octubre

#### Scenario: Sin confirmación no se vincula
- **CUANDO** el EDITOR aprueba sin confirmar la candidata de la fila "TIGO INTERNET"
- **ENTONCES** se crea el gasto de 199.00 BOB y la ocurrencia del "Internet" sigue sin resolver

#### Scenario: Confirmar todas las de confianza alta
- **CUANDO** la vista previa tiene 5 filas con un único candidato de confianza alta y 2 filas con candidatas ambiguas, y el EDITOR confirma todas las de confianza alta
- **ENTONCES** las 5 filas quedan con su vínculo confirmado y las 2 ambiguas sin confirmar

#### Scenario: Ocurrencia resuelta antes de persistir
- **CUANDO** el EDITOR confirmó el vínculo de "TIGO INTERNET" y, antes de persistir, la ocurrencia del "Internet" se aprobó creando otro gasto
- **ENTONCES** el gasto importado de 199.00 BOB se crea sin vínculo con la advertencia `IMPORT_OCCURRENCE_LINK_SKIPPED`

### Requirement: Idempotencia por identificador externo
Cuando la fila trae un identificador externo estable —el del movimiento OFX o el de una columna de referencia declarada única en el perfil—, el sistema DEBE (MUST) usarlo, junto con la institución y el formato, como referencia de la transacción en la cuenta: una fila cuyo identificador ya tiene una transacción no anulada en la cuenta DEBE (MUST) clasificarse como ya importada aunque cambien su descripción o su fecha. Una columna de referencia no declarada única NO DEBE (MUST NOT) usarse como identificador.
Trace: FR-IMPORTS-010, FR-TRANSACTIONS-032 · Priority: Must

#### Scenario: Mismo identificador con descripción cambiada
- **CUANDO** el movimiento con identificador "2026030100017" de "Banco BOB" ya se importó y un OFX posterior lo trae con la descripción "COMPRA SUPERMERCADO SUC 12"
- **ENTONCES** la fila se clasifica como ya importada y no se crea otra transacción

#### Scenario: Referencia que el banco repite
- **CUANDO** el perfil declara la columna "Nro. Doc." como no única y el extracto trae el interés de 12.40 BOB y su retención de 1.60 BOB con la misma referencia "88231"
- **ENTONCES** las dos filas son nuevas y al aprobar se crean dos transacciones

#### Scenario: Mismo identificador en otra cuenta
- **CUANDO** el identificador "2026030100017" ya se importó en "Banco BOB" y aparece en un extracto de "Banco USD"
- **ENTONCES** la fila de "Banco USD" no se clasifica como ya importada por ese identificador

### Requirement: Extractos solapados de varios formatos sin duplicados
Importar extractos de una misma cuenta en formatos distintos y con periodos que se solapan DEBE (MUST) dejar exactamente una transacción por movimiento real cuando el usuario resuelve los posibles duplicados que el sistema le muestra, y volver a importar cualquiera de esos archivos DEBE (MUST) crear 0 transacciones.
Trace: FR-IMPORTS-007, FR-IMPORTS-010, FR-TRANSACTIONS-032 · Priority: Must

#### Scenario: Tres meses con solapamiento entre CSV y OFX
- **CUANDO** se importó "enero-15feb.csv" con 52 movimientos del 2026-01-01 al 2026-02-15 y luego se importa "feb-mar.ofx" con 75 movimientos del 2026-02-01 al 2026-03-31, 12 de ellos los mismos del 1 al 15 de febrero con otra descripción
- **ENTONCES** esas 12 filas son posibles duplicados con su transacción del CSV como candidato
- **Y** al omitirlas vinculándolas y aprobar se crean 63 transacciones y la cuenta tiene 115 transacciones importadas, ninguna duplicada

#### Scenario: Reimportar los tres meses
- **CUANDO** el usuario vuelve a importar "enero-15feb.csv" y "feb-mar.ofx" y aprueba ambas importaciones
- **ENTONCES** todas las filas se clasifican como ya importadas y se crean 0 transacciones

### Requirement: Reconciliación contra el saldo final del extracto
Al terminar de persistir una importación con saldo final del extracto conocido, el sistema DEBERÍA (SHOULD) comparar el saldo contable de la cuenta a la fecha de ese saldo con el saldo del extracto: si coinciden, la importación DEBE (MUST) terminar completada y ofrecer iniciar una sesión de reconciliación con esa fecha y ese saldo; si difieren, DEBE (MUST) terminar "completada con diferencia" mostrando la diferencia. El sistema NO DEBE (MUST NOT) crear ningún ajuste automático.
Trace: FR-IMPORTS-011, FR-TRANSACTIONS-030 · Priority: Should

#### Scenario: Extracto que cuadra
- **CUANDO** el OFX de "Banco BOB" declara un saldo final de 1019.32 BOB al 2026-03-31 y tras persistir el saldo contable de la cuenta a esa fecha es 1019.32 BOB
- **ENTONCES** la importación termina completada y ofrece iniciar la reconciliación de "Banco BOB" al 2026-03-31 por 1019.32 BOB

#### Scenario: Diferencia contra el extracto
- **CUANDO** el saldo contable de "Banco BOB" al 2026-03-31 queda en 1001.32 BOB frente a 1019.32 BOB del extracto
- **ENTONCES** la importación termina "completada con diferencia" con una diferencia de 18.00 BOB
- **Y** no se crea ningún ajuste

### Requirement: Deshacer un import
El OWNER o EDITOR DEBERÍA (SHOULD) poder deshacer una importación terminada: el sistema DEBE (MUST) mostrar antes cuántas transacciones se anularán y cuáles están bloqueadas, y al confirmar DEBE (MUST) anular con su reversa cada transacción no anulada que la importación creó, sin borrar nada, con auditoría y de forma idempotente. Si alguna está reconciliada o en un periodo cerrado, el deshacer DEBE (MUST) rechazarse con `IMPORT_REVERT_BLOCKED` y la lista de filas bloqueadas sin anular ninguna, salvo que el usuario pida expresamente el deshacer parcial, que anula las demás y deja la importación "deshecha parcialmente". Tras deshacer, volver a importar el archivo DEBE (MUST) crear de nuevo esas transacciones.
Trace: FR-IMPORTS-012, FR-TRANSACTIONS-009 · Priority: Should

#### Scenario: Deshacer un import de 3 transacciones
- **CUANDO** "Banco BOB" tenía 4000.00 BOB, una importación creó 2 gastos de 18.00 BOB y un ingreso de 8000.00 BOB (saldo 11964.00 BOB) y la EDITOR "Ana" la deshace
- **ENTONCES** las 3 transacciones quedan anuladas con su reversa y el saldo de "Banco BOB" vuelve a 4000.00 BOB
- **Y** la importación queda "deshecha" con un registro de auditoría con "Ana" como actor

#### Scenario: Transacción reconciliada bloquea el deshacer
- **CUANDO** el ingreso de 8000.00 BOB de esa importación está reconciliado y la EDITOR pide deshacerla
- **ENTONCES** se rechaza con `IMPORT_REVERT_BLOCKED` indicando 1 fila bloqueada
- **Y** ninguna de las 3 transacciones se anula

#### Scenario: Deshacer parcial explícito
- **CUANDO** con el ingreso de 8000.00 BOB reconciliado la EDITOR pide el deshacer parcial
- **ENTONCES** los 2 gastos de 18.00 BOB quedan anulados y el saldo de "Banco BOB" es 12000.00 BOB
- **Y** la importación queda "deshecha parcialmente" con 1 fila bloqueada

#### Scenario: Reimportar después de deshacer
- **CUANDO** la importación se deshizo por completo y el usuario vuelve a importar el mismo archivo
- **ENTONCES** las 3 filas son nuevas y al aprobar se crean 3 transacciones

### Requirement: Permisos y auditoría de perfiles, vínculos y deshacer
Solo OWNER y EDITOR DEBEN (MUST) poder crear, versionar y archivar perfiles, editar filas, confirmar vínculos con compromisos y deshacer importaciones; un VIEWER DEBE (MUST) poder consultarlos y recibir `INSUFFICIENT_ROLE` al modificarlos. La creación, cada versión y el archivo de un perfil, el deshacer de una importación y cada vínculo de una fila con un movimiento existente o con una ocurrencia DEBEN (MUST) auditarse con el actor en la misma unidad de trabajo.
Trace: FR-IDENTITY-006, FR-AUDIT-002, FR-IMPORTS-005, FR-IMPORTS-012 · Priority: Must

#### Scenario: VIEWER intenta deshacer
- **CUANDO** un VIEWER pide deshacer una importación completada
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y ninguna transacción cambia

#### Scenario: Auditoría de una vinculación con un movimiento existente
- **CUANDO** la EDITOR "Ana" aprueba una importación en la que una fila quedó vinculada al gasto manual de 245.30 BOB con puntaje 0.9000
- **ENTONCES** existe un registro de auditoría de ese vínculo con la línea de la fila, el gasto, el puntaje y "Ana" como actor

#### Scenario: Auditoría de las versiones de un perfil
- **CUANDO** el EDITOR crea un perfil y luego lo edita
- **ENTONCES** existen dos registros de auditoría, de la versión 1 y de la versión 2, con el EDITOR como actor

### Requirement: Rendimiento hasta la vista previa con el pipeline completo
Una importación de 5 000 filas creada desde un documento DEBE (MUST) llegar a la vista previa en 30 segundos o menos en el entorno de referencia, incluyendo la lectura, la normalización, la validación, la evaluación de 200 reglas activas, los duplicados y las coincidencias con compromisos.
Trace: NFR-PERF-007 · Priority: Must

#### Scenario: Extracto OFX de 5 000 movimientos
- **CUANDO** un EDITOR crea una importación desde un OFX de 5 000 movimientos nuevos en un workspace con 200 reglas activas
- **ENTONCES** la importación queda "en revisión" en 30 segundos o menos desde su creación

### Requirement: Límites del archivo importado desde un documento
El procesamiento de un documento NO DEBE (MUST NOT) admitir más filas de datos que el máximo configurado (por defecto 5 000) ni más de 50 columnas: al excederlos, la importación DEBE (MUST) quedar en "falló la lectura" con `IMPORT_TOO_MANY_ROWS` o `IMPORT_UNSUPPORTED_FORMAT`, sin filas, y DEBE (MUST) detener la lectura al alcanzar el límite sin cargar el resto del archivo.
Trace: FR-IMPORTS-002, NFR-SEC-012 · Priority: Must

#### Scenario: Extracto de más de 5 000 movimientos
- **CUANDO** un EDITOR importa un OFX de 5 001 movimientos
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_TOO_MANY_ROWS` y sin filas

#### Scenario: Demasiadas columnas
- **CUANDO** un EDITOR importa un CSV de 51 columnas
- **ENTONCES** la importación queda en "falló la lectura" con `IMPORT_UNSUPPORTED_FORMAT` y sin filas

### Requirement: Resumen final con la cobertura de reglas
Al terminar una importación, su resumen DEBE (MUST) mostrar, además de los conteos, la cobertura de clasificación por reglas de las transacciones que creó, calculada como la define la capability de reglas.
Trace: FR-IMPORTS-008, FR-RULES-010 · Priority: Should

#### Scenario: Resumen de un import clasificado
- **CUANDO** una importación creó 57 transacciones de ingreso y gasto, 41 con la categoría fijada por una regla
- **ENTONCES** su resumen muestra 57 creadas y una cobertura por reglas de 0.7193
