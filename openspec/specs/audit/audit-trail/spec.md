# audit/audit-trail Specification

## Purpose
Deja constancia inmutable de quién cambió qué, cuándo y por qué en cada workspace: toda mutación financiera o de configuración se registra de forma atómica con el cambio, el registro no puede alterarse y el historial de una entidad puede consultarse.

## Requirements

### Requirement: Registro de auditoría atómico con la mutación
Todo comando que muta datos financieros o de configuración de un workspace DEBE (MUST) escribir su registro de auditoría en la misma transacción que el cambio: si el registro de auditoría no puede escribirse, el cambio NO DEBE (MUST NOT) persistirse, y un comando rechazado NO DEBE (MUST NOT) dejar registro de auditoría.
Trace: FR-AUDIT-001, NFR-DATA-007 · Priority: Must

#### Scenario: Gasto registrado junto con su auditoría
- **CUANDO** un usuario EDITOR registra un gasto de 75.00 BOB en "Bank A" (saldo 1000.00 BOB)
- **ENTONCES** el gasto, su efecto contable y exactamente un registro de auditoría de esa acción quedan confirmados juntos
- **Y** el saldo de "Bank A" es 925.00 BOB

#### Scenario: Falla al escribir la auditoría
- **CUANDO** un usuario registra un gasto de 75.00 BOB en "Bank A" (saldo 1000.00 BOB) y la escritura del registro de auditoría falla
- **ENTONCES** el comando falla con `INTERNAL_ERROR`
- **Y** no existe el gasto, ni su efecto contable, ni registro de auditoría, ni evento publicado para él
- **Y** el saldo de "Bank A" sigue siendo 1000.00 BOB

#### Scenario: Comando rechazado no se audita
- **CUANDO** un usuario intenta registrar un gasto de 50.00 BOB en "USD Savings" (cuenta en USD) y el comando se rechaza por moneda distinta
- **ENTONCES** no se escribe ningún registro de auditoría para ese intento

#### Scenario: Cambio de configuración auditado
- **CUANDO** un usuario OWNER cambia la zona horaria del workspace de "America/La_Paz" a "UTC"
- **ENTONCES** se escribe un registro de auditoría con el valor anterior "America/La_Paz" y el nuevo "UTC" en la misma transacción que el cambio

### Requirement: Contenido del registro de auditoría
Cada registro de auditoría DEBE (MUST) contener: identificador, workspace, actor, acción, tipo e identificador de la entidad afectada, versión resultante de la entidad, diferencias antes/después campo a campo, motivo cuando el comando lo exige, instante UTC, identificador de correlación de la solicitud y origen (`ui`, `api`, `import`, `rule`, `recurring`, `system`). Los montos DEBEN (MUST) registrarse como decimal exacto con su moneda.
Trace: FR-AUDIT-002 · Priority: Must

#### Scenario: Edición de monto de una transacción
- **CUANDO** el usuario "U1" del workspace "W1", en una solicitud con correlación "C1" desde la UI, edita el monto de la transacción "T1" de 120.00 BOB a 102.00 BOB el 2026-03-15T14:00:00Z
- **ENTONCES** el registro de auditoría tiene actor "U1", workspace "W1", acción de edición de transacción, entidad "T1" con su nueva versión, antes 120.00 BOB y después 102.00 BOB, instante 2026-03-15T14:00:00Z, correlación "C1" y origen `ui`
- **Y** los montos se conservan exactamente como "120.00" y "102.00" con moneda BOB, sin pérdida de escala

#### Scenario: Motivo registrado
- **CUANDO** un usuario anula una transacción de 30.00 BOB indicando el motivo "Duplicada"
- **ENTONCES** el registro de auditoría de la anulación contiene el motivo "Duplicada"

### Requirement: Atribución de mutaciones automáticas
Una mutación ejecutada por un proceso del sistema (job, regla, generación recurrente, importación o proceso interno) DEBE (MUST) registrarse con un actor de tipo sistema que identifique el proceso, y DEBE (MUST) conservar la correlación con la solicitud o evento que la originó cuando exista.
Trace: FR-AUDIT-002 · Priority: Must

#### Scenario: Mutación hecha por un proceso interno
- **CUANDO** un proceso interno del sistema crea la cuenta contable de sistema para la moneda USDT durante un registro de 100.000000 USDT
- **ENTONCES** el registro de auditoría correspondiente identifica un actor de tipo sistema y no un usuario
- **Y** conserva el identificador de correlación de la solicitud que originó el registro

### Requirement: Datos sensibles excluidos de la auditoría
El registro de auditoría NO DEBE (MUST NOT) contener secretos, tokens, cookies, credenciales ni identificadores completos de cuentas; los identificadores de cuenta DEBEN (MUST) quedar enmascarados (solo los últimos 4 caracteres) y la dirección IP solo como hash. Los montos y monedas SÍ DEBEN (MUST) registrarse, porque son el propósito de la auditoría financiera.
Trace: FR-AUDIT-002, NFR-SEC-015 · Priority: Must

#### Scenario: Identificador de cuenta enmascarado
- **CUANDO** un usuario cambia el identificador de la cuenta "Bank A" a "DEMO-000123456789"
- **ENTONCES** el registro de auditoría muestra el identificador solo como sus últimos 4 caracteres "6789"
- **Y** no contiene el identificador completo ni el token de sesión de la solicitud

#### Scenario: Monto conservado
- **CUANDO** un usuario abre la cuenta "USDT Wallet" con saldo inicial 100.000000 USDT
- **ENTONCES** el registro de auditoría contiene el monto 100.000000 USDT

### Requirement: Auditoría inmutable
Un registro de auditoría, una vez escrito, NO DEBE (MUST NOT) poder modificarse ni eliminarse por ningún proceso de la aplicación; las correcciones de un cambio generan nuevos registros.
Trace: FR-AUDIT-003 · Priority: Must

#### Scenario: Intento de modificar un registro de auditoría
- **CUANDO** un proceso de la aplicación intenta modificar o eliminar el registro de auditoría de la edición de 120.00 BOB a 102.00 BOB
- **ENTONCES** la operación es rechazada por el almacenamiento
- **Y** el registro conserva sus valores originales

#### Scenario: Corrección genera un nuevo registro
- **CUANDO** el usuario vuelve a editar el monto de la transacción "T1" de 102.00 BOB a 120.00 BOB
- **ENTONCES** existen dos registros de auditoría para "T1" en orden cronológico y el primero no cambió

### Requirement: Auditoría aislada por workspace
Los registros de auditoría DEBEN (MUST) pertenecer a un único workspace y NO DEBEN (MUST NOT) ser visibles ni consultables desde otro workspace, aun cuando la solicitud indique el identificador de una entidad ajena.
Trace: FR-AUDIT-003, NFR-SEC-003 · Priority: Must

#### Scenario: Consulta de historial de una entidad de otro workspace
- **CUANDO** un usuario de "W2" consulta el historial de auditoría de la cuenta "Bank A" de "W1"
- **ENTONCES** obtiene una lista vacía, igual que para una entidad inexistente
- **Y** no se revela ningún registro de "W1"

### Requirement: Historial de auditoría por entidad
El sistema DEBE (MUST) permitir consultar el historial de auditoría de una entidad concreta (por ejemplo una transacción o una cuenta) en orden cronológico, paginado, mostrando para cada registro actor, acción, instante, origen y diferencias antes/después.
Trace: FR-AUDIT-004 · Priority: Must

#### Scenario: Historial de una cuenta
- **CUANDO** la cuenta "Bank C" se abrió con saldo inicial 500.00 BOB, luego se renombró a "Bank C Sueldo" y luego se archivó, y el usuario consulta su historial
- **ENTONCES** obtiene tres registros en orden cronológico: apertura (con 500.00 BOB), renombre (antes "Bank C", después "Bank C Sueldo") y archivo

#### Scenario: Entidad sin historial
- **CUANDO** el usuario consulta el historial de una entidad del workspace que no tiene registros de auditoría
- **ENTONCES** obtiene una lista vacía

### Requirement: Consulta de auditoría por rango de fechas
El sistema DEBE (MUST) permitir consultar los registros de auditoría del workspace dentro de un rango de fechas, opcionalmente acotado a un tipo de entidad, ordenados del más reciente al más antiguo y paginados; los límites del rango se interpretan en la zona horaria del workspace.
Trace: FR-AUDIT-004, FR-AUDIT-006 · Priority: Should

#### Scenario: Registros de un día
- **CUANDO** existen registros el 2026-03-14, el 2026-03-15 a las 23:30 hora de La Paz (2026-03-16T03:30:00Z) y el 2026-03-16, y el usuario consulta del 2026-03-15 al 2026-03-15
- **ENTONCES** obtiene solo el registro del 2026-03-15 a las 23:30 hora de La Paz

### Requirement: Lectura de auditoría restringida por rol
Solo los miembros con rol OWNER o EDITOR del workspace DEBEN (MUST) poder consultar el log de auditoría del workspace; un miembro VIEWER NO DEBE (MUST NOT) consultarlo, pero SÍ DEBE (MUST) poder ver el historial de cambios de cada transacción que puede ver, desde el detalle de esa transacción.
Trace: FR-AUDIT-004, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER consulta la auditoría
- **CUANDO** un usuario VIEWER de "W1" consulta el historial de auditoría de la cuenta "Bank A"
- **ENTONCES** la respuesta es `INSUFFICIENT_ROLE`

#### Scenario: VIEWER ve el historial de una transacción
- **CUANDO** un usuario VIEWER de "W1" abre el detalle de un gasto de 45.90 BOB que fue editado
- **ENTONCES** obtiene el historial de cambios de ese gasto
- **Y** no obtiene registros de auditoría de ninguna otra entidad

#### Scenario: EDITOR consulta la auditoría
- **CUANDO** un usuario EDITOR de "W1" consulta el historial de auditoría de la cuenta "Bank A"
- **ENTONCES** obtiene los registros de "Bank A"

### Requirement: Auditoría de inicio y cierre de sesión
El sistema DEBE (MUST) registrar en la auditoría cada inicio de sesión exitoso y cada cierre de sesión, con el usuario, el instante UTC, el hash de la dirección IP y el agente de usuario, sin tokens ni credenciales.
Trace: FR-AUDIT-005 · Priority: Must

#### Scenario: Inicio de sesión auditado
- **CUANDO** el usuario "U1" inicia sesión correctamente el 2026-03-15T12:00:00Z
- **ENTONCES** existe un registro de auditoría de inicio de sesión de "U1" con instante 2026-03-15T12:00:00Z
- **Y** el registro no contiene el token de acceso ni la cookie de sesión

#### Scenario: Cierre de sesión auditado
- **CUANDO** el usuario "U1" cierra sesión
- **ENTONCES** existe un registro de auditoría de cierre de sesión de "U1"

### Requirement: Consulta global del log de auditoría con filtros
Un OWNER o EDITOR DEBERÍA poder consultar el log de auditoría de todo el workspace con filtros combinables por actor, acción, tipo de entidad, entidad, origen y rango de fechas (interpretado en la zona horaria del workspace), ordenado del más reciente al más antiguo y paginado por cursor; cuando se ofrece, un VIEWER DEBE (MUST) recibir `INSUFFICIENT_ROLE` y nunca DEBEN (MUST NOT) devolverse registros de otro workspace.
Trace: FR-AUDIT-006, FR-AUDIT-004, NFR-SEC-003 · Priority: Should

#### Scenario: Cambios de un actor sobre transacciones en marzo
- **CUANDO** en marzo de 2026 "U1" editó 3 transacciones y archivó 1 cuenta, y "U2" editó 2 transacciones, y el OWNER filtra por actor "U1", tipo de entidad transacción y rango del 2026-03-01 al 2026-03-31
- **ENTONCES** obtiene solo los 3 registros de "U1" sobre transacciones, del más reciente al más antiguo

#### Scenario: VIEWER consulta el log global
- **CUANDO** un VIEWER del workspace consulta el log de auditoría global
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE`

### Requirement: Registros agrupados por operación
La consulta global DEBERÍA permitir filtrar por identificador de correlación para ver juntos todos los registros de una misma operación, incluidas las ediciones masivas por su identificador de operación masiva; cuando se ofrece, DEBE (MUST) devolver todos los registros de la operación y ninguno de otras.
Trace: FR-AUDIT-006, FR-TRANSACTIONS-033 · Priority: Should

#### Scenario: Registros de una edición masiva
- **CUANDO** una edición masiva recategorizó 3 gastos con un mismo identificador de operación masiva y el OWNER filtra por ese identificador
- **ENTONCES** obtiene los 3 registros por transacción y el registro agregado de la operación, y ningún otro

### Requirement: Exportación CSV del log de auditoría
Solo el OWNER DEBERÍA poder exportar a CSV el resultado de una consulta global del log de auditoría con los mismos filtros; cuando se ofrece, el CSV DEBE (MUST) usar UTF-8, separador coma y punto decimal, expresar los instantes en la zona horaria del workspace con su desfase, incluir el identificador y el nombre visible del actor (vacío para procesos), conservar enmascarados los campos sensibles y neutralizar las celdas que empiecen con `=`, `+`, `-`, `@`, tabulación o retorno; un EDITOR DEBE (MUST) recibir `INSUFFICIENT_ROLE`, una consulta de más de 50000 registros DEBE (MUST) rechazarse con `VALIDATION_FAILED` y cada exportación DEBE (MUST) auditarse.
Trace: FR-AUDIT-006, FR-AUDIT-005, NFR-SEC-015 · Priority: Should

#### Scenario: El OWNER exporta los cambios de marzo
- **CUANDO** el OWNER exporta a CSV el log de marzo de 2026 que contiene un registro del 2026-03-15T23:30:00-04:00 con una transacción cuya descripción anterior era "=SUM(A1)"
- **ENTONCES** obtiene un CSV con ese instante como "2026-03-15T23:30:00-04:00", la descripción neutralizada y una fila por registro del rango
- **Y** cada fila de un cambio hecho por un usuario incluye su id y su nombre visible
- **Y** existe un registro de auditoría de la exportación del log con el actor y los filtros usados

#### Scenario: EDITOR intenta exportar
- **CUANDO** un EDITOR del workspace exporta a CSV el log de auditoría
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE`

### Requirement: Auditoría de fallos de autorización
Cada intento rechazado por rol insuficiente o por no pertenecer al workspace DEBE (MUST) registrarse en la auditoría del workspace afectado como evento de seguridad, con el usuario, la operación intentada, el código de rechazo y el instante, sin el contenido de la solicitud, y DEBE (MUST) limitarse a un registro por usuario, workspace y operación por minuto.
Trace: FR-AUDIT-005, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta registrar un gasto
- **CUANDO** un VIEWER de "W1" intenta registrar un gasto de 45.90 BOB y se rechaza con `INSUFFICIENT_ROLE`
- **ENTONCES** la auditoría de "W1" contiene un evento de seguridad con ese usuario, la operación de registro de transacción y `INSUFFICIENT_ROLE`, sin el monto ni la descripción

#### Scenario: Reintentos repetidos en un minuto
- **CUANDO** ese VIEWER repite el mismo intento 5 veces en 30 segundos
- **ENTONCES** la auditoría contiene un solo evento de seguridad para ese minuto

### Requirement: Vista de eventos de seguridad
La consulta global DEBERÍA permitir filtrar solo los eventos de seguridad (inicios y cierres de sesión, fallos de autorización, cambios de configuración del workspace, exportaciones, descargas y eliminaciones de exports, importaciones y reaperturas de periodos); cuando se ofrece, DEBE (MUST) devolver esos eventos y ningún cambio de datos financieros.
Trace: FR-AUDIT-005, FR-AUDIT-006 · Priority: Should

#### Scenario: Eventos de seguridad de una semana
- **CUANDO** en la semana hubo 2 inicios de sesión, 1 fallo de autorización, 1 exportación descargada y 10 transacciones registradas, y el OWNER filtra eventos de seguridad
- **ENTONCES** obtiene los 2 inicios de sesión, el fallo de autorización y los registros de la exportación y su descarga, y ningún registro de transacciones
