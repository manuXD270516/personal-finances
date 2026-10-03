# Spec Delta

## Purpose

Hace que el ciclo de vida de cada elemento con estados (transacciones —incluidas transferencias y conversiones—, cuentas y tasas de cambio) sea un flujo trazable de transiciones explícitas y no una serie de actualizaciones sueltas: cada agregado declara su máquina de estados, cada transición queda registrada con actor, instante, motivo, revisión y asientos del ledger, y el usuario puede recorrer el camino completo que tomó un elemento en el tiempo, por API y en un reporte visual tipo máquina de estados (docs/31 D37).

## ADDED Requirements

### Requirement: Máquina de estados declarada por agregado
Cada tipo de agregado con ciclo de vida (transacción, cuenta, tasa de cambio) DEBE (MUST) tener una máquina de estados declarada con sus estados, sus estados terminales y sus transiciones permitidas, cada una con su estado de origen, su estado de destino, su guarda y el evento que publica; toda transición no declarada DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION` y el sistema DEBE (MUST) exponer la definición vigente de cada máquina.
Trace: FR-AUDIT-009, FR-TRANSACTIONS-006, FR-ACCOUNTS-007 · Priority: Must

#### Scenario: Definición de la máquina de una transacción
- **CUANDO** el usuario consulta la definición de la máquina de estados de las transacciones
- **ENTONCES** obtiene los estados `pending`, `posted`, `cleared`, `reconciled` y `void`, con `void` como terminal
- **Y** cada transición declarada (registrar, postear, marcar cleared, desmarcar cleared, reconciliar, des-reconciliar, revisar y anular) indica origen, destino, guarda y evento

#### Scenario: Transición no declarada
- **CUANDO** el usuario intenta reconciliar un gasto `pending` de 80.00 BOB
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y no se registra ninguna transición

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

### Requirement: Transiciones previas reconstruidas desde la auditoría
Para los elementos creados antes de existir el registro de transiciones, el recorrido DEBE (MUST) reconstruirse desde el historial de auditoría y marcar esas transiciones como derivadas; si no hay evidencia de una transición, el recorrido NO DEBE (MUST NOT) inventarla y DEBE (MUST) indicar que la historia previa es incompleta.
Trace: FR-AUDIT-012, FR-AUDIT-004 · Priority: Should

#### Scenario: Gasto anterior al registro de transiciones
- **CUANDO** un gasto de 60.00 BOB se registró posteado y luego se anuló antes de existir el registro de transiciones, y su auditoría tiene la creación y la anulación
- **ENTONCES** su recorrido muestra registrar (a `posted`) y anular (`posted` a `void`), ambas marcadas como derivadas

### Requirement: Reporte visual del recorrido en la UI
El detalle de una transacción y de una cuenta DEBE (MUST) ofrecer un reporte de recorrido con un diagrama de su máquina de estados en el que el camino recorrido y el estado actual se destacan y las transiciones no recorridas se atenúan, más una línea de tiempo de las transiciones con enlace a cada revisión y a sus asientos; la línea de tiempo DEBE (MUST) ser la alternativa accesible del diagrama.
Trace: FR-AUDIT-011, NFR-USAB-001 · Priority: Should

#### Scenario: Reporte de un gasto corregido y anulado
- **CUANDO** el usuario abre la pestaña "Recorrido" de un gasto de 80.00 BOB registrado pendiente, posteado, corregido a 85.00 BOB y anulado
- **ENTONCES** el diagrama destaca `pending`, `posted` y `void` con las transiciones postear, revisar y anular numeradas en el orden en que ocurrieron, y `void` como estado actual
- **Y** `cleared` y `reconciled` aparecen atenuados y la línea de tiempo lista las cuatro transiciones con actor, fecha en la zona horaria del workspace y enlace a la revisión 2
