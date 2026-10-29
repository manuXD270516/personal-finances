## ADDED Requirements

### Requirement: Definición de reglas WHEN/THEN
El sistema DEBE (MUST) permitir definir reglas por workspace con nombre (único sin distinguir mayúsculas entre las no archivadas), descripción opcional, prioridad numérica, modo de combinación, entre 1 y 20 condiciones (CUANDO), entre 1 y 10 acciones (ENTONCES), disparadores (importación, creación manual, ejecución retroactiva) y estado activo o inactivo; una regla nueva DEBE (MUST) nacer activa en la versión 1 y con los disparadores importación y ejecución retroactiva salvo que se indiquen otros. Una regla sin condiciones o sin acciones, o que supere esos límites, DEBE (MUST) rechazarse con `VALIDATION_FAILED`.
Trace: FR-RULES-001, FR-RULES-009 · Priority: Must

#### Scenario: Crear una regla de supermercado
- **CUANDO** el EDITOR crea la regla "Supermercado" con la condición "descripción contiene `hipermaxi`" y la acción "categoría = Supermercado", prioridad 100 y sin indicar disparadores
- **ENTONCES** la regla queda activa en la versión 1 con prioridad 100
- **Y** sus disparadores son importación y ejecución retroactiva (no creación manual)

#### Scenario: Regla sin acciones
- **CUANDO** el EDITOR intenta crear una regla con una condición y ninguna acción
- **ENTONCES** la operación se rechaza con `VALIDATION_FAILED` y no se crea ninguna regla

#### Scenario: Nombre repetido
- **CUANDO** existe la regla activa "Supermercado" y el EDITOR crea otra llamada "SUPERMERCADO"
- **ENTONCES** la operación se rechaza con `NAME_TAKEN`

### Requirement: Campos de condición
Una condición DEBE (MUST) poder evaluar descripción, contraparte, monto, moneda, cuenta, tipo de transacción, fecha, día de la semana, día del mes, categoría actual, etiquetas, fuente externa y el valor de un campo personalizado de transacciones. Una condición de monto DEBE (MUST) declarar su moneda y comparar el monto absoluto exacto (sin punto flotante) solo contra transacciones de esa moneda; una transacción de otra moneda NO DEBE (MUST NOT) cumplirla.
Trace: FR-RULES-002, FR-RULES-003 · Priority: Must

#### Scenario: Monto entre dos valores en bolivianos
- **CUANDO** la regla tiene la condición "monto entre 100.00 BOB y 500.00 BOB" y se evalúan un gasto de 250.00 BOB, uno de 500.00 BOB, uno de 500.01 BOB y uno de 250.00 USD
- **ENTONCES** cumplen la condición los gastos de 250.00 BOB y 500.00 BOB
- **Y** no la cumplen el de 500.01 BOB ni el de 250.00 USD

#### Scenario: Día del mes y tipo de transacción
- **CUANDO** la regla exige "tipo = ingreso" y "día del mes en 1..5" y se evalúan un ingreso del 2026-09-03 y otro del 2026-09-15 en America/La_Paz
- **ENTONCES** solo el ingreso del 2026-09-03 cumple la regla

#### Scenario: Campo personalizado de la transacción
- **CUANDO** la regla exige "campo personalizado `proyecto` = `casa`" y se evalúa un gasto existente con ese valor y otro sin valor
- **ENTONCES** solo el gasto con `proyecto = casa` cumple la condición

### Requirement: Operadores y comparación de texto
El sistema DEBE (MUST) ofrecer los operadores `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `matches_regex`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `is_empty` e `is_not_empty`, cada uno solo sobre los campos de tipo compatible; la comparación de texto DEBE (MUST) ignorar mayúsculas, acentos y espacios repetidos. Un operador incompatible con el campo DEBE (MUST) rechazarse al guardar con `VALIDATION_FAILED`.
Trace: FR-RULES-003 · Priority: Must

#### Scenario: Texto sin acentos ni mayúsculas
- **CUANDO** la regla tiene "descripción contiene `cafe`" y se evalúa la descripción "PAGO QR  CAFÉ Alexander"
- **ENTONCES** la condición se cumple

#### Scenario: Contraparte vacía
- **CUANDO** la regla tiene "contraparte `is_empty`" y se evalúan un gasto sin contraparte y otro con la contraparte "Hipermaxi"
- **ENTONCES** solo el gasto sin contraparte cumple la condición

#### Scenario: Operador incompatible
- **CUANDO** el EDITOR guarda una regla con "monto `starts_with` 100"
- **ENTONCES** la operación se rechaza con `VALIDATION_FAILED` y el puntero señala la condición

### Requirement: Expresiones regulares acotadas
Una condición `matches_regex` DEBE (MUST) evaluarse con un motor de tiempo lineal sobre como máximo 500 caracteres del texto, con un patrón de hasta 200 caracteres; un patrón inválido, más largo o que use construcciones sin tiempo lineal (referencias hacia atrás, lookaround) DEBE (MUST) rechazarse al guardar con `RULE_INVALID_REGEX`, y ningún patrón aceptado DEBE (MUST) poder bloquear la evaluación.
Trace: FR-RULES-003, NFR-SEC-009 · Priority: Must

#### Scenario: Patrón con referencia hacia atrás
- **CUANDO** el EDITOR guarda una regla con `matches_regex` y el patrón `(a+)\1`
- **ENTONCES** la operación se rechaza con `RULE_INVALID_REGEX`

#### Scenario: Patrón patológico acotado
- **CUANDO** una regla con el patrón `(a|aa)*b` se evalúa contra una descripción de 500 letras `a`
- **ENTONCES** la evaluación termina en menos de 50 ms sin coincidencia

### Requirement: Combinación de condiciones con ALL y ANY
Una regla DEBE (MUST) combinar sus condiciones con `ALL` (todas) o `ANY` (alguna) y admitir grupos anidados de un solo nivel, cada uno con su propio modo; un segundo nivel de anidamiento DEBE (MUST) rechazarse con `VALIDATION_FAILED`.
Trace: FR-RULES-004 · Priority: Should

#### Scenario: Grupo ANY dentro de una regla ALL
- **CUANDO** la regla es `ALL` con "tipo = gasto" y un grupo `ANY` con "descripción contiene `uber`" o "descripción contiene `yango`", y se evalúan un gasto "YANGO VIAJE" de 18.50 BOB y un ingreso "UBER REEMBOLSO" de 18.50 BOB
- **ENTONCES** solo el gasto "YANGO VIAJE" cumple la regla

### Requirement: Acciones de clasificación
Una regla DEBE (MUST) poder fijar la categoría, agregar o quitar etiquetas, fijar la contraparte, fijar el valor de un campo personalizado de transacciones y marcar la transacción para revisión. Las acciones sobre categoría, etiquetas y campos personalizados DEBEN (MUST) aplicarse al único split de la transacción.
Trace: FR-RULES-005 · Priority: Must

#### Scenario: Fila importada del supermercado
- **CUANDO** la regla "Supermercado" (descripción contiene `hipermaxi` ⇒ categoría Supermercado, etiqueta "hogar", contraparte "Hipermaxi") se evalúa sobre un gasto importado "HIPERMAXI SUC 12" de 185.40 BOB
- **ENTONCES** el resultado propone la categoría Supermercado, la etiqueta "hogar" y la contraparte "Hipermaxi"
- **Y** el monto sigue siendo 185.40 BOB

#### Scenario: Gasto grande marcado para revisión
- **CUANDO** la regla "Revisar gastos grandes" (tipo = gasto y monto mayor que 2000.00 BOB ⇒ marcar para revisión) se evalúa sobre un gasto de 2450.00 BOB
- **ENTONCES** el resultado marca la transacción para revisión con esa regla como motivo

### Requirement: Acciones de descripción, nota y exclusión del import
Una regla DEBE (MUST) poder reemplazar la descripción visible, agregar texto al final de las notas y, solo con el disparador de importación, excluir la fila del import; la exclusión NO DEBE (MUST NOT) tener efecto en la creación manual ni en la ejecución retroactiva, y el texto original de la fila importada DEBE (MUST) conservarse en la importación.
Trace: FR-RULES-005 · Priority: Should

#### Scenario: Renombrar una glosa bancaria
- **CUANDO** la regla "Netflix" (descripción contiene `nflx` ⇒ descripción = "Netflix") se evalúa en la vista previa de un import sobre la fila "DEB AUT NFLX.COM 0412"
- **ENTONCES** la fila propone la descripción "Netflix"
- **Y** la vista previa conserva el texto original "DEB AUT NFLX.COM 0412"

#### Scenario: Excluir transferencias propias del import
- **CUANDO** la regla "Traspasos propios" (descripción contiene `traspaso entre mis cuentas` ⇒ excluir del import) coincide con una fila importada y con una transacción en un dry-run retroactivo
- **ENTONCES** la fila importada queda propuesta como excluida
- **Y** el dry-run no propone ningún cambio para esa transacción

### Requirement: Las reglas no cambian datos financieros
Ninguna acción de regla DEBE (MUST) cambiar el monto, la moneda, la cuenta, la fecha, el tipo o el estado de una transacción, ni generar asientos; una definición que intente fijar esos campos DEBE (MUST) rechazarse con `VALIDATION_FAILED`.
Trace: FR-RULES-005, FR-CLASSIFICATION-002 · Priority: Must

#### Scenario: Acción sobre el monto
- **CUANDO** el EDITOR guarda una regla cuya acción es "monto = 100.00 BOB"
- **ENTONCES** la operación se rechaza con `VALIDATION_FAILED`

#### Scenario: Recategorizar un gasto posteado
- **CUANDO** una regla cambia la categoría de un gasto posteado de 185.40 BOB en "Banco BOB" (saldo 4000.00 BOB)
- **ENTONCES** el saldo de "Banco BOB" sigue en 4000.00 BOB
- **Y** no se crea ningún asiento nuevo

### Requirement: Prioridad y resolución acumulativa determinista
Las reglas activas del disparador DEBEN (MUST) evaluarse en orden de prioridad ascendente (menor número primero) y, a igual prioridad, por fecha de creación y luego por identificador; todas las reglas que coinciden DEBEN (MUST) aportar acciones, pero en cada campo de valor único (categoría, contraparte, descripción, cada campo personalizado) y en cada etiqueta gana la primera regla que lo fija, y las reglas posteriores NO DEBEN (MUST NOT) reemplazarlo. El mismo conjunto de reglas sobre la misma transacción DEBE (MUST) producir siempre el mismo resultado.
Trace: FR-RULES-006 · Priority: Must

#### Scenario: Dos reglas con categorías distintas
- **CUANDO** la regla "Restaurantes" (prioridad 10: descripción contiene `pollos` ⇒ categoría Restaurantes) y la regla "Comida" (prioridad 20: descripción contiene `pollos` ⇒ categoría Supermercado y etiqueta "comida") coinciden con el gasto "POLLOS COPACABANA" de 64.00 BOB
- **ENTONCES** la categoría propuesta es Restaurantes por la regla "Restaurantes"
- **Y** la etiqueta "comida" se agrega por la regla "Comida"

#### Scenario: Empate de prioridad
- **CUANDO** dos reglas de prioridad 50 fijan categorías distintas y la regla "A" se creó antes que la "B"
- **ENTONCES** la categoría propuesta es la de la regla "A"
- **Y** repetir la evaluación 100 veces con las reglas cargadas en cualquier orden da el mismo resultado

### Requirement: Detener el procesamiento
Una regla con la opción de detener el procesamiento DEBE (MUST), al coincidir, impedir que se evalúen las reglas de prioridad posterior para esa transacción; si no coincide, la evaluación DEBE (MUST) continuar normalmente.
Trace: FR-RULES-006 · Priority: Must

#### Scenario: Regla que detiene la evaluación
- **CUANDO** la regla "Restaurantes" (prioridad 10) detiene el procesamiento y la regla "Comida" (prioridad 20) agrega la etiqueta "comida", y ambas coincidirían con "POLLOS COPACABANA"
- **ENTONCES** se propone la categoría Restaurantes sin la etiqueta "comida"

#### Scenario: Regla que detiene pero no coincide
- **CUANDO** la regla de prioridad 10 que detiene el procesamiento no coincide con la transacción
- **ENTONCES** la regla de prioridad 20 se evalúa y aplica sus acciones

### Requirement: Referencias y acciones no aplicables
Al guardar una regla, cada categoría, etiqueta, contraparte y campo personalizado referenciado DEBE (MUST) existir y estar activo, con los códigos de Classification (`REFERENCE_NOT_FOUND`, `CATEGORY_ARCHIVED`, `TAG_ARCHIVED`, `COUNTERPARTY_ARCHIVED`, `CUSTOM_FIELD_ARCHIVED`, `CUSTOM_FIELD_VALUE_INVALID`). Al evaluar, una acción cuyo destino se archivó después, cuya categoría no corresponde al tipo de la transacción o que recae sobre una transacción con más de un split DEBE (MUST) omitirse con un motivo, sin fijar el campo, de modo que una regla posterior pueda fijarlo; la regla con un destino archivado DEBE (MUST) quedar señalada como "requiere atención".
Trace: FR-RULES-005, FR-CLASSIFICATION-002 · Priority: Must

#### Scenario: Categoría archivada después de crear la regla
- **CUANDO** la categoría Supermercado se archiva y la regla "Supermercado" se evalúa sobre "HIPERMAXI SUC 12"
- **ENTONCES** la acción de categoría se omite con el motivo `RULE_ACTION_TARGET_ARCHIVED`
- **Y** la regla aparece como "requiere atención" en el listado

#### Scenario: Categoría de gasto sobre un ingreso
- **CUANDO** la regla "A" (prioridad 10) fija la categoría de gasto Supermercado, la regla "B" (prioridad 20) fija la categoría de ingreso "Reembolsos varios", y ambas coinciden con un ingreso de 40.00 BOB
- **ENTONCES** la acción de "A" se omite con el motivo `CATEGORY_KIND_MISMATCH`
- **Y** la categoría propuesta es "Reembolsos varios" por la regla "B"

### Requirement: Vista previa de una regla
El sistema DEBE (MUST) permitir probar una regla guardada o una definición sin guardar contra una transacción existente o contra un ejemplo (descripción, monto con moneda, cuenta, fecha y tipo), mostrando cada condición con su resultado, las acciones resultantes y las omitidas con su motivo, sin persistir nada ni auditar.
Trace: FR-RULES-007 · Priority: Must

#### Scenario: Probar una definición sin guardar
- **CUANDO** el VIEWER prueba la definición "descripción contiene `tigo` y monto menor o igual que 150.00 BOB ⇒ categoría Telefonía" contra el ejemplo "TIGO MONEY RECARGA" de 100.00 BOB
- **ENTONCES** la respuesta muestra ambas condiciones cumplidas y la acción "categoría = Telefonía"
- **Y** no existe ninguna regla nueva ni ningún registro de auditoría

#### Scenario: Condición que falla
- **CUANDO** se prueba la misma definición contra el ejemplo "TIGO MONEY RECARGA" de 180.00 BOB
- **ENTONCES** la respuesta muestra la condición de monto como no cumplida y ninguna acción

### Requirement: Dry-run sobre transacciones existentes
El sistema DEBE (MUST) ejecutar una regla, un conjunto o todas las reglas con disparador retroactivo sobre las transacciones de ingreso, gasto y reembolso no anuladas de un rango de hasta 366 días (opcionalmente filtrado por cuentas), y devolver, sin persistir nada, el diff por transacción (campo, valor actual, valor propuesto, regla y versión). El modo por defecto DEBE (MUST) solo completar campos vacíos (categoría "sin categoría", sin contraparte, campo sin valor); el modo de reemplazo DEBE (MUST) pedirse explícitamente. Si el rango supera 5 000 transacciones, la respuesta DEBE (MUST) indicar que está truncada.
Trace: FR-RULES-008 · Priority: Should

#### Scenario: Completar categorías vacías de septiembre
- **CUANDO** el EDITOR ejecuta un dry-run de la regla "Supermercado" sobre 2026-09-01..2026-09-30 y hay 6 gastos con `hipermaxi`, 4 "sin categoría" y 2 ya en la categoría Hogar
- **ENTONCES** el diff propone categoría Supermercado para los 4 gastos "sin categoría" y para ninguno de los 2 de Hogar
- **Y** ninguna transacción cambia

#### Scenario: Modo de reemplazo
- **CUANDO** el EDITOR repite el dry-run en modo de reemplazo
- **ENTONCES** el diff propone categoría Supermercado para los 6 gastos

### Requirement: Aplicación del dry-run como edición masiva auditada
El EDITOR DEBE (MUST) poder aplicar el diff de un dry-run sobre hasta 500 transacciones por operación, en forma atómica y con la versión de cada transacción del dry-run; si alguna cambió desde el dry-run, la operación DEBE (MUST) rechazarse completa con `RULE_DRY_RUN_STALE`. Las transacciones en periodos cerrados DEBEN (MUST) quedar como no aplicables, igual que en la edición masiva. Cada transacción modificada DEBE (MUST) registrar la regla y versión aplicada y un registro de auditoría con un identificador de operación común.
Trace: FR-RULES-008, FR-RULES-010, FR-TRANSACTIONS-033 · Priority: Should

#### Scenario: Aplicar el dry-run de septiembre
- **CUANDO** el EDITOR aplica el dry-run de los 4 gastos "sin categoría"
- **ENTONCES** los 4 quedan en Supermercado con la regla "Supermercado" versión 1 como origen
- **Y** existen 4 registros de auditoría con el mismo identificador de operación

#### Scenario: Una transacción cambió después del dry-run
- **CUANDO** el usuario editó a mano uno de los 4 gastos entre el dry-run y la aplicación
- **ENTONCES** la aplicación se rechaza con `RULE_DRY_RUN_STALE` y ninguna de las 4 transacciones cambia

### Requirement: Evaluación sin efectos en la importación
Durante la vista previa de un import, las reglas activas con disparador de importación DEBEN (MUST) evaluarse sobre cada fila normalizada, con la contraparte reconocida por alias como dato evaluable, sin persistir nada en las reglas; la vista previa DEBE (MUST) mostrar en cada fila las acciones propuestas y la regla y versión que las originó. Al aprobar, cada transacción creada DEBE (MUST) llevar la clasificación propuesta (o la que el usuario editó en la fila) con su origen; una regla editada entre la vista previa y la aprobación NO DEBE (MUST NOT) cambiar en silencio lo que el usuario aprobó.
Trace: FR-RULES-009, FR-IMPORTS-008 · Priority: Must

#### Scenario: Tres filas, dos clasificadas por reglas
- **CUANDO** se previsualiza un import con "HIPERMAXI SUC 12" 185.40 BOB, "TIGO MONEY RECARGA" 100.00 BOB y "TRANSF 99812" 300.00 BOB, con las reglas "Supermercado" y "Telefonía" activas
- **ENTONCES** las dos primeras filas proponen Supermercado y Telefonía con su regla y versión
- **Y** la tercera queda "sin categoría" sin regla

#### Scenario: El usuario corrige una fila
- **CUANDO** el usuario cambia en la vista previa la categoría de "TIGO MONEY RECARGA" a "Internet" y aprueba
- **ENTONCES** la transacción creada tiene la categoría "Internet" con origen manual
- **Y** la de "HIPERMAXI SUC 12" tiene Supermercado con origen en la regla "Supermercado" versión 1

#### Scenario: La regla cambia antes de aprobar
- **CUANDO** el EDITOR modifica la regla "Supermercado" (versión 2) después de la vista previa y antes de aprobar
- **ENTONCES** la transacción creada conserva la clasificación mostrada con el origen versión 1
- **Y** la vista previa ofrece reevaluar las reglas antes de aprobar

### Requirement: Aplicación al crear una transacción manual
Al registrar manualmente un ingreso, gasto o reembolso, las reglas activas con disparador de creación manual DEBEN (MUST) aplicarse en la misma operación solo a los campos que el usuario dejó vacíos (categoría "sin categoría", sin contraparte, campo personalizado sin valor) y para agregar etiquetas o marcar para revisión; NO DEBEN (MUST NOT) reemplazar un valor elegido por el usuario. El usuario DEBE (MUST) poder pedir que no se apliquen reglas a esa creación.
Trace: FR-RULES-009 · Priority: Must

#### Scenario: Gasto manual sin categoría
- **CUANDO** la regla "Telefonía" tiene el disparador de creación manual y el usuario registra un gasto "Tigo recarga" de 100.00 BOB sin categoría
- **ENTONCES** el gasto queda en Telefonía con origen en la regla "Telefonía"

#### Scenario: El usuario ya eligió categoría
- **CUANDO** el usuario registra el mismo gasto con la categoría "Regalos"
- **ENTONCES** el gasto queda en "Regalos" con origen manual

#### Scenario: Creación sin reglas
- **CUANDO** el usuario registra el gasto sin categoría pidiendo no aplicar reglas
- **ENTONCES** el gasto queda "sin categoría" y ninguna regla figura como origen

### Requirement: Trazabilidad de la regla aplicada
Cada split cuya categoría, etiquetas, contraparte o campos personalizados fije una regla DEBE (MUST) registrar, por campo, la regla y la versión aplicada; el detalle de la transacción DEBE (MUST) mostrarlo y el registro de auditoría de la creación o del cambio DEBE (MUST) incluirlo. Un cambio manual posterior de ese campo DEBE (MUST) pasar su origen a manual, sin borrar la historia de auditoría.
Trace: FR-RULES-010 · Priority: Must

#### Scenario: Detalle de una transacción clasificada
- **CUANDO** el usuario abre el gasto importado "HIPERMAXI SUC 12"
- **ENTONCES** ve "Categoría: Supermercado, por la regla Supermercado (v1)" y "Etiqueta hogar, por la regla Supermercado (v1)"
- **Y** el registro de auditoría de su creación lista la regla y versión por campo

#### Scenario: Corrección manual posterior
- **CUANDO** el usuario cambia la categoría de ese gasto a "Hogar"
- **ENTONCES** la categoría queda con origen manual y la etiqueta conserva su origen en la regla
- **Y** la auditoría conserva el valor anterior con su regla

### Requirement: Activar, desactivar y archivar reglas
Una regla inactiva NO DEBE (MUST NOT) evaluarse en ningún disparador; una regla DEBE (MUST) archivarse en lugar de eliminarse (la API responde `405` a `DELETE`), dejar de evaluarse y liberar su nombre, y la referencia a ella desde transacciones ya clasificadas DEBE (MUST) seguir resolviéndose con su nombre y versión.
Trace: FR-RULES-001, FR-RULES-010 · Priority: Must

#### Scenario: Regla desactivada
- **CUANDO** el EDITOR desactiva la regla "Supermercado" y se previsualiza un import con "HIPERMAXI SUC 12"
- **ENTONCES** la fila queda "sin categoría" sin regla

#### Scenario: Regla archivada con transacciones clasificadas
- **CUANDO** el EDITOR archiva la regla "Supermercado" que clasificó 40 transacciones
- **ENTONCES** las 40 siguen mostrando "por la regla Supermercado (v1, archivada)"
- **Y** el EDITOR puede crear otra regla llamada "Supermercado"

### Requirement: Versionado de reglas
Modificar las condiciones, acciones, modo de combinación, disparadores o la opción de detener el procesamiento DEBE (MUST) crear una versión nueva e inmutable de la regla con control optimista (`If-Match`); las versiones anteriores DEBEN (MUST) seguir consultables y las transacciones clasificadas con ellas NO DEBEN (MUST NOT) cambiar. Cambiar el nombre, la descripción, la prioridad o el estado DEBE (MUST) auditarse sin crear versión.
Trace: FR-RULES-010 · Priority: Must

#### Scenario: Edición de las acciones
- **CUANDO** el EDITOR agrega la acción "etiqueta hogar" a la regla "Supermercado" (versión 1) con la versión vigente en `If-Match`
- **ENTONCES** la regla pasa a la versión 2 y la versión 1 sigue consultable con sus acciones originales
- **Y** las transacciones clasificadas antes siguen con origen versión 1

#### Scenario: Edición concurrente
- **CUANDO** dos EDITOR modifican la regla con la misma versión en `If-Match`
- **ENTONCES** la segunda modificación se rechaza con `PRECONDITION_FAILED`

#### Scenario: Reordenar no versiona
- **CUANDO** el EDITOR cambia la prioridad de la regla de 100 a 5
- **ENTONCES** la regla sigue en su versión y el cambio queda auditado

### Requirement: Cobertura de clasificación por reglas
El sistema DEBE (MUST) informar, para un rango de fechas de transacción o para un import, la cobertura de clasificación de las transacciones importadas: total de transacciones de ingreso, gasto y reembolso creadas por imports y no anuladas (sin transferencias ni conversiones), cuántas tienen hoy su categoría fijada por una regla, por la categoría por defecto de la contraparte, por el usuario o siguen "sin categoría", y el cociente "clasificadas por reglas ÷ total" con 4 decimales (HALF_EVEN) junto a la meta 0.7000 de Phase 6. Una transacción cuya categoría de regla el usuario corrigió después NO DEBE (MUST NOT) contarse como clasificada por reglas.
Trace: FR-RULES-010, FR-IMPORTS-008 · Priority: Must

#### Scenario: Tres meses importados
- **CUANDO** en 2026-07-01..2026-09-30 hay 200 transacciones importadas: 148 con categoría de regla, 20 por contraparte, 12 manuales y 20 "sin categoría"
- **ENTONCES** la cobertura informa total 200, reglas 148, contraparte 20, manual 12 y sin categoría 20
- **Y** el cociente es 0.7400 y cumple la meta 0.7000

#### Scenario: Corrección posterior y anulaciones
- **CUANDO** el usuario corrige a mano 3 de las 148 y anula 2 de las 20 "sin categoría"
- **ENTONCES** la cobertura informa total 198 y reglas 145
- **Y** el cociente es 0.7323

#### Scenario: Cobertura de un import
- **CUANDO** se consulta la cobertura del import de octubre con 57 transacciones creadas, 41 por reglas
- **ENTONCES** el cociente del import es 0.7193

### Requirement: Estadísticas por regla
El listado de reglas DEBE (MUST) mostrar por regla cuántas transacciones tienen hoy un campo fijado por ella y la fecha de su última aplicación, y señalar las reglas activas sin aplicaciones en los últimos 90 días.
Trace: FR-RULES-001, FR-RULES-010 · Priority: Should

#### Scenario: Regla sin uso
- **CUANDO** la regla "Gimnasio" está activa desde el 2026-06-01 y no clasificó ninguna transacción hasta el 2026-10-20
- **ENTONCES** el listado la muestra con 0 transacciones y la señal "sin aplicaciones en 90 días"

### Requirement: Límites y rendimiento de la evaluación
Un workspace NO DEBE (MUST NOT) tener más de 500 reglas no archivadas (`RULE_LIMIT_EXCEEDED`). Evaluar 5 000 filas contra 200 reglas activas de 5 condiciones DEBE (MUST) tardar como máximo 3 s, dentro de los 30 s de la vista previa de un import de 5 000 filas, y aplicar las reglas al crear una transacción manual con 200 reglas activas NO DEBE (MUST NOT) sumar más de 20 ms al p95 del registro.
Trace: NFR-PERF-007, NFR-PERF-003, FR-RULES-006 · Priority: Must

#### Scenario: Regla número 501
- **CUANDO** el workspace tiene 500 reglas no archivadas y el EDITOR crea otra
- **ENTONCES** la operación se rechaza con `RULE_LIMIT_EXCEEDED`

#### Scenario: Evaluación de un import grande
- **CUANDO** el benchmark evalúa 5 000 filas sintéticas contra 200 reglas activas de 5 condiciones (una con `matches_regex`)
- **ENTONCES** la evaluación termina en 3 s o menos

### Requirement: Permisos y auditoría de las reglas
Solo OWNER y EDITOR DEBEN (MUST) crear, modificar, reordenar, activar, desactivar, archivar reglas y aplicar un dry-run; VIEWER DEBE (MUST) poder listarlas, verlas, probarlas y consultar la cobertura; un VIEWER que intente escribir DEBE (MUST) recibir `INSUFFICIENT_ROLE`. Cada operación de escritura DEBE (MUST) auditarse en la misma unidad de trabajo, y las reglas de un workspace NO DEBEN (MUST NOT) ser visibles ni evaluarse en otro.
Trace: FR-RULES-001, NFR-SEC-003 · Priority: Must

#### Scenario: VIEWER intenta crear una regla
- **CUANDO** un VIEWER crea una regla
- **ENTONCES** la operación se rechaza con `INSUFFICIENT_ROLE`

#### Scenario: Aislamiento entre workspaces
- **CUANDO** "W2" previsualiza un import con "HIPERMAXI SUC 12" y solo "W1" tiene la regla "Supermercado"
- **ENTONCES** la fila de "W2" queda "sin categoría"

### Requirement: Crear una regla desde una transacción o fila importada
Desde una transacción o una fila de la vista previa de un import, el EDITOR DEBERÍA poder abrir una regla nueva prellenada con la descripción normalizada (sin números de referencia ni dígitos de tarjeta), la cuenta, el tipo y la categoría y contraparte elegidas, revisarla con la vista previa y guardarla; el sistema DEBE (MUST) no guardar nada hasta que el EDITOR confirme.
Trace: FR-RULES-001, FR-RULES-007 · Priority: Could

#### Scenario: Regla desde una fila de Tigo
- **CUANDO** el EDITOR elige "crear regla" sobre la fila "TIGO MONEY RECARGA 77712345" con categoría Telefonía
- **ENTONCES** se abre una regla prellenada con "descripción contiene `tigo money recarga`", "tipo = gasto" y la acción "categoría = Telefonía"
- **Y** no existe ninguna regla nueva hasta que la guarda
