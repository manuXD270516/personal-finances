# Propuesta: add-rate-feed-alerts

## Why

El criterio de salida de Phase 5 (docs/24 §5.5) exige "alertas de obsolescencia funcionando", y FR-FX-010 (Must) pide detección de tasas obsoletas y anómalas "con alerta". Hoy la obsolescencia y las muestras anómalas retenidas solo se ven si alguien abre el estado de providers: una muestra retenida bloquea la valoración del par hasta que alguien la revise, sin avisar a nadie (docs/40 P16, P18). Con los pares cripto del change 38 la volatilidad hace más probable ese bloqueo. US-182 (Should) pide la alerta de tasa obsoleta o anómala. El owner decidió el disparador (D233); las demás reglas vienen de decisiones por omisión (D234–D236, D249).

## What Changes

- **Episodios de obsolescencia por workspace y par configurado** (D233): cuando un par configurado con cobertura automática lleva más de N horas (por defecto 6, configurable) sin tasa aceptada de ningún provider, se abre un episodio y se avisa una sola vez; cuando vuelve una tasa fresca, se cierra y se avisa la recuperación. La falla no transitoria de un provider **no** alerta en Phase 5 (D233): sigue visible en el estado de providers.
- **Aviso de muestra anómala retenida** (D234): una notificación por muestra retenida, con enlace para confirmarla o rechazarla. La muestra sigue retenida hasta la respuesta, sin aceptación automática (D236).
- **Destinatarios y canal** (D235): OWNER y EDITOR; in-app siempre y email según preferencias, sin valores de tasa en el email salvo opt-in (regla general de FR-NOTIFY-006); i18n es/en/pt.
- **Sin consumidor nuevo** (D249): la detección corre en el job de providers existente y entrega la notificación a NOTIFY por un puerto síncrono en la misma unidad de trabajo, sin suscribir NOTIFY a eventos nuevos. Los hechos se publican además como eventos de dominio para el catálogo.
- **Fuera de alcance:** alerta por falla no transitoria de un provider (D233); aceptación automática de anomalías (D236); alertas de casas de cambio (change 41, en espera); digest (Phase 7); umbral N por workspace (es de la instalación).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `fx/market-rate-providers`: episodios de obsolescencia por par configurado y hecho por muestra retenida (2 requirements ADDED: 1 Must, 1 Should).
- `notifications/alerts`: tipos tasa obsoleta, tasa recuperada y tasa anómala retenida, emails sin valores e idiomas (5 requirements ADDED: 3 Must, 2 Should).

## Impact

**Specs impactadas:** `fx/market-rate-providers`, `notifications/alerts`. Leídas sin cambios: `fx/market-rates`, `security/access-control`. Depende de los pares configurados de `add-crypto-rate-providers` (change 38). No toca `debt/loans` ni `debt/amortization` (D219).

**Componentes/contextos impactados:** FX (`@pf/fx`): DS puro `FeedFreshnessEvaluator`, `RateFeedEpisode`, paso de verificación al final de cada ciclo de `PollMarketRates`, hecho de muestra retenida en la ingesta; NOTIFY (`@pf/notifications`): puerto público `NotificationIntakePort` (contracts) implementado por NOTIFY, tres tipos nuevos en el catálogo de tipos (sin consumidor), plantillas es/en/pt; `apps/worker` (cableado del puerto en el job de FX); `apps/web` (textos, enlaces al estado de tasas y a la revisión de anomalías).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`, aditivo: `NotificationType` (`x-extensible-enum`) con `FX_RATE_FEED_STALE`, `FX_RATE_FEED_RECOVERED`, `FX_RATE_ANOMALY_RETAINED`; `FxRatePairStatus` (change 38) con `openEpisode {openedAt, lastRateAsOf}` opcional. Sin endpoints ni códigos de error nuevos. `pnpm contract:breaking` limpio.

**Tablas impactadas:** `fx.rate_feed_episode` (nueva, `workspace_id`, RLS forzada, `platform.workspace_scoped_table`, portabilidad). NOTIFY sin cambios de esquema (tipos nuevos como valores de texto; CHECK ampliado si existe).

**Eventos impactados:** nuevos `fx.RateFeedStale.v1`, `fx.RateFeedRecovered.v1` y `fx.RateAnomalyRetained.v1` (productor FX; sin consumidores en Phase 5); `contracts/events/README.md` y docs/11 actualizados.

**Migraciones requeridas:** expand-only (tabla nueva; CHECK de tipos de notificación ampliado si existe); no destructivas.

**Test cases:** AÑADIDOS — TC-FX-PROVIDER-038..041 (4), TC-NOTIFICATIONS-FX-001..009 (9); total 13. MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** el ciclo de providers hace una verificación más por workspace (vigilar su duración); notificaciones existentes (TC-NOTIFICATIONS-\*), estado de providers (TC-FX-PROVIDER-\*), revisión de anomalías (Phase 1).

**Riesgos introducidos:** ruido de alertas con un provider inestable (mitigado por el umbral en horas y el aviso único por episodio); RISK-023 (la caída de una fuente se vuelve visible, que es lo buscado); acoplamiento FX → NOTIFY por puerto (pregunta 1 de design.md).

**Invariantes afectadas:** INV-011 (las muestras retenidas no cambian; solo su revisión se registra aparte), INV-025 (aislamiento de episodios y notificaciones), INV-028 (deduplicación por episodio y por tasa sin inbox de consumidor).
