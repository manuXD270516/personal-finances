# classification/counterparties Specification

## Purpose
Catálogo de contrapartes (counterparties): comercios, proveedores, empleadores, personas, instituciones y demás terceros con quienes el usuario opera. Cada contraparte tiene alias para reconocerla en descripciones, una categoría por defecto que acelera la carga y se archiva en lugar de borrarse.

## Requirements

### Requirement: Gestión de counterparties
El sistema DEBE (MUST) permitir crear y editar counterparties con nombre, tipo (comercio, proveedor de servicios, empleador, persona, institución financiera, prestamista, exchange, trader P2P, gobierno u otro), icono, notas y categoría por defecto opcional. El nombre DEBE (MUST) ser único, sin distinguir mayúsculas ni acentos, entre las activas (`NAME_TAKEN`), y la categoría por defecto DEBE (MUST) estar activa (`CATEGORY_ARCHIVED`).
Trace: FR-CLASSIFICATION-010 · Priority: Must

#### Scenario: Counterparty creada
- **CUANDO** el usuario crea la counterparty "Hipermaxi" de tipo comercio con categoría por defecto "Supermercado"
- **ENTONCES** la counterparty queda activa con esa categoría por defecto

#### Scenario: Nombre equivalente sin acentos
- **CUANDO** existe la counterparty activa "Tigo Bolivia" y el usuario crea "TIGO bolivia"
- **ENTONCES** la operación se rechaza con `NAME_TAKEN`

#### Scenario: Categoría por defecto archivada
- **CUANDO** el usuario crea una counterparty con la categoría por defecto archivada "Old Gym"
- **ENTONCES** la operación se rechaza con `CATEGORY_ARCHIVED`

### Requirement: Reconocimiento de counterparties por alias
Cada counterparty DEBE (MUST) admitir alias. El sistema DEBE (MUST) reconocer una counterparty activa cuando un texto de descripción contiene uno de sus alias o su nombre, sin distinguir mayúsculas, acentos ni espacios repetidos.
Trace: FR-CLASSIFICATION-010 · Priority: Must

#### Scenario: Descripción bancaria reconocida por alias
- **CUANDO** la counterparty "PedidosYa" tiene el alias "pedidos ya" y se busca la descripción "COMPRA PEDIDOS  YA*LPZ 4471 por 85.50 BOB"
- **ENTONCES** el sistema reconoce la counterparty "PedidosYa"

#### Scenario: Descripción sin coincidencias
- **CUANDO** se busca la descripción "TRANSF 99812" y ningún nombre ni alias aparece en ella
- **ENTONCES** el sistema no reconoce ninguna counterparty

### Requirement: Alias únicos por workspace
Un alias normalizado NO DEBE (MUST NOT) pertenecer a más de una counterparty del workspace; asignar un alias ya usado por otra counterparty DEBE (MUST) rechazarse con `COUNTERPARTY_ALIAS_TAKEN`.
Trace: FR-CLASSIFICATION-010 · Priority: Must

#### Scenario: Alias en uso
- **CUANDO** "PedidosYa" tiene el alias "pedidos ya" y el usuario añade el alias "Pedidos Ya" a la counterparty "Yaigo"
- **ENTONCES** la operación se rechaza con `COUNTERPARTY_ALIAS_TAKEN`

### Requirement: Sugerencia de categoría por counterparty
Al elegir una counterparty en un movimiento, el sistema DEBE (MUST) sugerir su categoría por defecto si está activa; si no tiene, la última categoría activa usada con ella; si no hay ninguna, no sugiere. La sugerencia NO DEBE (MUST NOT) asignarse sin que el usuario la acepte.
Trace: FR-CLASSIFICATION-011 · Priority: Should

#### Scenario: Sugerencia por última categoría usada
- **CUANDO** "Farmacorp" no tiene categoría por defecto, su último gasto de 64.00 BOB fue en "Farmacia" y el usuario la elige en un gasto nuevo
- **ENTONCES** el sistema sugiere la categoría "Farmacia"

### Requirement: Creación inline de counterparties
El usuario DEBE (MUST) poder crear una counterparty indicando solo su nombre desde el formulario de transacción, con tipo "otro" por defecto, y usarla de inmediato en ese movimiento. Si el nombre coincide con una counterparty activa, DEBE (MUST) rechazarse con `NAME_TAKEN` identificando la existente para poder elegirla.
Trace: FR-CLASSIFICATION-012 · Priority: Must

#### Scenario: Counterparty nueva desde el formulario
- **CUANDO** al registrar un gasto de 35.00 BOB el usuario crea inline la counterparty "Panadería Don Pepe"
- **ENTONCES** la counterparty queda activa con tipo "otro" y el gasto se registra con ella

#### Scenario: Nombre existente desde el formulario
- **CUANDO** el usuario crea inline "hipermaxi" y existe la counterparty activa "Hipermaxi"
- **ENTONCES** la operación se rechaza con `NAME_TAKEN` e identifica a "Hipermaxi" para seleccionarla

### Requirement: Las counterparties se archivan en lugar de eliminarse
El sistema NO DEBE (MUST NOT) eliminar counterparties: solo archivarlas. Archivar una counterparty NO DEBE (MUST NOT) modificar las transacciones que la referencian, y los históricos DEBEN (MUST) seguir mostrándola como archivada.
Trace: FR-CLASSIFICATION-010 · Priority: Must

#### Scenario: Archivar una counterparty con historial
- **CUANDO** la counterparty "Entel" tiene 12 pagos que suman 1,440.00 BOB y el usuario la archiva
- **ENTONCES** los 12 pagos siguen referenciando "Entel"
- **Y** el historial de movimientos de "Entel" sigue mostrando 1,440.00 BOB

### Requirement: Una counterparty archivada no es asignable
Una counterparty archivada NO DEBE (MUST NOT) aparecer en los selectores, ser reconocida por alias ni asignarse a transacciones nuevas o editadas; el intento DEBE (MUST) rechazarse con `COUNTERPARTY_ARCHIVED`.
Trace: FR-CLASSIFICATION-010 · Priority: Must

#### Scenario: Asignar una counterparty archivada
- **CUANDO** el usuario registra un gasto de 120.00 BOB con la counterparty archivada "Entel"
- **ENTONCES** la operación se rechaza con `COUNTERPARTY_ARCHIVED`

### Requirement: Desarchivar una counterparty
El sistema DEBE (MUST) permitir desarchivar una counterparty, que vuelve a ser asignable y reconocible por sus alias; si su nombre ya lo usa otra counterparty activa, DEBE (MUST) rechazarse con `NAME_TAKEN`.
Trace: FR-CLASSIFICATION-010 · Priority: Should

#### Scenario: Counterparty desarchivada
- **CUANDO** el usuario desarchiva "Entel" y registra un gasto de 120.00 BOB con ella
- **ENTONCES** el gasto se acepta con la counterparty "Entel"

### Requirement: Cambiar la counterparty no modifica el ledger
Asignar, cambiar o quitar la counterparty de una transacción NO DEBE (MUST NOT) crear, modificar ni revertir asientos contables ni alterar ningún saldo de cuenta.
Trace: FR-TRANSACTIONS-008 · Priority: Must

#### Scenario: Cambiar la counterparty de un gasto contabilizado
- **CUANDO** un gasto contabilizado de 45.00 USD desde "Efectivo USD" (saldo 300.00 USD) cambia de counterparty "Hipermaxi" a "Fidalga"
- **ENTONCES** el número de asientos contables no cambia y el saldo de "Efectivo USD" sigue siendo 300.00 USD

### Requirement: Fusionar contrapartes
Un OWNER o EDITOR DEBE (MUST) poder fusionar una contraparte origen en una contraparte destino activa del mismo workspace. La fusión DEBE (MUST):
- reasignar a la destino las transacciones y porciones que referencian la origen y cuya fecha de negocio no cae en un periodo cerrado, sin crear, modificar ni revertir asientos ni cambiar saldos;
- conservar en la destino los alias de la origen y agregar como alias el nombre de la origen cuando no coincide con el nombre ni con un alias de la destino;
- dar a la destino la categoría por defecto de la origen solo si la destino no tiene una y la de la origen está activa;
- dejar la origen archivada y marcada como fusionada en la destino;
- aplicarse completa o no aplicarse, con un registro de auditoría que la identifique.

Las transacciones de periodos cerrados DEBEN (MUST) conservar la origen. Estos casos DEBEN (MUST) rechazarse sin cambios:
- origen y destino iguales: `VALIDATION_FAILED`;
- una destino archivada: `COUNTERPARTY_ARCHIVED`;
- un VIEWER: `INSUFFICIENT_ROLE`.

Trace: FR-CLASSIFICATION-013, FR-CLASSIFICATION-010, FR-AUDIT-001, INV-019 · Priority: Could

#### Scenario: Fusionar HIPERMAXI S.A. en Hipermaxi
- **CUANDO** la contraparte "HIPERMAXI S.A.", creada en línea, tiene 4 gastos de noviembre de 2026 (periodo abierto) que suman 512.40 BOB y el alias "hipermaxi sa", y el EDITOR la fusiona en "Hipermaxi"
- **ENTONCES** los 4 gastos tienen la contraparte "Hipermaxi" y el historial de "Hipermaxi" suma esos 512.40 BOB
- **Y** "Hipermaxi" tiene los alias "hipermaxi sa" y "HIPERMAXI S.A.", y la descripción "COMPRA HIPERMAXI S.A. 4471" se reconoce como "Hipermaxi"
- **Y** "HIPERMAXI S.A." queda archivada y marcada como fusionada en "Hipermaxi", y el número de asientos no cambia

#### Scenario: Categoría por defecto heredada
- **CUANDO** "Hipermaxi" no tiene categoría por defecto, "HIPERMAXI S.A." tiene "Supermercado" y el EDITOR fusiona "HIPERMAXI S.A." en "Hipermaxi"
- **ENTONCES** "Hipermaxi" tiene "Supermercado" como categoría por defecto

#### Scenario: Destino archivada
- **CUANDO** el EDITOR intenta fusionar "HIPERMAXI S.A." en la contraparte archivada "Hiper Viejo"
- **ENTONCES** se rechaza con `COUNTERPARTY_ARCHIVED` y los gastos siguen con "HIPERMAXI S.A."

#### Scenario: Gasto en un periodo cerrado
- **CUANDO** "HIPERMAXI S.A." tiene además un gasto de 60.00 BOB en octubre de 2026, periodo cerrado, y el EDITOR la fusiona en "Hipermaxi"
- **ENTONCES** el gasto de octubre conserva "HIPERMAXI S.A.", mostrada como archivada y fusionada en "Hipermaxi", y los de noviembre pasan a "Hipermaxi"

### Requirement: Vista previa de la fusión de contrapartes
Antes de fusionar, todo miembro del workspace DEBE (MUST) poder consultar la vista previa de la fusión de una contraparte en otra. La vista previa DEBE (MUST) informar:
- la cantidad de referencias que pasarán a la destino: transacciones, compromisos recurrentes, suscripciones, préstamos, conversiones, reglas y filas de importaciones sin persistir;
- las transacciones que conservarán la origen por estar en periodos cerrados;
- los alias que se moverán.

La vista previa NO DEBE (MUST NOT) cambiar nada.

Trace: FR-CLASSIFICATION-013 · Priority: Could

#### Scenario: Vista previa de HIPERMAXI S.A.
- **CUANDO** "HIPERMAXI S.A." tiene 4 gastos en noviembre de 2026 (abierto), 1 en octubre de 2026 (cerrado), 1 suscripción y 1 regla, y el usuario pide la vista previa de su fusión en "Hipermaxi"
- **ENTONCES** la vista previa informa 4 transacciones a reasignar, 1 transacción que conserva la origen, 1 suscripción, 1 regla y el alias "hipermaxi sa" a mover, sin conflictos
- **Y** nada cambia

### Requirement: Referencias a la contraparte fusionada en otros contextos
En la misma operación, la fusión de contrapartes DEBE (MUST) llevar a la destino toda referencia viva a la origen:
- los compromisos recurrentes activos y las suscripciones, sin cambiar sus ocurrencias, precios ni montos;
- el prestamista de los préstamos;
- el proveedor de las conversiones;
- las condiciones y acciones de las reglas no archivadas, con una versión nueva de cada regla;
- las filas de importaciones todavía no persistidas.

La historia (versiones anteriores de reglas, historial de precios de suscripciones y decisiones sobre sugerencias) NO DEBE (MUST NOT) cambiar.

Trace: FR-CLASSIFICATION-013, FR-COMMITMENTS-012, FR-DEBT-001, FR-RULES-001 · Priority: Could

#### Scenario: Suscripción, préstamo y regla
- **CUANDO** la suscripción "Seguro de desgravamen" de 25.00 BOB es de "BANCO UNO S.A.", el préstamo "Préstamo vehicular" tiene como prestamista a "BANCO UNO S.A." y la regla "BANCO UNO" asigna "BANCO UNO S.A.", y el EDITOR fusiona "BANCO UNO S.A." en "Banco Uno"
- **ENTONCES** "Seguro de desgravamen" es de "Banco Uno" con su precio de 25.00 BOB y su historial sin cambios, y "Préstamo vehicular" tiene como prestamista a "Banco Uno"
- **Y** la regla "BANCO UNO" tiene una versión nueva que asigna "Banco Uno"

### Requirement: Una contraparte fusionada no se desarchiva ni se vuelve a fusionar
Una contraparte fusionada DEBE (MUST) quedar archivada de forma permanente: desarchivarla o usarla como origen o destino de otra fusión DEBE (MUST) rechazarse con `COUNTERPARTY_MERGED`, indicando la destino, sin cambios. Los históricos DEBEN (MUST) seguir mostrándola con su nombre y la destino en la que se fusionó.
Trace: FR-CLASSIFICATION-013, FR-CLASSIFICATION-010 · Priority: Could

#### Scenario: Desarchivar una contraparte fusionada
- **CUANDO** "HIPERMAXI S.A." se fusionó en "Hipermaxi" y el EDITOR intenta desarchivarla
- **ENTONCES** se rechaza con `COUNTERPARTY_MERGED` indicando "Hipermaxi"
