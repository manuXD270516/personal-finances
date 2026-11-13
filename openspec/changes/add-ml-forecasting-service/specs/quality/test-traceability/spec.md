## ADDED Requirements

### Requirement: Tests del servicio de pronósticos en la trazabilidad
La verificación de trazabilidad DEBE (MUST) reconocer los tests del servicio de pronósticos escritos en Python que citan un TC-id entre corchetes, con las mismas reglas que los tests del monorepo: un TC automatizado DEBE (MUST) tener al menos un test que lo cite y un test NO DEBE (MUST NOT) citar un TC inexistente o deprecado.
Trace: NFR-MAINT-004, NFR-MAINT-005 · Priority: Must

#### Scenario: Test de Python que cita un TC
- **CUANDO** un test del servicio de pronósticos tiene en su docstring "[TC-FORECAST-SERVICE-011]" y ese TC está marcado como automatizado con la ruta del archivo
- **ENTONCES** la verificación de trazabilidad enlaza el TC con ese test sin errores

#### Scenario: Test de Python con un TC inexistente
- **CUANDO** un test del servicio de pronósticos cita "[TC-FORECAST-SERVICE-999]", que no existe en el catálogo
- **ENTONCES** la verificación de trazabilidad falla indicando el TC inexistente
