## ADDED Requirements

### Requirement: Sugerencia de reglas por clasificaciones manuales repetidas
El sistema DEBE (MUST) sugerir una regla "patrón ⇒ categoría" cuando, dentro de la ventana de evidencia (los últimos 180 días hasta hoy en la zona horaria del workspace, configurable hasta 366), al menos 3 transacciones distintas del mismo tipo que comparten un patrón fueron clasificadas a mano en la misma categoría. La regla sugerida DEBE (MUST) tener como condiciones el patrón y el tipo de transacción, como única acción fijar esa categoría y los disparadores por omisión de una regla nueva.
Trace: FR-RULES-011, FR-RULES-001 · Priority: Could

#### Scenario: Recargas de Tigo clasificadas a mano
- **CUANDO** el 2026-11-04 hay 4 gastos "TIGO MONEY RECARGA 77712345", "TIGO MONEY RECARGA 77754321", "TIGO MONEY RECARGA 70011122" y "TIGO MONEY RECARGA 77712345" de 20.00 a 50.00 BOB entre el 2026-07-02 y el 2026-10-28, los 4 clasificados a mano en "Telefonía"
- **ENTONCES** se sugiere la regla "descripción contiene `tigo money recarga` y tipo = gasto ⇒ categoría Telefonía"
- **Y** la sugerencia informa apoyo de 4 transacciones

#### Scenario: Dos repeticiones no alcanzan
- **CUANDO** solo 2 gastos "TIGO MONEY RECARGA" fueron clasificados a mano en "Telefonía" en la ventana
- **ENTONCES** no se sugiere ninguna regla para ese patrón

#### Scenario: Evidencia fuera de la ventana
- **CUANDO** hay 3 gastos "TIGO MONEY RECARGA" clasificados a mano en "Telefonía" con fechas 2026-04-20, 2026-09-01 y 2026-10-01
- **ENTONCES** no se sugiere ninguna regla, porque el del 2026-04-20 queda fuera de los 180 días

### Requirement: Evidencia de clasificación manual
Solo DEBEN (MUST) contar como evidencia las transacciones de ingreso, gasto o reembolso no anuladas, de un único split, no administradas por otro módulo, cuya categoría vigente no es "sin categoría" ni está archivada y fue fijada por el usuario: origen manual, u origen desconocido (anterior al motor de reglas) en transacciones registradas a mano o importadas. Una categoría fijada por una regla, por la categoría por defecto de la contraparte o por el sistema NO DEBE (MUST NOT) contar, y una corrección manual de lo que puso una regla DEBE (MUST) contar como evidencia de la categoría corregida.
Trace: FR-RULES-011, FR-RULES-010 · Priority: Could

#### Scenario: Clasificaciones hechas por una regla no son evidencia
- **CUANDO** 5 gastos "HIPERMAXI SUC 12" tienen hoy la categoría "Supermercado" fijada por la regla "Supermercado"
- **ENTONCES** esos 5 gastos no cuentan como evidencia y no se sugiere otra regla para ellos

#### Scenario: Correcciones de una regla cuentan
- **CUANDO** la regla "Supermercado" puso 3 gastos "FARMACORP SUC 3" en "Supermercado" y el usuario los corrigió a mano a "Farmacia"
- **ENTONCES** los 3 cuentan como evidencia de "Farmacia" y se sugiere una regla hacia "Farmacia"

#### Scenario: Historia anterior al motor de reglas
- **CUANDO** 3 gastos "GIMNASIO BODYTECH" registrados a mano en junio de 2026, antes del motor de reglas, tienen la categoría "Gimnasio" con origen desconocido
- **ENTONCES** los 3 cuentan como evidencia y se sugiere la regla hacia "Gimnasio"

#### Scenario: Transacciones de varios splits y préstamos excluidas
- **CUANDO** 3 gastos "PAGO CUOTA" son la cuota de un préstamo administrado por Deudas y otros 3 "SUPER CENTER" tienen 2 splits cada uno
- **ENTONCES** ninguno de los 6 cuenta como evidencia

### Requirement: Patrones por descripción normalizada y por contraparte
El patrón de descripción DEBE (MUST) ser el texto normalizado (sin acentos, en minúsculas y con espacios colapsados) sin las palabras que contienen dígitos o asteriscos ni las de un solo carácter, limitado a sus 5 primeras palabras y con al menos 3 letras; el patrón de contraparte DEBE (MUST) ser la contraparte de la transacción. Cuando la evidencia de una sugerencia por descripción está contenida en la de una sugerencia por contraparte hacia la misma categoría y del mismo tipo, DEBE (MUST) sugerirse solo la de contraparte.
Trace: FR-RULES-011, FR-RULES-003 · Priority: Could

#### Scenario: Clave sin números de tarjeta ni de sucursal
- **CUANDO** un gasto tiene la descripción "COMPRA TARJ ****1234 FARMACORP SUC 3"
- **ENTONCES** su patrón de descripción es `compra tarj farmacorp suc`

#### Scenario: Contraparte con glosas distintas
- **CUANDO** 4 gastos con la contraparte "Farmacorp" y descripciones "FARMACORP SUC 3", "FARMACORP SUC 9", "FARMACORP SUC 12" y "QR FARMACORP" fueron clasificados a mano en "Farmacia"
- **ENTONCES** se sugiere la regla "contraparte = Farmacorp y tipo = gasto ⇒ categoría Farmacia"
- **Y** no se sugiere la regla por la descripción `farmacorp suc`, cuya evidencia (3 gastos) está contenida en la de la contraparte

### Requirement: Confianza de la sugerencia
La confianza DEBE (MUST) ser la cantidad de transacciones de evidencia del patrón en la categoría sugerida dividida por el total de transacciones de evidencia del patrón y del mismo tipo, con 4 decimales HALF_EVEN. Solo DEBE (MUST) sugerirse un patrón con confianza de al menos 0.8000 y con una categoría con más evidencia que cualquier otra; la confianza DEBE (MUST) mostrarse como "alta" cuando es al menos 0.9500 con 5 o más transacciones y como "media" en otro caso.
Trace: FR-RULES-011 · Priority: Could

#### Scenario: Cuatro de cinco
- **CUANDO** hay 5 gastos "PEDIDOSYA" clasificados a mano, 4 en "Restaurantes" y 1 en "Supermercado"
- **ENTONCES** se sugiere la regla hacia "Restaurantes" con confianza 0.8000 y nivel "media"

#### Scenario: Tres de cuatro no alcanza
- **CUANDO** hay 4 gastos "PEDIDOSYA" clasificados a mano, 3 en "Restaurantes" y 1 en "Supermercado"
- **ENTONCES** no se sugiere ninguna regla para ese patrón (confianza 0.7500)

#### Scenario: Redondeo de la confianza
- **CUANDO** hay 6 gastos "UBER TRIP" clasificados a mano, 5 en "Taxi" y 1 en "Viajes"
- **ENTONCES** se sugiere la regla hacia "Taxi" con confianza 0.8333 y nivel "media"

### Requirement: Patrones ya cubiertos o en conflicto con reglas existentes
Antes de sugerir, el sistema DEBE (MUST) evaluar las reglas activas sobre la evidencia como si su categoría estuviera vacía: si fijan la categoría sugerida en toda la evidencia, NO DEBE (MUST NOT) sugerir nada; si alguna fija otra categoría, la sugerencia DEBE (MUST) informar cada regla en conflicto con la cantidad de transacciones afectadas y proponer una prioridad una unidad menor que la menor prioridad en conflicto (mínimo 0), avisando cuando no puede quedar antes.
Trace: FR-RULES-011, FR-RULES-006 · Priority: Could

#### Scenario: Patrón ya cubierto
- **CUANDO** hay 4 gastos "TIGO MONEY RECARGA" clasificados a mano en "Telefonía" y existe la regla activa "Tigo" (descripción contiene `tigo money` ⇒ Telefonía)
- **ENTONCES** no se sugiere ninguna regla para ese patrón

#### Scenario: Corrección de una regla existente
- **CUANDO** los 3 gastos "FARMACORP SUC 3" corregidos a "Farmacia" coinciden con la regla "Supermercado" de prioridad 100, que fija "Supermercado"
- **ENTONCES** la sugerencia hacia "Farmacia" informa el conflicto con "Supermercado" en 3 transacciones
- **Y** propone la prioridad 99

### Requirement: Explicación de la sugerencia
Cada sugerencia DEBE (MUST) mostrar el patrón, el tipo, la categoría, la ventana, el apoyo, el total del patrón, la confianza y su nivel, hasta 20 transacciones de evidencia (las más recientes, con fecha, descripción, monto y cuenta), las transacciones del patrón clasificadas en otras categorías con su categoría y las reglas en conflicto; los textos DEBEN (MUST) armarse en la interfaz desde códigos y datos.
Trace: FR-RULES-011, NFR-USAB-104 · Priority: Could

#### Scenario: Evidencia y contraejemplo de PedidosYa
- **CUANDO** se consulta la sugerencia de "PEDIDOSYA" hacia "Restaurantes" (4 de 5)
- **ENTONCES** se muestran las 4 transacciones de evidencia con fecha, descripción, monto y cuenta
- **Y** la transacción en "Supermercado" se muestra como contraejemplo

### Requirement: Vista previa de una sugerencia sin efectos
El sistema DEBE (MUST) permitir probar una sugerencia, tal como se propone o editada por el usuario, sobre las transacciones existentes de la ventana con el mismo evaluador y los mismos motivos de no aplicable que el dry-run, informando cuántas transacciones coinciden, cuántas completaría (hoy "sin categoría"), cuántas ya tienen la categoría sugerida y cuántas tienen otra; NO DEBE (MUST NOT) persistir ni auditar nada.
Trace: FR-RULES-011, FR-RULES-008 · Priority: Could

#### Scenario: Vista previa de Tigo
- **CUANDO** en la ventana coinciden con la sugerencia de Tigo 9 gastos: 4 clasificados a mano en "Telefonía", 3 "sin categoría" y 2 en "Recargas" por la categoría por defecto de su contraparte
- **ENTONCES** la vista previa informa 9 coincidencias, 3 que completaría, 4 que ya están en "Telefonía" y 2 con otra categoría
- **Y** ninguna transacción ni regla cambia

### Requirement: Aceptación explícita de una sugerencia
Solo una aceptación explícita del EDITOR DEBE (MUST) convertir una sugerencia en regla, con las modificaciones que él haga antes de guardar, mediante la misma creación y validación de cualquier regla. La regla nueva DEBE (MUST) quedar en la versión 1 con el registro de la sugerencia de origen, y la aceptación NO DEBE (MUST NOT) reclasificar transacciones existentes: aplicarla a la historia DEBE (MUST) hacerse con el dry-run y su aplicación. Aceptar o descartar una sugerencia ya decidida DEBE (MUST) rechazarse con `RULE_SUGGESTION_DECIDED`.
Trace: FR-RULES-011, FR-RULES-001, FR-RULES-008 · Priority: Could

#### Scenario: Aceptar la sugerencia de Tigo
- **CUANDO** el EDITOR acepta la sugerencia de Tigo con el nombre "Recargas Tigo"
- **ENTONCES** existe la regla "Recargas Tigo" en la versión 1, con disparadores importación y ejecución retroactiva y la sugerencia como origen
- **Y** los 3 gastos "sin categoría" siguen sin categoría hasta que el EDITOR aplique un dry-run

#### Scenario: Aceptar dos veces
- **CUANDO** el EDITOR intenta aceptar otra vez la sugerencia de Tigo ya aceptada
- **ENTONCES** la operación se rechaza con `RULE_SUGGESTION_DECIDED` y no se crea otra regla

### Requirement: Descartar una sugerencia
El EDITOR DEBE (MUST) poder descartar una sugerencia; una sugerencia descartada NO DEBE (MUST NOT) volver a mostrarse aunque crezca su evidencia, salvo en el listado de descartadas, desde donde DEBERÍA poder restaurarse.
Trace: FR-RULES-011 · Priority: Could

#### Scenario: Descartar PedidosYa
- **CUANDO** el EDITOR descarta la sugerencia de "PEDIDOSYA" hacia "Restaurantes" y luego se clasifican a mano 3 gastos "PEDIDOSYA" más en "Restaurantes"
- **ENTONCES** la sugerencia no aparece en el listado
- **Y** aparece en el listado de descartadas con apoyo 7

### Requirement: Sin creación ni aplicación automática de reglas sugeridas
Calcular, listar o probar sugerencias NO DEBE (MUST NOT) crear, modificar, activar ni aplicar reglas, ni modificar transacciones, ni dejar registros de auditoría, y NO DEBE (MUST NOT) ejecutarse en segundo plano: las sugerencias se calculan solo cuando un usuario las pide.
Trace: FR-RULES-011, FR-RULES-009 · Priority: Must

#### Scenario: Listar sugerencias no cambia nada
- **CUANDO** el EDITOR lista las sugerencias y prueba la de Tigo sin aceptarla
- **ENTONCES** la cantidad de reglas, sus versiones y las transacciones no cambian
- **Y** el historial de auditoría no tiene registros nuevos

### Requirement: Permisos, auditoría y aislamiento de las sugerencias
Todo miembro (incluido VIEWER) DEBE (MUST) poder listar y probar sugerencias; aceptar, descartar y restaurar DEBEN (MUST) exigir rol EDITOR u OWNER (`INSUFFICIENT_ROLE`) y quedar auditados en la misma unidad de trabajo, con la regla creada en el caso de la aceptación. Las sugerencias de un workspace NO DEBEN (MUST NOT) usar evidencia ni reglas de otro.
Trace: FR-RULES-011, FR-IDENTITY-006, FR-AUDIT-001, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta aceptar
- **CUANDO** un VIEWER lista las sugerencias e intenta aceptar la de Tigo
- **ENTONCES** el listado responde y la aceptación se rechaza con `INSUFFICIENT_ROLE`

#### Scenario: Evidencia de otro workspace
- **CUANDO** "W2" tiene 5 gastos "TIGO MONEY RECARGA" clasificados a mano en "Telefonía" y "W1" ninguno
- **ENTONCES** "W1" no recibe ninguna sugerencia para ese patrón

### Requirement: Límites y rendimiento de las sugerencias
El cálculo DEBE (MUST) leer como máximo las 5 000 transacciones de evidencia más recientes de la ventana e indicar si quedó truncado, devolver como máximo 50 sugerencias ordenadas por apoyo descendente, luego por confianza descendente y luego por patrón, y tardar como máximo 3 s con 5 000 transacciones y 200 reglas activas.
Trace: FR-RULES-011, FR-RULES-006 · Priority: Should

#### Scenario: Ventana con más de 5 000 transacciones
- **CUANDO** la ventana tiene 6 200 transacciones de evidencia
- **ENTONCES** el cálculo usa las 5 000 más recientes y la respuesta indica que está truncada

#### Scenario: Cálculo con 200 reglas
- **CUANDO** el benchmark calcula sugerencias con 5 000 transacciones de evidencia y 200 reglas activas de 5 condiciones
- **ENTONCES** la respuesta tarda 3 s o menos
