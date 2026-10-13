# Tareas

> Requiere aplicado `add-crypto-rate-providers` (pares configurados, cobertura, `MARKET`, `RatePairsQuery`) y Phase 2 (NOTIFY). Sin consumidores nuevos (D249). Confirmar la pregunta 1 de design.md antes del grupo 3; no bloquea la spec.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar los deltas de `fx/market-rate-providers` y `notifications/alerts`; `openspec validate add-rate-feed-alerts --strict` — Hecho 2026-10-13: `openspec validate add-rate-feed-alerts --strict` válido.
- [x] 1.2 Revisar TC-FX-PROVIDER-038..041 y TC-NOTIFICATIONS-FX-001..009 contra los scenarios (08:00Z → 14:15Z = 6 h 15 min > 6 h; 72000.00 / 65000.00 − 1 = +10.77 %); pasar a `ready` y `requirement_status: confirmed` — Hecho 2026-10-13: 08:00Z → 14:15Z = 6 h 15 min > 6 h y 72000.00 / 65000.00 − 1 = +10,7692 % verificados en los tests; los 13 TC pasan a `automated` con `requirement_status: confirmed` (sin dejarlos en `ready`: ya tienen test).

## 2. DOMAIN (TDD)

- [x] 2.1 `FeedFreshnessEvaluator` test-first (TC-FX-PROVIDER-038, TC-FX-PROVIDER-039; PBT con timeout explícito: a lo sumo un episodio abierto por par y un hecho por apertura y por cierre) — Hecho 2026-10-13: `packages/contexts/fx/src/domain/feed-freshness.ts` (`evaluateFeedFreshness`, puro) con TDD y PBT de 200 corridas (timeout 60 s): a lo sumo un episodio abierto por par y un hecho por apertura y por cierre; a las 6 h exactas no es obsoleto.
- [x] 2.2 Validación de `FX_FEED_STALE_ALERT_AFTER` y exclusión de pares `MANUAL_ONLY` y de providers deshabilitados (TC-FX-PROVIDER-041) — Hecho 2026-10-13: `FX_FEED_STALE_ALERT_AFTER` validada en `parseFxProviderSettings` (no menor que el intervalo de polling ni que los umbrales `FX_STALE_AFTER_*` de PARALLEL y MARKET; inválida ⇒ `FX_PROVIDER_CONFIG_INVALID` sin detener el worker); los pares sin cobertura en su tipo automático (solo manuales, o cubiertos solo por OFFICIAL) y los providers deshabilitados no abren episodios.
- [x] 2.3 Tipos `FX_RATE_FEED_STALE`, `FX_RATE_FEED_RECOVERED`, `FX_RATE_ANOMALY_RETAINED` en el catálogo de NOTIFY sin consumidor; plantillas es/en/pt y emails sin detalles (TC-NOTIFICATIONS-FX-001, TC-NOTIFICATIONS-FX-003, TC-NOTIFICATIONS-FX-005, TC-NOTIFICATIONS-FX-006) — Hecho 2026-10-13: tipos en `NOTIFICATION_TYPES` y catálogo de entrega directa `NOTIFICATION_INTAKE_CATALOG` (sin `consumer` ni `event`: el catálogo de consumidores no cambia y NOTIFY sigue en 11 colas); plantillas es/en/pt y emails `basic` sin valores, monedas ni providers; hora en la zona del workspace (`timeZone` viaja en el hecho).

## 3. APPLICATION

- [x] 3.1 `NotificationIntakePort` en `@pf/notifications/contracts`, implementado por NOTIFY con destinatarios OWNER y EDITOR, preferencias, horario de silencio y deduplicación por `(type, factKey, recipient)` (TC-NOTIFICATIONS-FX-002, TC-NOTIFICATIONS-FX-007) — Hecho 2026-10-13: `NotificationIntakePort` y los hechos tipados en `@pf/notifications/contracts`; `NotificationIntake` reutiliza `NotifyFromEvent` (OWNER y EDITOR, preferencias, silencio, deduplicación `(workspace, usuario, dedupe_key)` con `ON CONFLICT DO NOTHING`) en la transacción del llamador.
- [x] 3.2 Paso `CheckFeedFreshness` al final de cada ciclo de `PollMarketRates`, por workspace en la misma unidad de trabajo (episodio + outbox + puerto), consultas secuenciales sobre el mismo cliente (TC-FX-PROVIDER-038, TC-FX-PROVIDER-039) — Hecho 2026-10-13: `CheckFeedFreshness` al final de cada `poll()` (también si todos los intentos fallaron), por workspace en su unidad de trabajo (episodio + evento del outbox + puerto), consultas secuenciales; un error de un workspace revierte solo el suyo. Decisión: una consulta `latestAccepted` por par y feed (≤ 50 pares) en lugar de la consulta agrupada del diseño.
- [x] 3.3 Hecho de muestra retenida en la ingesta (outbox + puerto) (TC-FX-PROVIDER-040, TC-NOTIFICATIONS-FX-004) — Hecho 2026-10-13: `SampleRecorder` publica `fx.RateAnomalyRetained.v1` y avisa por el puerto en la misma transacción que inserta la muestra (un hecho por muestra: la inserción es idempotente; la carga histórica no marca anomalías).

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand-only `fx.rate_feed_episode` (RLS forzada, índice único parcial, `platform.workspace_scoped_table`); CHECK de tipos de notificación si existe; timestamp posterior a la última de `main` — Hecho 2026-10-13: `20261017100000_fx_rate_feed_episode.sql` (RLS forzada, índice único parcial, `platform.register_workspace_scoped_table` orden 150). No existe CHECK de tipos de notificación (solo la forma `^[A-Z][A-Z0-9_]{1,59}$`): no hay nada que ampliar.
- [x] 4.2 Config `FX_FEED_STALE_ALERT_AFTER` en el contrato único; `pnpm config:docs` — Hecho 2026-10-13: `FX_FEED_STALE_ALERT_AFTER` (6h) en `packages/platform/src/config/variables.ts`, `.env.example` y `pnpm config:docs`.
- [x] 4.3 Portabilidad: sección `fx-rate-feed-episodes` — Hecho 2026-10-13: sección `fx-rate-feed-episodes` (orden 226, después de las tasas por la FK `recovered_rate_id`) y esquema `contracts/export/v1/fx-rate-feed-episodes.schema.json` generado con `UPDATE_EXPORT_SCHEMAS=1`.
- [x] 4.4 Cableado del puerto en el worker; el arranque no registra colas `events.notifications.*` nuevas y el presupuesto de conexiones no cambia (TC-NOTIFICATIONS-FX-009, TC-PLATFORM-EVENTS-018 en verde) — Hecho 2026-10-13: el worker compone NOTIFY antes que los providers y pasa `notifications.intake` a `createFxMarketRateJobs`; `[TC-NOTIFICATIONS-FX-009]` en `apps/api/test/events/event-throughput.int.test.ts` (pool 34 de la plantilla del host, 11 consumidores de NOTIFY, ninguno para las alertas de tasas) y TC-PLATFORM-EVENTS-018/019 en verde sobre PostgreSQL 16 local.
- [x] 4.5 Tests de integración con providers simulados y `FixedClock`; `pnpm test:integration` dos veces en verde — Hecho 2026-10-13 (verificación local): integraciones de FX y NOTIFY, `fx-feed-alerts.api.test.ts` y el subconjunto de `apps/api` en verde sobre PostgreSQL 16 local con shim de `uuidv7` y `dbmate` (sin Docker). `pnpm test:integration` dos veces seguidas con Testcontainers queda para CI.

## 5. API y EVENTOS

- [x] 5.1 OpenAPI: `NotificationType` con los tres tipos, destinos de enlace, `FxRatePairStatus.openEpisode`; `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas — Hecho 2026-10-13: `NotificationType` y `NotificationLink.kind` (`FX_FEED_STATUS`, `FX_RATE`, `fxRateId`) en `x-extensible-enum`, `FxRatePairStatus.openEpisode` opcional (`FxRateFeedOpenEpisode`); Redocly y Spectral sin errores y `oasdiff breaking` v1.32.1 de main a la rama sin rupturas. El `pnpm contract:breaking` oficial (contenedor) queda para CI.
- [x] 5.2 `contracts/events/fx/RateFeedStale.v1`, `RateFeedRecovered.v1`, `RateAnomalyRetained.v1` con ejemplos; tests de contrato de eventos; README de eventos — Hecho 2026-10-13: `RateFeedStale.v1`, `RateFeedRecovered.v1` y `RateAnomalyRetained.v1` con ejemplos (validados por `event-contracts.test.ts` y por el outbox real en las integraciones) y `contracts/events/README.md`.

## 6. UI

- [x] 6.1 Textos de los tres tipos en el centro de notificaciones (es/en/pt), enlace al estado de tasas automáticas y a la revisión de la tasa; episodio abierto visible en el estado por par; axe — Hecho 2026-10-13: enlaces `FX_FEED_STATUS` (→ `/configuracion#tasas-automaticas`) y `FX_RATE` (→ `/fx?vista=proveedores#anomalia-<id>`), textos del detalle y de las preferencias en es/en/pt, episodio abierto visible por par en Configuración → Tasas automáticas (la tabla conserva `role=region`, `tabIndex=0` y `aria-label`); pruebas de lógica y de render. axe corre en la spec E2E.

## 7. TESTS AUTOMATIZADOS y E2E

- [ ] 7.1 E2E: con el provider simulado caído y el reloj avanzado más de 6 h, el OWNER ve la alerta de obsolescencia; al volver la tasa, la de recuperación; una muestra anómala genera la alerta y desde su enlace se confirma (TC-NOTIFICATIONS-FX-008); con `PF_E2E_PROJECT` — Spec `tests/e2e/specs/fx-feed-alerts.spec.ts` escrita (providers simulados: tasa de hace 7 h para la obsolescencia, email en Mailpit sin valores, recuperación, anomalía confirmada desde el enlace, axe) pero NO ejecutada en esta sesión (sin Docker): la valida CI; hasta entonces queda abierta.
- [x] 7.2 Regresión: TC-NOTIFICATIONS-\*, TC-FX-PROVIDER-001..037, TC-PLATFORM-EVENTS-018 — Hecho 2026-10-13: `pnpm -r test` (unitarios de FX, NOTIFY, plataforma y web: único fallo local ajeno TC-FX-PROVIDER-015 de apps/web por el formato de fecha) e integraciones de TC-FX-PROVIDER, TC-NOTIFICATIONS-* y TC-PLATFORM-EVENTS-018/019 sobre PostgreSQL 16 local.

## 8. DOCS

- [x] 8.1 docs/11 (tres eventos), docs/10 (`NotificationType`), docs/01 FR-NOTIFY-004 (tasa obsoleta, recuperada y anómala: OWNER y EDITOR), docs/config-reference.md — Hecho 2026-10-13: docs/11 (tres eventos y alertas de NOTIFY), docs/10 (`NotificationType`, enlaces y `openEpisode`), docs/01 FR-NOTIFY-004, docs/08 (`fx.rate_feed_episode`) y docs/config-reference.md.
- [x] 8.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `openspec validate add-rate-feed-alerts --strict` — Hecho 2026-10-13: los 13 TC en `automated`; `pnpm traceability:check`, `pnpm format:check` y `openspec validate add-rate-feed-alerts --strict` en verde.
