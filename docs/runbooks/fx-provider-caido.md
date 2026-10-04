# Runbook: provider de tasas caído, lento u obsoleto

> **Relacionado:** ADR-0025 · openspec `add-market-rate-providers` (capability `fx/market-rate-providers`) · [config-reference.md](../config-reference.md) (variables `FX_*`) · RISK-023

El core **no depende** de los providers: ninguna request de usuario los consulta (la API solo lee `fx.exchange_rate`). Si paralelo.bo o bo.dolarapi.com fallan, la valoración conmuta sola: principal → respaldo → última tasa conocida marcada obsoleta (con su antigüedad) o la manual más reciente → `FX_RATE_NOT_FOUND` (nunca un valor inventado). Este runbook sirve para entender qué pasa y decidir si hace falta intervenir.

### Niveles de selección y umbrales (as-built)

La tasa resuelta (`GET /fx-rates/latest`, valoración de saldos y reportes) informa el nivel usado en `selection` y si está obsoleta en `stale` (+ `ageSeconds`). Solo se consideran tasas elegibles: no reemplazadas, sin anomalía `PENDING`/`REJECTED` y con `asOf ≤ t`.

| `selection` | Cuándo | Umbral de obsolescencia |
|---|---|---|
| `PRIMARY` | Última tasa del provider principal del tipo, no obsoleta (`PARALLEL`: `FX_PROVIDER_PRIMARY`; `OFFICIAL`: `FX_PROVIDER_OFFICIAL`). | `FX_STALE_AFTER_PARALLEL` (`60m`) · `FX_STALE_AFTER_OFFICIAL` (`48h`) |
| `FALLBACK` | Última tasa del provider de respaldo (`FX_PROVIDER_FALLBACK`, solo `PARALLEL`), no obsoleta. | `FX_STALE_AFTER_FALLBACK` (`180m`; bo.dolarapi.com publica con ~2 h de retraso, docs/31 D32) |
| `LAST_KNOWN_STALE` | Ninguna fresca: la última de provider es más reciente que la última manual; `stale = true`. | — |
| `MANUAL` | Ninguna fresca y la manual más reciente gana. Puede ser de **otro tipo** del par (p. ej. `P2P`) solo si tiene ≤ `FX_MANUAL_FALLBACK_MAX_AGE` (`24h`) y su desvío respecto de la última tasa de provider del par no supera `FX_ANOMALY_THRESHOLD_PCT` (docs/31 D34, D38); nunca `PARALLEL_BUY`/`PARALLEL_SELL`. | — |

Sin ninguna candidata ⇒ `FX_RATE_NOT_FOUND`. Defaults confirmados en docs/31 D31–D33 y D38; detalle de las variables en [config-reference.md](../config-reference.md) y [19-local-development.md](../19-local-development.md) §6.1.

## 1. Diagnóstico

1. **Estado:** `GET /api/v1/workspaces/{workspaceId}/fx-providers/status` (cualquier miembro). Mirar por provider:
   - `health`: `HEALTHY` · `DEGRADED` (último intento falló, la tasa aún no está obsoleta) · `DOWN` (alguna tasa de su rol está obsoleta) · `DISABLED` (`none` o configuración inválida).
   - `lastError.code`: `PROVIDER_UNAVAILABLE` (red/5xx/redirección), `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMITED` (+ `rateLimit.retryAfterUntil`), `PROVIDER_PAYLOAD_INVALID` (valor nulo/≤ 0/> 18 decimales/JSON truncado), `PROVIDER_SCHEMA_CHANGED` (cambió la API), `FX_PROVIDER_CONFIG_INVALID`.
   - `consecutiveFailures`, `lastSuccessAt`, `feeds[].ageSeconds`/`stale`, `nextAttemptAt`.
2. **Bitácora:** `fx.provider_run` (tabla de instalación, sin datos de usuario; 90 días):
   ```sql
   SELECT provider, kind, started_at, outcome, error_code, http_status, latency_ms, new_samples, retry_after_until
     FROM fx.provider_run ORDER BY started_at DESC LIMIT 20;
   ```
   `outcome`: `OK` · `NO_NEW_SAMPLE` · `FAILED` (con `error_code`) · `SKIPPED_RATE_LIMIT` · `SKIPPED_CACHE`; `kind`: `POLL` · `BACKFILL` · `GAP_FILL` (estas dos con `history_points`/`history_from`/`history_to`). La purga de filas > 90 días la hace el propio ciclo de polling.
3. **Logs del worker** (campo `job.queue`): `fx market rate providers scheduled` (arranque: colas, cron y roles), `fx market rates polled` (resultado por provider), `fx historical rates backfilled`, `fx rate gaps filled`, `fx market rate providers disabled (FX_PROVIDER_* = none)` y, con configuración inválida, `fx market rate providers not started: invalid configuration` (nivel `error`, `code = FX_PROVIDER_CONFIG_INVALID`). No hay métricas OTel propias de los providers: la fuente es `GET /fx-providers/status` + `fx.provider_run`.
4. **Egress desde Docker Compose** (modo B, D33): si todos los intentos fallan con `PROVIDER_UNAVAILABLE`/`PROVIDER_TIMEOUT` solo en contenedores, comprobar la salida HTTPS a `paralelo.bo` y `bo.dolarapi.com` con la verificación de [19-local-development.md](../19-local-development.md) §6.1 (firewall/proxy corporativo del host de Docker).

## 2. Acciones por causa

| Causa | Qué hace el sistema | Acción |
|---|---|---|
| Caída temporal / timeout / 5xx | Reintenta en el siguiente ciclo; tras 5 fallas seguidas espacia los intentos (máx. 1 h). La valoración usa el respaldo. | Ninguna. Si dura > 1 día, registrar tasas manuales (`POST /fx-rates`) para las operaciones concretas. |
| `PROVIDER_RATE_LIMITED` | No consulta hasta `retryAfterUntil` (persistido: sobrevive reinicios). | Ninguna. Si se repite, subir `FX_POLL_INTERVAL` (p. ej. `30m`). |
| `PROVIDER_SCHEMA_CHANGED` / `PROVIDER_PAYLOAD_INVALID` persistente | No registra ninguna tasa de esa respuesta. | Revisar la API del provider (`https://paralelo.bo/openapi.json`), actualizar el adapter (ACL) y sus fixtures de contrato; mientras tanto, `FX_PROVIDER_PRIMARY=dolarapi_bo` y `FX_PROVIDER_FALLBACK=none`, o tasas manuales. |
| Anomalía (> `FX_ANOMALY_THRESHOLD_PCT`) | La muestra queda retenida (`anomaly.status = PENDING`) y no se usa. | Un EDITOR/OWNER la confirma o rechaza con motivo: `POST /fx-rates/{fxRateId}/anomaly-review` con `{"decision": "CONFIRM" \| "REJECT", "reason": "…"}` e `Idempotency-Key` (auditado; 409 `FX_RATE_ANOMALY_ALREADY_REVIEWED`, 422 `FX_RATE_NOT_ANOMALOUS`). Una rechazada nunca se usa ni sirve de línea base. |
| `FX_PROVIDER_CONFIG_INVALID` | Los providers no se inician; el resto del worker y la API siguen. | Corregir las variables `FX_*` (ver config-reference) y reiniciar el worker. |
| Cambio de términos/licencia | — | Deshabilitar el provider (`none`), registrar la revisión en ADR-0025 §Notas y decidir con el owner. |

## 3. Deshabilitar / rollback

`FX_PROVIDER_PRIMARY=none FX_PROVIDER_FALLBACK=none FX_PROVIDER_OFFICIAL=none` y reiniciar el worker: se desprograman las colas `fx.poll-market-rates` y `fx.fill-rate-gaps`. Las tasas ya registradas quedan (son históricas válidas e inmutables). Volver a habilitar repone las programaciones y, con `FX_BACKFILL_ENABLED=true`, el relleno diario (`fx.fill-rate-gaps`, 02:00 America/La_Paz, y uno al arrancar) completa los días faltantes desde el histórico de paralelo.bo.
