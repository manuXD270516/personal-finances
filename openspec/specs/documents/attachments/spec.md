# documents/attachments Specification

## Purpose
Permite guardar documentos del workspace (comprobantes, contratos, extractos) y vincularlos a transacciones y otras entidades: subida presignada a una cuarentena, verificación del tipo real por contenido, cifrado de sobre de la aplicación, descarga solo por la API, vínculos N:M con siete tipos de destino, cuotas por workspace, archivo, retención y purga de los documentos sin vínculo.

## Requirements

### Requirement: Solicitar la subida de un documento
Un OWNER o EDITOR DEBE (MUST) poder solicitar la subida de un archivo declarando su nombre, su tipo, su tamaño en bytes, su suma SHA-256 y su propósito (comprobante, factura, extracto, contrato, extracto para importar u otro). El sistema DEBE (MUST) registrar el documento como "pendiente de subida" y devolver una dirección de subida directa al almacenamiento de objetos válida por 5 minutos (configurable, nunca más de 10), atada al tamaño, al tipo y a la suma declarados; la API NO DEBE (MUST NOT) recibir el contenido del archivo. Un VIEWER DEBE (MUST) recibir `INSUFFICIENT_ROLE` y no se registra nada.
Trace: FR-DOCUMENTS-001, NFR-SEC-012 · Priority: Must

#### Scenario: Solicitud de subida de un comprobante
- **CUANDO** un EDITOR de "W1" solicita subir "factura-luz-octubre.pdf" de tipo `application/pdf`, 482133 bytes, con su suma SHA-256 y propósito comprobante
- **ENTONCES** se registra un documento "pendiente de subida" con esos datos
- **Y** la respuesta trae una dirección de subida que vence 5 minutos después y exige exactamente 482133 bytes, el tipo `application/pdf` y esa suma

#### Scenario: Un VIEWER no puede subir
- **CUANDO** un VIEWER de "W1" solicita subir "recibo.png"
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y no se registra ningún documento ni se entrega dirección de subida

### Requirement: Confirmar la subida y verificar el archivo
Tras subir el archivo, el usuario DEBE (MUST) confirmar la subida; el sistema DEBE (MUST) comprobar que el objeto existe con el tamaño y la suma declarados, aplicar la verificación de seguridad de archivos y dejar el documento "disponible" o "rechazado" con un motivo, en ambos casos sin conservar el archivo en la zona de cuarentena. Confirmar sin haber subido el archivo DEBE (MUST) rechazarse con `DOCUMENT_UPLOAD_MISSING` dejando el documento pendiente; repetir la confirmación de un documento ya verificado DEBE (MUST) devolver el mismo resultado sin verificar de nuevo.
Trace: FR-DOCUMENTS-001, FR-DOCUMENTS-002 · Priority: Must

#### Scenario: Confirmación de un PDF válido
- **CUANDO** el EDITOR sube los 482133 bytes de "factura-luz-octubre.pdf" a la dirección recibida y confirma la subida
- **ENTONCES** el documento queda "disponible" con tipo detectado `application/pdf`, 482133 bytes y la suma declarada
- **Y** la zona de cuarentena ya no contiene el archivo

#### Scenario: Confirmación sin haber subido
- **CUANDO** el EDITOR confirma la subida de un documento cuyo archivo nunca llegó al almacenamiento
- **ENTONCES** se rechaza con `DOCUMENT_UPLOAD_MISSING`
- **Y** el documento sigue "pendiente de subida"

#### Scenario: Confirmación repetida
- **CUANDO** el EDITOR vuelve a confirmar la subida de un documento que ya quedó "disponible"
- **ENTONCES** recibe el mismo documento "disponible" y no se registra una segunda verificación en la auditoría

### Requirement: Expiración de subidas no completadas
Un documento "pendiente de subida" cuya confirmación no llega dentro del plazo de la dirección más 1 hora de gracia DEBE (MUST) pasar a "rechazado" con el motivo subida no completada, eliminando cualquier objeto en cuarentena y liberando su reserva de cuota.
Trace: FR-DOCUMENTS-001, NFR-COMP-005 · Priority: Should

#### Scenario: Subida abandonada
- **CUANDO** un documento de 2000000 bytes quedó "pendiente de subida" a las 10:00 con una dirección que venció a las 10:05 y el mantenimiento corre a las 11:10
- **ENTONCES** el documento queda "rechazado" con el motivo subida no completada
- **Y** la cuota reservada del workspace baja en 2000000 bytes

### Requirement: Deduplicación por contenido dentro del workspace
Si el workspace ya tiene un documento "disponible" con la misma suma SHA-256, la solicitud de subida DEBE (MUST) devolver ese documento existente sin dirección de subida y sin consumir cuota. La deduplicación NO DEBE (MUST NOT) cruzar workspaces.
Trace: FR-DOCUMENTS-006 · Priority: Should

#### Scenario: Mismo archivo dos veces en el workspace
- **CUANDO** "W1" ya tiene disponible "extracto-oct.csv" y un EDITOR solicita subir "copia-extracto.csv" con la misma suma SHA-256
- **ENTONCES** la respuesta devuelve el documento existente marcado como deduplicado y sin dirección de subida
- **Y** la cuota usada de "W1" no cambia

#### Scenario: Mismo archivo en otro workspace
- **CUANDO** un miembro de "W2" solicita subir un archivo con la misma suma que un documento de "W1"
- **ENTONCES** se registra un documento nuevo de "W2" pendiente de subida y nada de "W1" se revela

### Requirement: Adjuntar documentos a elementos del workspace
Un OWNER o EDITOR DEBE (MUST) poder adjuntar un documento "disponible" a transacciones, conversiones, préstamos, suscripciones, cuentas, importaciones y cierres de mes del mismo workspace, en relación de muchos a muchos: un documento puede adjuntarse a varios elementos y un elemento puede tener varios documentos. Adjuntar dos veces el mismo documento al mismo elemento DEBE (MUST) devolver el vínculo existente sin duplicarlo.
Trace: FR-DOCUMENTS-003 · Priority: Must

#### Scenario: Un comprobante para dos gastos y dos documentos para un gasto
- **CUANDO** el EDITOR adjunta "ticket-supermercado.jpg" a los gastos de 150.00 BOB y 35.50 BOB, y además adjunta "garantia.pdf" al gasto de 150.00 BOB
- **ENTONCES** el gasto de 150.00 BOB tiene 2 documentos adjuntos y el de 35.50 BOB tiene 1
- **Y** "ticket-supermercado.jpg" figura adjunto a 2 elementos

#### Scenario: Adjuntar dos veces
- **CUANDO** el EDITOR adjunta de nuevo "garantia.pdf" al gasto de 150.00 BOB
- **ENTONCES** recibe el vínculo existente y el gasto sigue con 2 documentos adjuntos

### Requirement: Validación del documento y del destino del vínculo
Adjuntar DEBE (MUST) rechazarse con `REFERENCE_NOT_FOUND` si el elemento destino no existe en el workspace (incluido uno de otro workspace), con `VALIDATION_FAILED` si el tipo de destino no está soportado, con `DOCUMENT_NOT_AVAILABLE` si el documento aún no está disponible o su contenido está pendiente de restaurar, con `DOCUMENT_REJECTED` si fue rechazado y con `DOCUMENT_DELETED` si fue eliminado; en todos los casos sin crear el vínculo.
Trace: FR-DOCUMENTS-003, NFR-SEC-003 · Priority: Must

#### Scenario: Destino de otro workspace
- **CUANDO** un EDITOR de "W1" adjunta un documento de "W1" a una transacción de "W2"
- **ENTONCES** se rechaza con `REFERENCE_NOT_FOUND` y no se crea el vínculo

#### Scenario: Documento rechazado
- **CUANDO** un EDITOR adjunta a un gasto un documento que quedó "rechazado"
- **ENTONCES** se rechaza con `DOCUMENT_REJECTED` y no se crea el vínculo

### Requirement: Adjuntos en periodos cerrados
Adjuntar y desvincular documentos DEBE (MUST) permitirse sobre elementos cuya fecha cae en un periodo cerrado, sin modificar ningún asiento ni el estado del periodo.
Trace: FR-DOCUMENTS-003 · Priority: Must

#### Scenario: Comprobante tardío de un mes cerrado
- **CUANDO** "2026-09" está cerrado y el EDITOR adjunta "recibo-alquiler.pdf" a un gasto de 2800.00 BOB del 2026-09-05
- **ENTONCES** el vínculo se crea
- **Y** el periodo "2026-09" sigue cerrado y sus asientos no cambian

### Requirement: Límite de adjuntos por elemento
Un elemento NO DEBE (MUST NOT) superar el máximo configurado de documentos adjuntos (por defecto 20); el vínculo que lo excedería DEBE (MUST) rechazarse con `ATTACHMENT_LIMIT_EXCEEDED`.
Trace: FR-DOCUMENTS-003, NFR-SEC-011 · Priority: Should

#### Scenario: Vínculo número 21
- **CUANDO** un gasto ya tiene 20 documentos adjuntos y el EDITOR adjunta otro
- **ENTONCES** se rechaza con `ATTACHMENT_LIMIT_EXCEEDED` y el gasto sigue con 20

### Requirement: Desvincular un documento
Un OWNER o EDITOR DEBE (MUST) poder quitar el vínculo entre un documento y un elemento; el documento DEBE (MUST) conservarse con sus demás vínculos.
Trace: FR-DOCUMENTS-003 · Priority: Must

#### Scenario: Quitar un adjunto
- **CUANDO** el EDITOR quita "ticket-supermercado.jpg" del gasto de 35.50 BOB
- **ENTONCES** el gasto de 35.50 BOB queda sin adjuntos
- **Y** "ticket-supermercado.jpg" sigue disponible y adjunto al gasto de 150.00 BOB

### Requirement: Consulta de documentos y adjuntos
Todo miembro del workspace, VIEWER incluido, DEBE (MUST) poder listar los documentos del workspace filtrando por propósito, estado y elemento vinculado, y ver los adjuntos de un elemento con nombre original, tipo, tamaño, fecha de subida y estado; la consulta NO DEBE (MUST NOT) devolver nunca documentos de otro workspace.
Trace: FR-DOCUMENTS-003, FR-DOCUMENTS-004 · Priority: Must

#### Scenario: Adjuntos de un gasto vistos por un VIEWER
- **CUANDO** un VIEWER consulta los adjuntos del gasto de 150.00 BOB
- **ENTONCES** recibe "ticket-supermercado.jpg" y "garantia.pdf" con su tipo, tamaño, fecha de subida y estado

### Requirement: Descarga a través de la API
Todo miembro del workspace DEBE (MUST) poder descargar un documento "disponible" únicamente a través de la API, recibiendo el contenido original junto con su suma SHA-256; el almacenamiento de objetos NO DEBE (MUST NOT) ofrecer direcciones de descarga directa del contenido. Descargar un documento no disponible, rechazado o eliminado DEBE (MUST) rechazarse con `DOCUMENT_NOT_AVAILABLE`, `DOCUMENT_REJECTED` o `DOCUMENT_DELETED`.
Trace: FR-DOCUMENTS-004, NFR-SEC-012 · Priority: Must

#### Scenario: Descargar un comprobante
- **CUANDO** un VIEWER descarga "factura-luz-octubre.pdf"
- **ENTONCES** recibe los 482133 bytes originales con la suma SHA-256 informada al subirlo

#### Scenario: Descargar un documento eliminado
- **CUANDO** un miembro descarga un documento que el OWNER eliminó
- **ENTONCES** se rechaza con `DOCUMENT_DELETED` y no se entrega contenido

### Requirement: Archivar documentos
Un OWNER o EDITOR DEBE (MUST) poder archivar y desarchivar un documento; un documento archivado DEBE (MUST) excluirse del listado por defecto, conservar sus vínculos, seguir descargable y quedar exento de la purga de documentos sin vínculo.
Trace: FR-DOCUMENTS-007 · Priority: Should

#### Scenario: Archivar un contrato
- **CUANDO** el EDITOR archiva "contrato-alquiler-2025.pdf"
- **ENTONCES** el listado por defecto ya no lo muestra y el filtro de archivados sí
- **Y** sigue descargable

### Requirement: Eliminar un documento
Un OWNER o EDITOR DEBE (MUST) poder eliminar un documento; su contenido DEBE (MUST) volverse irrecuperable para la aplicación, sus vínculos DEBEN (MUST) quitarse y sus metadatos DEBEN (MUST) conservarse en estado "eliminado", liberando su tamaño de la cuota. Eliminar un documento NO DEBE (MUST NOT) modificar ninguna transacción ni asiento.
Trace: FR-DOCUMENTS-007, NFR-COMP-002 · Priority: Should

#### Scenario: Eliminar un comprobante adjunto
- **CUANDO** el OWNER elimina "ticket-supermercado.jpg" de 1250000 bytes, adjunto al gasto de 150.00 BOB
- **ENTONCES** el documento queda "eliminado", el gasto ya no lo lista como adjunto y la cuota usada baja en 1250000 bytes
- **Y** el gasto de 150.00 BOB y su asiento no cambian

### Requirement: Purga de documentos sin vínculo
El mantenimiento DEBE (MUST) eliminar, con el actor sistema, los documentos disponibles que no están archivados ni vinculados a ningún elemento desde hace más del plazo de retención configurado (por defecto 30 días); un documento vinculado o archivado NO DEBE (MUST NOT) purgarse.
Trace: FR-DOCUMENTS-007, NFR-COMP-005 · Priority: Should

#### Scenario: Documento huérfano de 31 días
- **CUANDO** "borrador.pdf" está disponible, sin vínculos ni archivado desde el 2026-09-28 y el mantenimiento corre el 2026-10-29
- **ENTONCES** "borrador.pdf" queda "eliminado" con actor sistema
- **Y** un documento archivado sin vínculos desde la misma fecha sigue disponible

### Requirement: Auditoría de documentos
La solicitud de subida, la aceptación o el rechazo, la vinculación, la desvinculación, el archivado, la eliminación, la purga y cada descarga de un documento DEBEN (MUST) registrarse en la auditoría en la misma unidad de trabajo que el cambio, con actor e instante; los registros NO DEBEN (MUST NOT) contener el nombre original ni el contenido del archivo.
Trace: FR-AUDIT-001, FR-AUDIT-005 · Priority: Must

#### Scenario: Descarga auditada
- **CUANDO** un VIEWER descarga "factura-luz-octubre.pdf"
- **ENTONCES** existe un registro de auditoría de la descarga con el VIEWER como actor y el identificador del documento
- **Y** el registro no contiene el texto "factura-luz-octubre"

### Requirement: Lectura de documentos para el pipeline de importación
Un documento disponible con propósito "extracto para importar" DEBE (MUST) poder leerse desde el procesamiento de importaciones del mismo workspace como un flujo del contenido original verificado, junto con su formato detectado, tamaño y suma, y DEBE (MUST) poder vincularse a una importación dentro de la misma unidad de trabajo que crea o actualiza esa importación. Un documento que no está disponible NO DEBE (MUST NOT) poder leerse, y una alteración del contenido almacenado DEBE (MUST) interrumpir la lectura con error sin entregar bytes no verificados.
Trace: FR-DOCUMENTS-003, FR-IMPORTS-002 · Priority: Must

#### Scenario: Lectura del extracto subido
- **CUANDO** el procesamiento de importaciones lee el documento disponible "extracto-oct.csv" de 18 MiB y propósito extracto para importar
- **ENTONCES** recibe formato CSV, 18874368 bytes y un flujo cuyo contenido coincide byte a byte con el subido y con su suma SHA-256

#### Scenario: Extracto aún pendiente
- **CUANDO** el procesamiento de importaciones intenta leer un documento "pendiente de subida"
- **ENTONCES** la lectura se rechaza con `DOCUMENT_NOT_AVAILABLE`

### Requirement: Eventos de disponibilidad de documentos
Cuando un documento queda disponible, el sistema DEBE (MUST) publicar un evento con su identificador, tipo detectado, tamaño, suma SHA-256 y propósito, y cuando queda rechazado, un evento con su identificador, propósito y motivo; ningún evento DEBE (MUST) contener el nombre original del archivo.
Trace: FR-DOCUMENTS-001, NFR-SEC-015 · Priority: Should

#### Scenario: Evento de documento disponible
- **CUANDO** "extracto-oct.csv" queda disponible
- **ENTONCES** se publica un único evento de documento disponible con su identificador, `text/csv`, 18874368 bytes, su suma y el propósito extracto para importar
- **Y** el evento no contiene el texto "extracto-oct"

### Requirement: Adjuntos en la interfaz
La interfaz DEBE (MUST) permitir, desde el detalle de una transacción, conversión, préstamo, suscripción, cuenta, importación y cierre de mes, subir un archivo con progreso visible y adjuntarlo, listar sus adjuntos, descargarlos y quitarlos, mostrando el motivo cuando un archivo es rechazado; y DEBE (MUST) ofrecer una página de documentos con filtros y el uso de la cuota del workspace, en español, inglés y portugués.
Trace: FR-DOCUMENTS-003, FR-DOCUMENTS-004 · Priority: Must

#### Scenario: Adjuntar un comprobante desde el detalle de un gasto
- **CUANDO** el EDITOR abre el gasto de 150.00 BOB, elige "ticket-supermercado.jpg" y la subida termina
- **ENTONCES** el detalle muestra el adjunto con su nombre y tamaño y un botón para descargarlo

#### Scenario: Archivo rechazado en la interfaz
- **CUANDO** el EDITOR elige "factura.pdf" que en realidad es una imagen PNG
- **ENTONCES** la interfaz muestra que el archivo fue rechazado porque su contenido no coincide con su tipo y no lo adjunta
