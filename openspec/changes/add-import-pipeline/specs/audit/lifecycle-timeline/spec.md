## ADDED Requirements

### Requirement: Recorrido de una importación
La importación DEBE (MUST) declarar su máquina de estados —subida, procesando, esperando mapeo, en revisión, aprobada, persistiendo, parcialmente fallida, completada, completada con diferencia, completada con errores, deshaciendo, deshecha, deshecha parcialmente, falló la lectura y cancelada— con sus transiciones, y su recorrido DEBE (MUST) mostrar cada transición con actor (el usuario, o el sistema para las etapas del worker y la expiración), instante y motivo si lo hay; la aplicación de un perfil y su versión, la reevaluación de reglas y la aceptación de errores DEBEN (MUST) aparecer como anotaciones. Una transición no declarada DEBE (MUST) rechazarse con `INVALID_STATUS_TRANSITION` sin registrarse.
Trace: FR-AUDIT-009, FR-AUDIT-010, FR-IMPORTS-001 · Priority: Must

#### Scenario: Recorrido de una importación deshecha
- **CUANDO** la EDITOR "Ana" crea una importación desde un documento, el sistema la procesa aplicando el perfil "Cumbre caja de ahorro CSV" versión 2, "Ana" la aprueba, el sistema la persiste y la completa, y luego "Ana" la deshace
- **ENTONCES** el recorrido muestra en orden subida, procesando, en revisión, aprobada, persistiendo, completada, deshaciendo y deshecha, con "Ana" o el sistema como actor de cada transición
- **Y** muestra la aplicación del perfil versión 2 como anotación

#### Scenario: Transición no declarada de una importación
- **CUANDO** el usuario intenta aprobar una importación deshecha
- **ENTONCES** se rechaza con `INVALID_STATUS_TRANSITION` y no se registra ninguna transición
