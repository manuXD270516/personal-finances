# Spec Delta

## Purpose

Define el calendario financiero del workspace: periodos mensuales contiguos calculados a partir del día de inicio del mes financiero, creados automáticamente con anticipación, con un ciclo de vida explícito (`draft`, `active`, `closed`, `reopened`) que se rige por la fecha de hoy en la zona horaria del workspace. Es la base sobre la que se planifica el mes y se cierra (planning/month-closing).

## ADDED Requirements

### Requirement: Periodo financiero mensual según el día de inicio
El sistema DEBE (MUST) definir cada periodo financiero como un rango de fechas de negocio inclusivo que empieza el día de inicio del mes financiero del workspace (1 a 28) y termina el día anterior a ese mismo día del mes siguiente, identificado por una etiqueta `YYYY-MM` única por workspace igual al año y mes de su fecha de inicio.
Trace: FR-PLANNING-001, FR-IDENTITY-005 · Priority: Must

#### Scenario: Día de inicio 1
- **CUANDO** el workspace tiene día de inicio 1
- **ENTONCES** el periodo "2026-10" va del 2026-10-01 al 2026-10-31 y el periodo "2026-02" va del 2026-02-01 al 2026-02-28
- **Y** el periodo "2028-02" va del 2028-02-01 al 2028-02-29

#### Scenario: Día de inicio 25 por fecha de cobro del salario
- **CUANDO** el workspace tiene día de inicio 25
- **ENTONCES** el periodo "2026-10" va del 2026-10-25 al 2026-11-24 y el periodo "2026-12" va del 2026-12-25 al 2027-01-24

#### Scenario: Día de inicio 28 alrededor de febrero
- **CUANDO** el workspace tiene día de inicio 28
- **ENTONCES** el periodo "2027-01" va del 2027-01-28 al 2027-02-27 y el periodo "2027-02" va del 2027-02-28 al 2027-03-27

### Requirement: Periodos contiguos y sin solapamiento
Los periodos de un workspace DEBEN (MUST) ser contiguos y no solaparse: el día siguiente al fin de un periodo DEBE (MUST) ser el inicio del periodo siguiente, y cada fecha de negocio entre el inicio del primer periodo y el fin del último DEBE (MUST) pertenecer a exactamente un periodo; un intento de crear un periodo que solape o deje un hueco DEBE (MUST) rechazarse sin persistir nada.
Trace: FR-PLANNING-001, FR-PLANNING-002 · Priority: Must

#### Scenario: Secuencia de periodos con día de inicio 25
- **CUANDO** existen los periodos "2026-10" y "2026-11" con día de inicio 25
- **ENTONCES** "2026-10" termina el 2026-11-24 y "2026-11" empieza el 2026-11-25
- **Y** la fecha 2026-11-24 pertenece solo a "2026-10" y la fecha 2026-11-25 solo a "2026-11"

#### Scenario: Escritura que solaparía periodos
- **CUANDO** un proceso intenta registrar directamente un periodo del 2026-10-15 al 2026-11-14 en un workspace que ya tiene "2026-10" del 2026-10-01 al 2026-10-31
- **ENTONCES** la escritura se rechaza y los periodos existentes no cambian

### Requirement: Creación automática e idempotente con anticipación
El sistema DEBE (MUST) asegurar de forma automática e idempotente que existan el periodo que contiene la fecha de hoy en la zona horaria del workspace y, como mínimo, el periodo siguiente (por defecto los 3 siguientes); repetir la creación, incluso de forma concurrente, NO DEBE (MUST NOT) duplicar periodos ni modificar los existentes.
Trace: FR-PLANNING-002 · Priority: Must

#### Scenario: Primera creación en un workspace nuevo
- **CUANDO** hoy es 2026-10-05 en America/La_Paz, el workspace tiene día de inicio 1, no tiene asientos ni periodos y se ejecuta la creación automática
- **ENTONCES** existen el periodo "2026-10" en estado `active` y los periodos "2026-11", "2026-12" y "2027-01" en estado `draft`

#### Scenario: Creación repetida
- **CUANDO** la creación automática se ejecuta otra vez el mismo día, o dos ejecuciones corren de forma concurrente
- **ENTONCES** siguen existiendo exactamente los cuatro periodos con los mismos identificadores y versiones

#### Scenario: Avance del calendario
- **CUANDO** hoy pasa a ser 2026-11-02 y se ejecuta la creación automática
- **ENTONCES** se crea el periodo "2027-02" en `draft` y no se modifica ningún periodo existente salvo la activación de "2026-11"

### Requirement: Participantes de la creación de periodos en la misma transacción
Cada periodo creado DEBE (MUST) notificarse, en la misma transacción que lo crea, a los participantes de planificación registrados (como el template predeterminado de presupuestos); si un participante falla, el periodo NO DEBE (MUST NOT) crearse, y reintentar la creación NO DEBE (MUST NOT) duplicar periodos ni efectos de los participantes. Sin participantes registrados la creación no cambia.
Trace: FR-PLANNING-002, FR-PLANNING-010 · Priority: Must

#### Scenario: Participante notificado una sola vez por periodo
- **CUANDO** hay un participante registrado y la creación automática crea "2027-02" y luego se ejecuta otra vez
- **ENTONCES** el participante recibe "2027-02" exactamente una vez, dentro de la transacción que lo creó

#### Scenario: Falla de un participante
- **CUANDO** el participante registrado falla al recibir "2027-02"
- **ENTONCES** "2027-02" no se crea y la siguiente ejecución lo crea y lo notifica

### Requirement: Cobertura retroactiva desde la primera actividad
Mientras el workspace no tenga ningún periodo cerrado, el sistema DEBE (MUST) crear los periodos necesarios para que toda fecha de negocio de un asiento del ledger, desde la más antigua hasta 24 meses después de hoy, pertenezca a un periodo; los periodos creados que ya terminaron o contienen hoy DEBEN (MUST) quedar `active` y los futuros `draft`.
Trace: FR-PLANNING-002, FR-LEDGER-011 · Priority: Must

#### Scenario: Saldo inicial anterior a los periodos existentes
- **CUANDO** hoy es 2026-10-05, existen los periodos "2026-10" a "2027-01" con día de inicio 1 y se registra un saldo inicial de 2500.00 BOB en "Bank C" con fecha 2026-07-01
- **ENTONCES** se crean los periodos "2026-07", "2026-08" y "2026-09" en estado `active`
- **Y** el periodo "2026-07" va del 2026-07-01 al 2026-07-31

#### Scenario: Gasto con fecha futura
- **CUANDO** hoy es 2026-10-05 y se registra un gasto de 300.00 BOB con fecha 2027-06-10
- **ENTONCES** existen todos los periodos de "2027-02" a "2027-06" en estado `draft`, sin huecos

#### Scenario: Fecha más allá del horizonte
- **CUANDO** hoy es 2026-10-05 y se registra un gasto de 10.00 BOB con fecha 2029-01-15
- **ENTONCES** el gasto se registra y no se crean periodos posteriores a "2028-10"

### Requirement: Ciclo de vida declarado del periodo
Cada periodo DEBE (MUST) estar en exactamente uno de los estados `draft`, `active`, `closed` o `reopened`, sin estado terminal, y solo admitir las transiciones crear (a `draft` o a `active`), activar (`draft` a `active`), cerrar (`active` o `reopened` a `closed`) y reabrir (`closed` a `reopened`); toda otra transición DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION` sin cambios.
Trace: FR-PLANNING-001, FR-AUDIT-009 · Priority: Must

#### Scenario: Cerrar un periodo en borrador
- **CUANDO** se intenta cerrar el periodo "2026-12" en estado `draft`
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y el periodo sigue en `draft`

#### Scenario: Reabrir un periodo activo
- **CUANDO** el OWNER intenta reabrir el periodo "2026-10" en estado `active` con motivo "corrección"
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y el periodo sigue `active`

#### Scenario: Activar un periodo cerrado
- **CUANDO** se intenta activar el periodo "2026-09" en estado `closed`
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y el periodo sigue `closed`

### Requirement: Activación automática según la zona horaria del workspace
El sistema DEBE (MUST) pasar a `active` todo periodo `draft` cuya fecha de inicio sea menor o igual a la fecha de hoy calculada en la zona horaria del workspace, a más tardar en la siguiente ejecución horaria del proceso de periodos; un periodo terminado y no cerrado DEBE (MUST) seguir `active` (pendiente de cierre) y nunca volver a `draft`.
Trace: FR-PLANNING-001, FR-PLANNING-002, NFR-USAB-004 · Priority: Must

#### Scenario: Medianoche en La Paz
- **CUANDO** el workspace usa America/La_Paz (UTC−4), el periodo "2026-11" (del 2026-11-01 al 2026-11-30) está en `draft` y el proceso se ejecuta en el instante 2026-11-01T03:30Z (2026-10-31 23:30 en La Paz)
- **ENTONCES** "2026-11" sigue en `draft` porque hoy en el workspace es 2026-10-31
- **Y** en la ejecución del instante 2026-11-01T04:05Z (2026-11-01 00:05 en La Paz) "2026-11" pasa a `active` y "2026-10" sigue `active` pendiente de cierre

#### Scenario: Workspace en UTC
- **CUANDO** un workspace con zona horaria UTC tiene "2026-11" en `draft` y el proceso se ejecuta en el instante 2026-11-01T00:05Z
- **ENTONCES** "2026-11" pasa a `active`

### Requirement: Activación manual de un periodo iniciado
Un EDITOR u OWNER DEBE (MUST) poder activar manualmente un periodo `draft` cuya fecha de inicio ya llegó en la zona horaria del workspace; activar un periodo cuya fecha de inicio es posterior a hoy DEBE (MUST) rechazarse con `PERIOD_NOT_STARTED`.
Trace: FR-PLANNING-001 · Priority: Should

#### Scenario: Activación antes de que corra el proceso
- **CUANDO** hoy es 2026-11-01 en La Paz, "2026-11" sigue en `draft` porque el proceso aún no corrió y el EDITOR lo activa
- **ENTONCES** "2026-11" pasa a `active` una sola vez y la ejecución posterior del proceso no lo modifica

#### Scenario: Activación de un periodo futuro
- **CUANDO** hoy es 2026-11-01 y el EDITOR intenta activar "2026-12"
- **ENTONCES** se rechaza con `PERIOD_NOT_STARTED` y "2026-12" sigue en `draft`

### Requirement: Periodo determinado por la fecha de negocio
El periodo al que pertenece un hecho económico DEBE (MUST) determinarse solo por su fecha de negocio interpretada en la zona horaria del workspace, nunca por el instante UTC de su registro; cambiar la zona horaria del workspace NO DEBE (MUST NOT) cambiar los rangos de los periodos existentes ni el periodo de ningún hecho ya registrado.
Trace: FR-PLANNING-001, NFR-USAB-004 · Priority: Must

#### Scenario: Gasto registrado a las 23:30 del último día del mes
- **CUANDO** el usuario registra en el instante 2026-11-01T03:30Z (2026-10-31 23:30 en La Paz) un gasto de 85.50 BOB con fecha de negocio 2026-10-31
- **ENTONCES** el gasto pertenece al periodo "2026-10" y no al "2026-11"

#### Scenario: Borde con día de inicio 25
- **CUANDO** el workspace tiene día de inicio 25 y se consultan los periodos que contienen las fechas 2026-11-24 y 2026-11-25
- **ENTONCES** 2026-11-24 pertenece a "2026-10" y 2026-11-25 a "2026-11"

#### Scenario: Cambio de zona horaria
- **CUANDO** el OWNER cambia la zona horaria del workspace de America/La_Paz a UTC
- **ENTONCES** "2026-10" sigue yendo del 2026-10-01 al 2026-10-31 y el gasto del 2026-10-31 sigue en "2026-10"

### Requirement: Cambio del día de inicio solo hacia adelante
Un cambio del día de inicio del mes financiero NO DEBE (MUST NOT) modificar periodos en estado `active`, `closed` o `reopened`; DEBE (MUST) recalcular los periodos `draft` conservando su identidad y etiqueta, de modo que el primer periodo siguiente al último periodo no-`draft` sea un periodo de transición que empieza al día siguiente del fin de aquel y termina el día anterior al nuevo día de inicio del mes calendario posterior al de su inicio.
Trace: FR-PLANNING-001, FR-IDENTITY-005 · Priority: Must

#### Scenario: Cambio de día 1 a día 25
- **CUANDO** hoy es 2026-10-05, "2026-10" (del 2026-10-01 al 2026-10-31) está `active`, "2026-11", "2026-12" y "2027-01" están en `draft` y el OWNER cambia el día de inicio a 25
- **ENTONCES** "2026-10" no cambia
- **Y** "2026-11" pasa a ir del 2026-11-01 al 2026-12-24 marcado como transición, "2026-12" del 2026-12-25 al 2027-01-24 y "2027-01" del 2027-01-25 al 2027-02-24, cada uno con su mismo identificador

#### Scenario: Cambio de día 25 a día 1
- **CUANDO** "2026-10" (del 2026-10-25 al 2026-11-24) está `active`, los siguientes están en `draft` y el OWNER cambia el día de inicio a 1
- **ENTONCES** "2026-11" pasa a ir del 2026-11-25 al 2026-11-30 marcado como transición y "2026-12" del 2026-12-01 al 2026-12-31

#### Scenario: Planes conservados tras el recálculo
- **CUANDO** el periodo `draft` "2026-12" tiene un plan mensual con 1500.00 BOB para "Supermercado" y el día de inicio cambia de 1 a 25
- **ENTONCES** el plan sigue asociado al mismo periodo "2026-12", ahora del 2026-12-25 al 2027-01-24, con 1500.00 BOB para "Supermercado"

### Requirement: Creación anticipada a pedido
Un EDITOR u OWNER DEBE (MUST) poder pedir que existan los periodos hasta una fecha dada, como máximo 24 meses después de hoy, con el mismo resultado idempotente que la creación automática; una fecha posterior al límite DEBE (MUST) rechazarse con `VALIDATION_FAILED` sin crear periodos.
Trace: FR-PLANNING-002 · Priority: Should

#### Scenario: Planificar el año siguiente
- **CUANDO** hoy es 2026-10-05, existen periodos hasta "2027-01" y el EDITOR pide periodos hasta 2027-12-31
- **ENTONCES** existen en `draft` todos los periodos de "2027-02" a "2027-12" y repetir el pedido no crea ninguno más

#### Scenario: Fecha fuera del límite
- **CUANDO** el EDITOR pide periodos hasta 2029-01-01
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y no se crea ningún periodo

### Requirement: Consulta de periodos
Todo miembro del workspace, incluido VIEWER, DEBE (MUST) poder listar los periodos ordenados por fecha de inicio, filtrarlos por estado, obtener uno por su identificador y obtener el periodo que contiene una fecha, viendo etiqueta, rango, estado, si es de transición, si está pendiente de cierre, número de cierres y de reaperturas y versión.
Trace: FR-PLANNING-001 · Priority: Must

#### Scenario: Periodo de una fecha
- **CUANDO** un VIEWER consulta el periodo que contiene la fecha 2026-10-31 en un workspace con día de inicio 1
- **ENTONCES** obtiene "2026-10" del 2026-10-01 al 2026-10-31 con su estado

#### Scenario: Periodos pendientes de cierre
- **CUANDO** hoy es 2026-11-03 y se listan los periodos en estado `active`
- **ENTONCES** se obtienen "2026-10" marcado como pendiente de cierre y "2026-11" sin esa marca

#### Scenario: Fecha sin periodo
- **CUANDO** se consulta el periodo que contiene la fecha 2031-01-01, posterior a todos los periodos
- **ENTONCES** la respuesta es 404 con código `REFERENCE_NOT_FOUND`

### Requirement: Planificación de solo lectura en periodos cerrados
Ninguna modificación del plan mensual de un periodo ni de sus presupuestos DEBE (MUST) aceptarse mientras el periodo esté `closed`, rechazándose con `PERIOD_CLOSED` sin cambios; en periodos `draft`, `active` o `reopened` el plan DEBE (MUST) poder modificarse.
Trace: FR-PLANNING-008, FR-PLANNING-014, INV-015 · Priority: Must

#### Scenario: Editar el plan de un mes cerrado
- **CUANDO** el periodo "2026-09" está `closed` y el EDITOR intenta cambiar el monto planificado de "Supermercado" de 1500.00 BOB a 1800.00 BOB
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y el plan sigue en 1500.00 BOB

#### Scenario: Editar el plan tras reabrir
- **CUANDO** el OWNER reabre "2026-09" y el EDITOR cambia "Supermercado" de 1500.00 BOB a 1800.00 BOB
- **ENTONCES** el cambio se acepta y el plan queda en 1800.00 BOB

#### Scenario: Editar el plan de un mes futuro
- **CUANDO** el EDITOR cambia "Supermercado" de 1500.00 BOB a 1600.00 BOB en el plan del periodo "2026-12" en `draft`
- **ENTONCES** el cambio se acepta

### Requirement: Auditoría y evento de los cambios de periodo
Toda creación, activación o recálculo de un periodo DEBE (MUST) escribir auditoría y su registro de transición en la misma transacción de base de datos que el cambio, con el usuario o el proceso como actor; cada activación DEBE (MUST) publicar exactamente un evento de periodo activado y repetir el proceso NO DEBE (MUST NOT) publicarlo otra vez.
Trace: FR-AUDIT-001, FR-AUDIT-009, INV-029, NFR-REL-008 · Priority: Must

#### Scenario: Activación automática auditada
- **CUANDO** el proceso de periodos activa "2026-11" en la ejecución de 2026-11-01T04:05Z
- **ENTONCES** existe una auditoría de la activación con el proceso de periodos como actor, una transición de `draft` a `active` y un único evento de periodo activado con la etiqueta "2026-11" y el rango del 2026-11-01 al 2026-11-30
- **Y** la ejecución siguiente no escribe auditoría ni evento para "2026-11"

#### Scenario: Recálculo auditado
- **CUANDO** el cambio del día de inicio de 1 a 25 recalcula "2026-12"
- **ENTONCES** la auditoría de "2026-12" registra el rango anterior del 2026-12-01 al 2026-12-31 y el nuevo del 2026-12-25 al 2027-01-24

### Requirement: Autorización de comandos de periodos
Pedir la creación anticipada y activar periodos DEBE (MUST) requerir rol EDITOR u OWNER; un VIEWER DEBE (MUST) recibir `INSUFFICIENT_ROLE` y quien no es miembro `WORKSPACE_ACCESS_DENIED`, sin cambios en los periodos.
Trace: FR-PLANNING-001, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta activar
- **CUANDO** un VIEWER intenta activar "2026-11", iniciado y en `draft`
- **ENTONCES** la respuesta es 403 con código `INSUFFICIENT_ROLE` y "2026-11" sigue en `draft`

#### Scenario: No miembro consulta periodos
- **CUANDO** un usuario que no es miembro del workspace lista sus periodos
- **ENTONCES** la respuesta es 403 con código `WORKSPACE_ACCESS_DENIED` sin datos de periodos

### Requirement: Aislamiento de workspace en los periodos
Los periodos DEBEN (MUST) pertenecer a un único workspace; el sistema NO DEBE (MUST NOT) leer ni modificar periodos de otro workspace, y una operación sin contexto de workspace DEBE (MUST) fallar en lugar de devolver resultados vacíos.
Trace: NFR-SEC-003, NFR-SEC-004 · Priority: Must

#### Scenario: Calendarios independientes
- **CUANDO** el workspace W1 tiene día de inicio 1 y el workspace W2 día de inicio 25
- **ENTONCES** "2026-10" de W1 va del 2026-10-01 al 2026-10-31 y "2026-10" de W2 del 2026-10-25 al 2026-11-24, y desde W1 nunca se observan los periodos de W2

#### Scenario: Consulta sin contexto de workspace
- **CUANDO** se consultan los periodos sin haber establecido el workspace de la transacción de base de datos
- **ENTONCES** la consulta falla
