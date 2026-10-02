# quality/test-traceability Specification

## Purpose
Convierte los tests en documentación viva enlazando cada requerimiento con test cases versionados y tests automatizados, y hace fallar el build cuando esa cadena se rompe.

## Requirements

### Requirement: Catálogo versionado de test cases
Los test cases DEBEN (MUST) almacenarse en el repositorio como un archivo por caso, cada uno con identificador `TC-<CONTEXTO>-<FEATURE>-<NNN>`, capability y requirement referenciados, prioridad, tipo, precondiciones, entrada, pasos, resultado esperado, estado de automatización y estado de ciclo de vida.
Trace: NFR-MAINT-005 · Priority: Must

#### Scenario: Test case sin un campo obligatorio
- **CUANDO** un archivo de test case no declara el requirement referenciado
- **ENTONCES** el chequeo de trazabilidad falla indicando el archivo y el campo faltante

### Requirement: Los tests automatizados referencian IDs de test case
Todo test automatizado que implemente un test case catalogado DEBE (MUST) incluir el identificador del caso en su nombre, y todo test case con estado de automatización `automated` DEBE (MUST) estar implementado por al menos un test automatizado.
Trace: NFR-MAINT-005 · Priority: Must

#### Scenario: Caso automatizado sin test
- **CUANDO** un test case está marcado `automated` y ningún nombre de test automatizado contiene su identificador
- **ENTONCES** el chequeo de trazabilidad falla

#### Scenario: Identificador desconocido en un test
- **CUANDO** el nombre de un test automatizado contiene un identificador de test case que no existe en el catálogo
- **ENTONCES** el chequeo de trazabilidad falla

### Requirement: Los requirements Must están cubiertos
Todo requirement de una capability perteneciente a una fase implementada y con prioridad Must DEBE (MUST) estar referenciado por al menos un test case no deprecado.
Trace: NFR-MAINT-004 · Priority: Must

#### Scenario: Requirement Must sin cobertura
- **CUANDO** un requirement Must no tiene ningún test case no deprecado que lo referencie
- **ENTONCES** el chequeo de trazabilidad falla listando el requirement

### Requirement: Matriz de trazabilidad generada
El proyecto DEBE (MUST) generar en cada ejecución del pipeline una matriz de trazabilidad desde requerimiento funcional hasta requirement de spec, scenario, test case y test automatizado, en formato legible y en formato procesable por máquina.
Trace: NFR-MAINT-005 · Priority: Must

#### Scenario: Matriz producida
- **CUANDO** el pipeline se ejecuta sobre una pull request
- **ENTONCES** la matriz se publica como artefacto del build y lista cada test case catalogado con su estado de automatización

### Requirement: Los test cases se deprecan, no se borran en silencio
Un test case NO DEBE (MUST NOT) eliminarse del catálogo sin antes marcarse como deprecado con un motivo y una referencia al change que lo deprecó.
Trace: NFR-MAINT-005 · Priority: Must

#### Scenario: Se borra un test case activo
- **CUANDO** una pull request elimina un archivo de test case cuyo estado no es `deprecated`
- **ENTONCES** el chequeo de trazabilidad falla
