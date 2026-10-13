# Diseño: refine-rate-anomaly-alert-grouping

## Contexto

`add-rate-feed-alerts` (#128, implementado y sin archivar) avisa una vez por muestra retenida (D234, por omisión). En el código de `main`:

- `PollMarketRates` consulta los providers habilitados uno tras otro; las muestras de cada provider se copian a cada workspace en una unidad de trabajo propia (`SampleRecorder.recordIn`). paralelo.bo (principal) y bo.dolarapi.com (respaldo) publican `PARALLEL`, `PARALLEL_BUY` y `PARALLEL_SELL`; los dos se consultan en cada ciclo.
- Al insertar una muestra marcada como anómala, `SampleRecorder.publishRetained` escribe `fx.RateAnomalyRetained.v1` en el outbox y llama a `NotificationIntakePort.notify` con `factKey = rateId`, en la misma transacción. NOTIFY (`NotificationIntake` → `NotifyFromEvent`) inserta una notificación por destinatario con `dedupeKey = fx-rate-anomaly-retained:<rateId>` y `ON CONFLICT DO NOTHING`, y programa el email solo si la insertó.
- La línea base de la detección es la última tasa aceptada del mismo feed (provider, par y tipo), sin muestras pendientes ni rechazadas (`latestAccepted`). Mientras nadie revise, cada muestra nueva con otra vigencia se compara con la misma línea base vieja y también queda retenida.

Resultado: un salto de USDT/BOB produce hasta 3 avisos por provider y ciclo (mediana, compra y venta), hasta 6 con el respaldo, y otros tantos en cada ciclo mientras el salto persista sin revisión. El owner respondió el 2026-10-13 que los avisos deben agruparse; eso revierte D234 (el número de la decisión nueva lo asigna el documento de decisiones siguiente, fuera de este change).

| Decisión | Origen | Aplicación |
|---|---|---|
| Agrupar los avisos de muestra anómala | Owner (2026-10-13) | Revierte D234: un aviso por grupo de muestras pendientes del par (este diseño). |
| D235 | Por omisión | Sin cambios: OWNER y EDITOR; in-app siempre; email según preferencias, sin valores salvo opt-in. |
| D236 | Por omisión | Sin cambios: la muestra sigue retenida hasta confirmarla o rechazarla. |
| D249 | Por omisión | Sin cambios: entrega por el puerto síncrono, sin consumidor ni conexiones nuevas. |
| Pregunta 2 de add-rate-feed-alerts | Resuelta (a) | Sin cambios: una muestra retenida no cuenta como tasa fresca; si el grupo pasa N horas sin revisión, el par también abre su episodio de obsolescencia (red de seguridad del aviso agrupado). |

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| FX | DS puro `AnomalyGroupResolver(retained[], pendingOf) → {anchorRateId, members, pending, peak}` | domain | Nuevo (TDD, PBT) |
| FX | `SampleRecorder`: un aviso por par al final de la transacción del workspace (no uno por muestra); el evento sigue siendo uno por muestra | application | Modificado |
| FX | `ExchangeRateRepository.retainedOfPair(workspace, base, quote)`; índice parcial de muestras retenidas | infrastructure | Nuevo |
| NOTIFY | Hecho `RateAnomalyGroupFact` en `@pf/notifications/contracts`; `NotificationIntakeOutcome.refreshed` | contracts | Modificado (ver Contratos) |
| NOTIFY | Plan del tipo `FX_RATE_ANOMALY_RETAINED` con clave de grupo, mensaje `notifications.fx_rate_anomaly_retained.v2` y política "crear o actualizar" | domain / application | Modificado |
| NOTIFY | `NotificationRepository.insertOrRefresh` (`ON CONFLICT … DO UPDATE` acotado al tipo) | infrastructure | Nuevo |
| NOTIFY | Plantillas es/en/pt del mensaje v2 (in-app y email `basic`/`detailed`); el v1 se sigue renderizando | domain | Ampliado |

## Objetivos / No objetivos

**Objetivos:**
- Un solo aviso por salto de un par, aunque lo vean varios feeds, varios providers y varios ciclos.
- Sin pérdida de avisos: el aviso sigue en la misma transacción que la muestra que lo origina.
- Sin tablas nuevas, sin consumidores nuevos y sin cambios incompatibles en contratos públicos.

**No objetivos:**
- Recordatorios de muestras retenidas sin revisar (D236: la red de seguridad es el episodio de obsolescencia).
- Actualizar el aviso cuando un miembro revisa muestras (el panel de providers muestra el estado vigente).
- Un aviso por ciclo que reúna varios pares (pregunta 2). Digest (Phase 7).
- Cambiar la detección de anomalías, sus umbrales o la revisión.

## Decisiones

1. **Qué es un grupo.** Para un workspace y un par (base, cotización), de cualquier provider y tipo de tasa, cada muestra retenida como anómala está *pendiente* desde su `created_at` hasta el `decided_at` de su revisión (`fx.rate_anomaly_review`), o indefinidamente si no se revisó. Un grupo es una "isla" de muestras retenidas cuyos intervalos de pendencia se solapan sin interrupción: ordenadas por `(created_at, id)`, una muestra abre un grupo nuevo si su `created_at` es mayor o igual que el máximo `decided_at` de todas las anteriores (todas estaban revisadas cuando llegó). El grupo vigente es la última isla; existe solo si tiene al menos una muestra pendiente. El *ancla* del grupo es su primera muestra; el id del ancla es la clave del grupo. Se elige así, en lugar de por ciclo o por salto (pregunta 1), porque: (a) en un salto que persiste, la clave por ciclo seguiría avisando cada 15 minutos; (b) la clave se deriva de datos ya persistidos, sin estado nuevo, y es la misma en cualquier reintento; (c) una revisión parcial (confirmar la muestra más antigua y dejar otras) no abre un grupo nuevo, porque la isla no se interrumpe.
2. **Dónde se calcula (FX, `AnomalyGroupResolver` puro).** En `SampleRecorder.recordIn`, con `detectAnomalies = true`: se insertan las muestras como hoy y se publica `fx.RateAnomalyRetained.v1` por cada muestra retenida (sin cambios); se acumulan los pares con alguna muestra retenida nueva y, al final de la misma unidad de trabajo, por cada uno de esos pares, en orden y sin consultas en paralelo: `retainedOfPair` (muestras retenidas del par con su `decided_at`, más recientes primero hasta cerrar la isla vigente), el resolver calcula el grupo y se llama una sola vez a `NotificationIntakePort.notify` con `factKey = anchorRateId` y la foto del grupo. Antes de insertar se toma `pg_advisory_xact_lock` por workspace (clave `fx-anomaly-group:<workspaceId>`) y `now` se lee después del lock, de modo que dos transacciones del mismo workspace (dos réplicas del worker) se serializan y el orden `(created_at, id)` coincide con el de commit; el ciclo normal ya es secuencial y no espera. La carga histórica no detecta anomalías y no llama al puerto (sin cambios).
3. **Foto del grupo (el hecho).** `RateAnomalyGroupFact`: `anchorRateId`, `base`, `quote`, `pendingCount` (muestras del grupo pendientes ahora), `retainedCount` (todas las del grupo), `providers` (distintos, orden alfabético), `reviewRateId` (la pendiente más antigua: destino del enlace), `peak` (la pendiente con mayor variación absoluta; empate ⇒ la más reciente) con los campos del hecho por muestra actual (`RateAnomalyRetainedFact`: `rateId`, `rateType`, `provider`, `value`, `baselineRateId`, `baselineValue`, `variationPct`, `thresholdPct`), `firstRetainedAt` (`created_at` del ancla), `lastRetainedAt` (`now` de la transacción), `detectedAt` y `timeZone`. Determinista para un mismo estado de la base: la misma transacción reintentada produce la misma foto.
4. **NOTIFY: crear o actualizar.** El plan del tipo usa `dedupeKey = fx-rate-anomaly-retained:<anchorRateId>` (el mismo formato de hoy) y el mensaje `notifications.fx_rate_anomaly_retained.v2`. Por destinatario, `insertOrRefresh`: si no existe, inserta `UNREAD` y programa el email según preferencias y silencio (como hoy); si existe, `ON CONFLICT (workspace_id, user_id, dedupe_key) DO UPDATE SET params, message_key, link` solo cuando `notification_type = 'FX_RATE_ANOMALY_RETAINED'` y la foto entrante no es más vieja (`params->>'lastRetainedAt'` nulo o menor o igual); nunca cambia `status`, `read_at`, `archived_at` ni `created_at`, y nunca programa otro email. `NotifyFromEvent` sigue igual para los demás tipos (`insertIfAbsent`). Métricas: `created` como hoy y un contador `refreshed` por tipo.
5. **Pares distintos, avisos distintos.** Un aviso por par (pregunta 2): la acción del usuario (revisar) y el ciclo de vida del grupo son por par, igual que el episodio de obsolescencia; el máximo de avisos simultáneos es el número de pares configurados (≤ 50), y cada uno se avisa una sola vez por grupo.
6. **Enlace.** Sigue siendo `FX_RATE` con `fxRateId = periodId = reviewRateId` (la pendiente más antigua en la última actualización) y `periodLabel` = mes de `firstRetainedAt` en la zona del workspace; lleva a Tasas → Proveedores, que ya lista todas las muestras pendientes del workspace y hace scroll a esa (`/fx?vista=proveedores#anomalia-<id>`). Se actualiza en cada refresco. Sin destino nuevo (pregunta 3).
7. **Contenido.** In-app (v2): título "USDT/BOB: 3 tasas automáticas retenidas" (plural según la cantidad, ICU en es/en/pt) y cuerpo con la mayor variación (`PARALLEL_SELL` 12.90 frente a 12.10, +6.61 %, paralelo.bo) y los providers. Email `basic`: "Una o más tasas automáticas quedaron retenidas y necesitan tu revisión", sin valores, variaciones, códigos, providers ni cantidad (la cantidad puede quedar desactualizada respecto del email y no aporta a la acción). Email `detailed`: se renderiza al enviarse desde la notificación vigente (`DispatchEmailDelivery` ya lo hace así), por lo que un email diferido por silencio muestra el estado del grupo en ese momento. Severidad `WARNING` (sin cambios).
8. **Evento `fx.RateAnomalyRetained.v1`: sin cambios.** Sigue publicándose uno por muestra retenida, en la misma transacción que su inserción; es el hecho de dominio (catálogo, trazabilidad, futuros consumidores) y la agrupación es una regla de aviso de NOTIFY. No se agrega `groupRateId` al payload (pregunta 4).
9. **Idempotencia y reintentos.** (a) Reintento del job o ciclo reprocesado: la inserción de muestras es idempotente por (provider, par, tipo, vigencia), así que no hay muestras retenidas nuevas ni llamada al puerto. (b) Falla del puerto o de la foto: la transacción del workspace se revierte completa (muestras, eventos y aviso) y el ciclo siguiente la reintenta, como hoy. (c) Misma foto entregada dos veces: el `UPDATE` deja la fila igual. (d) Fotos fuera de orden: la condición sobre `lastRetainedAt` impide retroceder. (e) Purga de notificaciones antiguas (`purge-expired`) con el grupo aún abierto: la siguiente muestra crea un aviso nuevo para ese destinatario (residuo aceptado; la retención supera con creces la vida de un grupo normal).
10. **Migración de lo existente (sin migración de datos).** Las notificaciones v1 (una por muestra) se siguen renderizando con su mensaje v1. Como su `dedupeKey` ya es `fx-rate-anomaly-retained:<rateId>`, si una muestra retenida antes del cambio es el ancla de un grupo que sigue recibiendo muestras, la primera actualización convierte esa notificación en el aviso del grupo (mensaje v2 y foto completa); las demás v1 quedan como están. Un usuario que hoy tiene avisos sueltos de un salto pendiente no recibe uno nuevo: se actualiza el más antiguo.

## Contratos

**`contracts/openapi/finance-api.v1.yaml`:** sin cambios de esquema. Se amplía solo la descripción de `NotificationLink.fxRateId` ("for a held-rate notice, the oldest pending sample of the pair's group at its last update; the notice can be updated while the group stays open"), lo que oasdiff no marca como ruptura. `NotificationType` y `NotificationLink.kind` no cambian. Sin endpoints ni `ErrorCode` nuevos.

**`contracts/events/`:** sin cambios; `RateAnomalyRetained.v1` conserva su payload y su cardinalidad (uno por muestra). Se corrige solo la frase de su descripción "NOTIFY recibe el aviso por su puerto síncrono" para decir que el aviso se agrupa por par (texto, no esquema).

**`@pf/notifications/contracts` (contrato entre módulos, no público):**

```ts
export interface RateAnomalyGroupFact {
  readonly anchorRateId: string;
  readonly base: string;
  readonly quote: string;
  readonly pendingCount: number; // ≥ 1
  readonly retainedCount: number; // ≥ pendingCount
  readonly providers: readonly string[]; // distintos, orden alfabético
  readonly reviewRateId: string;
  readonly peak: RateAnomalyRetainedFact; // tipo existente, sin cambios
  readonly firstRetainedAt: string;
  readonly lastRetainedAt: string;
  readonly detectedAt: string;
  readonly timeZone: string;
}
// NotificationIntakeFact: la variante FX_RATE_ANOMALY_RETAINED pasa a llevar payload RateAnomalyGroupFact y factKey = anchorRateId.
// NotificationIntakeOutcome: se agrega `refreshed: number` (aditivo).
```

El cambio de la variante `FX_RATE_ANOMALY_RETAINED` no es aditivo en TypeScript, pero el puerto es síncrono y en proceso: productor (FX) y consumidor (NOTIFY) se despliegan juntos en `apps/worker` y no hay mensajes persistidos con la forma anterior. `RateAnomalyRetainedFact` se conserva (es el `peak`).

## Riesgos / Trade-offs

- [El aviso leído no vuelve a no leído aunque el grupo crezca] → decisión deliberada para bajar el ruido (pregunta 5); las muestras pendientes siguen en el panel y, si el grupo pasa N horas sin revisión, el par abre su episodio de obsolescencia, que sí avisa.
- [Un grupo que nadie revisa dura días y absorbe saltos nuevos del par] → mismo argumento: el aviso existente se actualiza (cantidad, mayor variación) y la obsolescencia avisa aparte.
- [Costo de `retainedOfPair` con muchas muestras retenidas] → índice parcial `(workspace_id, base_currency, quote_currency, created_at DESC, id DESC) WHERE anomaly_flagged`; la lectura recorre de la más reciente hacia atrás y se detiene al cerrar la isla vigente; solo corre para pares con alguna muestra retenida nueva en la transacción.
- [Bloqueo consultivo por workspace] → solo en transacciones con detección de anomalías; el ciclo ya es secuencial, así que en una sola réplica nunca espera.
- [UPDATE sobre `notifications.notification` desde el worker] → si `pf_worker` no tiene `UPDATE` sobre esas columnas, migración expand-only con el `GRANT` mínimo (`params`, `message_key`, `link`); RLS de workspace y usuario sin cambios.

## Plan de migración

Expand-only y sin migración de datos:

1. Índice parcial `fx.exchange_rate (workspace_id, base_currency, quote_currency, created_at DESC, id DESC) WHERE anomaly_flagged` (migración con timestamp posterior a la última de `main`).
2. `GRANT UPDATE (params, message_key, link) ON notifications.notification TO pf_worker` solo si hoy no lo tiene (la tarea 4.1 lo verifica).
3. Despliegue: el worker nuevo agrupa desde la primera muestra; las notificaciones v1 se siguen viendo; la conversión del ancla ocurre sola (decisión 10).

Rollback: revertir solo el agrupamiento en FX y en el plan de NOTIFY, conservando el render del mensaje v2 (no se revierte), para que los avisos ya agrupados se sigan mostrando; las notificaciones v2 quedan como datos y los avisos nuevos vuelven a ser uno por muestra.

**Orden:** después de `add-rate-feed-alerts` (modifica su requirement "Notificación de muestra anómala retenida"); se archiva después de él, que a su vez se archiva después de `add-crypto-rate-providers` (docs/38). No depende de los changes 40–45.

## Preguntas abiertas

Ninguna bloquea la redacción ni el orden de implementación; el diseño adopta las recomendaciones.

1. **Clave de agrupación.** Opciones: (a) **grupo de muestras pendientes del par sin interrupción, con ancla en la primera (este diseño)**: un aviso por salto aunque persista, sin estado nuevo; (b) workspace + par + ciclo de consulta: simple, pero un salto que persiste avisa cada ciclo (hasta 96 por día con polling de 15 minutos); (c) ventana fija de tiempo (por ejemplo 6 horas): requiere estado o una clave por tramo y vuelve a avisar sin que cambie nada; (d) tabla `fx.rate_anomaly_group` con el grupo explícito: mismo comportamiento que (a) con una tabla más (RLS, portabilidad, registro), innecesaria porque (a) se deriva de `fx.exchange_rate` y `fx.rate_anomaly_review`. **Recomendación: (a).**
2. **Un aviso por par o uno por ciclo.** Opciones: (a) **uno por par**: coincide con la revisión y con el episodio de obsolescencia, y la clave es estable; (b) uno por workspace y ciclo con todos los pares: menos avisos en un desplome general, pero mezcla grupos con ciclos de vida distintos y no admite una clave estable sin estado. **Recomendación: (a).**
3. **Destino del enlace.** Opciones: (a) **`FX_RATE` a la muestra pendiente más antigua del grupo, actualizado en cada refresco** (sin cambio de contrato; el panel lista todas las pendientes); (b) destino nuevo `FX_RATE_ANOMALIES` con filtro por par (`x-extensible-enum`, aditivo) y una vista filtrada en la web; (c) siempre la primera muestra del grupo (puede estar ya revisada). **Recomendación: (a)**; (b) queda para cuando el panel tenga filtro por par.
4. **Evento por muestra o por grupo.** Opciones: (a) **seguir publicando `fx.RateAnomalyRetained.v1` uno por muestra, sin cambios**; (b) agregar `groupRateId` opcional al payload (aditivo); (c) un evento nuevo `fx.RateAnomalyGroupUpdated.v1`. Sin consumidores en Phase 5, (b) y (c) no aportan hoy. **Recomendación: (a).**
5. **Estado de lectura al actualizar.** Opciones: (a) **conservar leído o archivado y la fecha de creación; sin email nuevo**; (b) volver a no leído cuando crece la cantidad (más visible, más ruido: lo contrario a lo pedido). **Recomendación: (a).**
6. **Cantidad en el email sin detalles.** Opciones: (a) **sin cantidad: texto "una o más tasas"** (no queda desactualizado y no revela actividad del par); (b) con la cantidad del momento de la creación. **Recomendación: (a).**
