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
