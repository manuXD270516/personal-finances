# security/file-upload-security Specification

## Purpose
Define los controles obligatorios sobre todo archivo que suba un usuario: URL firmada con tamaño, tipo y suma exactos, cuarentena, determinación del tipo real por su contenido, rechazo de contenido activo o malformado en PDF, texto y XLSX, límites de descompresión, ejecución del análisis aislada, antimalware opcional por puerto y una suite de uploads maliciosos generada por código.

## Requirements

### Requirement: Lista permitida de tipos de archivo
La solicitud de subida DEBE (MUST) aceptar solo las extensiones `pdf`, `png`, `jpg`, `jpeg`, `webp`, `heic`, `csv`, `ofx`, `qfx`, `qif`, `json` y `xlsx`, cada una con su tipo declarado correspondiente; cualquier otra extensión o tipo (entre ellos SVG, HTML, ejecutables, archivos comprimidos, XLSM y XLS) o una extensión cuyo tipo declarado no le corresponde DEBE (MUST) rechazarse con `UPLOAD_TYPE_NOT_ALLOWED` sin registrar el documento ni entregar dirección de subida.
Trace: FR-DOCUMENTS-002, NFR-SEC-012 · Priority: Must

#### Scenario: Imagen SVG
- **CUANDO** un EDITOR solicita subir "logo.svg" de tipo `image/svg+xml`
- **ENTONCES** se rechaza con `UPLOAD_TYPE_NOT_ALLOWED` y no se registra ningún documento

#### Scenario: Extensión y tipo declarado que no corresponden
- **CUANDO** un EDITOR solicita subir "extracto.pdf" declarando el tipo `text/html`
- **ENTONCES** se rechaza con `UPLOAD_TYPE_NOT_ALLOWED` y no se entrega dirección de subida

### Requirement: Tamaño máximo por propósito
La solicitud de subida DEBE (MUST) rechazar con `UPLOAD_TOO_LARGE` un archivo declarado mayor que el máximo de su propósito: por defecto 15 MiB (15728640 bytes) para documentos y 20 MiB (20971520 bytes) para extractos a importar; la configuración NO DEBE (MUST NOT) admitir un máximo superior a 25 MiB (26214400 bytes). Un archivo vacío DEBE (MUST) rechazarse con `VALIDATION_FAILED`.
Trace: FR-DOCUMENTS-002, NFR-SEC-012 · Priority: Must

#### Scenario: Comprobante demasiado grande
- **CUANDO** un EDITOR solicita subir un comprobante de 15728641 bytes
- **ENTONCES** se rechaza con `UPLOAD_TOO_LARGE` y no se registra ningún documento

#### Scenario: Extracto de 19 MiB
- **CUANDO** un EDITOR solicita subir un extracto para importar de 19922944 bytes
- **ENTONCES** se registra el documento pendiente de subida

### Requirement: Integridad de la subida
La dirección de subida DEBE (MUST) obligar al almacenamiento a rechazar un contenido de tamaño, tipo o suma SHA-256 distintos de los declarados y a rechazar su uso después de vencida. Si al confirmar el tamaño o la suma del objeto difieren de los declarados, el documento DEBE (MUST) quedar "rechazado" con el motivo tamaño distinto o suma distinta, sin quedar disponible.
Trace: FR-DOCUMENTS-002, NFR-SEC-012 · Priority: Must

#### Scenario: Contenido sustituido
- **CUANDO** se usa la dirección de subida de "factura.pdf" (482133 bytes y suma declarada) para enviar otros 482133 bytes
- **ENTONCES** el almacenamiento rechaza la subida
- **Y** al confirmar, la respuesta es `DOCUMENT_UPLOAD_MISSING` y el documento no queda disponible

#### Scenario: Dirección vencida
- **CUANDO** se usa la dirección de subida 6 minutos después de emitida con un vencimiento de 5 minutos
- **ENTONCES** el almacenamiento rechaza la subida y el documento sigue pendiente

### Requirement: Tipo real por contenido
Antes de quedar disponible, el tipo real del archivo DEBE (MUST) determinarse por su contenido (firma inicial y estructura), no por su nombre ni por el tipo declarado, y DEBE (MUST) pertenecer a la lista permitida y coincidir con la familia declarada; si no, el documento DEBE (MUST) quedar "rechazado" con el motivo tipo no permitido o tipo distinto. Un PDF DEBE (MUST) empezar con su firma en el primer byte.
Trace: FR-DOCUMENTS-002, NFR-SEC-012 · Priority: Must

#### Scenario: Imagen renombrada como PDF
- **CUANDO** se sube y confirma "factura.pdf" declarado `application/pdf` cuyo contenido es una imagen PNG
- **ENTONCES** el documento queda "rechazado" con el motivo tipo distinto

#### Scenario: Ejecutable con extensión de extracto
- **CUANDO** se sube y confirma "extracto.csv" declarado `text/csv` cuyo contenido es un ejecutable de Windows
- **ENTONCES** el documento queda "rechazado" y nunca está disponible

#### Scenario: Políglota HTML y PDF
- **CUANDO** se sube y confirma "estado.pdf" cuyo contenido empieza con una página HTML con un script y contiene una cabecera PDF más adelante
- **ENTONCES** el documento queda "rechazado" con el motivo tipo distinto

### Requirement: PDF sin contenido activo
Un PDF DEBE (MUST) quedar "rechazado" con el motivo contenido activo si contiene JavaScript, acciones de apertura que ejecutan código, acciones de lanzamiento, archivos incrustados, formularios XFA o contenido multimedia enriquecido, también cuando esos nombres están ofuscados con escapes o dentro de flujos de objetos comprimidos; un PDF que exige contraseña para abrirse DEBE (MUST) quedar "rechazado" con el motivo contenido cifrado.
Trace: FR-DOCUMENTS-002, NFR-SEC-012 · Priority: Must

#### Scenario: PDF con JavaScript al abrir
- **CUANDO** se sube y confirma un PDF cuya acción de apertura ejecuta JavaScript
- **ENTONCES** el documento queda "rechazado" con el motivo contenido activo

#### Scenario: Nombre ofuscado dentro de un flujo comprimido
- **CUANDO** se sube y confirma un PDF cuyo diccionario `/J#61vaScript` está dentro de un flujo de objetos comprimido
- **ENTONCES** el documento queda "rechazado" con el motivo contenido activo

#### Scenario: PDF con contraseña de apertura
- **CUANDO** se sube y confirma un extracto PDF que exige contraseña para abrirse
- **ENTONCES** el documento queda "rechazado" con el motivo contenido cifrado

### Requirement: Formatos de texto sin marcado activo
Un archivo declarado CSV, OFX, QFX, QIF o JSON DEBE (MUST) decodificarse como texto (UTF-8 con o sin BOM, UTF-16 con BOM o windows-1252) sin bytes nulos ni caracteres de control distintos de tabulación, retorno de carro y salto de línea, y NO DEBE (MUST NOT) empezar con marcado HTML, SVG o script; si no cumple, DEBE (MUST) quedar "rechazado" con el motivo contenido mal formado o contenido activo. Un JSON con más de 64 niveles de anidamiento DEBE (MUST) quedar "rechazado" con el motivo contenido mal formado.
Trace: FR-DOCUMENTS-002, NFR-SEC-012 · Priority: Must

#### Scenario: CSV que es una página HTML
- **CUANDO** se sube y confirma "movimientos.csv" cuyo contenido empieza con `<html><script>`
- **ENTONCES** el documento queda "rechazado" con el motivo contenido activo

#### Scenario: CSV con bytes nulos
- **CUANDO** se sube y confirma "movimientos.csv" que contiene bytes nulos
- **ENTONCES** el documento queda "rechazado" con el motivo contenido mal formado

#### Scenario: JSON demasiado anidado
- **CUANDO** se sube y confirma un JSON con 65 niveles de anidamiento
- **ENTONCES** el documento queda "rechazado" con el motivo contenido mal formado

### Requirement: Hojas de cálculo sin macros ni bombas de compresión
Un XLSX DEBE (MUST) ser un libro de Office Open XML válido; si contiene macros DEBE (MUST) quedar "rechazado" con el motivo macros presentes, y si tiene más de 1000 entradas, más de 100 MiB (104857600 bytes) descomprimidos o una entrada con una razón de compresión mayor que 100 a 1 DEBE (MUST) quedar "rechazado" con el motivo límites de archivo comprimido excedidos, sin descomprimirlo por completo.
Trace: FR-DOCUMENTS-002, FR-IMPORTS-017 · Priority: Must

#### Scenario: Libro con macros renombrado
- **CUANDO** se sube y confirma "movimientos.xlsx" que contiene un proyecto de macros
- **ENTONCES** el documento queda "rechazado" con el motivo macros presentes

#### Scenario: Bomba de compresión
- **CUANDO** se sube y confirma un XLSX de 40 KiB cuya hoja se descomprime a 2 GiB
- **ENTONCES** el documento queda "rechazado" con el motivo límites de archivo comprimido excedidos

### Requirement: Cuarentena hasta la verificación
Un archivo subido DEBE (MUST) permanecer en una zona de cuarentena separada, inaccesible para la descarga y la lectura de otros contextos, hasta terminar su verificación; tras la verificación, aceptado o rechazado, DEBE (MUST) eliminarse de la cuarentena, y ningún objeto DEBE (MUST) permanecer en cuarentena más de 24 horas.
Trace: FR-DOCUMENTS-002, NFR-SEC-012 · Priority: Must

#### Scenario: Objeto rechazado eliminado de la cuarentena
- **CUANDO** un documento queda "rechazado" por tipo distinto
- **ENTONCES** la cuarentena ya no contiene su objeto y la zona de documentos tampoco

#### Scenario: Objeto olvidado en cuarentena
- **CUANDO** la cuarentena contiene un objeto subido hace 25 horas sin confirmación
- **ENTONCES** el mantenimiento lo elimina

### Requirement: Claves de objeto y registros sin datos personales
Las claves de objeto del almacenamiento DEBEN (MUST) componerse solo de identificadores opacos (workspace y documento) y NO DEBEN (MUST NOT) contener el nombre original ni ningún dato del usuario; el nombre original DEBE (MUST) guardarse solo como metadato, normalizado, sin rutas ni caracteres de control y con 255 caracteres como máximo, y NO DEBE (MUST NOT) aparecer en los registros técnicos (logs), las métricas ni las trazas.
Trace: FR-DOCUMENTS-005, NFR-SEC-015 · Priority: Must

#### Scenario: Nombre con datos personales
- **CUANDO** se sube "Extracto Juan Perez CI 1234567.pdf"
- **ENTONCES** la clave del objeto contiene solo identificadores opacos
- **Y** ningún registro técnico de la subida contiene "Juan" ni "1234567"

#### Scenario: Nombre con ruta y caracteres de control
- **CUANDO** se sube un archivo llamado `..\..\windows\factura` seguido de un salto de línea y `.pdf`
- **ENTONCES** el nombre original guardado es "factura.pdf"

### Requirement: Entrega segura de la descarga
La descarga DEBE (MUST) entregarse siempre como archivo adjunto (nunca para mostrarse en línea), con el tipo de contenido canónico del tipo detectado, la indicación de no adivinar el tipo, una política de contenido en modo aislado, sin almacenarse en cachés compartidas y con el nombre original codificado de forma segura; los caracteres que permiten inyectar cabeceras NO DEBEN (MUST NOT) llegar a la respuesta.
Trace: FR-DOCUMENTS-004, NFR-SEC-008, NFR-SEC-012 · Priority: Must

#### Scenario: Cabeceras de la descarga de una imagen
- **CUANDO** se descarga "foto-recibo.jpg"
- **ENTONCES** la respuesta lo entrega como adjunto con tipo `image/jpeg`, sin adivinar el tipo, en modo aislado y sin caché compartida

#### Scenario: Nombre con intento de inyección de cabeceras
- **CUANDO** se descarga un documento cuyo nombre guardado contiene comillas y punto y coma
- **ENTONCES** la cabecera del nombre lo lleva codificado y la respuesta no contiene cabeceras adicionales

### Requirement: Contenido cifrado en reposo
El contenido de cada documento DEBE (MUST) almacenarse cifrado con una clave de datos propia, protegida por una clave maestra identificada y rotable que nunca se guarda junto al contenido; leer el objeto directamente del almacenamiento NO DEBE (MUST NOT) revelar el contenido, y la descarga o lectura de un objeto alterado DEBE (MUST) fallar con `DOCUMENT_CONTENT_CORRUPTED` sin entregar contenido no verificado. Eliminar un documento DEBE (MUST) destruir su clave de datos envuelta.
Trace: NFR-SEC-006, FR-DOCUMENTS-007 · Priority: Must

#### Scenario: Objeto almacenado cifrado
- **CUANDO** se lee directamente del almacenamiento el objeto de "factura-luz-octubre.pdf"
- **ENTONCES** su contenido no empieza con `%PDF-` ni contiene el texto de la factura

#### Scenario: Objeto alterado
- **CUANDO** un byte del objeto cifrado se modifica en el almacenamiento y un miembro descarga el documento
- **ENTONCES** la descarga falla con `DOCUMENT_CONTENT_CORRUPTED` y no se entregan bytes del bloque alterado ni de los siguientes

### Requirement: Rotación de la clave maestra de documentos
Al activar una nueva clave maestra, los documentos nuevos DEBEN (MUST) protegerse con ella y el mantenimiento DEBE (MUST) volver a envolver con la clave activa las claves de datos de los documentos existentes, sin volver a cifrar su contenido; mientras queden documentos envueltos con una clave anterior, esa clave NO DEBE (MUST NOT) poder retirarse sin un error explícito al arrancar.
Trace: NFR-SEC-006 · Priority: Should

#### Scenario: Rotación con documentos existentes
- **CUANDO** "W1" tiene 40 documentos envueltos con la clave "k1", se activa "k2" y corre el mantenimiento
- **ENTONCES** los 40 documentos quedan envueltos con "k2" y siguen descargables con su suma original

#### Scenario: Retirar una clave en uso
- **CUANDO** se arranca la aplicación sin "k1" mientras un documento sigue envuelto con "k1"
- **ENTONCES** el arranque falla con un error que nombra la clave faltante

### Requirement: Cuota de almacenamiento por workspace
La suma de los tamaños de los documentos pendientes, disponibles y archivados de un workspace NO DEBE (MUST NOT) superar la cuota configurada (por defecto 5 GiB, 5368709120 bytes) ni el workspace tener más de 20 subidas pendientes a la vez (configurable); la solicitud que lo excedería DEBE (MUST) rechazarse con `DOCUMENT_QUOTA_EXCEEDED` o `DOCUMENT_PENDING_UPLOADS_EXCEEDED`, también cuando dos solicitudes compiten por el último espacio. Todo miembro DEBE (MUST) poder consultar el uso y la cuota.
Trace: NFR-SEC-011, NFR-SEC-012 · Priority: Should

#### Scenario: Cuota agotada
- **CUANDO** "W1" usa 5368000000 bytes y un EDITOR solicita subir un archivo de 1000000 bytes
- **ENTONCES** se rechaza con `DOCUMENT_QUOTA_EXCEEDED` y no se registra ningún documento

#### Scenario: Dos solicitudes por el último espacio
- **CUANDO** a "W1" le quedan 1500000 bytes libres y llegan a la vez dos solicitudes de 1000000 bytes
- **ENTONCES** exactamente una se registra y la otra se rechaza con `DOCUMENT_QUOTA_EXCEEDED`

### Requirement: Escaneo antimalware opcional
Con el escáner antimalware habilitado, todo archivo DEBE (MUST) escanearse antes de quedar disponible; una detección DEBE (MUST) dejarlo "rechazado" con el motivo malware detectado, y si el escáner no responde la confirmación DEBE (MUST) fallar con `SERVICE_UNAVAILABLE` dejando el documento sin disponer, para reintentarse. Con el escáner deshabilitado, el documento DEBE (MUST) indicar que no fue escaneado y entregarse solo como archivo adjunto.
Trace: FR-DOCUMENTS-008 · Priority: Could

#### Scenario: Archivo de prueba EICAR con escáner
- **CUANDO** con el escáner habilitado se sube y confirma "movimientos.csv" con la cadena de prueba EICAR
- **ENTONCES** el documento queda "rechazado" con el motivo malware detectado

#### Scenario: Escáner caído
- **CUANDO** con el escáner habilitado pero sin responder se confirma una subida
- **ENTONCES** la confirmación falla con `SERVICE_UNAVAILABLE` y el documento no queda disponible

#### Scenario: Escáner deshabilitado
- **CUANDO** con el escáner deshabilitado se confirma un PDF válido
- **ENTONCES** el documento queda disponible indicando que no fue escaneado

### Requirement: Aislamiento de documentos por workspace
Un documento, un vínculo o la descarga de otro workspace DEBEN (MUST) ser indistinguibles de uno inexistente (`RESOURCE_NOT_FOUND`), y ninguna operación sobre documentos DEBE (MUST) leer ni modificar datos de otro workspace, incluso sin contexto de workspace fijado.
Trace: NFR-SEC-003, NFR-SEC-004 · Priority: Must

#### Scenario: Descarga de un documento ajeno
- **CUANDO** el OWNER de "W1" y "W2" pide bajo "W1" la descarga de un documento de "W2"
- **ENTONCES** la respuesta es 404 con `RESOURCE_NOT_FOUND`, igual que para un identificador inexistente

### Requirement: Límite de frecuencia de subidas
Solicitar subidas y confirmarlas DEBE (MUST) contar en la cuota de operaciones costosas por usuario (10 por minuto); la que la exceda DEBE (MUST) rechazarse con `RATE_LIMITED` sin registrar nada, y un reintento idempotente NO DEBE (MUST NOT) consumir cuota.
Trace: NFR-SEC-011 · Priority: Should

#### Scenario: Undécima solicitud en un minuto
- **CUANDO** un EDITOR hace 11 solicitudes de subida distintas en el mismo minuto
- **ENTONCES** la undécima se rechaza con `RATE_LIMITED` y no registra ningún documento

### Requirement: Suite de archivos maliciosos rechazados
El conjunto de archivos maliciosos de prueba —tipos no permitidos, extensión falsa, políglota HTML/PDF, SVG con script, PDF con JavaScript visible y ofuscado, PDF con contraseña, texto con marcado activo o bytes nulos, JSON demasiado anidado, XLSX con macros, bomba de compresión, tamaño excedido, contenido sustituido, dirección vencida y, con el escáner habilitado, EICAR— DEBE (MUST) rechazarse de punta a punta contra el almacenamiento real, sin que ningún archivo quede disponible ni descargable ni permanezca en la cuarentena.
Trace: FR-DOCUMENTS-002, NFR-SEC-012 · Priority: Must

#### Scenario: Corrida completa de la suite
- **CUANDO** se ejecuta la suite con sus 17 casos maliciosos (18 con el escáner habilitado) contra la API y el almacenamiento reales
- **ENTONCES** los 17 (o 18) terminan rechazados en la solicitud, en el almacenamiento o en la verificación
- **Y** el workspace no tiene ningún documento disponible y la cuarentena queda vacía
