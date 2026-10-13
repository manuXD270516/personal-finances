## MODIFIED Requirements

### Requirement: Notificación de muestra anómala retenida
Las muestras de provider retenidas como anómalas de un mismo par en un workspace, de cualquier provider y tipo de tasa, DEBEN (MUST) avisarse agrupadas: un grupo empieza con la primera muestra retenida del par cuando el par no tenía ninguna muestra retenida pendiente de revisión y dura mientras el par tenga, sin interrupción, al menos una muestra retenida pendiente. Por cada grupo, el sistema DEBE (MUST) crear una sola notificación in-app no leída de tipo tasa anómala retenida, de severidad advertencia, para cada OWNER y EDITOR activo que no la haya desactivado, con el par, la cantidad de muestras pendientes del grupo, los providers y, de la muestra pendiente con mayor variación absoluta, el provider, el valor, la línea base y la variación, y con enlace a la revisión de la muestra pendiente más antigua del grupo, donde se confirma o se rechaza. Cada muestra retenida posterior del mismo grupo DEBE (MUST) actualizar esa notificación con el estado del grupo sin crear otra, sin volverla a no leída y sin cambiar su fecha de creación; la deduplicación DEBE (MUST) ser por grupo y destinatario, de modo que reprocesar un ciclo no cree ni duplique avisos, y muestras de pares distintos NO DEBEN (MUST NOT) compartir un aviso. Las notificaciones creadas antes de la agrupación, una por muestra, NO DEBEN (MUST NOT) modificarse salvo la de la muestra más antigua de un grupo que sigue recibiendo muestras, que pasa a ser el aviso de ese grupo. Un VIEWER NO DEBE (MUST NOT) recibirla.
Trace: FR-NOTIFY-004, FR-NOTIFY-005, FR-FX-010 · Priority: Should

#### Scenario: Bitcoin retenido
- **CUANDO** BTC/USDT no tiene muestras retenidas pendientes en "W1" y se retiene la muestra de BTC/USDT 72000.00 con línea base 65000.00 y variación +10.77 %
- **ENTONCES** el OWNER y el EDITOR tienen una notificación no leída de tasa anómala retenida de BTC/USDT con 1 muestra pendiente, 72000.00, 65000.00 y +10.77 %, con enlace a la revisión de esa muestra
- **Y** al abrirla pueden confirmarla o rechazarla con un motivo

#### Scenario: Salto con mediana, compra y venta
- **CUANDO** USDT/BOB no tiene muestras retenidas pendientes en "W1" y el ciclo de las 2026-10-13T14:00:00Z de paralelo.bo retiene USDT/BOB `PARALLEL` 12.80 (línea base 12.05, +6.22 %), `PARALLEL_BUY` 12.70 (línea base 12.00, +5.83 %) y `PARALLEL_SELL` 12.90 (línea base 12.10, +6.61 %)
- **ENTONCES** el OWNER y el EDITOR tienen cada uno una sola notificación de tasa anómala retenida de USDT/BOB con 3 muestras pendientes y la mayor variación, `PARALLEL_SELL` 12.90 frente a 12.10 (+6.61 %) de paralelo.bo
- **Y** se publican tres hechos de muestra retenida, uno por muestra
- **Y** el VIEWER no recibe ninguna notificación

#### Scenario: Respaldo en el mismo ciclo
- **CUANDO** después, en el mismo ciclo, bo.dolarapi.com retiene USDT/BOB `PARALLEL` 12.82 y `PARALLEL_BUY` 12.72
- **ENTONCES** cada destinatario sigue con una sola notificación de USDT/BOB, ahora con 5 muestras pendientes y los providers paralelo.bo y bo.dolarapi.com
- **Y** no se crea otra notificación ni se programa otro email

#### Scenario: Salto que persiste en ciclos siguientes
- **CUANDO** nadie revisa las 5 muestras y el ciclo de las 2026-10-13T14:15:00Z retiene tres muestras más de USDT/BOB con vigencia nueva
- **ENTONCES** la notificación de USDT/BOB de cada destinatario muestra 8 muestras pendientes
- **Y** no se crea otra notificación ni se programa otro email

#### Scenario: Revisión parcial del grupo
- **CUANDO** el OWNER confirma la muestra más antigua del grupo de USDT/BOB, quedan otras pendientes y el ciclo siguiente retiene otra muestra de USDT/BOB
- **ENTONCES** se actualiza la misma notificación con las muestras que siguen pendientes y su enlace lleva a la pendiente más antigua
- **Y** no se crea otra notificación

#### Scenario: Salto nuevo tras revisar todo el grupo
- **CUANDO** a las 2026-10-13T15:00:00Z ya no queda ninguna muestra pendiente de USDT/BOB y a las 2026-10-13T18:00:00Z se retiene una muestra nueva de USDT/BOB
- **ENTONCES** empieza un grupo nuevo y cada destinatario recibe una notificación nueva no leída con 1 muestra pendiente

#### Scenario: Varios pares en el mismo ciclo
- **CUANDO** en el mismo ciclo se retienen muestras de USDT/BOB y de BTC/USDT, sin pendientes previas en ninguno de los dos pares
- **ENTONCES** cada destinatario recibe dos notificaciones, una de USDT/BOB y otra de BTC/USDT

#### Scenario: Ciclo reprocesado
- **CUANDO** el job de providers reprocesa el ciclo de las 2026-10-13T14:00:00Z con las mismas muestras
- **ENTONCES** cada destinatario sigue con una sola notificación de USDT/BOB y la cantidad de muestras pendientes no cambia

#### Scenario: Aviso ya leído
- **CUANDO** el EDITOR ya leyó la notificación de USDT/BOB y se retiene otra muestra del mismo grupo
- **ENTONCES** la notificación muestra la cantidad nueva y sigue leída

#### Scenario: Aviso creado antes de la agrupación
- **CUANDO** antes de la agrupación se crearon tres notificaciones de USDT/BOB, una por muestra, las tres muestras siguen pendientes y se retiene una cuarta del mismo grupo
- **ENTONCES** la notificación de la muestra más antigua pasa a ser el aviso del grupo con 4 muestras pendientes
- **Y** las otras dos notificaciones no cambian y no se crea ninguna nueva

#### Scenario: Aviso agrupado en portugués
- **CUANDO** el EDITOR tiene locale "pt-BR" y recibe el aviso de USDT/BOB con 3 muestras pendientes
- **ENTONCES** el texto está en portugués, con el plural de 3 muestras y la variación +6,61 % en el formato de ese locale

## ADDED Requirements

### Requirement: Email único por grupo de tasas retenidas
Por cada grupo de muestras retenidas de un par, el sistema DEBE (MUST) programar como máximo un email por destinatario, al crear su notificación del grupo y según sus preferencias por tipo y canal y su horario de silencio; actualizar la notificación con muestras posteriores del grupo NO DEBE (MUST NOT) programar otro email. Sin opt-in de detalles, el email NO DEBE (MUST NOT) incluir valores de tasa, variaciones, códigos de moneda, nombres de providers ni la cantidad de muestras, y DEBE (MUST) decir que una o más tasas automáticas quedaron retenidas y necesitan revisión, con enlace a la app autenticada; con opt-in, DEBE (MUST) mostrar el estado del grupo en el momento del envío.
Trace: FR-NOTIFY-006, FR-NOTIFY-005, NFR-COMP-001 · Priority: Must

#### Scenario: Email del grupo sin detalles
- **CUANDO** el OWNER, con email activado y sin opt-in de detalles, recibe el aviso del grupo de USDT/BOB con 3 muestras pendientes y la mayor variación 12.90 frente a 12.10 (+6.61 %)
- **ENTONCES** el email dice que una o más tasas automáticas quedaron retenidas y necesitan su revisión, con enlace a la app
- **Y** no contiene "12.90", "12.10", "6.61", "USDT", "BOB", "paralelo.bo" ni la cantidad 3

#### Scenario: Muestras posteriores sin otro email
- **CUANDO** el grupo de USDT/BOB pasa de 3 a 8 muestras pendientes en dos ciclos
- **ENTONCES** el OWNER recibió un solo email del grupo

#### Scenario: Email diferido con el estado al enviarse
- **CUANDO** el OWNER, con opt-in de detalles y horario de silencio de 22:00 a 07:00 en America/La_Paz, recibe el aviso de USDT/BOB a las 2026-10-14T03:30:00Z con 3 muestras pendientes y el grupo llega a 5 a las 2026-10-14T05:00:00Z
- **ENTONCES** el único email del grupo se envía a las 2026-10-14T11:00:00Z (07:00 en La Paz) y muestra 5 muestras pendientes
