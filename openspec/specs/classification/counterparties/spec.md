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
