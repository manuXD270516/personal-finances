# classification/categories Specification

## Purpose
Catálogo de categorías con el que el usuario da significado a sus ingresos y gastos: jerarquía de dos niveles (categoría → subcategoría) agrupada en grupos, tipo ingreso/gasto, categorías de sistema protegidas y traducibles, catálogo inicial opcional y archivado en lugar de borrado. La clasificación vive fuera del ledger: cambiarla nunca altera asientos ni saldos.

## Requirements

### Requirement: Creación de categorías con tipo de ingreso o gasto
El sistema DEBE (MUST) permitir crear categorías dentro de un grupo, con nombre, tipo (`income` o `expense`, igual al del grupo), icono, color y orden opcionales, en estado activo. El nombre DEBE (MUST) ser único, sin distinguir mayúsculas, entre las categorías activas con el mismo padre dentro del mismo grupo; un duplicado DEBE (MUST) rechazarse con `NAME_TAKEN`.
Trace: FR-CLASSIFICATION-001 · Priority: Must

#### Scenario: Categoría de gasto creada
- **CUANDO** el usuario crea la categoría "Supermercado" en el grupo de gasto "Alimentación" con icono "cart" y color "#2E7D32"
- **ENTONCES** la categoría queda activa, con tipo `expense`, icono "cart" y color "#2E7D32"
- **Y** aparece en el selector de categorías de gasto

#### Scenario: Nombre duplicado entre hermanas activas
- **CUANDO** ya existe la categoría activa "Supermercado" en "Alimentación" y el usuario crea "supermercado" en el mismo grupo y nivel
- **ENTONCES** la operación se rechaza con `NAME_TAKEN` y no se crea ninguna categoría

### Requirement: Jerarquía de dos niveles
Una categoría PUEDE tener subcategorías, que heredan su grupo y su tipo. El sistema NO DEBE (MUST NOT) permitir más de dos niveles: crear una subcategoría bajo otra subcategoría DEBE (MUST) rechazarse con `CATEGORY_DEPTH_EXCEEDED`, y crearla bajo una categoría archivada DEBE (MUST) rechazarse con `CATEGORY_ARCHIVED`.
Trace: FR-CLASSIFICATION-001 · Priority: Must

#### Scenario: Subcategoría creada
- **CUANDO** el usuario crea "Luz" como subcategoría de "Servicios básicos" (gasto, grupo "Vivienda")
- **ENTONCES** "Luz" queda activa con tipo `expense` y grupo "Vivienda"

#### Scenario: Tercer nivel rechazado
- **CUANDO** el usuario intenta crear "Luz departamento" como subcategoría de "Luz"
- **ENTONCES** la operación se rechaza con `CATEGORY_DEPTH_EXCEEDED`

### Requirement: El tipo de una categoría es inmutable
Una vez creada, el tipo (`income`/`expense`) de una categoría NO DEBE (MUST NOT) cambiar. Moverla a un grupo o padre de otro tipo DEBE (MUST) rechazarse con `CATEGORY_KIND_MISMATCH`; moverla a un grupo del mismo tipo DEBE (MUST) permitirse sin alterar las transacciones que la referencian.
Trace: FR-CLASSIFICATION-001 · Priority: Must

#### Scenario: Mover a un grupo de otro tipo
- **CUANDO** el usuario mueve la categoría de gasto "Restaurantes" al grupo de ingreso "Ingresos laborales"
- **ENTONCES** la operación se rechaza con `CATEGORY_KIND_MISMATCH` y la categoría conserva su grupo

#### Scenario: Mover a un grupo del mismo tipo
- **CUANDO** la categoría "Restaurantes" tiene gastos por 420.00 BOB en marzo de 2026 y el usuario la mueve del grupo "Alimentación" al grupo de gasto "Ocio"
- **ENTONCES** las transacciones siguen referenciando "Restaurantes" y el total de "Restaurantes" en marzo de 2026 sigue siendo 420.00 BOB

### Requirement: Compatibilidad del tipo de categoría con el movimiento
El sistema DEBE (MUST) rechazar con `CATEGORY_KIND_MISMATCH` la asignación de una categoría de gasto a una porción de ingreso o de una categoría de ingreso a una porción de gasto. Los reembolsos DEBEN (MUST) usar categorías de gasto.
Trace: FR-CLASSIFICATION-001 · Priority: Must

#### Scenario: Ingreso con categoría de gasto
- **CUANDO** el usuario registra un ingreso de 3,500.00 BOB con la categoría de gasto "Supermercado"
- **ENTONCES** la operación se rechaza con `CATEGORY_KIND_MISMATCH` y no se registra ninguna transacción

#### Scenario: Reembolso con categoría de gasto
- **CUANDO** el usuario registra un reembolso de 50.00 BOB con la categoría de gasto "Supermercado"
- **ENTONCES** el reembolso se acepta y reduce en 50.00 BOB el gasto del mes en "Supermercado"

### Requirement: Las categorías se archivan en lugar de eliminarse
El sistema NO DEBE (MUST NOT) eliminar categorías: la única forma de retirarlas es archivarlas. Ninguna operación DEBE (MUST) dejar una porción de transacción referenciando una categoría inexistente.
Trace: FR-CLASSIFICATION-002 · Priority: Must

#### Scenario: Intento de eliminar una categoría usada
- **CUANDO** el usuario solicita eliminar la categoría "Supermercado", usada por transacciones que suman 1,240.00 BOB
- **ENTONCES** la solicitud se rechaza sin cambios y se ofrece archivar la categoría
- **Y** todas las porciones siguen referenciando una categoría existente

### Requirement: Una categoría archivada conserva su historial
Archivar una categoría NO DEBE (MUST NOT) modificar las transacciones que la referencian ni sus montos; los históricos y reportes DEBEN (MUST) seguir mostrándola, identificada como archivada.
Trace: FR-CLASSIFICATION-002 · Priority: Must

#### Scenario: Reporte histórico con categoría archivada
- **CUANDO** la categoría "Old Gym" tiene 3 transacciones que suman 450.00 BOB en 2025 y el usuario la archiva
- **ENTONCES** las 3 transacciones siguen referenciando "Old Gym"
- **Y** el reporte de gastos de 2025 por categoría muestra "Old Gym" = 450.00 BOB marcada como archivada

### Requirement: Una categoría archivada no es asignable
Una categoría archivada NO DEBE (MUST NOT) aparecer en los selectores ni asignarse a transacciones nuevas o editadas; el intento DEBE (MUST) rechazarse con `CATEGORY_ARCHIVED`. El listado DEBE (MUST) excluir las categorías archivadas salvo que se pidan explícitamente.
Trace: FR-CLASSIFICATION-002 · Priority: Must

#### Scenario: Asignación a una categoría archivada
- **CUANDO** el usuario registra un gasto de 150.00 BOB con fecha 2026-03-01 en la categoría archivada "Old Gym"
- **ENTONCES** la operación se rechaza con `CATEGORY_ARCHIVED`

#### Scenario: Listado sin archivadas
- **CUANDO** el usuario lista las categorías sin pedir las archivadas
- **ENTONCES** "Old Gym" no aparece en el resultado

### Requirement: Desarchivar una categoría
El sistema DEBE (MUST) permitir desarchivar una categoría, que vuelve a ser asignable. Desarchivar una subcategoría cuyo padre está archivado DEBE (MUST) rechazarse con `CATEGORY_ARCHIVED`, y desarchivar una categoría cuyo nombre ya usa una hermana activa DEBE (MUST) rechazarse con `NAME_TAKEN`.
Trace: FR-CLASSIFICATION-001 · Priority: Should

#### Scenario: Categoría desarchivada
- **CUANDO** el usuario desarchiva "Old Gym" y luego registra un gasto de 150.00 BOB en ella
- **ENTONCES** el gasto se acepta con la categoría "Old Gym"

### Requirement: Archivar una categoría archiva sus subcategorías
Archivar una categoría DEBE (MUST) archivar también sus subcategorías activas en la misma operación, de modo que ninguna subcategoría activa cuelgue de un padre archivado.
Trace: FR-CLASSIFICATION-002 · Priority: Must

#### Scenario: Archivado en cascada
- **CUANDO** el usuario archiva "Servicios básicos", que tiene las subcategorías activas "Luz" y "Agua"
- **ENTONCES** "Servicios básicos", "Luz" y "Agua" quedan archivadas
- **Y** las transacciones de "Luz" por 180.00 BOB en febrero de 2026 siguen referenciando "Luz"

### Requirement: Renombrar una categoría no altera el historial
Las transacciones DEBEN (MUST) referenciar las categorías por identidad, no por nombre: renombrar una categoría DEBE (MUST) reflejarse en todos los históricos sin modificar transacciones ni montos.
Trace: FR-CLASSIFICATION-002 · Priority: Must

#### Scenario: Renombrar con historial
- **CUANDO** la categoría "Super" tiene gastos por 320.50 BOB en marzo de 2026 y el usuario la renombra a "Supermercado"
- **ENTONCES** el reporte de marzo de 2026 muestra "Supermercado" = 320.50 BOB
- **Y** ninguna transacción cambia de categoría ni de monto

### Requirement: Categorías de sistema provisionadas en cada workspace
Al crear un workspace el sistema DEBE (MUST) provisionar, independientemente del catálogo inicial, las categorías de sistema: Comisiones, Comisiones de cambio, Intereses pagados, Comisiones de préstamo, Seguros, Impuestos, Ajustes (gasto) y Sin categoría (gasto), e Intereses ganados, Ajustes (ingreso) y Sin categoría (ingreso), cada una con un código de sistema estable.
Trace: FR-CLASSIFICATION-003 · Priority: Must

#### Scenario: Workspace nuevo sin catálogo inicial
- **CUANDO** el usuario crea un workspace eligiendo no cargar el catálogo inicial
- **ENTONCES** el workspace contiene exactamente las categorías de sistema, cada una con su código y tipo
- **Y** no contiene ninguna categoría de usuario

### Requirement: Las categorías de sistema están protegidas
Las categorías de sistema NO DEBEN (MUST NOT) archivarse, renombrarse, cambiar de tipo ni convertirse en subcategorías; el intento DEBE (MUST) rechazarse con `SYSTEM_CATEGORY_IMMUTABLE`. Su icono, color, orden y grupo PUEDEN cambiarse.
Trace: FR-CLASSIFICATION-003 · Priority: Must

#### Scenario: Archivar una categoría de sistema
- **CUANDO** el usuario intenta archivar la categoría de sistema "Comisiones"
- **ENTONCES** la operación se rechaza con `SYSTEM_CATEGORY_IMMUTABLE` y la categoría sigue activa

#### Scenario: Cambiar el color de una categoría de sistema
- **CUANDO** el usuario cambia el color de "Comisiones" a "#C62828"
- **ENTONCES** el cambio se aplica y la categoría conserva su código de sistema

### Requirement: Nombres traducibles de las categorías de sistema
El nombre visible de cada categoría de sistema DEBE (MUST) mostrarse en el idioma de la interfaz del usuario (español por defecto; inglés y portugués preparados), sin alterar su identidad ni su código de sistema.
Trace: FR-CLASSIFICATION-003 · Priority: Must

#### Scenario: Mismo concepto en dos idiomas
- **CUANDO** un usuario con idioma `es-BO` y otro con idioma `en` consultan la categoría de sistema con código de comisiones
- **ENTONCES** el primero la ve como "Comisiones" y el segundo como "Fees"
- **Y** ambos ven la misma categoría con los mismos gastos asociados

### Requirement: Catálogo inicial de categorías opcional y editable
Al crear un workspace el usuario DEBE (MUST) poder elegir cargar el catálogo inicial sugerido; también DEBE (MUST) poder aplicarlo después, sin duplicar categorías existentes con el mismo nombre. Las categorías cargadas DEBEN (MUST) ser categorías de usuario comunes: editables y archivables.
Trace: FR-CLASSIFICATION-004 · Priority: Must

#### Scenario: Catálogo cargado al crear el workspace
- **CUANDO** el usuario crea un workspace aceptando el catálogo inicial
- **ENTONCES** el workspace contiene, además de las categorías de sistema, los grupos y categorías sugeridos, entre ellos "Supermercado" en "Alimentación"
- **Y** el usuario puede renombrar o archivar "Supermercado"

#### Scenario: Aplicar el catálogo dos veces
- **CUANDO** el usuario aplica el catálogo inicial a un workspace que ya lo tiene cargado
- **ENTONCES** no se crea ninguna categoría duplicada

### Requirement: Orden persistente de categorías
El usuario DEBE (MUST) poder reordenar las categorías dentro de su grupo y las subcategorías dentro de su padre; el orden DEBE (MUST) persistir y usarse en selectores y listados.
Trace: FR-CLASSIFICATION-005 · Priority: Should

#### Scenario: Reordenar subcategorías
- **CUANDO** el usuario reordena las subcategorías de "Servicios básicos" como "Internet", "Luz", "Agua"
- **ENTONCES** el listado posterior devuelve las subcategorías en ese orden

### Requirement: Grupos de categorías
El sistema DEBE (MUST) permitir gestionar grupos de categorías con nombre (único por tipo entre los activos), tipo y orden; toda categoría pertenece a un grupo de su mismo tipo, y los reportes PUEDEN agregar montos por grupo.
Trace: FR-CLASSIFICATION-006 · Priority: Should

#### Scenario: Total por grupo
- **CUANDO** el grupo "Vivienda" contiene "Alquiler" con 2,800.00 BOB y "Servicios básicos" con 310.00 BOB en marzo de 2026
- **ENTONCES** el total del grupo "Vivienda" en marzo de 2026 es 3,110.00 BOB

### Requirement: Archivar un grupo exige que sus categorías estén archivadas
Un grupo de categorías solo DEBE (MUST) poder archivarse si todas sus categorías están archivadas; en otro caso DEBE (MUST) rechazarse con `CATEGORY_GROUP_NOT_EMPTY`.
Trace: FR-CLASSIFICATION-006 · Priority: Should

#### Scenario: Grupo con categorías activas
- **CUANDO** el usuario intenta archivar el grupo "Vivienda", que contiene la categoría activa "Alquiler"
- **ENTONCES** la operación se rechaza con `CATEGORY_GROUP_NOT_EMPTY`

### Requirement: Recategorizar no modifica el ledger
Cambiar la categoría de una transacción NO DEBE (MUST NOT) crear, modificar ni revertir asientos contables ni alterar ningún saldo de cuenta; solo DEBE (MUST) cambiar los totales por categoría. Recategorizar una transacción cuya fecha cae en un periodo cerrado NO DEBE (MUST NOT) permitirse: DEBE (MUST) rechazarse con `PERIOD_CLOSED` sin cambiar la categoría.
Trace: FR-LEDGER-008, FR-TRANSACTIONS-008 · Priority: Must

#### Scenario: Recategorizar un gasto contabilizado
- **CUANDO** un gasto contabilizado de 150.00 BOB desde "Banco BOB" (saldo 2,000.00 BOB) se recategoriza de "Supermercado" a "Hogar"
- **ENTONCES** el número de asientos contables no cambia y el saldo de "Banco BOB" sigue siendo 2,000.00 BOB
- **Y** en el mes "Supermercado" disminuye 150.00 BOB y "Hogar" aumenta 150.00 BOB

#### Scenario: Recategorizar en un periodo cerrado
- **CUANDO** un gasto contabilizado de 150.00 BOB del 2026-03-15 categorizado como "Supermercado" pertenece a marzo de 2026, que está cerrado, y el usuario intenta recategorizarlo a "Hogar"
- **ENTONCES** se rechaza con `PERIOD_CLOSED`
- **Y** la porción sigue en "Supermercado", los totales de marzo por categoría no cambian y no se escribe auditoría ni evento

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
