# Spec Delta

## Purpose

Cierra los periodos financieros del workspace: verifica un checklist previo, congela el periodo en el ledger y en un snapshot inmutable y versionado, permite reabrirlo solo al OWNER con motivo y re-cerrarlo con un snapshot nuevo sin alterar el anterior, y ofrece el reporte de cierre consultable, comparable y exportable.

## ADDED Requirements

### Requirement: Checklist previo al cierre
El sistema DEBE (MUST) ofrecer, sin modificar nada, el checklist de cierre de un periodo con, para cada ítem, su conteo, su detalle y su severidad: transacciones `pending` con fecha en el periodo, cuentas sin conciliar a diferencia cero al fin del periodo, duplicados sin resolver del periodo, transacciones del periodo sin categoría y ocurrencias recurrentes sin resolver, este último informado como no disponible mientras no exista el motor de recurrencia.
Trace: FR-PLANNING-003 · Priority: Must

#### Scenario: Checklist de octubre con observaciones
- **CUANDO** el periodo "2026-10" (del 2026-10-01 al 2026-10-31) tiene los gastos `pending` de 120.00 BOB del 2026-10-28 y de 45.00 BOB del 2026-10-30, un candidato a duplicado sin resolver, tres porciones sin categoría por 210.00 BOB y la cuenta "USD Savings" sin conciliar, y existe un gasto `pending` de 60.00 BOB del 2026-11-01
- **ENTONCES** el checklist informa 2 transacciones pendientes por 165.00 BOB, 1 cuenta sin conciliar ("USD Savings"), 1 duplicado sin resolver, 3 porciones sin categoría por 210.00 BOB y las ocurrencias recurrentes como no disponibles
- **Y** consultar el checklist no cambia el estado del periodo ni escribe auditoría

#### Scenario: Checklist sin observaciones
- **CUANDO** el periodo "2026-10" no tiene pendientes, duplicados ni porciones sin categoría y todas sus cuentas están conciliadas a diferencia 0.00
- **ENTONCES** todos los ítems del checklist tienen conteo 0 y el periodo puede cerrarse sin advertencias

### Requirement: Severidad configurable de los ítems del checklist
Cada ítem del checklist DEBE (MUST) ser bloqueante o de advertencia según la política de cierre del workspace, que por defecto marca como bloqueantes las transacciones pendientes y las cuentas sin conciliar y como advertencia los demás; solo el OWNER DEBE (MUST) poder cambiar la política y cada cambio DEBE (MUST) auditarse.
Trace: FR-PLANNING-003 · Priority: Must

#### Scenario: Política por defecto
- **CUANDO** se consulta la política de cierre de un workspace nuevo
- **ENTONCES** transacciones pendientes y cuentas sin conciliar son bloqueantes, y duplicados, porciones sin categoría y ocurrencias recurrentes son advertencias

#### Scenario: OWNER endurece la política
- **CUANDO** el OWNER marca como bloqueante el ítem de porciones sin categoría y el periodo "2026-10" tiene 3 porciones sin categoría por 210.00 BOB
- **ENTONCES** el checklist muestra ese ítem como bloqueante y el cambio de política queda auditado con el valor anterior y el nuevo

#### Scenario: EDITOR intenta cambiar la política
- **CUANDO** un EDITOR intenta marcar como advertencia el ítem de cuentas sin conciliar
- **ENTONCES** la respuesta es 403 con código `INSUFFICIENT_ROLE` y la política no cambia

### Requirement: Cuentas conciliadas a diferencia cero
Una cuenta DEBE (MUST) considerarse conciliada para el cierre solo si tiene una conciliación finalizada con diferencia 0 cuya fecha de extracto es igual o posterior al fin del periodo y no le quedan transacciones posteadas sin conciliar con fecha hasta el fin del periodo; DEBEN (MUST) exigirse todas las cuentas no archivadas con saldo distinto de cero al fin del periodo o con movimientos en él.
Trace: FR-PLANNING-003, FR-TRANSACTIONS-030 · Priority: Must

#### Scenario: Cuentas conciliadas, pendientes y exentas
- **CUANDO** al cerrar "2026-10" "Bank A" tiene una conciliación finalizada al 2026-10-31 con saldo de extracto 5200.00 BOB y diferencia 0.00 BOB, "USD Savings" tiene su última conciliación al 2026-09-30 y "Caja chica" tiene saldo 0.00 BOB sin movimientos en octubre
- **ENTONCES** "Bank A" cuenta como conciliada, "USD Savings" aparece sin conciliar y "Caja chica" no se exige

#### Scenario: Gasto retroactivo después de conciliar
- **CUANDO** después de conciliar "Bank A" al 2026-10-31 se registra en "Bank A" un gasto posteado de 50.00 BOB con fecha 2026-10-15
- **ENTONCES** "Bank A" vuelve a aparecer sin conciliar en el checklist de "2026-10"

### Requirement: Cierre impedido por ítems bloqueantes
El sistema DEBE (MUST) rechazar el cierre de un periodo con algún ítem bloqueante con conteo mayor que cero con `MONTH_CLOSING_BLOCKED`, informando los ítems que lo impiden, sin cambiar el estado, sin bloquear el ledger y sin generar snapshot.
Trace: FR-PLANNING-003 · Priority: Must

#### Scenario: Cierre con pendientes
- **CUANDO** el EDITOR intenta cerrar "2026-10" con 2 transacciones pendientes por 165.00 BOB y la política por defecto
- **ENTONCES** se rechaza con `MONTH_CLOSING_BLOCKED` indicando el ítem de transacciones pendientes
- **Y** "2026-10" sigue `active`, no existe snapshot y un gasto de 30.00 BOB con fecha 2026-10-20 todavía se acepta

### Requirement: Advertencias reconocidas explícitamente
Si el checklist solo tiene advertencias con conteo mayor que cero, el cierre DEBE (MUST) exigir el reconocimiento explícito de esas advertencias y rechazarse sin él con `MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED`; con el reconocimiento, el snapshot DEBE (MUST) registrar las advertencias reconocidas, su conteo y quién las reconoció.
Trace: FR-PLANNING-003, FR-PLANNING-004 · Priority: Must

#### Scenario: Advertencias sin reconocer
- **CUANDO** el EDITOR cierra "2026-10" sin reconocer advertencias y el checklist tiene 3 porciones sin categoría por 210.00 BOB como advertencia
- **ENTONCES** se rechaza con `MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED` y el periodo sigue `active`

#### Scenario: Advertencias reconocidas
- **CUANDO** el EDITOR repite el cierre reconociendo las advertencias
- **ENTONCES** "2026-10" queda `closed` y su snapshot registra la advertencia de 3 porciones sin categoría por 210.00 BOB reconocida por ese EDITOR

### Requirement: Cierre en orden cronológico
El sistema DEBE (MUST) rechazar con `PERIOD_PREVIOUS_NOT_CLOSED` el cierre de un periodo cuando el periodo inmediatamente anterior existe y no está `closed`; el primer periodo del workspace DEBE (MUST) poder cerrarse sin periodo anterior.
Trace: FR-PLANNING-001, FR-PLANNING-004 · Priority: Must

#### Scenario: Cerrar noviembre con octubre abierto
- **CUANDO** "2026-10" está `active` pendiente de cierre y el EDITOR intenta cerrar "2026-11", ya terminado y sin observaciones
- **ENTONCES** se rechaza con `PERIOD_PREVIOUS_NOT_CLOSED` y "2026-11" sigue `active`

#### Scenario: Primer periodo del workspace
- **CUANDO** "2026-07" es el primer periodo del workspace, ya terminó y no tiene observaciones
- **ENTONCES** el EDITOR puede cerrarlo

### Requirement: Cierre solo de periodos terminados en la zona horaria del workspace
El sistema DEBE (MUST) rechazar con `PERIOD_NOT_ENDED` el cierre de un periodo cuya fecha de fin no es anterior a la fecha de hoy calculada en la zona horaria del workspace, y DEBE (MUST) rechazar con `INVALID_STATUS_TRANSITION` el cierre de un periodo `draft` o `closed`.
Trace: FR-PLANNING-001, NFR-USAB-004 · Priority: Must

#### Scenario: Último día del mes por la noche en La Paz
- **CUANDO** el EDITOR intenta cerrar "2026-10" en el instante 2026-11-01T03:30Z (2026-10-31 23:30 en La Paz)
- **ENTONCES** se rechaza con `PERIOD_NOT_ENDED`

#### Scenario: Primer minuto del mes siguiente en La Paz
- **CUANDO** el EDITOR cierra "2026-10" sin observaciones en el instante 2026-11-01T04:10Z (2026-11-01 00:10 en La Paz)
- **ENTONCES** el cierre se acepta

### Requirement: Cierre atómico del periodo
El cierre DEBE (MUST) cambiar el estado del periodo a `closed`, bloquear su rango en el ledger, generar el snapshot, escribir la auditoría, registrar la transición del recorrido y publicar el evento de mes cerrado en una única transacción de base de datos; si cualquiera de esos pasos falla, nada DEBE (MUST) persistir.
Trace: FR-PLANNING-004, FR-PLANNING-005, INV-015, INV-029 · Priority: Must

#### Scenario: Cierre exitoso
- **CUANDO** el EDITOR cierra "2026-10" sin observaciones
- **ENTONCES** existen juntos el periodo `closed` con un cierre, el bloqueo del 2026-10-01 al 2026-10-31, el snapshot versión 1, la auditoría del cierre, la transición de `active` a `closed` y un evento de mes cerrado

#### Scenario: Falla al escribir el snapshot
- **CUANDO** la escritura del snapshot de "2026-10" falla durante el cierre
- **ENTONCES** "2026-10" sigue `active`, sin bloqueo, sin auditoría ni evento de cierre
- **Y** un gasto de 30.00 BOB con fecha 2026-10-20 todavía se acepta

### Requirement: Bloqueo del ledger en periodos cerrados
Mientras un periodo esté `closed`, el sistema DEBE (MUST) rechazar con `PERIOD_CLOSED` todo registro, revisión o anulación sin corrección en el periodo actual con fecha dentro de su rango (las demás ediciones siguen el alcance de la edición en periodos cerrados), y todo asiento con fecha anterior al inicio del primer periodo cerrado; un cierre concurrente con un posteo NO DEBE (MUST NOT) dejar un asiento del periodo fuera de su snapshot.
Trace: FR-PLANNING-005, FR-LEDGER-011, INV-015 · Priority: Must

#### Scenario: Operaciones sobre un mes cerrado
- **CUANDO** "2026-10" está `closed` y se intenta registrar un gasto de 45.00 BOB con fecha 2026-10-15, cambiar el monto de un gasto del 2026-10-10 de 80.00 BOB a 85.00 BOB y recategorizar un gasto del 2026-10-05
- **ENTONCES** cada operación se rechaza con `PERIOD_CLOSED` y los saldos al 2026-10-31 no cambian
- **Y** un gasto de 45.00 BOB con fecha 2026-11-01 se acepta

#### Scenario: Anulación corregida en el periodo actual
- **CUANDO** "2026-10" está `closed` y el EDITOR anula un gasto de 80.00 BOB del 2026-10-10 pidiendo corregir en el periodo actual, con "2026-11" abierto
- **ENTONCES** la reversa se registra con fecha 2026-11-01 y el saldo al 2026-10-31 no cambia

#### Scenario: Cierre concurrente con un posteo
- **CUANDO** un gasto de 30.00 BOB con fecha 2026-10-31 se postea al mismo tiempo que el EDITOR cierra "2026-10"
- **ENTONCES** o el gasto queda registrado y el snapshot de "2026-10" lo incluye, o el gasto se rechaza con `PERIOD_CLOSED`
- **Y** nunca existe un asiento con fecha en "2026-10" que no esté reflejado en el snapshot vigente

#### Scenario: Fechas anteriores al primer periodo cerrado
- **CUANDO** el primer periodo del workspace, "2026-07" (del 2026-07-01 al 2026-07-31), está `closed` y se intenta registrar un saldo inicial de 1000.00 BOB con fecha 2026-06-15
- **ENTONCES** se rechaza con `PERIOD_CLOSED` y no se crea ningún periodo anterior a "2026-07"

### Requirement: Alcance de la edición en periodos cerrados
Mientras un periodo esté `closed`, el sistema DEBE (MUST) rechazar con `PERIOD_CLOSED`, sin cambios ni auditoría, toda edición individual, masiva o desde una conciliación de una transacción con fecha de negocio en su rango que cambie categoría, tags, contraparte, custom fields o el estado de confirmación o conciliación; cambiar notas, descripción, adjuntos o medio de pago DEBE (MUST) permitirse con auditoría, sin alterar saldos ni snapshot.
Trace: FR-PLANNING-005, FR-TRANSACTIONS-033, FR-CLASSIFICATION-009, INV-015 · Priority: Must

#### Scenario: Clasificación de un gasto de un mes cerrado
- **CUANDO** "2026-10" está `closed` y el EDITOR intenta agregar el tag "viaje", cambiar la contraparte o desmarcar como confirmado un gasto de 80.00 BOB del 2026-10-10
- **ENTONCES** cada edición se rechaza con `PERIOD_CLOSED` y el gasto conserva sus tags, su contraparte y su estado

#### Scenario: Ediciones descriptivas en un mes cerrado
- **CUANDO** "2026-10" está `closed` y el EDITOR cambia las notas y la descripción del mismo gasto de 80.00 BOB
- **ENTONCES** el cambio se acepta y queda auditado
- **Y** el saldo al 2026-10-31 y el snapshot vigente de "2026-10" no cambian

### Requirement: Contenido del snapshot de cierre
El snapshot de cierre DEBE (MUST) registrar al fin del periodo los saldos por cuenta y moneda, el patrimonio neto en la moneda base con cada tasa usada y si está completo, los ingresos, gastos, ahorro y tasa de ahorro por moneda y consolidados en la moneda base con la tasa de cada transacción, el presupuesto contra lo real por línea del plan cuando exista plan, los aportes a metas cuando existan y el resultado del checklist.
Trace: FR-PLANNING-004, INV-022, INV-031 · Priority: Must

#### Scenario: Snapshot de octubre de 2026
- **CUANDO** se cierra "2026-10" con saldos al 2026-10-31 de 5200.00 BOB en "Bank A", 1500.00 USD en "USD Savings", 800.000000 USDT en "Binance USDT" y una deuda de 350.00 BOB en "Visa BOB", tasas `PARALLEL` al 2026-10-31 de 12.05 BOB por USD y 12.02 BOB por USDT, ingresos de 12000.00 BOB y gastos de 8210.50 BOB y 20.00 USD (registrado con tasa 12.00, 240.00 BOB)
- **ENTONCES** el snapshot registra esos cuatro saldos, patrimonio neto de 32541.00 BOB completo con las tasas 12.05 y 12.02 y su fuente
- **Y** registra ingresos de 12000.00 BOB, gastos de 8210.50 BOB y 20.00 USD, gastos consolidados de 8450.50 BOB, ahorro de 3549.50 BOB y tasa de ahorro de 29.6 %

#### Scenario: Patrimonio incompleto por falta de tasa
- **CUANDO** al cierre no existe ninguna tasa utilizable para USDT/BOB a la fecha 2026-10-31
- **ENTONCES** el snapshot registra el patrimonio neto como incompleto y lista 800.000000 USDT como monto sin convertir

#### Scenario: Sin plan ni metas
- **CUANDO** "2026-10" no tiene plan mensual y el workspace no tiene metas
- **ENTONCES** el snapshot registra el presupuesto contra lo real y los aportes a metas como no disponibles, sin montos inventados

### Requirement: Snapshot de cierre inmutable
Un snapshot de cierre registrado NO DEBE (MUST NOT) modificarse ni eliminarse por ninguna vía de la aplicación, y la base de datos DEBE (MUST) rechazar toda actualización o eliminación de snapshots con el rol de aplicación.
Trace: FR-PLANNING-004, NFR-DATA-006 · Priority: Must

#### Scenario: Intento de modificar un snapshot en la base de datos
- **CUANDO** con el rol de aplicación se intenta cambiar el saldo de "Bank A" en el snapshot 1 de "2026-10" de 5200.00 BOB a 5000.00 BOB, o eliminar ese snapshot
- **ENTONCES** la base de datos rechaza ambas sentencias y el snapshot sigue registrando 5200.00 BOB

### Requirement: Reapertura auditada solo por el OWNER
Solo el OWNER DEBE (MUST) poder reabrir un periodo `closed`, indicando un motivo de 1 a 500 caracteres; la reapertura DEBE (MUST) pasar el periodo a `reopened`, quitar el bloqueo del ledger de su rango, auditar el motivo, registrar la transición y publicar el evento de periodo reabierto en una sola transacción, sin modificar ningún snapshot.
Trace: FR-PLANNING-006, INV-015, INV-029 · Priority: Must

#### Scenario: OWNER reabre octubre
- **CUANDO** el OWNER reabre "2026-10" con el motivo "Faltó registrar la comisión bancaria"
- **ENTONCES** "2026-10" queda `reopened` con una reapertura, un gasto de 15.00 BOB con fecha 2026-10-31 se acepta y la auditoría registra el motivo
- **Y** el snapshot 1 sigue registrando 5200.00 BOB en "Bank A"

#### Scenario: EDITOR intenta reabrir
- **CUANDO** un EDITOR intenta reabrir "2026-10" con un motivo
- **ENTONCES** la respuesta es 403 con código `INSUFFICIENT_ROLE` y el periodo sigue `closed`

#### Scenario: Reapertura sin motivo
- **CUANDO** el OWNER intenta reabrir "2026-10" con un motivo vacío
- **ENTONCES** la respuesta es 400 con código `VALIDATION_FAILED` y el periodo sigue `closed`

### Requirement: Reapertura en orden inverso
El sistema DEBE (MUST) rechazar con `PERIOD_NEXT_CLOSED` la reapertura de un periodo cuando el periodo inmediatamente siguiente está `closed`, sin reabrir periodos en cascada.
Trace: FR-PLANNING-006 · Priority: Must

#### Scenario: Reabrir octubre con noviembre cerrado
- **CUANDO** "2026-10" y "2026-11" están `closed` y el OWNER intenta reabrir "2026-10"
- **ENTONCES** se rechaza con `PERIOD_NEXT_CLOSED` y ambos periodos siguen `closed`
- **Y** el OWNER puede reabrir primero "2026-11" y después "2026-10"

### Requirement: Re-cierre con nuevo snapshot versionado
Cerrar de nuevo un periodo `reopened` DEBE (MUST) cumplir las mismas reglas que el primer cierre y generar un snapshot con el número de versión siguiente que referencia al anterior, conservando intactos todos los snapshots previos.
Trace: FR-PLANNING-006, FR-PLANNING-004, NFR-DATA-006 · Priority: Must

#### Scenario: Re-cierre con la comisión agregada
- **CUANDO** tras reabrir "2026-10" se registra una comisión de 15.00 BOB con fecha 2026-10-31 en "Bank A", se concilia "Bank A" a 5185.00 BOB con diferencia 0.00 BOB y el EDITOR cierra de nuevo
- **ENTONCES** se genera el snapshot 2 con "Bank A" en 5185.00 BOB y gastos consolidados de 8465.50 BOB, que referencia al snapshot 1
- **Y** el snapshot 1 sigue registrando 5200.00 BOB y 8450.50 BOB, y el periodo tiene dos cierres y una reapertura

### Requirement: Comparación entre versiones del snapshot
Todo miembro del workspace DEBE (MUST) poder comparar dos versiones del snapshot de un periodo y obtener las diferencias de saldos por cuenta, de totales y del patrimonio neto.
Trace: FR-PLANNING-006, FR-PLANNING-004 · Priority: Should

#### Scenario: Diferencias entre el snapshot 1 y el 2 de octubre
- **CUANDO** se comparan los snapshots 1 y 2 de "2026-10"
- **ENTONCES** las diferencias son −15.00 BOB en "Bank A", +15.00 BOB en gastos consolidados, −15.00 BOB en ahorro y −15.00 BOB en patrimonio neto

### Requirement: Reporte de cierre consultable
Todo miembro del workspace, incluido VIEWER, DEBE (MUST) poder consultar el reporte de cierre de un periodo con su snapshot vigente o con una versión indicada, incluyendo quién y cuándo cerró y los KPIs del periodo; consultar un periodo nunca cerrado DEBE (MUST) responder 404 con `REFERENCE_NOT_FOUND`.
Trace: FR-PLANNING-004 · Priority: Must

#### Scenario: Reporte vigente tras el re-cierre
- **CUANDO** un VIEWER consulta el reporte de cierre de "2026-10" sin indicar versión
- **ENTONCES** obtiene el snapshot 2 con "Bank A" en 5185.00 BOB, ahorro de 3534.50 BOB y la lista de versiones 1 y 2

#### Scenario: Periodo nunca cerrado
- **CUANDO** se consulta el reporte de cierre de "2026-12", en `draft`
- **ENTONCES** la respuesta es 404 con código `REFERENCE_NOT_FOUND`

### Requirement: Variaciones respecto al periodo anterior
El reporte de cierre DEBE (MUST) mostrar la variación absoluta y porcentual de ingresos, gastos, ahorro, tasa de ahorro y patrimonio neto respecto al snapshot vigente del periodo inmediatamente anterior, y DEBE (MUST) indicar que no hay comparación cuando el periodo anterior no tiene snapshot.
Trace: FR-PLANNING-007 · Priority: Should

#### Scenario: Octubre contra septiembre
- **CUANDO** el snapshot vigente de "2026-09" registra gastos consolidados de 7900.00 BOB y el de "2026-10" 8450.50 BOB
- **ENTONCES** el reporte de "2026-10" muestra una variación de gastos de +550.50 BOB (+7.0 %)

#### Scenario: Primer periodo cerrado
- **CUANDO** se consulta el reporte de cierre de "2026-07", primer periodo del workspace
- **ENTONCES** el reporte indica que no hay periodo anterior para comparar, sin variaciones

### Requirement: Exportación del reporte de cierre
Todo miembro que puede ver el reporte de cierre DEBE (MUST) poder exportar cualquier versión en CSV y en PDF, con los montos como decimales a la escala de su moneda acompañados del código de moneda, el número de versión y la fecha de cierre.
Trace: FR-PLANNING-004 · Priority: Must

#### Scenario: Exportar el snapshot 1 de octubre en CSV
- **CUANDO** un VIEWER exporta en CSV el snapshot 1 de "2026-10"
- **ENTONCES** el archivo contiene la fila de "Bank A" con 5200.00 y BOB, la de "Binance USDT" con 800.000000 y USDT, el número de versión 1 y la fecha de cierre

#### Scenario: Exportar en PDF
- **CUANDO** el OWNER exporta en PDF el snapshot 2 de "2026-10"
- **ENTONCES** obtiene un PDF con los KPIs, los saldos por cuenta y la indicación de que existe una versión anterior

### Requirement: Eventos de cierre y reapertura
Cada cierre aceptado DEBE (MUST) publicar exactamente un evento de mes cerrado con el periodo, su rango, el número de versión del snapshot y sus totales, y cada reapertura exactamente un evento de periodo reabierto con el número de reapertura y el motivo; un cierre o una reapertura rechazados NO DEBEN (MUST NOT) publicar eventos.
Trace: FR-PLANNING-004, FR-PLANNING-006, NFR-REL-008 · Priority: Must

#### Scenario: Eventos del ciclo de octubre
- **CUANDO** "2026-10" se cierra, se reabre con el motivo "Faltó registrar la comisión bancaria" y se cierra de nuevo
- **ENTONCES** se publican en orden un evento de mes cerrado con versión 1, uno de periodo reabierto con reapertura 1 y ese motivo, y uno de mes cerrado con versión 2, con montos como texto decimal y su moneda

#### Scenario: Cierre rechazado sin evento
- **CUANDO** un cierre de "2026-10" se rechaza con `MONTH_CLOSING_BLOCKED`
- **ENTONCES** no se publica ningún evento de mes cerrado

### Requirement: Aviso de cierre pendiente
Cuando un periodo `active` o `reopened` siga sin cerrar 3 días (plazo configurable) después de su fecha de fin, contados en la zona horaria del workspace, el sistema DEBE (MUST) publicar exactamente un hecho de cierre pendiente para ese periodo en toda su vida, aun con reintentos o ejecuciones concurrentes; un periodo cerrado antes del plazo NO DEBE (MUST NOT) generarlo.
Trace: FR-PLANNING-003, FR-NOTIFY-004 · Priority: Must

#### Scenario: Octubre sin cerrar tres días después
- **CUANDO** "2026-10" (del 2026-10-01 al 2026-10-31) sigue `active` y hoy pasa a ser 2026-11-03 en La Paz
- **ENTONCES** se publica un hecho de cierre pendiente de "2026-10" con su fecha de fin
- **Y** las ejecuciones siguientes, aunque "2026-10" siga sin cerrar o se reabra después, no publican otro

#### Scenario: Cerrado antes del plazo
- **CUANDO** "2026-10" se cierra el 2026-11-02 y hoy pasa a ser 2026-11-03 en La Paz
- **ENTONCES** no se publica ningún hecho de cierre pendiente de "2026-10"

### Requirement: Autorización del cierre
Cerrar un periodo DEBE (MUST) requerir rol EDITOR u OWNER y consultar el checklist, los snapshots y el reporte DEBE (MUST) permitirse a todo miembro; un VIEWER que intenta cerrar DEBE (MUST) recibir `INSUFFICIENT_ROLE` sin cambios.
Trace: FR-PLANNING-003, FR-PLANNING-004, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta cerrar
- **CUANDO** un VIEWER intenta cerrar "2026-10", terminado y sin observaciones
- **ENTONCES** la respuesta es 403 con código `INSUFFICIENT_ROLE` y "2026-10" sigue `active`
- **Y** el mismo VIEWER puede consultar el checklist de "2026-10"

### Requirement: Cierre de un mes real con todas las cuentas conciliadas
El sistema DEBE (MUST) permitir cerrar un periodo cuyas cuentas exigibles están todas conciliadas a diferencia cero y sin ítems bloqueantes, y el snapshot DEBE (MUST) registrar para cada cuenta su saldo al fin del periodo junto con la conciliación que lo respalda, de modo que cada saldo coincida con el saldo de extracto conciliado.
Trace: FR-PLANNING-003, FR-PLANNING-004, FR-TRANSACTIONS-030 · Priority: Must

#### Scenario: Cierre de octubre con cuatro cuentas conciliadas
- **CUANDO** el owner concilia al 2026-10-31 "Bank A" en 5200.00 BOB, "USD Savings" en 1500.00 USD, "Binance USDT" en 800.000000 USDT y "Visa BOB" en una deuda de 350.00 BOB, todas con diferencia 0.00, no hay pendientes y cierra "2026-10"
- **ENTONCES** "2026-10" queda `closed` con el snapshot 1
- **Y** cada saldo del snapshot es igual al saldo de extracto de su conciliación y referencia esa conciliación
