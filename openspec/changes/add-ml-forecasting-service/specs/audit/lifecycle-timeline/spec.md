## ADDED Requirements

### Requirement: Recorrido de una corrida de pronóstico
La corrida de pronóstico DEBE (MUST) declarar su máquina de estados (solicitada, en curso, completada, sin datos suficientes, fallida y reemplazada) con las transiciones iniciar, completar, quedar sin datos suficientes, reintentar, fallar y reemplazar, cada una con instante, actor (el miembro que la solicitó o el sistema) y motivo cuando corresponda (cantidad de intentos, motivo de la falla o corrida que la reemplazó). Todo miembro del workspace DEBE (MUST) poder consultar el recorrido de sus corridas.
Trace: FR-AUDIT-009, FR-AUDIT-010, FR-FORECAST-006 · Priority: Should

#### Scenario: Corrida reintentada y completada
- **CUANDO** un EDITOR solicitó la corrida "R3", el primer intento falló porque el servicio no respondió y el segundo se completó, y luego la corrida "R4" la reemplazó
- **ENTONCES** el recorrido de "R3" muestra solicitar por el EDITOR, iniciar, reintentar con el motivo servicio no disponible, iniciar, completar y reemplazar por "R4", con sus instantes
