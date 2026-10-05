# Spec Delta

## Purpose

Permite cambiar en una sola operación la clasificación (categoría, tags, contraparte, notas, custom fields) y el estado `cleared` de una selección de transacciones, con vista previa, ejecución todo o nada con versión por ítem, auditoría por transacción con un identificador de operación común y sin tocar nunca montos, cuentas, fechas ni el ledger (FR-TRANSACTIONS-033, INV-033), respetando los periodos cerrados (docs/31 D49).

## ADDED Requirements

### Requirement: Edición masiva de clasificación
Un EDITOR u OWNER DEBERÍA poder aplicar en una sola operación, sobre una selección explícita de transacciones, uno o más de estos cambios: categoría, agregar tags, quitar tags, fijar o quitar la contraparte y reemplazar las notas; cuando se ofrece, cada transacción DEBE (MUST) quedar con el cambio aplicado y una versión nueva, y las categorías, tags y contrapartes DEBEN (MUST) validarse con las mismas reglas que la edición individual (activos, tipo compatible).
Trace: FR-TRANSACTIONS-033, FR-CLASSIFICATION-008, FR-CLASSIFICATION-010 · Priority: Should

#### Scenario: Recategorizar y etiquetar tres gastos
- **CUANDO** el usuario selecciona tres gastos de un solo split de "Bank A" (45.90 BOB, 150.00 BOB y 200.00 BOB, categoría "Supermercado") y aplica categoría "Hogar" y el tag "familia"
- **ENTONCES** los tres quedan con categoría "Hogar" y el tag "familia", cada uno con su versión incrementada en uno
- **Y** en marzo de 2026 "Supermercado" disminuye 395.90 BOB y "Hogar" aumenta 395.90 BOB

#### Scenario: Categoría archivada
- **CUANDO** el usuario aplica en lote la categoría archivada "Mascotas" a dos gastos
- **ENTONCES** se rechaza con `CATEGORY_ARCHIVED` y ninguno cambia

#### Scenario: Categoría de ingreso sobre gastos
- **CUANDO** el usuario aplica en lote la categoría de ingreso "Sueldo" a dos gastos
- **ENTONCES** se rechaza con `CATEGORY_KIND_MISMATCH` y ninguno cambia

### Requirement: Vista previa del alcance de la edición masiva
Antes de ejecutar, el sistema DEBERÍA ofrecer una vista previa sin efectos a partir de una selección o de los filtros del listado de transacciones; cuando se ofrece, DEBE (MUST) informar cuántas transacciones se verían afectadas, la versión vigente de cada una y, por transacción, si cada cambio es aplicable y el motivo cuando no lo es, sin modificar nada ni escribir auditoría.
Trace: FR-TRANSACTIONS-033, FR-TRANSACTIONS-012 · Priority: Should

#### Scenario: Vista previa por filtro
- **CUANDO** el usuario pide la vista previa de "categoría Hogar" para los gastos de "Bank A" de marzo de 2026 con categoría "Supermercado" y existen 3 gastos de un split y 1 gasto con dos splits
- **ENTONCES** la vista previa informa 4 transacciones con sus versiones, 3 aplicables y 1 no aplicable por tener varios splits
- **Y** ninguna transacción cambia y no se escribe auditoría

### Requirement: Ejecución todo o nada de la edición masiva
La edición masiva DEBE (MUST) ejecutarse en una sola transacción de base de datos: cada ítem DEBE (MUST) indicar la versión esperada de su transacción y, si algún ítem no existe, tiene versión obsoleta, no admite el cambio o viola una regla, NINGUNA transacción DEBE (MUST) cambiar y la respuesta DEBE (MUST) indicar el error de cada ítem afectado.
Trace: FR-TRANSACTIONS-033, FR-TRANSACTIONS-011, NFR-DATA-014 · Priority: Must

#### Scenario: Un ítem con versión obsoleta
- **CUANDO** el usuario envía en lote "categoría Hogar" para los gastos de 45.90 BOB (versión 2), 150.00 BOB (versión 1) y 200.00 BOB (versión 4), y el de 150.00 BOB ya está en la versión 2
- **ENTONCES** se rechaza con `PRECONDITION_FAILED` con un error para el gasto de 150.00 BOB
- **Y** los tres gastos conservan la categoría "Supermercado" y su versión

#### Scenario: Un ítem inexistente
- **CUANDO** el lote incluye un identificador de transacción que no existe en el workspace
- **ENTONCES** se rechaza con `RESOURCE_NOT_FOUND` indicando ese ítem y ninguna transacción cambia

### Requirement: La edición masiva no cambia montos, cuentas, fechas ni el ledger
La edición masiva NO DEBE (MUST NOT) aceptar cambios de monto, moneda, cuenta, fecha, montos de splits ni estado distinto de confirmar o desconfirmar (`VALIDATION_FAILED`), y NO DEBE (MUST NOT) crear, modificar ni revertir asientos ni alterar saldos de cuentas.
Trace: FR-TRANSACTIONS-033, FR-TRANSACTIONS-008, INV-033 · Priority: Must

#### Scenario: Intento de cambiar montos en lote
- **CUANDO** el usuario envía un lote que incluye un cambio de monto a 100.00 BOB para dos gastos
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y ninguno cambia

#### Scenario: Saldos intactos tras recategorizar
- **CUANDO** "Bank A" tiene saldo 2000.00 BOB y el usuario recategoriza en lote tres gastos posteados de esa cuenta
- **ENTONCES** el número de asientos no cambia y el saldo de "Bank A" sigue en 2000.00 BOB

### Requirement: Aplicabilidad de los cambios masivos
Un cambio de categoría en lote DEBE (MUST) aplicarse solo a transacciones de ingreso, gasto o reembolso con un único split nominal; sobre una transacción con varios splits, una transferencia o una conversión DEBE (MUST) rechazarse con `BULK_EDIT_NOT_APPLICABLE` indicando el ítem. Los tags agregados o quitados DEBERÍAN aplicarse a todos los splits de cada transacción; cuando se aplican, una transacción sin splits clasificables DEBE (MUST) rechazarse con `BULK_EDIT_NOT_APPLICABLE`.
Trace: FR-TRANSACTIONS-033, FR-TRANSACTIONS-026 · Priority: Should

#### Scenario: Categoría sobre un gasto con dos splits
- **CUANDO** el lote "categoría Hogar" incluye un gasto de 300.00 BOB con splits de 200.00 BOB y 100.00 BOB
- **ENTONCES** se rechaza con `BULK_EDIT_NOT_APPLICABLE` indicando ese gasto y ninguna transacción del lote cambia

#### Scenario: Tag sobre un gasto con dos splits
- **CUANDO** el usuario agrega en lote el tag "viaje" a ese gasto de 300.00 BOB y a un gasto de un split de 45.90 BOB
- **ENTONCES** los dos splits del gasto de 300.00 BOB y el split del de 45.90 BOB quedan con el tag "viaje"

### Requirement: Confirmación cleared en lote desde la edición masiva
La edición masiva DEBERÍA permitir confirmar o desconfirmar como `cleared` las transacciones seleccionadas, con las mismas reglas y efectos que el marcado `cleared` en lote; cuando se ofrece, una transacción `reconciled`, `pending` o `void` DEBE (MUST) rechazar la operación completa con `INVALID_STATUS_TRANSITION` o `TRANSACTION_RECONCILED`.
Trace: FR-TRANSACTIONS-033, FR-TRANSACTIONS-029 · Priority: Should

#### Scenario: Confirmar y etiquetar en una operación
- **CUANDO** el usuario aplica en lote "confirmar" y el tag "revisado" a dos gastos posteados de 45.90 BOB y 150.00 BOB
- **ENTONCES** ambos quedan `cleared` con el tag "revisado" y se publica un hecho "transacción confirmada" por cada uno

#### Scenario: Desconfirmar un gasto reconciliado
- **CUANDO** el lote "desconfirmar" incluye un gasto `reconciled` de 150.00 BOB y un gasto `cleared` de 45.90 BOB
- **ENTONCES** se rechaza con `TRANSACTION_RECONCILED` indicando el gasto de 150.00 BOB y ninguno cambia

### Requirement: Auditoría de la edición masiva con identificador común
Cada transacción cambiada por una edición masiva DEBE (MUST) tener su propio registro de auditoría con el diff de lo que cambió, todos con un mismo identificador de operación masiva, y la operación DEBE (MUST) registrar además un registro agregado con el actor, la cantidad de transacciones y los cambios solicitados; todo en la misma transacción de base de datos que los cambios.
Trace: FR-TRANSACTIONS-033, FR-AUDIT-001, FR-AUDIT-002, INV-029 · Priority: Must

#### Scenario: Auditoría de tres recategorizaciones
- **CUANDO** el usuario recategoriza en lote tres gastos de "Supermercado" a "Hogar"
- **ENTONCES** existen tres registros de auditoría con categoría antes "Supermercado" y después "Hogar" y el mismo identificador de operación masiva
- **Y** existe un registro agregado de la operación con 3 transacciones y ese mismo identificador

#### Scenario: Falla de auditoría en la operación
- **CUANDO** falla la escritura del registro agregado de la operación
- **ENTONCES** ninguna de las tres transacciones cambia

### Requirement: Edición masiva y periodos cerrados
Una edición masiva que cambie la clasificación o el estado de confirmación de alguna transacción cuya fecha de negocio cae en un periodo cerrado DEBE (MUST) rechazarse completa con `PERIOD_CLOSED` indicando cada transacción afectada, sin cambios, sin auditoría y sin eventos.
Trace: FR-TRANSACTIONS-033, FR-PLANNING-005, INV-015 · Priority: Must

#### Scenario: Recategorizar en lote incluyendo un gasto de un mes cerrado
- **CUANDO** marzo de 2026 está cerrado y el lote "categoría Hogar" incluye un gasto de 150.00 BOB del 2026-03-15 y uno de 45.90 BOB del 2026-04-02
- **ENTONCES** se rechaza con `PERIOD_CLOSED` indicando el gasto del 2026-03-15
- **Y** ninguno de los dos cambia de categoría y no se escribe auditoría

### Requirement: Límite e idempotencia de la edición masiva
Una edición masiva DEBERÍA admitir hasta 500 transacciones y exigir clave de idempotencia; cuando se exige, un lote de más de 500 DEBE (MUST) rechazarse con `VALIDATION_FAILED`, el reenvío con la misma clave y el mismo contenido DEBE (MUST) devolver el resultado original sin aplicar cambios de nuevo y la misma clave con contenido distinto DEBE (MUST) rechazarse con `IDEMPOTENCY_KEY_REUSED`.
Trace: FR-TRANSACTIONS-033, FR-TRANSACTIONS-010, INV-027 · Priority: Should

#### Scenario: Reenvío de la misma edición masiva
- **CUANDO** el usuario reenvía con la misma clave la recategorización en lote de tres gastos que ya se aplicó
- **ENTONCES** obtiene el mismo resultado y el mismo identificador de operación masiva, sin versiones nuevas ni auditoría adicional

#### Scenario: Lote de 501 transacciones
- **CUANDO** el usuario envía una edición masiva con 501 transacciones
- **ENTONCES** se rechaza con `VALIDATION_FAILED` y ninguna cambia

### Requirement: Custom fields en la edición masiva
Cuando existan definiciones de custom fields de transacción, la edición masiva DEBERÍA permitir fijar o quitar el valor de un custom field en las transacciones seleccionadas (en todos sus splits clasificables), validando el valor contra la definición; cuando se ofrece, un valor inválido o una definición archivada DEBE (MUST) rechazar la operación completa con `CUSTOM_FIELD_VALUE_INVALID` o `CUSTOM_FIELD_ARCHIVED`.
Trace: FR-TRANSACTIONS-033, FR-CLASSIFICATION-009 · Priority: Should

#### Scenario: Fijar el centro de costo en lote
- **CUANDO** existe el custom field de transacción "centro_costo" de tipo selección con opciones "casa" y "oficina" y el usuario fija "oficina" en lote a dos gastos de 45.90 BOB y 150.00 BOB
- **ENTONCES** ambos gastos quedan con "centro_costo" = "oficina" y el saldo de sus cuentas no cambia

#### Scenario: Opción inexistente en lote
- **CUANDO** el usuario fija "taller" en lote, que no es una opción de "centro_costo"
- **ENTONCES** se rechaza con `CUSTOM_FIELD_VALUE_INVALID` y ningún gasto cambia

### Requirement: Edición masiva restringida por rol
Solo los miembros EDITOR u OWNER del workspace DEBEN (MUST) poder ejecutar una edición masiva o pedir su vista previa; un VIEWER DEBE (MUST) recibir `INSUFFICIENT_ROLE` y las transacciones de otro workspace NO DEBEN (MUST NOT) verse afectadas ni revelarse.
Trace: FR-TRANSACTIONS-033, FR-IDENTITY-006, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta una edición masiva
- **CUANDO** un VIEWER de "W1" envía una recategorización en lote de dos gastos de "W1"
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` y ninguno cambia

#### Scenario: Transacción de otro workspace en el lote
- **CUANDO** un EDITOR de "W1" incluye en el lote el identificador de un gasto de "W2"
- **ENTONCES** se rechaza con `RESOURCE_NOT_FOUND` para ese ítem, igual que para un identificador inexistente, y nada cambia en "W1" ni en "W2"
