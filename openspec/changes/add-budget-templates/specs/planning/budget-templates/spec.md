# Spec Delta

## Purpose

Permite reutilizar la planificación mes a mes: templates de presupuesto versionados (cada cambio crea una versión inmutable), creación del plan de un periodo desde una versión de template o clonando el plan del periodo anterior, aplicación automática del template por defecto a los periodos nuevos, edición local del plan sin tocar el template y propagación opcional a periodos futuros en borrador con vista previa, sin alterar nunca periodos cerrados.

## ADDED Requirements

### Requirement: Crear un template con su primera versión
El sistema DEBE (MUST) permitir crear un template de presupuesto con nombre único entre los templates activos del workspace y líneas de gasto e ingreso esperado con el mismo formato que las líneas del plan, quedando registrada su versión 1; un nombre repetido DEBE (MUST) rechazarse con `NAME_TAKEN`.
Trace: FR-PLANNING-009 · Priority: Must

#### Scenario: Template "Mes estándar"
- **CUANDO** el EDITOR crea el template "Mes estándar" con "Alquiler" fijo 2800.00 BOB, "Supermercado" máximo 1500.00 BOB y "Salario" esperado 8000.00 BOB
- **ENTONCES** el template queda activo con la versión 1 y esas tres líneas

#### Scenario: Nombre repetido rechazado
- **CUANDO** se intenta crear otro template activo llamado "mes estándar"
- **ENTONCES** la operación se rechaza con `NAME_TAKEN`

### Requirement: Cada modificación del template crea una versión inmutable
Modificar las líneas de un template DEBE (MUST) crear una versión nueva con número consecutivo y conservar sin cambios todas las versiones anteriores; una versión publicada NO DEBE (MUST NOT) modificarse, y una modificación basada en una versión que ya no es la última DEBE (MUST) rechazarse con `CONCURRENCY_CONFLICT`.
Trace: FR-PLANNING-009 · Priority: Must

#### Scenario: Subir el máximo de supermercado
- **CUANDO** el EDITOR cambia en "Mes estándar" el máximo de "Supermercado" de 1500.00 BOB a 1600.00 BOB con la nota "Inflación"
- **ENTONCES** existe la versión 2 con "Supermercado" en 1600.00 BOB y la nota "Inflación"
- **Y** la versión 1 sigue teniendo "Supermercado" en 1500.00 BOB

#### Scenario: Modificación sobre una versión vieja
- **CUANDO** "Mes estándar" ya está en la versión 2 y llega una modificación basada en la versión 1
- **ENTONCES** la operación se rechaza con `CONCURRENCY_CONFLICT` y no se crea la versión 3

### Requirement: Crear el plan de un periodo desde un template
El sistema DEBE (MUST) permitir crear el plan de un periodo sin plan desde una versión indicada de un template activo o, si no se indica, desde su última versión, copiando sus líneas; el plan DEBE (MUST) guardar el template y la versión de origen aunque luego existan versiones nuevas.
Trace: FR-PLANNING-010, FR-PLANNING-009 · Priority: Must

#### Scenario: Plan desde la última versión
- **CUANDO** "Mes estándar" tiene versiones 1 y 2 y el EDITOR crea el plan de "2026-11" desde "Mes estándar" sin indicar versión
- **ENTONCES** el plan tiene "Supermercado" máximo 1600.00 BOB, "Alquiler" fijo 2800.00 BOB y "Salario" esperado 8000.00 BOB
- **Y** el plan indica como origen "Mes estándar" versión 2

#### Scenario: Plan desde una versión anterior
- **CUANDO** el EDITOR crea el plan de "2026-11" desde "Mes estándar" versión 1
- **ENTONCES** el plan tiene "Supermercado" máximo 1500.00 BOB y origen "Mes estándar" versión 1

#### Scenario: El periodo ya tiene plan
- **CUANDO** el periodo "2026-11" ya tiene plan y se intenta crearlo desde "Mes estándar"
- **ENTONCES** la operación se rechaza con `BUDGET_ALREADY_EXISTS` y el plan existente no cambia

### Requirement: Líneas con objetivos archivados se omiten al aplicar
Al crear un plan desde un template o por clonado, las líneas cuyo objetivo (categoría, grupo o tag) esté archivado DEBEN (MUST) omitirse e informarse en la respuesta, sin fallar la operación y sin modificar el template de origen.
Trace: FR-PLANNING-010, FR-PLANNING-011 · Priority: Must

#### Scenario: Categoría Gimnasio archivada
- **CUANDO** "Mes estándar" versión 2 incluye "Gimnasio" máximo 250.00 BOB, "Gimnasio" está archivada y se crea el plan de "2026-11" desde ese template
- **ENTONCES** el plan se crea sin la línea "Gimnasio" y la respuesta informa "Gimnasio" como omitida por estar archivada
- **Y** la versión 2 de "Mes estándar" sigue incluyendo "Gimnasio"

### Requirement: Crear el plan clonando el plan del periodo anterior
El sistema DEBE (MUST) permitir crear el plan de un periodo copiando las líneas del plan del periodo inmediatamente anterior (objetivos, tipos, montos, umbrales y política de rollover), sin copiar gastado ni cruces de umbral, registrando el plan de origen y conservando la referencia al template de origen de cada línea; si el periodo anterior no tiene plan DEBE (MUST) rechazarse con `REFERENCE_NOT_FOUND`.
Trace: FR-PLANNING-011 · Priority: Must

#### Scenario: Noviembre clonado a diciembre
- **CUANDO** el plan de "2026-11" tiene "Restaurantes" máximo 650.00 BOB (editado a mano) con umbrales 80 y 100 % y un cruce del 80 % registrado, y se crea el plan de "2026-12" clonando el anterior
- **ENTONCES** el plan de "2026-12" tiene "Restaurantes" máximo 650.00 BOB con umbrales 80 y 100 %, sin cruces registrados y con origen el plan de "2026-11"

#### Scenario: Periodo anterior sin plan
- **CUANDO** se intenta crear el plan de "2027-01" clonando el anterior y "2026-12" no tiene plan
- **ENTONCES** la operación se rechaza con `REFERENCE_NOT_FOUND`

### Requirement: Template por defecto aplicado a los periodos nuevos
El workspace DEBE (MUST) poder marcar a lo sumo un template activo como predeterminado; al crearse un periodo nuevo, el sistema DEBE (MUST) crear su plan desde la última versión del template predeterminado una sola vez aunque la creación del periodo se reintente, y sin template predeterminado NO DEBE (MUST NOT) crear plan.
Trace: FR-PLANNING-010, FR-PLANNING-002 · Priority: Must

#### Scenario: Diciembre creado automáticamente con el predeterminado
- **CUANDO** "Mes estándar" es el predeterminado con última versión 2 y el 2026-11-01 se crea automáticamente el periodo "2026-12"
- **ENTONCES** "2026-12" tiene un plan con las líneas de "Mes estándar" versión 2 y origen ese template y versión

#### Scenario: Creación del periodo reintentada
- **CUANDO** la creación automática de "2026-12" se ejecuta dos veces
- **ENTONCES** "2026-12" tiene un solo plan

#### Scenario: Un solo predeterminado
- **CUANDO** "Mes estándar" es el predeterminado y el EDITOR marca "Mes de vacaciones" como predeterminado
- **ENTONCES** "Mes de vacaciones" queda predeterminado y "Mes estándar" deja de serlo

### Requirement: Modificar solo el plan actual
Editar, agregar o quitar líneas del plan de un periodo DEBE (MUST) afectar solo a ese plan: NO DEBE (MUST NOT) modificar el template ni la versión de origen ni los planes de otros periodos, y la línea editada DEBE (MUST) quedar marcada como modificada respecto del template.
Trace: FR-PLANNING-013 · Priority: Must

#### Scenario: Ajuste local de noviembre
- **CUANDO** el plan de "2026-11" viene de "Mes estándar" versión 2 y el EDITOR cambia en ese plan "Supermercado" de 1600.00 BOB a 1800.00 BOB
- **ENTONCES** el plan de "2026-11" tiene "Supermercado" 1800.00 BOB marcado como modificado
- **Y** "Mes estándar" versión 2 y el plan de "2026-12" siguen con "Supermercado" 1600.00 BOB

### Requirement: Clonar un template como template independiente
El sistema DEBE (MUST) permitir clonar una versión de un template como un template nuevo con otro nombre y su propia versión 1, sin vínculo de versiones con el original.
Trace: FR-PLANNING-012 · Priority: Should

#### Scenario: Mes de vacaciones desde Mes estándar
- **CUANDO** el EDITOR clona "Mes estándar" versión 2 como "Mes de vacaciones"
- **ENTONCES** "Mes de vacaciones" versión 1 tiene las mismas líneas que "Mes estándar" versión 2
- **Y** crear la versión 3 de "Mes estándar" no cambia "Mes de vacaciones"

### Requirement: Aplicar a futuro con vista previa
Un cambio en el plan actual o en un template DEBE (MUST) poder propagarse a los planes de periodos futuros en borrador mediante una vista previa que liste periodos y diferencias por línea; al confirmarla DEBE (MUST) crearse una versión nueva del template y actualizarse esos planes, sin sobrescribir líneas modificadas a mano (informadas como conflicto); si algo cambió desde la vista previa DEBE (MUST) rechazarse con `BUDGET_PROPAGATION_STALE`.
Trace: FR-PLANNING-014 · Priority: Should

#### Scenario: Propagar el nuevo máximo de restaurantes
- **CUANDO** el plan de "2026-11" (activo) viene de "Mes estándar" versión 2, "2026-12" y "2027-01" están en borrador con planes de esa versión ("Restaurantes" máximo 600.00 BOB) y "2027-01" tiene "Restaurantes" modificado a mano en 700.00 BOB, y el EDITOR pide propagar "Restaurantes" máximo 650.00 BOB
- **ENTONCES** la vista previa lista "2026-12" con "Restaurantes" de 600.00 a 650.00 BOB y "2027-01" como conflicto
- **Y** al confirmar se crea "Mes estándar" versión 3, "2026-12" queda con 650.00 BOB y "2027-01" conserva 700.00 BOB

#### Scenario: Vista previa desactualizada
- **CUANDO** entre la vista previa y la confirmación alguien edita el plan de "2026-12"
- **ENTONCES** la confirmación se rechaza con `BUDGET_PROPAGATION_STALE` y nada cambia

### Requirement: Propagación limitada a periodos futuros en borrador
La propagación NO DEBE (MUST NOT) modificar planes de periodos cerrados, reabiertos o activos ni de periodos anteriores al periodo desde el que se propaga; solo DEBE (MUST) alcanzar planes de periodos posteriores en estado borrador.
Trace: FR-PLANNING-014 · Priority: Should

#### Scenario: Octubre cerrado y noviembre activo intactos
- **CUANDO** "2026-10" está cerrado, "2026-11" activo y "2026-12" en borrador, y se propaga desde "Mes estándar" un cambio de "Alquiler" a 2900.00 BOB
- **ENTONCES** solo el plan de "2026-12" pasa a "Alquiler" 2900.00 BOB
- **Y** los planes de "2026-10" y "2026-11" conservan 2800.00 BOB

### Requirement: Archivar un template
Un template NO DEBE (MUST NOT) eliminarse: DEBE (MUST) poder archivarse, con lo que deja de ser predeterminado y no puede aplicarse (`BUDGET_TEMPLATE_ARCHIVED`), conservando sus versiones y la referencia de los planes ya creados.
Trace: FR-PLANNING-009 · Priority: Should

#### Scenario: Template archivado no aplicable
- **CUANDO** el EDITOR archiva "Mes de vacaciones" y luego intenta crear el plan de "2027-02" desde él
- **ENTONCES** la operación se rechaza con `BUDGET_TEMPLATE_ARCHIVED`
- **Y** los planes creados antes desde "Mes de vacaciones" siguen indicando ese template y versión de origen

### Requirement: Permisos y auditoría de templates
Leer templates y versiones DEBE (MUST) estar permitido a todo miembro; crear, versionar, clonar, aplicar, propagar, marcar predeterminado y archivar DEBE (MUST) exigir rol EDITOR u OWNER (si no, `INSUFFICIENT_ROLE`) y quedar auditado en la misma operación.
Trace: FR-IDENTITY-006, FR-AUDIT-001 · Priority: Must

#### Scenario: VIEWER no versiona
- **CUANDO** un VIEWER consulta "Mes estándar" e intenta crear una versión nueva
- **ENTONCES** la consulta responde con sus versiones y la escritura se rechaza con `INSUFFICIENT_ROLE`

#### Scenario: Aplicación auditada
- **CUANDO** el EDITOR crea el plan de "2026-11" desde "Mes estándar" versión 2
- **ENTONCES** el historial registra al EDITOR, el plan creado, el template y la versión de origen y las líneas omitidas
