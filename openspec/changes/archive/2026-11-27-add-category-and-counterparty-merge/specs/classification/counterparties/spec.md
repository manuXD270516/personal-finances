# Spec Delta

## ADDED Requirements

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
