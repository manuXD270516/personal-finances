## ADDED Requirements

### Requirement: Puerto común de proveedores bancarios y de exchange
Toda fuente externa de movimientos (API de banco, agregador, API de exchange o archivo de historial de exchange) DEBE (MUST) integrarse como un proveedor con descriptor (identificador, tipo, capacidades, modo de credencial, hosts permitidos, estado de términos y estado de formato) que entregue registros externos con identificador estable al mismo pipeline de importación desde la normalización; cada proveedor DEBE (MUST) pasar la misma suite de contrato antes de habilitarse.
Trace: FR-IMPORTS-013, FR-IMPORTS-002 · Priority: Should

#### Scenario: Proveedor de prueba en la suite de contrato
- **CUANDO** el proveedor simulado `FAKE_EXCHANGE` entrega 5 registros sintéticos (2 trades, 1 depósito, 1 retiro y 1 recompensa) en una ventana del 2026-09-01 al 2026-09-30
- **ENTONCES** pasa la suite de contrato común (identificador estable, ventana respetada, cursor reanudable, montos como texto decimal exacto)
- **Y** sus registros llegan a la etapa de normalización del import como los de un archivo

### Requirement: Proveedores habilitados solo con términos y formato verificados
Un proveedor real NO DEBE (MUST NOT) ofrecerse ni usarse mientras su descriptor no tenga términos de uso verificados y registrados en un ADR (y, si es un formato de archivo, una muestra real verificada); un proveedor con términos `PENDING` o `REJECTED` DEBE (MUST) rechazarse al crear una conexión con `BANKING_PROVIDER_NOT_AVAILABLE`, y el proveedor simulado NO DEBE (MUST NOT) estar disponible en staging ni en producción.
Trace: NFR-COMP-007, FR-IMPORTS-013 · Priority: Must

#### Scenario: Exchange con términos pendientes
- **CUANDO** el descriptor de `EXCHANGE_API_BINANCE` tiene términos `PENDING` y el OWNER intenta crear una conexión con él
- **ENTONCES** la operación se rechaza con `BANKING_PROVIDER_NOT_AVAILABLE`
- **Y** el catálogo de proveedores lo muestra como "pendiente de verificación"

#### Scenario: Proveedor simulado en producción
- **CUANDO** la aplicación arranca en producción con `FAKE_EXCHANGE` habilitado en la configuración
- **ENTONCES** el arranque falla con un error de configuración

### Requirement: Conexión con un proveedor y mapeo de activos a cuentas
El OWNER DEBE (MUST) poder crear una conexión con un proveedor habilitado indicando nombre, proveedor y el mapeo de cada activo del proveedor a una cuenta de PFOS de la misma moneda; un activo sin cuenta mapeada DEBE (MUST) llegar a la vista previa como fila no importable con el motivo `CONNECTION_ASSET_UNMAPPED`, nunca crearse en otra cuenta. Un mapeo a una cuenta de otra moneda DEBE (MUST) rechazarse con `CURRENCY_MISMATCH`.
Trace: FR-IMPORTS-013, FR-IMPORTS-014 · Priority: Should

#### Scenario: Mapear USDT y BTC
- **CUANDO** el OWNER crea la conexión "Exchange principal" con USDT ⇒ "Exchange USDT" (USDT) y BTC ⇒ "Exchange BTC" (BTC)
- **ENTONCES** la conexión queda creada con esos dos mapeos

#### Scenario: Activo sin cuenta
- **CUANDO** una sincronización trae un depósito de 12.500000 TRX y TRX no está mapeado
- **ENTONCES** la fila aparece en la vista previa como no importable con `CONNECTION_ASSET_UNMAPPED`
- **Y** ninguna transacción se crea para ella

#### Scenario: Cuenta de otra moneda
- **CUANDO** el OWNER mapea BTC a la cuenta "Exchange USDT"
- **ENTONCES** la operación se rechaza con `CURRENCY_MISMATCH`

### Requirement: Credenciales cifradas y nunca expuestas
Las credenciales de una conexión (clave y secreto de API o token delegado) DEBEN (MUST) cifrarse con cifrado de sobre (una clave de datos por credencial, envuelta con una clave maestra identificada) antes de persistirse, y solo el proceso que sincroniza DEBE (MUST) poder descifrarlas; NO DEBEN (MUST NOT) devolverse por la API, escribirse en logs, en mensajes de error, en la auditoría, en la clave de idempotencia ni en el export. La API solo DEBE (MUST) mostrar una huella enmascarada (los últimos 4 caracteres del identificador de la clave).
Trace: NFR-SEC-007, NFR-SEC-015, NFR-COMP-008, FR-IMPORTS-013 · Priority: Must

#### Scenario: Crear una conexión con clave de API
- **CUANDO** el OWNER crea una conexión con una clave cuyo identificador termina en `a1b2` y su secreto
- **ENTONCES** la respuesta y las lecturas posteriores muestran solo `…a1b2`
- **Y** la base de datos guarda solo el texto cifrado y la clave de datos envuelta, y ni los logs ni la auditoría contienen el secreto

#### Scenario: El proceso de la API no puede descifrar
- **CUANDO** se intenta descifrar una credencial guardada con la configuración del proceso de la API
- **ENTONCES** el descifrado no es posible y solo el proceso de sincronización puede hacerlo

### Requirement: Nunca usuario y contraseña de banca
El sistema NO DEBE (MUST NOT) aceptar ni almacenar usuario y contraseña de banca en línea ni de un exchange; solo DEBE (MUST) admitir claves de API o tokens delegados emitidos por el proveedor, y un proveedor que requiera usuario y contraseña NO DEBE (MUST NOT) poder registrarse.
Trace: NFR-COMP-008 · Priority: Must

#### Scenario: Descriptor que pide contraseña
- **CUANDO** se registra un descriptor de proveedor cuyo modo de credencial es usuario y contraseña
- **ENTONCES** el registro falla al arrancar y el proveedor no aparece en el catálogo

### Requirement: Solo credenciales de solo lectura
Antes de activar una conexión, el sistema DEBE (MUST) verificar con el proveedor que la credencial solo permite leer (sin operar, retirar ni transferir); una credencial con cualquiera de esos permisos DEBE (MUST) rechazarse con `CONNECTION_CREDENTIAL_NOT_READ_ONLY` y destruirse. Cada sincronización DEBE (MUST) volver a verificarlo y, si los permisos se ampliaron, pasar la conexión a "requiere atención" sin leer movimientos.
Trace: FR-IMPORTS-013, NFR-COMP-008 · Priority: Must

#### Scenario: Clave con permiso de retiro
- **CUANDO** el OWNER crea una conexión con una clave que tiene habilitados los retiros
- **ENTONCES** la conexión queda rechazada con `CONNECTION_CREDENTIAL_NOT_READ_ONLY` y su credencial destruida
- **Y** el OWNER ve la indicación de crear una clave de solo lectura

#### Scenario: Permisos ampliados después
- **CUANDO** una conexión activa sincroniza y el proveedor informa que su clave ahora permite operar
- **ENTONCES** la conexión pasa a "requiere atención" y no se lee ningún movimiento

### Requirement: Revocación de una conexión
El OWNER DEBE (MUST) poder revocar una conexión: su credencial DEBE (MUST) destruirse de forma irrecuperable en la misma operación (se elimina la clave de datos envuelta), no DEBE (MUST NOT) volver a sincronizarse y la revocación DEBE (MUST) auditarse; las transacciones ya importadas y sus vínculos DEBEN (MUST) conservarse.
Trace: FR-IMPORTS-013, NFR-COMP-008 · Priority: Must

#### Scenario: Revocar la conexión del exchange
- **CUANDO** el OWNER revoca "Exchange principal", que importó 37 transacciones
- **ENTONCES** la conexión queda revocada, su credencial ya no puede descifrarse y un intento de sincronizar falla con `INVALID_STATUS_TRANSITION`
- **Y** las 37 transacciones siguen en sus cuentas
- **Y** la UI recuerda borrar también la clave en el exchange

### Requirement: Credencial rechazada por el proveedor
Si el proveedor rechaza la credencial (revocada, vencida o inválida), la sincronización DEBE (MUST) fallar con `IMPORT_CONNECTION_EXPIRED`, la conexión DEBE (MUST) pasar a "requiere atención" y el OWNER DEBE (MUST) poder reemplazar la credencial, que se verifica de nuevo como al crearla.
Trace: FR-IMPORTS-013 · Priority: Should

#### Scenario: Clave borrada en el exchange
- **CUANDO** el owner borró la clave en el exchange y el EDITOR sincroniza la conexión
- **ENTONCES** la sincronización falla con `IMPORT_CONNECTION_EXPIRED` y la conexión queda "requiere atención"
- **Y** al reemplazar la credencial por una de solo lectura la conexión vuelve a activa

### Requirement: Rotación de la clave maestra
El sistema DEBE (MUST) admitir varias claves maestras identificadas, cifrar las credenciales nuevas con la vigente y volver a envolver las claves de datos existentes con la vigente sin exponer las credenciales; una credencial envuelta con una clave maestra ausente DEBE (MUST) dejar su conexión en "requiere atención" sin detener las demás.
Trace: NFR-SEC-007 · Priority: Should

#### Scenario: Rotar de k1 a k2
- **CUANDO** hay 3 conexiones con credenciales envueltas con `k1`, se configura `k2` como vigente y corre la rotación
- **ENTONCES** las 3 claves de datos quedan envueltas con `k2` y las sincronizaciones siguen funcionando
- **Y** `k1` puede retirarse de la configuración

### Requirement: Sincronización incremental con ventana y cursor
Sincronizar una conexión DEBE (MUST) crear un import cuyos registros entran al pipeline desde la normalización y pasan siempre por vista previa y aprobación; la primera sincronización DEBE (MUST) pedir la fecha de inicio (hasta 365 días atrás) y las siguientes DEBEN (MUST) continuar desde el cursor de la última sincronización completada, que solo avanza cuando su import termina. Una conexión NO DEBE (MUST NOT) tener dos sincronizaciones en curso (`CONNECTION_SYNC_IN_PROGRESS`).
Trace: FR-IMPORTS-013, FR-IMPORTS-009 · Priority: Should

#### Scenario: Primera y segunda sincronización
- **CUANDO** el EDITOR sincroniza por primera vez desde el 2026-07-01, aprueba el import el 2026-10-20 y vuelve a sincronizar el 2026-10-27
- **ENTONCES** la segunda sincronización solo pide registros posteriores al cursor guardado el 2026-10-20
- **Y** ambas pasan por vista previa antes de crear transacciones

#### Scenario: Import cancelado no avanza el cursor
- **CUANDO** el EDITOR cancela la vista previa de una sincronización
- **ENTONCES** el cursor queda donde estaba y la siguiente sincronización vuelve a traer esos registros

#### Scenario: Dos sincronizaciones a la vez
- **CUANDO** el EDITOR pide sincronizar una conexión que ya tiene una sincronización en curso
- **ENTONCES** la operación se rechaza con `CONNECTION_SYNC_IN_PROGRESS`

### Requirement: Idempotencia por identificador del proveedor
Cada registro del proveedor DEBE (MUST) llevar una referencia externa formada por el proveedor, el tipo de registro y su identificador estable, de modo que volver a sincronizar o reimportar un rango solapado NO DEBA (MUST NOT) crear transacciones duplicadas; un registro ya importado DEBE (MUST) aparecer en la vista previa como ya importado.
Trace: FR-IMPORTS-010, FR-TRANSACTIONS-032 · Priority: Must

#### Scenario: Ventana solapada
- **CUANDO** una sincronización del 2026-09-01 al 2026-09-30 creó 20 transacciones y otra del 2026-09-15 al 2026-10-15 trae 18 registros, 9 de ellos ya importados
- **ENTONCES** la vista previa marca 9 como ya importados y al aprobar se crean solo 9 transacciones

#### Scenario: Mismo historial por archivo y por API
- **CUANDO** el owner sube el archivo de historial con un trade ya importado por API con el mismo identificador
- **ENTONCES** la fila aparece como ya importada y no se crea otra conversión

### Requirement: Trades del exchange como conversiones
Un trade spot DEBE (MUST) proponerse como conversión entre las cuentas mapeadas de sus dos activos, con el precio, los montos y la comisión tal como los informa el exchange (comisión como gasto en su moneda, categoría Fees) y el instante de ejecución; NO DEBE (MUST NOT) recalcularse con tasas de PFOS, y un trade con un activo sin mapear DEBE (MUST) quedar no importable.
Trace: FR-IMPORTS-014, FR-TRANSACTIONS-020 · Priority: Should

#### Scenario: Compra de BTC con USDT
- **CUANDO** el exchange informa la compra de 0.01500000 BTC a 65000.00 USDT por BTC, pagando 975.000000 USDT, con comisión de 0.00001500 BTC descontada de lo recibido
- **ENTONCES** la vista previa propone una conversión de 975.000000 USDT desde "Exchange USDT" a 0.01498500 BTC netos en "Exchange BTC"
- **Y** el detalle registra tasa cotizada 65000.00, comisión `PROVIDER` de 0.00001500 BTC como gasto Fees y el instante del exchange
- **Y** al aprobar, la suma de cada moneda en el asiento es cero

### Requirement: Depósitos, retiros, comisiones y recompensas
Los depósitos DEBEN (MUST) proponerse como ingresos y los retiros como gastos en la cuenta del activo, con la comisión de red como gasto Fees aparte, ambos señalados como "posible transferencia" para que el usuario los vincule a la otra cuenta en la vista previa; las recompensas e intereses DEBEN (MUST) proponerse como ingresos; las órdenes P2P NO DEBEN (MUST NOT) importarse y DEBEN (MUST) aparecer excluidas con el motivo `CONNECTION_RECORD_UNSUPPORTED`. Las filas de ingresos y gastos DEBEN (MUST) pasar por las reglas del workspace.
Trace: FR-IMPORTS-014 · Priority: Should

#### Scenario: Retiro con comisión de red
- **CUANDO** el exchange informa un retiro de 200.000000 USDT con comisión de red de 1.000000 USDT
- **ENTONCES** la vista previa propone un gasto de 200.000000 USDT señalado como posible transferencia y un gasto Fees de 1.000000 USDT
- **Y** el saldo propuesto de "Exchange USDT" baja 201.000000 USDT

#### Scenario: Orden P2P
- **CUANDO** el historial trae una orden P2P de venta de 100.000000 USDT por 690.00 BOB
- **ENTONCES** la fila aparece excluida con `CONNECTION_RECORD_UNSUPPORTED` y no se crea ninguna transacción

### Requirement: Importación por archivo del historial de un exchange
El sistema DEBE (MUST) admitir como proveedor de tipo archivo el historial exportado por el usuario desde un exchange (trades, depósitos, retiros), con un formato versionado por exchange y verificado contra una muestra real, sin credenciales; el archivo DEBE (MUST) producir los mismos registros, referencias externas y propuestas que la API del mismo exchange. Un archivo que no coincide con ningún formato verificado DEBE (MUST) rechazarse con `IMPORT_UNSUPPORTED_FORMAT`.
Trace: FR-IMPORTS-014, FR-IMPORTS-004 · Priority: Should

#### Scenario: Archivo de trades con formato verificado
- **CUANDO** el EDITOR sube a la conexión de archivo "Exchange archivo" el historial de trades sintético de 3 filas en el formato verificado
- **ENTONCES** la vista previa propone 3 conversiones con las referencias externas del exchange

#### Scenario: Columnas desconocidas
- **CUANDO** el EDITOR sube un archivo cuyas columnas no coinciden con ningún formato verificado
- **ENTONCES** la operación se rechaza con `IMPORT_UNSUPPORTED_FORMAT`

### Requirement: Límites del proveedor y reintentos
Las solicitudes a un proveedor DEBEN (MUST) respetar sus límites publicados con un presupuesto propio por conexión, esperar lo indicado por `Retry-After` (o la espera publicada si no lo envía) persistiendo la espera, y reanudar desde el último cursor confirmado sin repetir registros; una falla transitoria NO DEBE (MUST NOT) dejar un import a medias visible como completo.
Trace: FR-IMPORTS-013, NFR-REL-012, NFR-REL-007 · Priority: Should

#### Scenario: Límite excedido a mitad de la sincronización
- **CUANDO** el proveedor responde 429 con `Retry-After: 120` tras 4 de 10 páginas
- **ENTONCES** la sincronización espera al menos 120 s y continúa desde la página 5
- **Y** la vista previa final contiene los registros de las 10 páginas una sola vez

### Requirement: Privacidad de las solicitudes al proveedor
Las solicitudes de una conexión DEBEN (MUST) ir solo a los hosts permitidos de su proveedor, llevar solo la credencial de esa conexión y la ventana pedida, y NO DEBEN (MUST NOT) incluir datos de PFOS (nombres de cuentas, montos, descripciones, otros workspaces); la credencial descifrada solo DEBE (MUST) existir en memoria durante la sincronización.
Trace: NFR-COMP-001, NFR-SEC-015 · Priority: Must

#### Scenario: Host no permitido
- **CUANDO** un adapter intenta seguir una redirección a un host fuera de la lista permitida de su proveedor
- **ENTONCES** la solicitud se bloquea y la sincronización falla sin enviar la credencial a ese host

### Requirement: Permisos y auditoría de las conexiones
Solo el OWNER DEBE (MUST) crear conexiones, reemplazar credenciales, cambiar mapeos y revocar; OWNER y EDITOR DEBEN (MUST) poder sincronizar y subir archivos de historial; VIEWER DEBE (MUST) poder ver conexiones y su estado sin credenciales; los demás reciben `INSUFFICIENT_ROLE`. Crear, verificar, reemplazar credencial, cambiar mapeo, sincronizar y revocar DEBEN (MUST) auditarse en la misma unidad de trabajo, y las conexiones de un workspace NO DEBEN (MUST NOT) ser visibles en otro.
Trace: FR-IMPORTS-013, NFR-SEC-003 · Priority: Must

#### Scenario: EDITOR intenta revocar
- **CUANDO** un EDITOR intenta revocar "Exchange principal"
- **ENTONCES** la operación se rechaza con `INSUFFICIENT_ROLE` y la conexión sigue activa

#### Scenario: Auditoría de la creación
- **CUANDO** el OWNER crea "Exchange principal"
- **ENTONCES** existe un registro de auditoría con el proveedor, la huella `…a1b2` y los mapeos, sin el secreto
