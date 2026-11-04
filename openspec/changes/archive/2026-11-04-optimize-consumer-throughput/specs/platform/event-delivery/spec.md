## ADDED Requirements

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
