## ADDED Requirements

### Requirement: Selección de cabezas del relay acotada e independiente de las estadísticas
El relay del outbox DEBE (MUST) seleccionar en cada lote, por orden de confirmación y hasta el tamaño de lote, solo el evento pendiente más antiguo de cada agregado de cada workspace, saltando sin esperar los que otra transacción tenga bloqueados, y NO DEBE (MUST NOT) seleccionar un evento mientras otro anterior del mismo agregado siga pendiente, aunque esté bloqueado. El costo de seleccionar un lote NO DEBE (MUST NOT) crecer con el cuadrado de los eventos pendientes ni depender de que las estadísticas del outbox estén actualizadas: las cabezas pendientes DEBEN (MUST) calcularse en una sola pasada sobre los pendientes por lote, sin evaluar nada por cada evento pendiente. Esta selección NO DEBE (MUST NOT) apoyarse en índices, migraciones ni conexiones nuevas.
Trace: NFR-PERF-008, NFR-REL-008 · Priority: Must

#### Scenario: Misma selección que antes con varios agregados y workspaces
- **CUANDO** hay eventos pendientes intercalados de varios agregados, varios por agregado, en dos workspaces que comparten un identificador de agregado, y el relay corre lotes de tamaño 3
- **ENTONCES** cada lote contiene, en orden de confirmación, los primeros 3 eventos que son los más antiguos pendientes de su agregado y workspace
- **Y** ningún evento sale en el mismo lote que otro anterior de su agregado, y el agregado compartido sale una vez por workspace
- **Y** al vaciar el outbox cada agregado publicó todos sus eventos en orden de confirmación

#### Scenario: Una cabeza bloqueada retiene a sus sucesores
- **CUANDO** otra transacción tiene bloqueado el evento más antiguo pendiente de un agregado y el relay corre un lote
- **ENTONCES** ese evento y sus sucesores del mismo agregado quedan pendientes
- **Y** los eventos más antiguos de los demás agregados se publican en ese lote
- **Y** al liberarse el bloqueo el evento se publica en un lote y su sucesor en uno posterior

#### Scenario: Estadísticas desactualizadas tras un período tranquilo
- **CUANDO** las estadísticas del outbox se tomaron con 5 000 eventos publicados y ninguno pendiente, y luego quedan 10 000 eventos pendientes de 2 000 agregados, 5 consecutivos por agregado, con entradas muertas en el índice de pendientes
- **ENTONCES** el plan de la consulta de cabezas calcula el evento más antiguo de cada agregado en una sola pasada sobre los pendientes, sin una anti-unión que compare los pendientes entre sí ni una subconsulta evaluada por cada evento pendiente
- **Y** un lote de 200 cabezas se selecciona en 5 segundos o menos
