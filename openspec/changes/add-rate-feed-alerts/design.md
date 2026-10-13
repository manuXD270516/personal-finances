# Diseño: add-rate-feed-alerts

## Contexto

Phase 1 (`add-market-rate-providers`) dejó la obsolescencia y las anomalías visibles solo en el estado de providers (`GET W/fx-providers/status`) y en la tasa (`FxRate.anomaly`); Phase 2 (`add-alerts`) dejó el centro de notificaciones, el email con Mailpit, las preferencias, el horario de silencio y la deduplicación por hecho. Cada tipo de notificación existente es un consumidor de eventos propio en el worker (`NOTIFICATION_CONSUMERS`), y el presupuesto de conexiones está en 55 de 60 (API 22 + worker 33). El change 38 (`add-crypto-rate-providers`) agrega los pares configurados por workspace y su cobertura (`RatePairsQuery`), sobre los que se mide la obsolescencia.

Decisiones que se aplican:

| Decisión | Origen | Aplicación |
|---|---|---|
| D233 | Owner | Por workspace y par configurado; N horas sin tasa fresca de ningún provider (default 6 h, configurable); una vez por episodio; aviso de recuperación; la falla no transitoria de un provider no alerta en Phase 5. |
| D234 | Por omisión | Una notificación por muestra retenida, con enlace para confirmar o rechazar. |
| D235 | Por omisión | OWNER y EDITOR; in-app siempre; email según preferencias, sin valores de tasa (FR-NOTIFY-006). |
| D236 | Por omisión | La muestra sigue retenida hasta confirmarla o rechazarla (regla de Phase 1). |
| D249 | Por omisión | Las alertas reutilizan el job de providers: sin consumidor nuevo. |
| D220 | Owner | La obsolescencia se mide sobre los pares configurados (change 38). |

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| FX | DS puro `FeedFreshnessEvaluator(pairs, latestAccepted, now, N) → {open[], close[]}` | domain | Nuevo (TDD, PBT) |
| FX | Entidad `RateFeedEpisode` (workspace, par, `openedAt`, `lastRateAsOf`, `closedAt`, `recoveredRateId`) | domain | Nuevo |
| FX | Paso `CheckFeedFreshness` al final de cada ciclo de `PollMarketRates`, por workspace; hecho de muestra retenida en la ingesta | application | Nuevo / ampliado |
| NOTIFY | Puerto público `NotificationIntakePort.notify(fact)` en `@pf/notifications/contracts`, implementado por NOTIFY con su dedupe por hecho y destinatarios | application (contracts) | Nuevo |
| NOTIFY | Tipos `FX_RATE_FEED_STALE`, `FX_RATE_FEED_RECOVERED`, `FX_RATE_ANOMALY_RETAINED` en el catálogo (sin `consumer`), plantillas es/en/pt | domain | Nuevo |
| apps/worker | Cableado: el módulo FX recibe el puerto de NOTIFY | interface | Ampliado |
| apps/web | Textos y enlaces (estado de tasas automáticas; revisión de la tasa) | interface | Ampliado |

## Objetivos / No objetivos

**Objetivos:**
- El owner se entera, sin abrir el estado de providers, de que un par que valora lleva horas sin tasa automática y de cuándo se recupera.
- Una muestra retenida se revisa pronto porque alguien recibe el aviso con el enlace.
- Cero consumidores nuevos y cero conexiones nuevas.

**No objetivos:**
- Alerta por falla no transitoria de un provider (D233). Aceptación automática (D236).
- N por workspace o por par. Digest.

## Decisiones

1. **Frescura (`FeedFreshnessEvaluator`, puro).** Por workspace, para cada par configurado con `coverage = AUTOMATIC` (change 38): `latest` = última tasa con `source = PROVIDER`, tipo automático del par (`PARALLEL` para fiat y estables, `MARKET` para cripto volátil; sin `PARALLEL_BUY/SELL` ni `OFFICIAL`), no reemplazada y sin anomalía pendiente o rechazada. `stale = now − latest.asOf > N` (o sin `latest`, desde que el par está configurado). Sin episodio abierto y `stale` ⇒ abrir; con episodio abierto y `!stale` ⇒ cerrar. `N = FX_FEED_STALE_ALERT_AFTER` (default `6h`, mínimo el intervalo de polling y no menor que el umbral de obsolescencia del tipo; validado en `parseFxProviderSettings`). Las manuales no cuentan (D233: "de ningún provider").
2. **Dónde corre.** Al final de cada ciclo de `fx.poll-market-rates`, también cuando todos los intentos del ciclo fallaron (es justo el caso). Por workspace, en la misma transacción con `SET LOCAL app.workspace_id` que ya usa la ingesta: abre o cierra el episodio, escribe el evento en el outbox y llama a `NotificationIntakePort.notify` en la misma unidad de trabajo. Con todos los providers en `none` la cola no existe y no hay episodios. Workspaces con muchos pares: una consulta por workspace (última tasa aceptada por par, agrupada), sin consultas en paralelo sobre el mismo cliente.
3. **Episodios.** `fx.rate_feed_episode` (`id`, `workspace_id`, `base_currency`, `quote_currency`, `opened_at`, `last_rate_as_of`, `closed_at` null, `recovered_rate_id` null); índice único parcial `(workspace_id, base_currency, quote_currency) WHERE closed_at IS NULL` (un solo episodio abierto por par, a prueba de dos réplicas del worker). Quitar un par configurado con episodio abierto lo cierra sin aviso de recuperación (`closed_reason = PAIR_REMOVED`). RLS forzada; `platform.workspace_scoped_table`; portabilidad (sección `fx-rate-feed-episodes`, después de los pares). Sin máquina de estados explícita (abierto/cerrado, sin transiciones de usuario; D250 por analogía).
4. **Muestra retenida.** Cuando la ingesta inserta una fila con `anomaly_flagged = true` en un workspace, en la misma transacción escribe `fx.RateAnomalyRetained.v1` y llama al puerto con el hecho `{rateId, base, quote, provider, value, baselineValue, variationPct}`. La carga histórica no marca anomalías (Phase 1), así que no alerta. La revisión (`reviewFxRateAnomaly`) no cambia.
5. **Entrega sin consumidor (D249).** `NotificationIntakePort.notify({workspaceId, type, factKey, payload, occurredAt}, uow)`: NOTIFY resuelve destinatarios (OWNER y EDITOR activos), preferencias, idioma, horario de silencio y email (agenda la entrega en `notifications.email-dispatch`, cola existente), y deduplica por `(type, factKey, recipient)` con su clave de negocio (FR-NOTIFY-005): `factKey` = `episodeId` (obsolescencia y recuperación) o `rateId` (anomalía). Es el mismo camino que usan hoy los handlers de NOTIFY, sin la capa de inbox de consumidor. Los tres tipos nuevos se registran en el catálogo **sin** `consumer`, así el worker no crea colas `events.notifications.*` nuevas y `assertConsumerConnectionBudget` no cambia (TC-NOTIFICATIONS-FX-009). Alternativas en la pregunta 1.
6. **Contenido.** In-app: par, provider (anomalía), valores y variación (anomalía), última vigencia y horas (obsolescencia); enlaces: obsolescencia y recuperación → Configuración → Tasas automáticas (estado por par); anomalía → revisión de la tasa (`/fx-rates/{id}` con la acción confirmar o rechazar de Phase 1). Email sin opt-in: texto genérico sin valores, códigos de moneda ni providers (las tenencias del owner se infieren de los pares). Severidad: obsolescencia y anomalía `WARNING`; recuperación `INFO`. Preferencias por defecto como el resto (ambos canales activos, detalles desactivados).
7. **Eventos de dominio.** `fx.RateFeedStale.v1` (`episodeId`, `base`, `quote`, `lastRateAsOf|null`, `staleAfterSeconds`, `detectedAt`), `fx.RateFeedRecovered.v1` (`episodeId`, `base`, `quote`, `rateId`, `asOf`, `openedAt`), `fx.RateAnomalyRetained.v1` (`rateId`, `base`, `quote`, `rateType`, `provider`, `value`, `baselineRateId`, `baselineValue`, `variationPct`, `thresholdPct`). Actor `SYSTEM fx-provider:<ciclo>`, `correlationId` = id del ciclo, `aggregateType` `RateFeedEpisode` o `ExchangeRate`. Sin consumidores en Phase 5 (catálogo y trazabilidad; un consumidor futuro tendría su propia justificación de conexiones).

## Contratos

**`contracts/openapi/finance-api.v1.yaml`** (aditivo): `NotificationType` `x-extensible-enum` agrega `FX_RATE_FEED_STALE`, `FX_RATE_FEED_RECOVERED`, `FX_RATE_ANOMALY_RETAINED`; `NotificationLink` admite los destinos "estado de tasas automáticas" y "tasa" (si es un enum, se amplía como `x-extensible-enum`); `FxRatePairStatus.openEpisode` (`{openedAt, lastRateAsOf}` | null, opcional). Sin endpoints ni errores nuevos.

**`contracts/events/fx/`**: `RateFeedStale.v1.schema.json`, `RateFeedRecovered.v1.schema.json`, `RateAnomalyRetained.v1.schema.json` (nuevos, con ejemplos USDT/BOB y BTC/USDT); README y docs/11 con productor FX y "sin consumidores (Phase 5)".

**Contratos entre módulos:** `@pf/notifications/contracts` `NotificationIntakePort` (nuevo); `@pf/fx/contracts` `RatePairsQuery` (del change 38).

## Riesgos / Trade-offs

- [Provider inestable que oscila alrededor de N] → el episodio solo se abre tras N horas seguidas sin tasa fresca y se cierra con una tasa fresca; una oscilación de minutos no alerta.
- [Doble aviso si una muestra retenida dura más de N horas] → la muestra retenida no cuenta como fresca, así que también abre episodio de obsolescencia (pregunta 2).
- [Acoplamiento FX → NOTIFY por puerto síncrono] → dependencia solo hacia `contracts`; si NOTIFY falla, la transacción del workspace se reintenta en el ciclo siguiente (la ingesta del resto de workspaces sigue). Alternativa en la pregunta 1.
- [Duración del ciclo con muchos workspaces] → una consulta agrupada por workspace; métrica de duración del ciclo.

## Plan de migración

Expand-only: `CREATE TABLE fx.rate_feed_episode` con RLS forzada, grants (`pf_worker` SELECT/INSERT/UPDATE; `pf_app` SELECT), índice único parcial y registro en `platform.workspace_scoped_table`; CHECK de tipos de notificación ampliado si existe. Config `FX_FEED_STALE_ALERT_AFTER` en el contrato único (`pnpm config:docs`). Rollback: revertir el despliegue (los episodios quedan como dato inerte).

**Orden:** después de `add-crypto-rate-providers` (pares configurados, cobertura y `MARKET`). La ventana de 30 días del criterio de salida empieza con 38 y 39 fusionados y N1 desplegado (D248).

## Preguntas abiertas

1. **Cómo llega la alerta a NOTIFY sin consumidor nuevo (D249).** Opciones: (a) **puerto síncrono `NotificationIntakePort` llamado por el job de FX en la misma unidad de trabajo** (este diseño; cero conexiones nuevas); (b) un consumidor único de NOTIFY para los tres eventos FX con concurrencia 1 (+1 conexión: contradice D249 y obligaría a subir `max_connections`); (c) un job periódico de NOTIFY que consulta episodios y anomalías de FX (sin consumidor, pero con latencia y otro cron). **Recomendación: (a).** No bloquea la redacción; conviene confirmarla antes de implementar.
2. **Muestra retenida y obsolescencia.** Una muestra retenida no es una tasa aceptada; si nadie la revisa en N horas, el par también abre un episodio de obsolescencia (dos avisos). Opciones: (a) **mantenerlo** (la valoración de verdad está vieja; el segundo aviso refuerza el primero); (b) no abrir episodio mientras haya una muestra retenida más reciente que N. **Recomendación: (a)**; no bloquea.

**Resolución al implementar (2026-10-13):** se adoptan las recomendaciones: la pregunta 1 con la opción (a) (puerto síncrono `NotificationIntakePort` llamado por el job de FX en la misma unidad de trabajo, sin consumidor ni cola nuevos) y la pregunta 2 con la opción (a) (el doble aviso se mantiene: una muestra retenida no cuenta como tasa fresca, así que un par con la muestra retenida sin revisar por más de N horas también abre su episodio).
