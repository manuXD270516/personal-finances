# Spec Delta

## ADDED Requirements

### Requirement: Fusión en el recorrido de categorías y contrapartes
El recorrido de una categoría o una contraparte origen de una fusión DEBE (MUST) mostrar la fusión como una transición hacia `ARCHIVED` (desde `ACTIVE`, o desde `ARCHIVED` si ya estaba archivada) con actor, instante, la destino y el identificador de la operación. El recorrido de la destino DEBE (MUST) mostrar una anotación con la origen y la cantidad de referencias reasignadas. Las subcategorías que cambian de padre DEBEN (MUST) mostrarlo como anotación. Una fusión rechazada NO DEBE (MUST NOT) registrar transiciones ni anotaciones. Los recorridos registrados antes de este cambio DEBEN (MUST) seguir leyéndose igual.
Trace: FR-AUDIT-009, FR-AUDIT-010, FR-CLASSIFICATION-007, FR-CLASSIFICATION-013 · Priority: Could

#### Scenario: Recorrido de una categoría fusionada
- **CUANDO** el usuario crea la categoría de gasto "Super", la fusiona en "Supermercado" con 3 porciones reasignadas y consulta los dos recorridos
- **ENTONCES** el de "Super" muestra crear (a `ACTIVE`) y fusionar (`ACTIVE` a `ARCHIVED`) con la destino "Supermercado", y su estado actual es `ARCHIVED`
- **Y** el de "Supermercado" muestra una anotación de fusión con la origen "Super" y 3 porciones reasignadas, con el mismo identificador de operación

#### Scenario: Fusión de contraparte rechazada
- **CUANDO** el EDITOR intenta fusionar "HIPERMAXI S.A." en la contraparte archivada "Hiper Viejo" y se rechaza con `COUNTERPARTY_ARCHIVED`
- **ENTONCES** los recorridos de "HIPERMAXI S.A." y de "Hiper Viejo" no tienen transiciones ni anotaciones nuevas
