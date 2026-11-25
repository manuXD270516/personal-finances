# Spec Delta

## ADDED Requirements

### Requirement: Fusionar categorías
Un OWNER o EDITOR DEBE (MUST) poder fusionar una categoría origen en una categoría destino activa del mismo workspace y del mismo tipo de movimiento. La fusión DEBE (MUST):
- reasignar a la destino las porciones de transacciones que referencian la origen, sin crear, modificar ni revertir asientos ni cambiar ningún saldo;
- dejar la origen archivada y marcada como fusionada en la destino;
- aplicarse completa o no aplicarse, con un registro de auditoría que la identifique.

Repetir la misma solicitud de fusión DEBE (MUST) devolver el mismo resultado sin reasignar nada dos veces. Estos casos DEBEN (MUST) rechazarse sin cambios:
- origen y destino iguales: `VALIDATION_FAILED`;
- tipos de movimiento distintos: `CATEGORY_KIND_MISMATCH`;
- una origen de sistema: `SYSTEM_CATEGORY_IMMUTABLE`;
- una destino archivada: `CATEGORY_ARCHIVED`;
- un VIEWER: `INSUFFICIENT_ROLE`.

Trace: FR-CLASSIFICATION-007, FR-CLASSIFICATION-002, FR-AUDIT-001, INV-019 · Priority: Could

#### Scenario: Fusionar Super en Supermercado
- **CUANDO** en noviembre de 2026 (periodo abierto) "Super" tiene 3 porciones de gasto que suman 320.50 BOB y "Supermercado" porciones que suman 1240.00 BOB, y el EDITOR fusiona "Super" en "Supermercado"
- **ENTONCES** el reporte de gastos de noviembre de 2026 muestra "Supermercado" = 1560.50 BOB y no muestra "Super"
- **Y** "Super" queda archivada y marcada como fusionada en "Supermercado", y el número de asientos y los saldos de las cuentas no cambian

#### Scenario: Tipos de movimiento distintos
- **CUANDO** el EDITOR intenta fusionar la categoría de gasto "Super" en la categoría de ingreso "Sueldo"
- **ENTONCES** se rechaza con `CATEGORY_KIND_MISMATCH` y ninguna porción cambia

#### Scenario: Origen de sistema
- **CUANDO** el EDITOR intenta fusionar la categoría de sistema "Comisiones" en "Gastos bancarios"
- **ENTONCES** se rechaza con `SYSTEM_CATEGORY_IMMUTABLE` y "Comisiones" sigue activa

#### Scenario: Destino archivada
- **CUANDO** el EDITOR intenta fusionar "Super" en la categoría archivada "Old Market"
- **ENTONCES** se rechaza con `CATEGORY_ARCHIVED` y "Super" sigue con sus porciones

#### Scenario: Origen igual a la destino
- **CUANDO** el EDITOR intenta fusionar "Supermercado" en "Supermercado"
- **ENTONCES** se rechaza con `VALIDATION_FAILED` sin cambios

#### Scenario: VIEWER no fusiona
- **CUANDO** un VIEWER intenta fusionar "Super" en "Supermercado"
- **ENTONCES** se rechaza con `INSUFFICIENT_ROLE` sin cambios

#### Scenario: Repetir la misma fusión
- **CUANDO** el EDITOR repite con la misma clave de idempotencia la fusión de "Super" en "Supermercado" que ya se aplicó
- **ENTONCES** recibe el mismo resultado y "Supermercado" sigue sumando 1560.50 BOB en noviembre de 2026

### Requirement: Vista previa de la fusión de categorías
Antes de fusionar, todo miembro del workspace DEBE (MUST) poder consultar la vista previa de la fusión de una categoría en otra. La vista previa DEBE (MUST) informar:
- la cantidad de referencias que pasarán a la destino: porciones, líneas de planes, plantillas, compromisos recurrentes, reglas, contrapartes con esa categoría por defecto, categorías esenciales del disponible, filas de importaciones sin persistir y subcategorías;
- la cantidad de porciones que conservarán la origen por estar en periodos cerrados;
- los conflictos que impiden la fusión.

La vista previa NO DEBE (MUST NOT) cambiar nada. Una fusión con conflictos DEBE (MUST) rechazarse con `CLASSIFICATION_MERGE_CONFLICT`, indicando cada conflicto, sin cambios.

Trace: FR-CLASSIFICATION-007 · Priority: Could

#### Scenario: Vista previa sin conflictos
- **CUANDO** "Super" tiene 3 porciones en noviembre de 2026 (abierto) y 2 en octubre de 2026 (cerrado), está en 1 línea del plan de noviembre de 2026 y en 1 regla, y el usuario pide la vista previa de su fusión en "Supermercado"
- **ENTONCES** la vista previa informa 3 porciones a reasignar, 2 porciones que conservan la origen por estar en periodos cerrados, 1 línea de plan, 1 regla y ningún conflicto
- **Y** ninguna porción, línea ni regla cambia

#### Scenario: Plan con líneas de las dos categorías
- **CUANDO** el plan de noviembre de 2026 tiene la línea "Super" con máximo 400.00 BOB y la línea "Supermercado" con máximo 1500.00 BOB, y el EDITOR fusiona "Super" en "Supermercado"
- **ENTONCES** la vista previa informa el conflicto del plan de noviembre de 2026 y la fusión se rechaza con `CLASSIFICATION_MERGE_CONFLICT`
- **Y** las dos líneas, las porciones y "Super" quedan como estaban

### Requirement: Fusión de una categoría con subcategorías
Al fusionar una categoría origen que tiene subcategorías activas en una destino de primer nivel, esas subcategorías DEBEN (MUST) pasar a ser subcategorías de la destino conservando sus porciones. Si la destino es una subcategoría, la fusión DEBE (MUST) rechazarse con `CATEGORY_DEPTH_EXCEEDED`. Si una subcategoría que se mueve tiene el nombre de una subcategoría activa de la destino, DEBE (MUST) rechazarse con `CLASSIFICATION_MERGE_CONFLICT`. Fusionar una subcategoría en su categoría padre DEBE (MUST) permitirse.
Trace: FR-CLASSIFICATION-007, FR-CLASSIFICATION-001 · Priority: Could

#### Scenario: Subcategorías que pasan a la destino
- **CUANDO** "Servicios" tiene las subcategorías activas "Luz" y "Agua" y el EDITOR la fusiona en "Servicios básicos", de primer nivel y sin subcategorías con esos nombres
- **ENTONCES** "Luz" y "Agua" quedan como subcategorías de "Servicios básicos"
- **Y** el gasto de "Luz" de 180.00 BOB de noviembre de 2026 sigue en "Luz"

#### Scenario: Destino que es una subcategoría
- **CUANDO** el EDITOR intenta fusionar "Servicios", que tiene la subcategoría activa "Luz", en la subcategoría "Mantenimiento" de "Hogar"
- **ENTONCES** se rechaza con `CATEGORY_DEPTH_EXCEEDED` sin cambios

#### Scenario: Subcategoría fusionada en su padre
- **CUANDO** "Luz" tiene gastos de noviembre de 2026 que suman 180.00 BOB y el EDITOR la fusiona en su padre "Servicios básicos"
- **ENTONCES** esos 180.00 BOB pasan a "Servicios básicos" y "Luz" queda archivada y marcada como fusionada

#### Scenario: Subcategoría con un nombre que ya usa la destino
- **CUANDO** "Servicios" tiene la subcategoría activa "Agua", "Servicios básicos" también, y el EDITOR fusiona "Servicios" en "Servicios básicos"
- **ENTONCES** se rechaza con `CLASSIFICATION_MERGE_CONFLICT` indicando la subcategoría "Agua", sin cambios

### Requirement: Fusión de categorías y periodos cerrados
La fusión NO DEBE (MUST NOT) reasignar las porciones de transacciones cuya fecha de negocio cae en un periodo financiero cerrado. Esas porciones DEBEN (MUST) conservar la origen, y los reportes y los snapshots de esos periodos NO DEBEN (MUST NOT) cambiar: muestran la origen como archivada y fusionada en la destino. Las porciones de periodos abiertos o reabiertos DEBEN (MUST) reasignarse.
Trace: FR-CLASSIFICATION-007, FR-PLANNING-005, INV-019 · Priority: Could

#### Scenario: Octubre cerrado y noviembre abierto
- **CUANDO** "Super" tiene un gasto de 100.00 BOB en octubre de 2026, periodo cerrado, y gastos que suman 320.50 BOB en noviembre de 2026, abierto, y el EDITOR la fusiona en "Supermercado"
- **ENTONCES** el gasto de octubre sigue en "Super" y el reporte de octubre de 2026 muestra "Super" = 100.00 BOB, archivada y fusionada en "Supermercado", igual que su snapshot de cierre
- **Y** los gastos de noviembre pasan a "Supermercado"

#### Scenario: Periodo reabierto
- **CUANDO** octubre de 2026 está reabierto al fusionar "Super" en "Supermercado"
- **ENTONCES** el gasto de 100.00 BOB de octubre pasa a "Supermercado"

### Requirement: Referencias a la categoría fusionada en otros contextos
En la misma operación, la fusión DEBE (MUST) llevar a la destino toda referencia viva a la origen:
- las líneas de los planes de periodos no cerrados;
- las plantillas de presupuesto vigentes, con una versión nueva;
- la categoría de los compromisos recurrentes activos, sin cambiar sus ocurrencias ni sus montos;
- las condiciones y acciones de las reglas no archivadas, con una versión nueva de cada regla;
- la categoría por defecto de las contrapartes;
- la lista de categorías esenciales del disponible, sin repetir la destino;
- la clasificación de las filas de importaciones todavía no persistidas.

La historia (versiones anteriores de reglas y plantillas, decisiones sobre sugerencias, pronósticos publicados y gastos atípicos marcados) NO DEBE (MUST NOT) cambiar.

Trace: FR-CLASSIFICATION-007, FR-PLANNING-008, FR-COMMITMENTS-001, FR-RULES-001 · Priority: Could

#### Scenario: Plan, plantilla, compromiso y regla
- **CUANDO** el plan de noviembre de 2026 tiene la línea "Super" con máximo 400.00 BOB y ninguna de "Supermercado", la plantilla vigente "Mensual" tiene la línea "Super", el compromiso "Mercado semanal" de 150.00 BOB es de "Super" y la regla "HIPERMAXI" asigna "Super", y el EDITOR fusiona "Super" en "Supermercado"
- **ENTONCES** el plan de noviembre tiene la línea "Supermercado" con máximo 400.00 BOB y la plantilla "Mensual" tiene una versión nueva con la línea "Supermercado"
- **Y** "Mercado semanal" es de "Supermercado" con sus ocurrencias de 150.00 BOB sin cambios, y la regla "HIPERMAXI" tiene una versión nueva que asigna "Supermercado"

#### Scenario: Contraparte y categorías esenciales
- **CUANDO** "Hipermaxi" tiene "Super" como categoría por defecto, las categorías esenciales del disponible son "Super" y "Supermercado", y el EDITOR fusiona "Super" en "Supermercado"
- **ENTONCES** "Hipermaxi" tiene "Supermercado" como categoría por defecto y las categorías esenciales son solo "Supermercado"

#### Scenario: Importación en revisión
- **CUANDO** una importación de "Banco BOB" en revisión tiene una fila de 85.50 BOB clasificada en "Super" y el EDITOR fusiona "Super" en "Supermercado"
- **ENTONCES** la fila queda clasificada en "Supermercado" y al aprobar la importación el gasto se registra en "Supermercado"

### Requirement: Una categoría fusionada no se desarchiva ni se vuelve a fusionar
Una categoría fusionada DEBE (MUST) quedar archivada de forma permanente: desarchivarla o usarla como origen o destino de otra fusión DEBE (MUST) rechazarse con `CATEGORY_MERGED`, indicando la destino, sin cambios. Los históricos DEBEN (MUST) seguir mostrándola con su nombre y la destino en la que se fusionó.
Trace: FR-CLASSIFICATION-007, FR-CLASSIFICATION-002 · Priority: Could

#### Scenario: Desarchivar una categoría fusionada
- **CUANDO** "Super" se fusionó en "Supermercado" y el EDITOR intenta desarchivarla
- **ENTONCES** se rechaza con `CATEGORY_MERGED` indicando "Supermercado"

#### Scenario: Fusionar de nuevo una categoría fusionada
- **CUANDO** "Super" se fusionó en "Supermercado" y el EDITOR intenta fusionar "Super" en "Mercado"
- **ENTONCES** se rechaza con `CATEGORY_MERGED` sin cambios

### Requirement: Continuidad de la historia de una categoría fusionada en los análisis
Los pronósticos por categoría, la detección de gastos atípicos y las sugerencias de categoría DEBEN (MUST) leer la historia de una categoría fusionada como historia de su destino vigente, incluidas las porciones que conservaron la origen por estar en periodos cerrados. Una sugerencia de categoría NO DEBE (MUST NOT) proponer una categoría fusionada. Los reportes por periodo, los snapshots de cierre y lo ya calculado (pronósticos publicados, gastos atípicos marcados y decisiones sobre sugerencias) NO DEBEN (MUST NOT) cambiar por esa lectura.
Trace: FR-CLASSIFICATION-007, FR-FORECAST-001, FR-FORECAST-010, FR-CLASSIFICATION-014 · Priority: Could

#### Scenario: Serie de pronóstico con meses cerrados de la origen
- **CUANDO** "Super" tiene un gasto de 100.00 BOB en cada mes de mayo a octubre de 2026, todos periodos cerrados, "Supermercado" no tiene gastos en esos meses, y en noviembre de 2026 el EDITOR fusiona "Super" en "Supermercado"
- **ENTONCES** la siguiente corrida de pronóstico prepara la serie de "Supermercado" con 100.00 BOB en cada mes de mayo a octubre de 2026
- **Y** el reporte de octubre de 2026 sigue mostrando "Super" = 100.00 BOB

#### Scenario: Gasto atípico con la historia de la origen
- **CUANDO** "Super" tiene 12 gastos de entre 70.00 y 90.00 BOB en periodos cerrados, "Supermercado" no tiene gastos anteriores, el EDITOR fusiona "Super" en "Supermercado" y después se registra un gasto de 400.00 BOB en "Supermercado"
- **ENTONCES** la detección evalúa ese gasto con una historia de 12 gastos de "Supermercado"
- **Y** los gastos atípicos marcados antes de la fusión no cambian

#### Scenario: Sugerencia con la evidencia de la origen
- **CUANDO** los gastos con la descripción "HIPERMAXI" están clasificados en "Super" en periodos cerrados, el EDITOR fusiona "Super" en "Supermercado" y después registra un gasto con la descripción "HIPERMAXI"
- **ENTONCES** la sugerencia de categoría es "Supermercado" y nunca "Super"
