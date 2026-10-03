# Runbook: provider de tasas caído, lento u obsoleto

> **Relacionado:** ADR-0025 · openspec `add-market-rate-providers` (capability `fx/market-rate-providers`) · [config-reference.md](../config-reference.md) (variables `FX_*`) · RISK-023

El core **no depende** de los providers: ninguna request de usuario los consulta (la API solo lee `fx.exchange_rate`). Si paralelo.bo o bo.dolarapi.com fallan, la valoración conmuta sola: principal → respaldo → última tasa conocida marcada obsoleta (con su antigüedad) o la manual más reciente → `FX_RATE_NOT_FOUND` (nunca un valor inventado). Este runbook sirve para entender qué pasa y decidir si hace falta intervenir.

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
3. **Logs del worker:** `fx market rates polled` (resultado por provider), `fx market rate providers not started: invalid configuration`.

## 2. Acciones por causa

| Causa | Qué hace el sistema | Acción |
|---|---|---|
| Caída temporal / timeout / 5xx | Reintenta en el siguiente ciclo; tras 5 fallas seguidas espacia los intentos (máx. 1 h). La valoración usa el respaldo. | Ninguna. Si dura > 1 día, registrar tasas manuales (`POST /fx-rates`) para las operaciones concretas. |
| `PROVIDER_RATE_LIMITED` | No consulta hasta `retryAfterUntil` (persistido: sobrevive reinicios). | Ninguna. Si se repite, subir `FX_POLL_INTERVAL` (p. ej. `30m`). |
| `PROVIDER_SCHEMA_CHANGED` / `PROVIDER_PAYLOAD_INVALID` persistente | No registra ninguna tasa de esa respuesta. | Revisar la API del provider (`https://paralelo.bo/openapi.json`), actualizar el adapter (ACL) y sus fixtures de contrato; mientras tanto, `FX_PROVIDER_PRIMARY=dolarapi_bo` y `FX_PROVIDER_FALLBACK=none`, o tasas manuales. |
| Anomalía (> `FX_ANOMALY_THRESHOLD_PCT`) | La muestra queda retenida (`anomaly.status = PENDING`) y no se usa. | Un EDITOR/OWNER la confirma o rechaza con motivo: `POST /fx-rates/{id}/anomaly-review` (auditado). |
| `FX_PROVIDER_CONFIG_INVALID` | Los providers no se inician; el resto del worker y la API siguen. | Corregir las variables `FX_*` (ver config-reference) y reiniciar el worker. |
| Cambio de términos/licencia | — | Deshabilitar el provider (`none`), registrar la revisión en ADR-0025 §Notas y decidir con el owner. |

## 3. Deshabilitar / rollback

`FX_PROVIDER_PRIMARY=none FX_PROVIDER_FALLBACK=none FX_PROVIDER_OFFICIAL=none` y reiniciar el worker: se desprograman las colas `fx.poll-market-rates` y `fx.fill-rate-gaps`. Las tasas ya registradas quedan (son históricas válidas e inmutables). Volver a habilitar repone las programaciones y el relleno diario (02:00 America/La_Paz, y uno al arrancar) completa los días faltantes desde el histórico de paralelo.bo.
