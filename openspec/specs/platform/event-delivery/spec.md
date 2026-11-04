# platform/event-delivery Specification

## Purpose
Define cómo viajan los eventos de dominio entre bounded contexts dentro del modular monolith: se registran atómicamente con el cambio de estado que los origina, cumplen el contrato publicado, se entregan al menos una vez sin pérdida, se procesan una sola vez por consumidor, respetan el orden por agregado y dejan rastro observable cuando fallan.

## Requirements

### Requirement: Evento registrado en la misma transacción que el cambio de estado
Todo evento de dominio emitido por un comando DEBE (MUST) quedar registrado de forma durable en la misma transacción que el cambio de estado que lo origina: si la transacción se confirma, el evento existe como pendiente de publicación; si se revierte, NO DEBE (MUST NOT) existir ningún rastro del evento ni publicarse.
Trace: NFR-REL-008 · Priority: Must

#### Scenario: Comando confirmado deja su evento pendiente
- **CUANDO** el OWNER de "W1 Personal Demo" cambia el nombre del workspace a "Finanzas personales" y el comando se confirma
- **ENTONCES** existe exactamente un evento `identity.WorkspaceSettingsChanged` versión 1 del agregado del workspace, con versión de agregado 2, pendiente de publicación
- **Y** el evento lleva el `workspaceId` de "W1 Personal Demo", el `correlationId` de la petición y el actor que originó el cambio

#### Scenario: Comando revertido no deja evento
- **CUANDO** un comando registra un evento y luego falla antes de confirmar su transacción
- **ENTONCES** el cambio de estado no se aplica
- **Y** no existe el evento ni ningún consumidor lo recibe

### Requirement: Envelope y payload validados contra el contrato al escribir
Todo evento DEBE (MUST) cumplir el envelope v1 publicado y el schema de su tipo y versión antes de registrarse; un evento que no los cumpla o cuyo tipo y versión no tengan schema publicado DEBE (MUST) hacer fallar el comando sin efectos.
Trace: NFR-REL-008, NFR-OBS-002 · Priority: Must

#### Scenario: Payload fuera de contrato
- **CUANDO** un comando intenta registrar `identity.WorkspaceCreated` versión 1 con un payload sin el campo obligatorio `baseCurrency`
- **ENTONCES** el comando falla
- **Y** ni el cambio de estado ni el evento se persisten

#### Scenario: Tipo de evento sin schema publicado
- **CUANDO** un comando intenta registrar un evento `identity.WorkspaceRenamed` versión 1, que no tiene schema publicado
- **ENTONCES** el comando falla sin efectos

### Requirement: Publicación al menos una vez sin pérdida ante caídas
El sistema DEBE (MUST) publicar a cada consumidor suscrito todo evento confirmado al menos una vez, aunque el proceso que publica caiga en cualquier punto; un evento NO DEBE (MUST NOT) marcarse como publicado si su entrega a la cola no quedó confirmada.
Trace: NFR-REL-008 · Priority: Must

#### Scenario: El publicador cae después de encolar y antes de marcar
- **CUANDO** el publicador toma 10 eventos pendientes, los encola y cae antes de marcarlos como publicados
- **ENTONCES** los 10 eventos siguen pendientes
- **Y** tras reiniciar el publicador cada consumidor aplica el efecto de cada uno de los 10 eventos exactamente una vez

#### Scenario: Evento sin consumidores suscritos
- **CUANDO** se confirma un evento de un tipo al que ningún consumidor está suscrito
- **ENTONCES** el evento se marca como publicado sin encolar trabajo

### Requirement: Consumidores idempotentes por evento
Cada consumidor DEBE (MUST) aplicar el efecto de un evento como máximo una vez aunque lo reciba varias veces: el registro de "evento procesado por este consumidor" y el efecto se confirman juntos y una re-entrega del mismo evento NO DEBE (MUST NOT) cambiar el resultado.
Trace: NFR-REL-007, INV-028 · Priority: Must

#### Scenario: Entrega duplicada
- **CUANDO** el mismo evento llega 5 veces al consumidor de una proyección
- **ENTONCES** la proyección aplica el efecto una sola vez
- **Y** las 4 entregas repetidas se cuentan como duplicados descartados

#### Scenario: Efecto que falla no marca el evento como procesado
- **CUANDO** el efecto de un consumidor falla a mitad de su transacción
- **ENTONCES** el evento no queda registrado como procesado por ese consumidor
- **Y** el reintento puede aplicarlo

### Requirement: Orden de entrega por agregado
Para un mismo consumidor, los eventos de un mismo agregado DEBEN (MUST) procesarse en el orden en que se confirmaron; un evento NO DEBE (MUST NOT) procesarse mientras otro anterior del mismo agregado siga pendiente, en reintento o en dead-letter. No se garantiza orden entre agregados distintos.
Trace: NFR-REL-008 · Priority: Must

#### Scenario: Eventos intercalados de varios agregados
- **CUANDO** se confirman 50 eventos repartidos en 5 agregados, intercalados, y un consumidor los procesa con concurrencia 4
- **ENTONCES** para cada agregado el consumidor observa las versiones de agregado 1 a 10 en orden creciente y sin huecos

#### Scenario: Un evento anterior en reintento retiene a los siguientes del mismo agregado
- **CUANDO** el evento con versión de agregado 1 de un agregado falla y queda en reintento
- **ENTONCES** el evento con versión 2 del mismo agregado no se procesa hasta que el de versión 1 se complete
- **Y** los eventos de otros agregados siguen procesándose

#### Scenario: Un evento pendiente de publicar retiene a los siguientes del mismo agregado
- **CUANDO** las versiones 1 y 2 de un agregado se confirman juntas mientras la cola no acepta trabajos y luego la cola vuelve
- **ENTONCES** la versión 1 se publica antes que la versión 2
- **Y** cada consumidor aplica la versión 1 antes que la versión 2

#### Scenario: Un evento en dead-letter congela su agregado en ese consumidor
- **CUANDO** el evento con versión 1 de un agregado queda en dead-letter abierto para un consumidor
- **ENTONCES** ese consumidor no procesa la versión 2 del agregado hasta que el dead-letter se resuelva
- **Y** el dead-letter abierto queda visible en la métrica de dead-letters

### Requirement: Reintentos con backoff y dead-letter observable
Un evento cuyo procesamiento falla DEBE (MUST) reintentarse con backoff exponencial hasta un máximo configurable (por defecto 5 reintentos); al agotarse DEBE (MUST) quedar en dead-letter con el consumidor, el evento, el error y el número de intentos, contarse en una métrica de dead-letters y NO DEBE (MUST NOT) bloquear a otros agregados.
Trace: NFR-REL-012, NFR-OBS-004 · Priority: Must

#### Scenario: Evento venenoso agota sus reintentos
- **CUANDO** un consumidor configurado con 2 reintentos falla siempre al procesar un evento del agregado A
- **ENTONCES** el consumidor lo intenta 3 veces con espera creciente entre intentos
- **Y** el evento queda en dead-letter en estado abierto con el último error y 3 intentos
- **Y** la métrica de dead-letters se incrementa en 1
- **Y** los eventos del agregado B se procesan normalmente

### Requirement: Escrituras aceptadas con la cola no disponible
La indisponibilidad de la cola o del proceso que publica NO DEBE (MUST NOT) impedir que los comandos confirmen sus cambios de estado y sus eventos; los eventos acumulados DEBEN (MUST) publicarse cuando la cola vuelva a estar disponible.
Trace: NFR-REL-010, NFR-REL-008 · Priority: Must

#### Scenario: Cola caída durante un comando
- **CUANDO** la cola no acepta trabajos y el OWNER crea el workspace "Hogar"
- **ENTONCES** el comando se confirma y el workspace existe
- **Y** el evento `identity.WorkspaceCreated` queda pendiente y la métrica de pendientes lo refleja
- **Y** cuando la cola vuelve a aceptar trabajos el evento se publica sin intervención manual

### Requirement: Purga de eventos publicados y registros de procesamiento vencidos
El sistema DEBE (MUST) eliminar periódicamente los eventos publicados más antiguos que su retención (por defecto 7 días) y los registros de "evento procesado" más antiguos que la suya (por defecto 30 días), sin eliminar nunca eventos pendientes ni dead-letters abiertos.
Trace: NFR-REL-008 · Priority: Must

#### Scenario: Purga respeta pendientes y retención
- **CUANDO** existen un evento publicado hace 8 días, uno publicado hace 2 días y uno pendiente creado hace 9 días, y corre la purga con retención de 7 días
- **ENTONCES** solo se elimina el evento publicado hace 8 días
- **Y** el evento pendiente sigue disponible para publicarse

### Requirement: Métricas de pendientes y retraso del outbox
El sistema DEBE (MUST) exponer como métricas la cantidad de eventos pendientes de publicación (`outbox_pending`), el retraso en segundos del evento pendiente más antiguo (`outbox_lag_seconds`, 0 sin pendientes), los eventos publicados, los fallos de publicación, los duplicados descartados por consumidor, los dead-letters, los eventos pendientes por consumidor (`event_consumer_backlog`) y la duración del procesamiento por consumidor (`event_consumer_duration_seconds`), sin etiquetas de alta cardinalidad (workspace, usuario, agregado).
Trace: NFR-OBS-004 · Priority: Must

#### Scenario: Pendientes y retraso
- **CUANDO** hay 3 eventos pendientes y el más antiguo se confirmó hace 42 segundos
- **ENTONCES** `outbox_pending` reporta 3 y `outbox_lag_seconds` reporta al menos 42
- **Y** tras publicarlos `outbox_pending` reporta 0 y `outbox_lag_seconds` reporta 0

#### Scenario: Pendientes y duración por consumidor
- **CUANDO** hay 7 eventos publicados sin procesar para el consumidor `planning.budget-thresholds`
- **ENTONCES** `event_consumer_backlog` con la etiqueta `consumer="planning.budget-thresholds"` reporta 7
- **Y** tras procesarlos reporta 0 y `event_consumer_duration_seconds` registró 7 observaciones para ese consumidor

### Requirement: Apagado ordenado de la entrega de eventos
Ante una señal de apagado, el proceso que publica y consume eventos DEBE (MUST) dejar de tomar eventos nuevos, permitir que terminen los que están en curso dentro del período de gracia y cerrar sus conexiones; un evento interrumpido NO DEBE (MUST NOT) perderse ni aplicarse dos veces.
Trace: NFR-REL-009 · Priority: Must

#### Scenario: Apagado con un evento en proceso
- **CUANDO** el worker recibe la señal de apagado mientras un consumidor procesa un evento que tarda 1 segundo
- **ENTONCES** el consumidor termina y confirma el efecto antes de que el proceso se detenga
- **Y** no se toman eventos nuevos después de la señal
- **Y** al reiniciar el worker el evento no se vuelve a aplicar

### Requirement: Contexto de tenant y correlación propagados al consumidor
Cada consumidor DEBE (MUST) procesar un evento dentro del aislamiento del workspace del evento y con el `correlationId` y el contexto de traza del comando que lo originó, de modo que no pueda leer ni escribir datos de otro workspace y sus logs se correlacionen con la petición original.
Trace: NFR-OBS-002, NFR-REL-008 · Priority: Must

#### Scenario: Consumidor aislado y correlacionado
- **CUANDO** un consumidor procesa un evento de "W1 Personal Demo" originado por una petición con `correlationId` C
- **ENTONCES** el consumidor solo ve los datos de "W1 Personal Demo"
- **Y** sus líneas de log llevan el `correlationId` C

### Requirement: Rendimiento sostenido de los consumidores
Cada consumidor DEBE (MUST) procesar en paralelo eventos de agregados distintos, con concurrencia y tamaño de lote configurables, y drenar un backlog de 5 000 eventos repartidos en 500 agregados en 120 segundos o menos con un handler trivial en el entorno local/CI, sin violar el orden por agregado ni reintentar trabajos ajenos cuando uno falla. El worker NO DEBE (MUST NOT) arrancar si la concurrencia sumada de sus consumidores excede su pool de conexiones a la base de datos.
Trace: NFR-PERF-008, NFR-REL-008 · Priority: Must

#### Scenario: Backlog grande drenado a tiempo
- **CUANDO** hay 5 000 eventos pendientes para un consumidor, 10 por agregado en 500 agregados, y el consumidor arranca con la configuración por defecto
- **ENTONCES** los 5 000 eventos quedan procesados en 120 segundos o menos
- **Y** para cada agregado el consumidor observó las versiones 1 a 10 en orden creciente

#### Scenario: Un fallo dentro del lote no reintenta a los demás
- **CUANDO** un consumidor recibe en el mismo lote eventos de 10 agregados distintos y el del agregado A falla
- **ENTONCES** solo el evento del agregado A queda en reintento
- **Y** los eventos de los otros 9 agregados se registran en el inbox una sola vez

#### Scenario: Configuración que excede el pool de conexiones
- **CUANDO** el worker arranca con una concurrencia sumada de consumidores mayor que su pool de conexiones
- **ENTONCES** el arranque falla con un mensaje que indica la concurrencia total y el tamaño del pool

### Requirement: Entrega agrupada para consumidores que recalculan estado
Un consumidor DEBE (MUST) poder declarar que su efecto recalcula estado y no depende del orden de los eventos de agregados distintos dentro de un mismo lote; para ese consumidor, el sistema DEBE (MUST) entregar los eventos de un lote que pertenecen al mismo workspace en una sola transacción de base de datos que registre en el inbox todos los eventos aún no procesados e invoque el efecto una sola vez con ellos, con el aislamiento de ese workspace. Los eventos ya registrados en el inbox NO DEBEN (MUST NOT) volver a aplicarse; un lote NO DEBE (MUST NOT) contener más de un evento del mismo agregado, de modo que el orden por agregado se conserve; si la transacción del grupo falla, el sistema DEBE (MUST) reintentar los eventos del grupo de a uno, cada uno en su propia transacción, para que solo el evento que falla quede en reintento. Un consumidor que no lo declara DEBE (MUST) seguir recibiendo cada evento en su propia transacción.
Trace: NFR-PERF-008, NFR-REL-008 · Priority: Must

#### Scenario: Ráfaga del mismo workspace aplicada en una transacción
- **CUANDO** un consumidor agrupado con lotes de 100 tiene pendientes 100 eventos de 100 transacciones distintas de "W1 Personal Demo"
- **ENTONCES** el efecto se invoca una sola vez con los 100 eventos dentro de una transacción con el aislamiento de "W1 Personal Demo"
- **Y** el inbox registra los 100 eventos para ese consumidor
- **Y** el estado resultante es el mismo que si los 100 eventos se hubieran procesado de a uno

#### Scenario: Eventos ya procesados dentro del lote
- **CUANDO** el lote de 100 eventos de "W1 Personal Demo" contiene 3 eventos que el consumidor ya registró en su inbox por una entrega anterior
- **ENTONCES** el efecto se invoca con los 97 eventos restantes
- **Y** los 3 eventos repetidos no vuelven a aplicarse

#### Scenario: Fallo dentro de un grupo
- **CUANDO** un grupo de 10 eventos de agregados distintos falla porque el efecto no puede aplicar el evento del agregado A
- **ENTONCES** ningún efecto del grupo queda confirmado y los 10 eventos se reintentan de a uno
- **Y** los 9 eventos de los otros agregados se registran en el inbox una sola vez
- **Y** solo el evento del agregado A queda en reintento

#### Scenario: Lote con eventos de dos workspaces
- **CUANDO** un lote trae 60 eventos de "W1 Personal Demo" y 40 de "W2 Familia Demo" para un consumidor agrupado
- **ENTONCES** el efecto se invoca dos veces, una por workspace, cada una con el aislamiento de su workspace
- **Y** ninguna invocación ve datos del otro workspace

#### Scenario: Orden por agregado con lotes grandes
- **CUANDO** un agregado tiene pendientes sus versiones 1 a 10 y el consumidor agrupado toma lotes de 100
- **ENTONCES** cada lote trae a lo sumo una versión de ese agregado
- **Y** el consumidor observa las versiones 1 a 10 en orden creciente

#### Scenario: Consumidor que no declara agrupación
- **CUANDO** un consumidor sin agrupación declarada tiene pendientes 10 eventos de "W1 Personal Demo"
- **ENTONCES** cada evento se procesa en su propia transacción con su registro de inbox, como antes de este cambio

### Requirement: Ráfaga de un import grande con la configuración del host
Con la configuración de la plantilla del host —concurrencia 1 por consumidor, pool de 34 conexiones en el worker con 4 reservadas y pool de 22 en la API—, cada consumidor DEBE (MUST) terminar de procesar los eventos de las transacciones de un import de 5 000 filas en 120 segundos o menos desde que termina la persistencia, aunque todos esos eventos queden pendientes a la vez, y el outbox DEBE (MUST) quedar sin eventos pendientes en ese plazo. El cumplimiento NO DEBE (MUST NOT) apoyarse en consumidores nuevos, en más concurrencia ni en un pool mayor que los de la plantilla, y ningún efecto DEBE (MUST) duplicarse por la agrupación ni por las reentregas.
Trace: NFR-PERF-007, NFR-PERF-008, NFR-REL-008 · Priority: Must

#### Scenario: Cinco mil transacciones importadas con concurrencia 1
- **CUANDO** se persisten 5 000 transacciones importadas con los consumidores detenidos, quedan pendientes a la vez sus 15 000 eventos y el worker arranca con concurrencia 1, pool de 34 y 4 conexiones reservadas
- **ENTONCES** cada consumidor termina de procesar sus eventos en 120 segundos o menos desde ese arranque
- **Y** el outbox queda sin eventos pendientes en ese plazo
- **Y** ninguna adquisición de conexión vence

#### Scenario: El worker de la plantilla arranca sin conexiones nuevas
- **CUANDO** el worker arranca con la configuración de la plantilla del host y los 28 consumidores con concurrencia 1
- **ENTONCES** el arranque valida 28 conexiones de consumidores más 4 reservadas, 32 de 34
- **Y** la cantidad de consumidores y su concurrencia sumada son las mismas que antes de este cambio

#### Scenario: Sin sugerencias duplicadas en la ráfaga
- **CUANDO** entre las 5 000 transacciones importadas hay 12 compatibles con ocurrencias pendientes y algunos de sus eventos se entregan dos veces
- **ENTONCES** existen exactamente 12 sugerencias de coincidencia propuestas

### Requirement: Métricas de la entrega agrupada
El sistema DEBE (MUST) exponer, por consumidor agrupado y sin etiquetas de alta cardinalidad (workspace, usuario, agregado), la cantidad de eventos aplicados por cada invocación del efecto y la cantidad de grupos que fallaron y se reintentaron evento por evento, además de las métricas de pendientes y duración por consumidor que ya existen.
Trace: NFR-OBS-004, NFR-PERF-008 · Priority: Should

#### Scenario: Grupo aplicado y grupo reintentado
- **CUANDO** el consumidor agrupado `reporting.data-version` aplica un grupo de 100 eventos y luego un grupo de 10 eventos falla y se reintenta de a uno
- **ENTONCES** la métrica de eventos por invocación registra una observación de 100 para `consumer="reporting.data-version"`
- **Y** la métrica de grupos reintentados evento por evento de ese consumidor sube en 1
