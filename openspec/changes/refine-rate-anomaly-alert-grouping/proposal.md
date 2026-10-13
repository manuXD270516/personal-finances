# Propuesta: refine-rate-anomaly-alert-grouping

## Why

`add-rate-feed-alerts` (#128) avisa una vez por muestra retenida como anómala (D234, por omisión). Un mismo salto de USDT/BOB genera hasta tres avisos por provider y ciclo (mediana, compra y venta), hasta seis con el provider de respaldo, y se repiten en cada ciclo mientras el salto siga sin revisar, porque cada muestra nueva se compara con la misma línea base. El owner respondió el 2026-10-13 que los avisos de muestra anómala deben agruparse, lo que revierte D234. FR-FX-010 y US-182 siguen pidiendo la alerta; lo que cambia es su granularidad.

## What Changes

- **Un aviso por grupo de muestras pendientes del par:** las muestras retenidas de un par en un workspace, de cualquier provider y tipo de tasa, forman un grupo mientras el par tenga sin interrupción alguna muestra pendiente de revisión. Cada OWNER y EDITOR recibe una sola notificación por grupo; las muestras siguientes del grupo la actualizan (cantidad pendiente, providers, mayor variación y enlace) sin crear otra, sin volverla a no leída y sin otro email.
- **Clave estable sin estado nuevo:** la clave del grupo es su primera muestra, derivada de las tasas y de sus revisiones; un reintento del job o un ciclo reprocesado no crea ni duplica avisos. Pares distintos tienen avisos distintos.
- **Email:** como máximo uno por destinatario y grupo; sin opt-in, el texto dice que "una o más tasas automáticas" quedaron retenidas, sin valores, monedas, providers ni cantidad; con opt-in, muestra el estado del grupo al enviarse.
- **Sin cambios** en el evento `fx.RateAnomalyRetained.v1` (sigue siendo uno por muestra), en la detección, en la revisión ni en el aviso de obsolescencia.
- **Migración:** sin migración de datos; los avisos existentes (uno por muestra) se siguen viendo y el de la muestra más antigua de un grupo abierto pasa a ser el aviso del grupo.
- **Fuera de alcance:** recordatorios de muestras sin revisar (D236), actualizar el aviso cuando alguien revisa, un aviso por ciclo con varios pares, digest (Phase 7).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `notifications/alerts`: el aviso de muestra anómala retenida pasa a ser uno por grupo de muestras pendientes del par (1 requirement MODIFIED, Should) y el email del grupo se envía una sola vez y sin detalles salvo opt-in (1 requirement ADDED, Must).

## Impact

**Specs impactadas:** `notifications/alerts` (modifica el requirement "Notificación de muestra anómala retenida" que agrega `add-rate-feed-alerts`). Leídas sin cambios: `fx/market-rate-providers` (el hecho por muestra retenida no cambia), `fx/market-rates`, `security/access-control`.

**Componentes/contextos impactados:** FX (`@pf/fx`): DS puro `AnomalyGroupResolver`, `SampleRecorder` (un aviso por par al final de la transacción del workspace), `retainedOfPair` en el repositorio de tasas; NOTIFY (`@pf/notifications`): hecho `RateAnomalyGroupFact` en el puerto, plan con clave de grupo, `insertOrRefresh`, mensaje v2 es/en/pt (in-app y email). `apps/worker` y `apps/web` sin cambios de cableado ni de rutas.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml`: solo la descripción de `NotificationLink.fxRateId`; sin cambios de esquema, endpoints ni `ErrorCode`. `pnpm contract:breaking` limpio.

**Tablas impactadas:** ninguna tabla nueva. Índice parcial nuevo en `fx.exchange_rate` (muestras retenidas); `GRANT UPDATE` mínimo sobre `notifications.notification` para `pf_worker` si falta.

**Eventos impactados:** ninguno; `fx.RateAnomalyRetained.v1` sin cambios de esquema ni de cardinalidad (solo se corrige el texto de su descripción).

**Migraciones requeridas:** expand-only (índice y, si hace falta, grant); sin migración de datos.

**Test cases:** AÑADIDOS — TC-NOTIFICATIONS-FX-010..023 (14). MODIFICADOS — TC-NOTIFICATIONS-FX-004 (el aviso muestra 1 muestra pendiente con el mensaje v2) y TC-NOTIFICATIONS-FX-005 (el email de anomalía dice "una o más tasas"). DEPRECADOS — ninguno.

**Impacto de regresión:** notificaciones de tasas (TC-NOTIFICATIONS-FX-\*), entrega por email y preferencias (TC-NOTIFICATIONS-EMAIL-\*, TC-NOTIFICATIONS-PREFS-\*), ingesta y anomalías de providers (TC-FX-PROVIDER-\*), presupuesto de conexiones (TC-NOTIFICATIONS-FX-009, sin cambios).

**Riesgos introducidos:** un aviso leído no vuelve a no leído aunque el grupo crezca (mitigado por el episodio de obsolescencia del par); costo de la lectura de muestras retenidas del par (índice parcial); bloqueo consultivo por workspace en la ingesta.

**Invariantes afectadas:** INV-011 (las muestras retenidas no cambian; el grupo se deriva), INV-025 (aislamiento de avisos por workspace), INV-028 (deduplicación por grupo y destinatario, sin inbox de consumidor).
