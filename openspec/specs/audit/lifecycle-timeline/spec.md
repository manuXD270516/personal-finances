# audit/lifecycle-timeline Specification

## Purpose
Hace que el ciclo de vida de cada elemento con estados (transacciones —incluidas transferencias y conversiones—, cuentas, tasas de cambio, categorías y contrapartes) sea un flujo trazable de transiciones explícitas y no una serie de actualizaciones sueltas: cada agregado declara su máquina de estados, cada transición queda registrada con actor, instante, motivo, revisión y asientos del ledger, y el usuario puede recorrer el camino completo que tomó un elemento en el tiempo, por API, en un reporte visual tipo máquina de estados y exportado en CSV o PDF (docs/31 D37, D52).

## Requirements

### Requirement: Máquina de estados declarada por agregado
Cada tipo de agregado con ciclo de vida (transacción, cuenta, tasa de cambio, categoría y contraparte) DEBE (MUST) tener una máquina de estados declarada con sus estados, sus estados terminales y sus transiciones permitidas, cada una con su estado de origen, su estado de destino, su guarda y el evento que publica, si lo hay; toda transición no declarada DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION` y el sistema DEBE (MUST) exponer la definición vigente de cada máquina.
Trace: FR-AUDIT-009, FR-TRANSACTIONS-006, FR-ACCOUNTS-007 · Priority: Must

#### Scenario: Definición de la máquina de una transacción
- **CUANDO** el usuario consulta la definición de la máquina de estados de las transacciones
- **ENTONCES** obtiene los estados `pending`, `posted`, `cleared`, `reconciled` y `void`, con `void` como terminal
- **Y** cada transición declarada (registrar, postear, marcar cleared, desmarcar cleared, reconciliar, des-reconciliar, revisar y anular) indica origen, destino, guarda y evento

#### Scenario: Transición no declarada
- **CUANDO** el usuario intenta reconciliar un gasto `pending` de 80.00 BOB
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y no se registra ninguna transición

#### Scenario: Definición de la máquina de una categoría y de una contraparte
- **CUANDO** el usuario consulta la definición de la máquina de estados de las categorías y la de las contrapartes
- **ENTONCES** cada una tiene los estados `ACTIVE` y `ARCHIVED`, ninguno terminal, y las transiciones crear (a `ACTIVE`), archivar (`ACTIVE` a `ARCHIVED`) y desarchivar (`ARCHIVED` a `ACTIVE`) con su guarda
- **Y** archivar una categoría publica el evento de categoría archivada, y ninguna de las dos declara una transición de fusión

### Requirement: Registro de transición atómico con el cambio
Toda transición de estado de un agregado, incluida su creación, DEBE (MUST) registrarse como un registro de transición inmutable en la misma transacción de base de datos que el cambio, su auditoría y sus eventos; si cualquiera de ellos falla, nada DEBE (MUST) persistir.
Trace: FR-AUDIT-009, FR-AUDIT-001, INV-029 · Priority: Must

#### Scenario: Posteo con su transición
- **CUANDO** el usuario postea un gasto pendiente de 75.00 BOB en "Bank A" (saldo 1000.00 BOB)
- **ENTONCES** existen juntos el asiento, el registro de auditoría, el evento de transacción posteada y un registro de transición de `pending` a `posted` que referencia ese asiento
- **Y** si la escritura del registro de transición falla, la transacción sigue `pending`, sin asiento, y el saldo sigue en 1000.00 BOB

#### Scenario: Registro de transición inmutable
- **CUANDO** un proceso intenta modificar o borrar un registro de transición de un workspace real
- **ENTONCES** la base de datos lo rechaza y el registro queda igual

### Requirement: Edición financiera como transición de revisión
La edición financiera de una transacción posteada o cleared DEBE (MUST) registrarse como una transición explícita de revisión (reversa del asiento activo más asiento nuevo) que indica la revisión anterior y la nueva, el asiento revertido, el asiento de reversa y el asiento nuevo, en lugar de una simple actualización del registro.
Trace: FR-AUDIT-009, FR-TRANSACTIONS-008, FR-LEDGER-005, INV-007, INV-008 · Priority: Must

#### Scenario: Corregir el monto de un gasto
- **CUANDO** el usuario cambia de 120.00 BOB a 102.00 BOB un gasto posteado en revisión 1 en "Bank A" (saldo 1000.00 BOB antes del gasto)
- **ENTONCES** se registra la transición "revisar" de `posted` a `posted` de la revisión 1 a la 2, con el asiento original, su reversa y el asiento nuevo de 102.00 BOB
- **Y** el saldo de "Bank A" es 898.00 BOB

### Requirement: Cambios descriptivos como anotaciones del recorrido
Las ediciones que no cambian el estado ni el ledger (descripción, notas, contraparte, tags, categoría, metadatos de cuenta) DEBEN (MUST) aparecer en el recorrido como anotaciones con actor, instante y campos cambiados, sin registrarse como transiciones de estado.
Trace: FR-AUDIT-010, FR-TRANSACTIONS-008, INV-033 · Priority: Should

#### Scenario: Recategorizar un gasto posteado
- **CUANDO** el usuario cambia la categoría de un gasto posteado de 150.00 BOB
- **ENTONCES** el recorrido muestra una anotación con el campo categoría cambiado
- **Y** el número de transiciones y de asientos no cambia

### Requirement: Consulta del recorrido de un elemento
El sistema DEBE (MUST) permitir consultar el recorrido de una transacción, una cuenta o una tasa: su estado actual, la secuencia de estados visitados y la lista ordenada de transiciones, cada una con secuencia, transición, estado de origen y de destino, instante, actor, origen, motivo, revisión y versión, asientos del ledger involucrados y evento publicado, junto con la definición de su máquina de estados.
Trace: FR-AUDIT-010, FR-AUDIT-004 · Priority: Must

#### Scenario: Recorrido completo de un gasto
- **CUANDO** el usuario registra un gasto pendiente de 80.00 BOB, lo postea, lo marca cleared, corrige su monto a 85.00 BOB y luego lo anula con motivo "duplicado", y consulta su recorrido
- **ENTONCES** obtiene cinco transiciones en orden: registrar (a `pending`), postear (`pending` a `posted`), marcar cleared (`posted` a `cleared`), revisar (`cleared` a `posted`, revisión 1 a 2) y anular (`posted` a `void`, motivo "duplicado")
- **Y** el estado actual es `void`, la secuencia de estados visitados es `pending`, `posted`, `cleared`, `posted`, `void` y cada transición indica su actor e instante

### Requirement: Recorrido visible para quien puede ver el elemento
Todo miembro que pueda ver un elemento, incluido un VIEWER, DEBE (MUST) poder consultar su recorrido; un usuario de otro workspace DEBE (MUST) recibir la misma respuesta que para un elemento inexistente.
Trace: FR-AUDIT-010, FR-AUDIT-004, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER consulta el recorrido
- **CUANDO** un usuario VIEWER de "W1" consulta el recorrido de un gasto de 120.00 BOB que un EDITOR corrigió a 102.00 BOB
- **ENTONCES** obtiene el recorrido con la transición de revisión, su actor e instante

#### Scenario: Usuario de otro workspace
- **CUANDO** un usuario de "W2" consulta el recorrido de un gasto de "W1"
- **ENTONCES** recibe la respuesta de recurso inexistente y no se revela ningún dato de "W1"

### Requirement: Recorrido de una transferencia
El recorrido de una transferencia DEBE (MUST) mostrar sus transiciones con las cuentas de origen y destino, el monto y la comisión de cada revisión, y el evento específico de transferencia publicado en cada una: transferencia completada en el primer posteo y transferencia revisada en cada edición financiera.
Trace: FR-AUDIT-010, FR-TRANSACTIONS-018, FR-TRANSACTIONS-036, INV-009 · Priority: Must

#### Scenario: Transferencia corregida
- **CUANDO** el usuario transfiere 300.00 BOB de "A" (saldo 1000.00 BOB) a "B" (saldo 0.00 BOB) y luego corrige el monto a 250.00 BOB
- **ENTONCES** el recorrido muestra la transición registrar (a `posted`, revisión 1, 300.00 BOB, evento de transferencia completada) y la transición revisar (`posted` a `posted`, revisión 1 a 2, 250.00 BOB, evento de transferencia revisada)
- **Y** los saldos son "A" 750.00 BOB y "B" 250.00 BOB

### Requirement: Recorrido de una conversión
El recorrido de una conversión DEBE (MUST) enlazar cada revisión con su detalle de conversión (montos enviado y recibido, tasa efectiva y fees) y sus asientos, de modo que el detalle anterior siga consultable desde la transición que lo reemplazó.
Trace: FR-AUDIT-010, FR-TRANSACTIONS-024, INV-011 · Priority: Must

#### Scenario: Conversión corregida
- **CUANDO** el usuario registra la conversión de 100.000000 USDT a 685.00 BOB con fee 5.00 BOB y luego corrige el monto recibido a 686.00 BOB
- **ENTONCES** el recorrido muestra la revisión 1 enlazada al detalle con 685.00 BOB y efectiva 6.85, y la transición revisar a la revisión 2 enlazada al detalle con 686.00 BOB y efectiva 6.86
- **Y** ambas transiciones enlazan sus asientos, incluida la reversa del asiento de la revisión 1

### Requirement: Recorrido de una cuenta
El recorrido de una cuenta DEBE (MUST) mostrar sus transiciones de apertura, cierre, archivo y reactivación con actor, instante, motivo y, en la apertura, el asiento del saldo inicial.
Trace: FR-AUDIT-010, FR-ACCOUNTS-007, FR-ACCOUNTS-004 · Priority: Must

#### Scenario: Cuenta abierta, archivada, reactivada y cerrada
- **CUANDO** "Bank C" se abre con saldo inicial 500.00 BOB, se archiva con motivo "sin uso", se reactiva, se transfiere su saldo y se cierra con fecha 2026-03-31
- **ENTONCES** el recorrido muestra en orden: abrir (a `ACTIVE`, con el asiento de 500.00 BOB), archivar (`ACTIVE` a `ARCHIVED`, motivo "sin uso"), reactivar (`ARCHIVED` a `ACTIVE`) y cerrar (`ACTIVE` a `CLOSED`, saldo 0.00 BOB)
- **Y** el estado actual es `CLOSED`

### Requirement: Recorrido de una tasa de cambio
El recorrido de una tasa de cambio manual DEBE (MUST) mostrar su registro y, si fue corregida, su reemplazo enlazado a la tasa que la reemplazó, sin modificar la tasa original.
Trace: FR-AUDIT-010, FR-FX-002, FR-FX-003, INV-011 · Priority: Should

#### Scenario: Tasa corregida por reemplazo
- **CUANDO** el usuario registra la tasa USDT/BOB `P2P` 6.95 del 2026-03-15 y luego la corrige a 6.96
- **ENTONCES** el recorrido de la tasa 6.95 muestra registrar (a `RECORDED`) y reemplazar (`RECORDED` a `SUPERSEDED`) enlazada a la tasa 6.96
- **Y** la tasa 6.95 sigue consultable con su valor original

### Requirement: Recorrido de una categoría
El recorrido de una categoría DEBE (MUST) mostrar sus transiciones de creación (alta del usuario, catálogo inicial o categoría de sistema), archivo y desarchivo con actor, instante y origen; los cambios de nombre, icono, color, orden y grupo DEBEN (MUST) aparecer como anotaciones. Archivar una categoría DEBE (MUST) registrar en la misma operación una transición de archivo en cada subcategoría activa que archiva, y una operación rechazada NO DEBE (MUST NOT) registrar ninguna transición.
Trace: FR-AUDIT-009, FR-AUDIT-010, FR-CLASSIFICATION-002, FR-CLASSIFICATION-003 · Priority: Must

#### Scenario: Categoría renombrada, archivada y desarchivada
- **CUANDO** el usuario crea la categoría de gasto "Super", la renombra a "Supermercado", la archiva, la desarchiva y consulta su recorrido
- **ENTONCES** obtiene tres transiciones en orden: crear (a `ACTIVE`), archivar (`ACTIVE` a `ARCHIVED`) y desarchivar (`ARCHIVED` a `ACTIVE`), más una anotación con el campo nombre cambiado entre crear y archivar
- **Y** el estado actual es `ACTIVE` y la secuencia de estados visitados es `ACTIVE`, `ARCHIVED`, `ACTIVE`

#### Scenario: Archivar una categoría con subcategorías
- **CUANDO** el usuario archiva "Servicios básicos", que tiene las subcategorías activas "Luz" y "Agua"
- **ENTONCES** los recorridos de "Servicios básicos", "Luz" y "Agua" muestran cada uno la transición archivar (`ACTIVE` a `ARCHIVED`) con el mismo actor, instante y correlación

#### Scenario: Archivar una categoría de sistema
- **CUANDO** el usuario intenta archivar la categoría de sistema "Comisiones"
- **ENTONCES** se rechaza con `SYSTEM_CATEGORY_IMMUTABLE`
- **Y** el recorrido de "Comisiones" sigue con una sola transición, crear (a `ACTIVE`) con origen sistema, y estado actual `ACTIVE`

### Requirement: Recorrido de una contraparte
El recorrido de una contraparte DEBE (MUST) mostrar sus transiciones de creación (incluida la creación en línea al registrar una transacción), archivo y desarchivo con actor, instante y origen; los cambios de nombre, tipo, alias, icono, notas y categoría por defecto DEBEN (MUST) aparecer como anotaciones, y ninguna de ellas DEBE (MUST) modificar las transacciones que la referencian ni el ledger.
Trace: FR-AUDIT-009, FR-AUDIT-010, FR-CLASSIFICATION-010, FR-CLASSIFICATION-012 · Priority: Must

#### Scenario: Contraparte creada en línea, archivada y desarchivada
- **CUANDO** el usuario registra un gasto de 120.00 BOB creando en línea la contraparte "Entel", le agrega el alias "ENTEL S.A.", la archiva, la desarchiva y consulta su recorrido
- **ENTONCES** obtiene tres transiciones en orden: crear (a `ACTIVE`), archivar (`ACTIVE` a `ARCHIVED`) y desarchivar (`ARCHIVED` a `ACTIVE`), más una anotación con el campo alias cambiado
- **Y** el gasto sigue en 120.00 BOB con el mismo asiento

### Requirement: Exportación del recorrido en CSV
Todo miembro que pueda ver el recorrido de un elemento (transacción, cuenta, tasa de cambio, categoría o contraparte), incluido un VIEWER, DEBE (MUST) poder descargarlo en CSV: una fila por transición o anotación en el orden del recorrido, con secuencia, tipo, transición, estado de origen y de destino, instante en la zona horaria del workspace con su desfase, actor, origen, motivo, revisiones, asientos, eventos y marca de derivada. Los montos DEBEN (MUST) escribirse como texto decimal exacto con su moneda, todo texto que empiece con `=`, `+`, `-` o `@` DEBE (MUST) neutralizarse y exportar NO DEBE (MUST NOT) modificar el recorrido. Un usuario de otro workspace DEBE (MUST) recibir la misma respuesta que para un elemento inexistente.
Trace: FR-AUDIT-013, FR-AUDIT-010, NFR-SEC-003 · Priority: Must

#### Scenario: Exportar a CSV el recorrido de un gasto
- **CUANDO** el usuario exporta a CSV el recorrido de un gasto de 80.00 BOB registrado pendiente, posteado, marcado cleared, corregido a 85.00 BOB y anulado con motivo "duplicado", en un workspace con zona horaria America/La_Paz
- **ENTONCES** el archivo tiene una fila de encabezado y cinco filas en el orden del recorrido: registrar, postear, marcar cleared, revisar (revisión 1 a 2, 85.00 BOB) y anular (motivo "duplicado")
- **Y** cada instante está en la hora de La Paz con desfase -04:00 y cada monto como texto decimal exacto con su moneda

#### Scenario: Motivo que parece una fórmula
- **CUANDO** el usuario anula un gasto de 40.00 BOB con motivo "=SUM(A1:A9)" y exporta su recorrido a CSV
- **ENTONCES** la celda del motivo contiene el texto neutralizado "'=SUM(A1:A9)" y no se interpreta como fórmula

#### Scenario: Exportación por un VIEWER y desde otro workspace
- **CUANDO** un VIEWER de "W1" exporta a CSV el recorrido de un gasto de 120.00 BOB de "W1" y un usuario de "W2" intenta exportar el mismo recorrido
- **ENTONCES** el VIEWER recibe el archivo con el recorrido completo
- **Y** el usuario de "W2" recibe la respuesta de recurso inexistente y no se revela ningún dato de "W1"

### Requirement: Exportación del recorrido en PDF
Todo miembro que pueda ver el recorrido de un elemento DEBE (MUST) poder descargarlo en PDF con la identificación del elemento, su estado actual, la secuencia de estados visitados y la línea de tiempo (transición, origen y destino, actor, fecha y hora en la zona horaria del workspace, motivo, revisión con su monto y marca de derivada), con la misma visibilidad que el recorrido; el PDF PUEDE incluir el diagrama de la máquina de estados.
Trace: FR-AUDIT-013, FR-AUDIT-010 · Priority: Must

#### Scenario: Exportar a PDF el recorrido de una cuenta
- **CUANDO** el usuario exporta a PDF el recorrido de "Bank C", que se abrió con saldo inicial 500.00 BOB, se archivó con motivo "sin uso", se reactivó y se cerró
- **ENTONCES** el PDF identifica la cuenta "Bank C" con estado actual `CLOSED` y la secuencia de estados `ACTIVE`, `ARCHIVED`, `ACTIVE`, `CLOSED`
- **Y** su línea de tiempo lista abrir (con el asiento de 500.00 BOB), archivar (motivo "sin uso"), reactivar y cerrar, con actor y fecha en la zona horaria del workspace

### Requirement: Transiciones previas reconstruidas desde la auditoría
Para los elementos creados antes de existir el registro de transiciones, el recorrido DEBE (MUST) reconstruirse desde el historial de auditoría y marcar esas transiciones como derivadas; si no hay evidencia de una transición, el recorrido NO DEBE (MUST NOT) inventarla y DEBE (MUST) indicar que la historia previa es incompleta.
Trace: FR-AUDIT-012, FR-AUDIT-004 · Priority: Should

#### Scenario: Gasto anterior al registro de transiciones
- **CUANDO** un gasto de 60.00 BOB se registró posteado y luego se anuló antes de existir el registro de transiciones, y su auditoría tiene la creación y la anulación
- **ENTONCES** su recorrido muestra registrar (a `posted`) y anular (`posted` a `void`), ambas marcadas como derivadas

#### Scenario: Contraparte anterior al registro de transiciones
- **CUANDO** la contraparte "Entel" se creó y se archivó antes de existir el registro de transiciones, y su auditoría tiene la creación y el archivo
- **ENTONCES** su recorrido muestra crear (a `ACTIVE`) y archivar (`ACTIVE` a `ARCHIVED`), ambas marcadas como derivadas

### Requirement: Reporte visual del recorrido en la UI
El detalle de una transacción, de una cuenta, de una categoría y de una contraparte DEBE (MUST) ofrecer un reporte de recorrido con un diagrama de su máquina de estados en el que el camino recorrido y el estado actual se destacan y las transiciones no recorridas se atenúan, más una línea de tiempo de las transiciones con enlace a cada revisión y a sus asientos; la línea de tiempo DEBE (MUST) ser la alternativa accesible del diagrama, y el reporte DEBE (MUST) ofrecer exportar el recorrido en CSV y en PDF.
Trace: FR-AUDIT-011, FR-AUDIT-013, NFR-USAB-001 · Priority: Should

#### Scenario: Reporte de un gasto corregido y anulado
- **CUANDO** el usuario abre la pestaña "Recorrido" de un gasto de 80.00 BOB registrado pendiente, posteado, corregido a 85.00 BOB y anulado
- **ENTONCES** el diagrama destaca `pending`, `posted` y `void` con las transiciones postear, revisar y anular numeradas en el orden en que ocurrieron, y `void` como estado actual
- **Y** `cleared` y `reconciled` aparecen atenuados y la línea de tiempo lista las cuatro transiciones con actor, fecha en la zona horaria del workspace y enlace a la revisión 2

#### Scenario: Recorrido de una categoría en la UI
- **CUANDO** el usuario abre el recorrido de la categoría "Supermercado", que se creó, se archivó y se desarchivó
- **ENTONCES** el diagrama destaca `ACTIVE` y `ARCHIVED` con archivar (1) y desarchivar (2) numeradas en el orden en que ocurrieron, y `ACTIVE` como estado actual
- **Y** la línea de tiempo lista crear, archivar y desarchivar con actor y fecha en la zona horaria del workspace, y el reporte ofrece exportar el recorrido en CSV y en PDF

### Requirement: Recorrido de una sesión de reconciliación
La sesión de reconciliación DEBE (MUST) declarar su máquina de estados —`IN_PROGRESS`, `COMPLETED` y `CANCELLED`, estos dos terminales, con las transiciones iniciar (a `IN_PROGRESS`), finalizar (`IN_PROGRESS` a `COMPLETED`, publica el hecho "reconciliación completada") y cancelar (`IN_PROGRESS` a `CANCELLED`)— y su recorrido DEBE (MUST) mostrar cada transición con actor, instante, motivo si lo hay, saldo del extracto, saldo confirmado, diferencia y, si hubo ajuste, la transacción de ajuste; los confirmados y desconfirmados dentro de la sesión y las des-reconciliaciones posteriores DEBEN (MUST) aparecer como anotaciones.
Trace: FR-AUDIT-009, FR-AUDIT-010, FR-TRANSACTIONS-030 · Priority: Must

#### Scenario: Recorrido de una sesión finalizada con ajuste
- **CUANDO** el usuario inicia la sesión de "Bank A" al 2026-03-31 por 3345.00 BOB, confirma el gasto de 45.90 BOB dentro de ella y la finaliza con un ajuste de 5.00 BOB
- **ENTONCES** el recorrido muestra iniciar y finalizar en orden, con saldo del extracto 3345.00 BOB, diferencia final 0.00 BOB y el ajuste de 5.00 BOB enlazado
- **Y** muestra la confirmación del gasto de 45.90 BOB como anotación

#### Scenario: Transición no declarada de una sesión
- **CUANDO** el usuario intenta finalizar una sesión `CANCELLED`
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y no se registra ninguna transición

### Requirement: Reconciliación en el recorrido de una transacción
La transición reconciliar de una transacción DEBE (MUST) registrar la sesión que la originó con su fecha y saldo de extracto, y la transacción de ajuste creada por una sesión DEBE (MUST) mostrar en su recorrido el registro y la reconciliación referenciando esa sesión.
Trace: FR-AUDIT-010, FR-TRANSACTIONS-030, FR-TRANSACTIONS-006 · Priority: Must

#### Scenario: Recorrido de un gasto reconciliado en sesión
- **CUANDO** el gasto de 150.00 BOB del 2026-03-05 se registró posteado, se confirmó y se reconcilió al finalizar la sesión de "Bank A" al 2026-03-31
- **ENTONCES** su recorrido muestra registrar, confirmar y reconciliar en orden, y la transición reconciliar enlaza la sesión al 2026-03-31 por 3350.00 BOB

#### Scenario: Recorrido del ajuste de una sesión
- **CUANDO** se consulta el recorrido del ajuste de 5.00 BOB creado al finalizar la sesión al 2026-03-31
- **ENTONCES** muestra registrar (con su asiento) y reconciliar, ambas referenciando esa sesión

### Requirement: Conciliación sin extracto en el recorrido de una transacción
La máquina de estados de las transacciones DEBE (MUST) declarar la transición "conciliar sin extracto" (`cleared` a `reconciled`, con guarda de modo explícito y periodo abierto), distinta de "reconciliar" (que exige una sesión), y el recorrido de una transacción conciliada sin extracto DEBE (MUST) mostrarla con actor, instante y modo; un cotejo posterior por una sesión DEBE (MUST) aparecer como anotación que referencia esa sesión, sin una transición nueva, y des-reconciliar DEBE (MUST) mostrarse como la transición des-reconciliar con su motivo.
Trace: FR-AUDIT-009, FR-AUDIT-010, FR-TRANSACTIONS-006, FR-TRANSACTIONS-030 · Priority: Must

#### Scenario: Definición de la máquina con la conciliación sin extracto
- **CUANDO** el usuario consulta la definición de la máquina de estados de las transacciones
- **ENTONCES** la transición "conciliar sin extracto" figura de `cleared` a `reconciled` con su guarda, separada de "reconciliar"

#### Scenario: Recorrido de un gasto conciliado sin extracto y cotejado después
- **CUANDO** el gasto de 45.90 BOB del 2026-03-20 de "Bank A" se registró posteado, se confirmó, se concilió sin extracto y luego lo cotejó la sesión de "Bank A" al 2026-03-31 por 3304.10 BOB
- **ENTONCES** su recorrido muestra registrar, confirmar y conciliar sin extracto en orden, y una anotación de cotejo que enlaza la sesión al 2026-03-31

### Requirement: Recorrido de una definición recurrente
La definición recurrente DEBE (MUST) declarar su máquina de estados —`ACTIVE`, `PAUSED` y `ENDED`, este terminal, con las transiciones crear (a `ACTIVE`), pausar (`ACTIVE` a `PAUSED`), reanudar (`PAUSED` a `ACTIVE`), revisar (`ACTIVE` o `PAUSED` al mismo estado, con versión nueva y fecha efectiva) y terminar (`ACTIVE` o `PAUSED` a `ENDED`), cada una con el hecho que publica— y su recorrido DEBE (MUST) mostrar cada transición con actor, instante, motivo si lo hay, versión de la definición y cantidad de ocurrencias canceladas, reinstauradas o reescritas; renombrar o cambiar la descripción DEBEN (MUST) aparecer como anotaciones; una transición no declarada DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION`.
Trace: FR-AUDIT-009, FR-COMMITMENTS-009 · Priority: Must

#### Scenario: Recorrido del alquiler revisado
- **CUANDO** el EDITOR crea el "Alquiler" de 3500.00 BOB, lo pausa el 2026-10-10, lo reanuda el 2026-10-12 y lo revisa a 3800.00 BOB desde 2027-01-05
- **ENTONCES** el recorrido muestra crear, pausar, reanudar y revisar en orden, con la versión 2 y la fecha efectiva 2027-01-05 en la revisión

#### Scenario: Reanudar una definición terminada
- **CUANDO** el EDITOR intenta reanudar el "Internet" terminado
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y no se registra ninguna transición

### Requirement: Recorrido de una ocurrencia recurrente
La ocurrencia recurrente DEBE (MUST) declarar su máquina de estados —`SCHEDULED`, `DUE`, `OVERDUE`, `MATERIALIZED`, `MATCHED`, `SKIPPED` y `CANCELLED`, siendo `SKIPPED` terminal— con las transiciones generar, pasar a próxima, atrasar, materializar, vincular, omitir, liberar (de `MATERIALIZED` o `MATCHED` a `DUE` u `OVERDUE`), cancelar y reinstaurar (de `CANCELLED` a `SCHEDULED`); su recorrido DEBE (MUST) mostrar cada transición con actor (usuario o proceso), instante, motivo y la transacción creada o vinculada, y la edición de monto o fecha DEBE (MUST) aparecer como anotación; una transición no declarada DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION`.
Trace: FR-AUDIT-009, FR-COMMITMENTS-008 · Priority: Must

#### Scenario: Recorrido del internet de octubre
- **CUANDO** se genera la ocurrencia del 2026-10-20 del "Internet", pasa a próxima el 2026-10-17, el EDITOR cambia su monto a 210.00 BOB y la aprueba el 2026-10-20
- **ENTONCES** el recorrido muestra generar, pasar a próxima y materializar en orden, con la edición a 210.00 BOB como anotación y el gasto creado enlazado

#### Scenario: Omitir una ocurrencia materializada
- **CUANDO** el EDITOR intenta omitir la ocurrencia ya materializada del 2026-10-20
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y la ocurrencia no cambia
