# Spec Delta

## Purpose

Garantiza la portabilidad de los datos del workspace (FR-IDENTITY-010, FR-IDENTITY-017, NFR-PORT-009, NFR-REL-014, NFR-COMP-002): el OWNER exporta todo su workspace en un archivo abierto, versionado, íntegro y consistente, que se guarda cifrado y expira, y puede importarlo en un workspace nuevo reproduciendo exactamente saldos, asientos e historia. La ida y vuelta export → import es un criterio de salida de Phase 2.

## ADDED Requirements

### Requirement: Solicitar la exportación del workspace
Solo el OWNER del workspace, con una autenticación reciente (no más de 10 minutos), DEBE (MUST) poder solicitar la exportación completa del workspace; la solicitud DEBE (MUST) exigir clave de idempotencia, ejecutarse como operación asíncrona consultable y admitir como máximo una exportación en curso por workspace (`EXPORT_IN_PROGRESS`). Un EDITOR o VIEWER DEBE (MUST) recibir `INSUFFICIENT_ROLE` y una autenticación no reciente `REAUTHENTICATION_REQUIRED`.
Trace: FR-IDENTITY-010, FR-IDENTITY-006, NFR-SEC-003 · Priority: Must

#### Scenario: El OWNER solicita la exportación
- **CUANDO** el OWNER de "W1", autenticado hace 3 minutos, solicita la exportación
- **ENTONCES** recibe una operación de exportación en estado pendiente que puede consultar hasta que termine

#### Scenario: Autenticación no reciente
- **CUANDO** el OWNER de "W1", autenticado hace 45 minutos, solicita la exportación
- **ENTONCES** se rechaza con `REAUTHENTICATION_REQUIRED` y no se crea ninguna operación

#### Scenario: EDITOR solicita la exportación
- **CUANDO** un EDITOR de "W1" solicita la exportación
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE`

#### Scenario: Segunda exportación en curso
- **CUANDO** "W1" ya tiene una exportación en curso y el OWNER solicita otra con una clave de idempotencia distinta
- **ENTONCES** se rechaza con `EXPORT_IN_PROGRESS`

### Requirement: Contenido completo del export
El export DEBE (MUST) contener todos los datos de negocio del workspace —configuración, monedas habilitadas, instituciones, cuentas, catálogos de clasificación con sus alias, definiciones y valores de custom fields, transacciones con legs, splits, todas sus revisiones y detalles de conversión, cuentas contables, asientos y postings (incluidas reversas), bloqueos de periodo, tasas de cambio y preferencias, sesiones de reconciliación, auditoría y recorridos, y los datos de Phase 2 del requirement siguiente— y NO DEBE (MUST NOT) contener secretos, tokens, sesiones, claves de idempotencia, mensajes del outbox ni hashes de IP.
Trace: FR-IDENTITY-010, NFR-COMP-002, NFR-SEC-015 · Priority: Must

#### Scenario: Conteos del export
- **CUANDO** "W1" tiene 3 cuentas, 25 categorías, 120 transacciones con 131 splits, 128 asientos y 2 sesiones de reconciliación, y el OWNER lo exporta
- **ENTONCES** el manifiesto informa exactamente esas cantidades y cada sección contiene esos registros

#### Scenario: Sin secretos en el export
- **CUANDO** se inspecciona el export de "W1"
- **ENTONCES** no contiene tokens, cookies, claves de idempotencia, mensajes del outbox ni hashes de IP de la auditoría

### Requirement: Datos de Phase 2 en el export
El export DEBE (MUST) incluir, y la importación restaurar, los periodos financieros, los planes de presupuesto con sus líneas y cruces de umbral, los templates con todas sus versiones, la política de cierre, los snapshots de cierre con sus saldos, las reaperturas, los avisos de cierre pendiente, los bloqueos de periodo y las preferencias de notificación; las notificaciones y sus entregas NO DEBEN (MUST NOT) exportarse.
Trace: FR-IDENTITY-010, FR-IDENTITY-017, FR-PLANNING-004 · Priority: Must

#### Scenario: Ida y vuelta de un mes cerrado con presupuesto
- **CUANDO** "W1" tiene "2026-10" cerrado con el snapshot 2 tras una reapertura, un plan de "2026-11" desde la versión 3 de un template con el umbral 90 % de "Restaurantes" ya cruzado, y el OWNER exporta e importa
- **ENTONCES** el workspace nuevo tiene "2026-10" cerrado con los snapshots 1 y 2 sin cambios, la reapertura con su motivo, el plan de "2026-11" con su template en la versión 3 y el cruce registrado
- **Y** un gasto con fecha 2026-10-15 se rechaza con `PERIOD_CLOSED` y no se emite de nuevo el umbral 90 %

### Requirement: Formato abierto y versionado del export
El export DEBE (MUST) ser un único archivo comprimido con un manifiesto (formato `pfos-export`, versión de formato, workspace, instante de exportación, moneda base, secciones con conteo y suma SHA-256 de cada archivo), datos en JSON validables contra un esquema JSON publicado por versión de formato y vistas planas en CSV RFC 4180 UTF-8; los montos DEBEN (MUST) escribirse como texto decimal exacto con la escala de su moneda y las celdas CSV que empiecen con `=`, `+`, `-`, `@`, tabulación o retorno DEBEN (MUST) neutralizarse.
Trace: FR-IDENTITY-010, NFR-PORT-009, NFR-DATA-010 · Priority: Must

#### Scenario: Montos exactos en JSON y CSV
- **CUANDO** "W1" tiene un gasto de 45.90 BOB y una conversión de 100.000000 USDT y se exporta
- **ENTONCES** el JSON y el CSV contienen "45.90" y "100.000000" exactamente y cada archivo JSON valida contra el esquema de la versión de formato 1

#### Scenario: Neutralización de fórmulas en CSV
- **CUANDO** una transacción tiene la descripción "=HYPERLINK(\"x\")"
- **ENTONCES** el CSV de transacciones contiene esa descripción neutralizada y no como fórmula

### Requirement: Instantánea consistente del export
El export DEBE (MUST) reflejar el estado del workspace en un único instante: los cambios confirmados después de ese instante NO DEBEN (MUST NOT) aparecer parcialmente, y el manifiesto DEBE (MUST) incluir el saldo de cada cuenta por moneda y el balance de comprobación a ese instante para verificar la importación.
Trace: FR-IDENTITY-010, NFR-REL-014 · Priority: Must

#### Scenario: Gasto registrado durante la exportación
- **CUANDO** el export de "W1" toma su instantánea con "Bank A" en 3099.10 BOB y, mientras se escribe el archivo, el usuario registra un gasto de 20.00 BOB en "Bank A"
- **ENTONCES** el export no contiene ese gasto ni sus asientos y su manifiesto informa "Bank A" con 3099.10 BOB

### Requirement: Archivo de export cifrado en reposo
El archivo de export DEBE (MUST) almacenarse cifrado con una clave de datos propia por archivo, protegida por una clave maestra identificada y rotable que nunca se guarda junto al archivo; el almacenamiento NO DEBE (MUST NOT) contener nunca el archivo en claro y el sistema DEBE (MUST) verificar su integridad al descifrarlo.
Trace: FR-IDENTITY-010, NFR-SEC-006 · Priority: Must

#### Scenario: Objeto almacenado cifrado
- **CUANDO** termina el export de "W1" y se lee el objeto directamente del almacenamiento sin pasar por la aplicación
- **ENTONCES** su contenido no es un archivo comprimido legible ni contiene el texto "Bank A"

#### Scenario: Objeto alterado
- **CUANDO** un byte del objeto cifrado se modifica en el almacenamiento y el OWNER intenta descargarlo
- **ENTONCES** la descarga falla con `EXPORT_FILE_CORRUPTED` y no se entrega contenido parcial

### Requirement: Descarga del export
Solo el OWNER, con autenticación reciente, DEBE (MUST) poder descargar un export terminado y no expirado, recibiendo el archivo descifrado junto con su suma SHA-256; cada descarga DEBE (MUST) auditarse y un export aún no terminado DEBE (MUST) rechazarse con `EXPORT_NOT_READY`.
Trace: FR-IDENTITY-010, FR-AUDIT-005 · Priority: Must

#### Scenario: Descargar el export terminado
- **CUANDO** el export de "W1" terminó hace 1 hora y el OWNER, autenticado hace 2 minutos, lo descarga
- **ENTONCES** recibe el archivo cuya suma SHA-256 coincide con la informada y existe un registro de auditoría de la descarga

#### Scenario: Descargar un export en curso
- **CUANDO** el OWNER intenta descargar un export que sigue en curso
- **ENTONCES** se rechaza con `EXPORT_NOT_READY`

### Requirement: Retención y expiración del export
Un export DEBE (MUST) expirar a los 7 días de terminado (valor configurable): desde entonces su descarga DEBE (MUST) rechazarse con `EXPORT_EXPIRED` y su archivo DEBE (MUST) eliminarse del almacenamiento, conservando el registro del export (fechas, tamaño, suma, actor) y su auditoría.
Trace: FR-IDENTITY-010, NFR-COMP-005 · Priority: Must

#### Scenario: Descargar un export vencido
- **CUANDO** el export de "W1" terminó el 2026-04-01T10:00:00Z y el OWNER intenta descargarlo el 2026-04-08T10:00:01Z
- **ENTONCES** se rechaza con `EXPORT_EXPIRED` y el archivo ya no está en el almacenamiento
- **Y** el registro del export sigue consultable con su fecha, tamaño y suma

### Requirement: Eliminar un export antes de su expiración
El OWNER DEBERÍA poder eliminar un export terminado antes de que expire; cuando se ofrece, el archivo DEBE (MUST) eliminarse del almacenamiento, toda descarga posterior DEBE (MUST) rechazarse con `EXPORT_EXPIRED` y la eliminación DEBE (MUST) auditarse.
Trace: FR-IDENTITY-010, NFR-COMP-002 · Priority: Should

#### Scenario: Eliminar el export de hoy
- **CUANDO** el OWNER elimina el export de "W1" terminado hoy
- **ENTONCES** el archivo deja de existir en el almacenamiento, la descarga se rechaza con `EXPORT_EXPIRED` y existe un registro de auditoría de la eliminación

### Requirement: Auditoría de exportaciones e importaciones
La solicitud, la finalización o falla, cada descarga, la eliminación y la expiración de un export, y la solicitud y el resultado de una importación, DEBEN (MUST) quedar auditados con el actor, el instante y el identificador del export o de la importación, sin incluir el contenido exportado.
Trace: FR-AUDIT-005, FR-AUDIT-001, FR-IDENTITY-010 · Priority: Must

#### Scenario: Ciclo auditado de un export
- **CUANDO** el OWNER solicita un export de "W1", lo descarga dos veces y luego el export expira
- **ENTONCES** la auditoría de "W1" contiene en orden: solicitud, finalización, dos descargas y expiración, cada una con su actor o proceso

### Requirement: Importar un export en un workspace nuevo
Un usuario autenticado recientemente DEBE (MUST) poder importar un archivo de export válido, lo que DEBE (MUST) crear un workspace nuevo del que es OWNER con todos los datos del archivo e identificadores nuevos; la importación NUNCA DEBE (MUST NOT) escribir en un workspace existente y el workspace de origen DEBE (MUST) quedar intacto.
Trace: FR-IDENTITY-017, NFR-REL-014 · Priority: Must

#### Scenario: Importar el export de "W1"
- **CUANDO** el usuario "U1", autenticado hace 1 minuto, importa el export de "W1" mientras "W1" sigue existiendo
- **ENTONCES** se crea el workspace "W1 (restaurado)" con "U1" como OWNER, con las mismas cuentas, categorías, transacciones y asientos que el export pero con identificadores distintos de los de "W1"
- **Y** "W1" no cambia

### Requirement: La ida y vuelta reproduce saldos e historia
Tras importar, el workspace nuevo DEBE (MUST) tener exactamente los mismos saldos por cuenta y moneda, el mismo balance de comprobación, los mismos asientos y reversas con sus fechas, las mismas revisiones de transacciones y la misma auditoría y recorridos que el export; el sistema DEBE (MUST) verificarlo contra el manifiesto antes de hacer visible el workspace y, si algo no coincide, la importación DEBE (MUST) fallar sin dejar ningún dato visible.
Trace: FR-IDENTITY-017, NFR-REL-014, INV-004, INV-022 · Priority: Must

#### Scenario: Saldos idénticos tras la ida y vuelta
- **CUANDO** "W1" tiene "Bank A" con 3099.10 BOB, "Wallet USDT" con 50.000000 USDT y la tarjeta "Visa" con una deuda de 520.00 BOB, se exporta y se importa
- **ENTONCES** el workspace restaurado tiene "Bank A" 3099.10 BOB, "Wallet USDT" 50.000000 USDT y "Visa" 520.00 BOB de deuda, y su balance de comprobación suma 0 en BOB y en USDT
- **Y** con la misma tasa USDT/BOB 12.02 su patrimonio neto es igual al de "W1": 3180.10 BOB

#### Scenario: Revisiones y reversas preservadas
- **CUANDO** en "W1" un gasto de 150.00 BOB se corrigió a 155.00 BOB (revisión 2 con asiento revertido, reversa y asiento nuevo) y se exporta e importa
- **ENTONCES** el gasto restaurado tiene revisión 2, los mismos tres asientos con sus fechas y su recorrido muestra registrar y revisar en el mismo orden

#### Scenario: Verificación fallida
- **CUANDO** durante la importación el saldo calculado de una cuenta no coincide con el del manifiesto
- **ENTONCES** la importación termina con error `EXPORT_VERIFICATION_FAILED` y no queda ningún workspace nuevo visible para el usuario

### Requirement: Rechazo de archivos de export inválidos
La importación DEBE (MUST) rechazar sin crear nada un archivo cuyo manifiesto falte o cuya suma SHA-256 de algún archivo no coincida (`EXPORT_FILE_CORRUPTED`), cuya versión de formato no sea soportada (`EXPORT_FORMAT_UNSUPPORTED`) o cuyos datos no validen contra el esquema de su versión (`EXPORT_FILE_CORRUPTED`).
Trace: FR-IDENTITY-017, NFR-PORT-009 · Priority: Must

#### Scenario: Archivo modificado a mano
- **CUANDO** el usuario cambia el monto "45.90" por "4.59" en el JSON de transacciones de un export y lo importa
- **ENTONCES** se rechaza con `EXPORT_FILE_CORRUPTED` y no se crea ningún workspace

#### Scenario: Versión de formato futura
- **CUANDO** el usuario importa un export con versión de formato 99
- **ENTONCES** se rechaza con `EXPORT_FORMAT_UNSUPPORTED`

### Requirement: Aviso de export terminado
Cuando un export termina o falla, el sistema DEBERÍA avisar al OWNER dentro de la app; cuando avisa, el aviso NO DEBE (MUST NOT) contener montos, nombres de cuentas ni el contenido del export.
Trace: FR-IDENTITY-010, NFR-COMP-001 · Priority: Should

#### Scenario: Export listo
- **CUANDO** termina el export solicitado por el OWNER de "W1"
- **ENTONCES** el OWNER ve un aviso "Tu exportación está lista" con enlace a la descarga y sin cifras
