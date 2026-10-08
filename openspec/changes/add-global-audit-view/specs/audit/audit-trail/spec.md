# Spec Delta

## Purpose

Completa la consulta global del log de auditoría de Phase 2 (FR-AUDIT-006): filtros combinables por actor, acción, tipo de entidad, entidad, origen y rango, agrupación por operación (incluidas las ediciones masivas), vista de eventos de seguridad, exportación CSV solo para el OWNER y auditoría de los fallos de autorización (FR-AUDIT-005).

## ADDED Requirements

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
Solo el OWNER DEBERÍA poder exportar a CSV el resultado de una consulta global del log de auditoría con los mismos filtros; cuando se ofrece, el CSV DEBE (MUST) usar UTF-8, separador coma y punto decimal, expresar los instantes en la zona horaria del workspace con su desfase, conservar enmascarados los campos sensibles y neutralizar las celdas que empiecen con `=`, `+`, `-`, `@`, tabulación o retorno; un EDITOR DEBE (MUST) recibir `INSUFFICIENT_ROLE`, una consulta de más de 50000 registros DEBE (MUST) rechazarse con `VALIDATION_FAILED` y cada exportación DEBE (MUST) auditarse.
Trace: FR-AUDIT-006, FR-AUDIT-005, NFR-SEC-015 · Priority: Should

#### Scenario: El OWNER exporta los cambios de marzo
- **CUANDO** el OWNER exporta a CSV el log de marzo de 2026 que contiene un registro del 2026-03-15T23:30:00-04:00 con una transacción cuya descripción anterior era "=SUM(A1)"
- **ENTONCES** obtiene un CSV con ese instante como "2026-03-15T23:30:00-04:00", la descripción neutralizada y una fila por registro del rango
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
