# Spec Delta

## Purpose

Catálogo de categorías con el que el usuario da significado a sus ingresos y gastos: jerarquía de dos niveles (categoría → subcategoría) agrupada en grupos, tipo ingreso/gasto, categorías de sistema protegidas y traducibles, catálogo inicial opcional y archivado en lugar de borrado. La clasificación vive fuera del ledger: cambiarla nunca altera asientos ni saldos.

## ADDED Requirements

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
