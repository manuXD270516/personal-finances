# Tareas

> Requiere aplicado `add-crypto-rate-providers` (pares configurados, cobertura, `MARKET`, `RatePairsQuery`) y Phase 2 (NOTIFY). Sin consumidores nuevos (D249). Confirmar la pregunta 1 de design.md antes del grupo 3; no bloquea la spec.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `fx/market-rate-providers` y `notifications/alerts`; `openspec validate add-rate-feed-alerts --strict`
- [ ] 1.2 Revisar TC-FX-PROVIDER-038..041 y TC-NOTIFICATIONS-FX-001..009 contra los scenarios (08:00Z → 14:15Z = 6 h 15 min > 6 h; 72000.00 / 65000.00 − 1 = +10.77 %); pasar a `ready` y `requirement_status: confirmed`

## 2. DOMAIN (TDD)

- [ ] 2.1 `FeedFreshnessEvaluator` test-first (TC-FX-PROVIDER-038, TC-FX-PROVIDER-039; PBT con timeout explícito: a lo sumo un episodio abierto por par y un hecho por apertura y por cierre)
- [ ] 2.2 Validación de `FX_FEED_STALE_ALERT_AFTER` y exclusión de pares `MANUAL_ONLY` y de providers deshabilitados (TC-FX-PROVIDER-041)
- [ ] 2.3 Tipos `FX_RATE_FEED_STALE`, `FX_RATE_FEED_RECOVERED`, `FX_RATE_ANOMALY_RETAINED` en el catálogo de NOTIFY sin consumidor; plantillas es/en/pt y emails sin detalles (TC-NOTIFICATIONS-FX-001, TC-NOTIFICATIONS-FX-003, TC-NOTIFICATIONS-FX-005, TC-NOTIFICATIONS-FX-006)

## 3. APPLICATION

- [ ] 3.1 `NotificationIntakePort` en `@pf/notifications/contracts`, implementado por NOTIFY con destinatarios OWNER y EDITOR, preferencias, horario de silencio y deduplicación por `(type, factKey, recipient)` (TC-NOTIFICATIONS-FX-002, TC-NOTIFICATIONS-FX-007)
- [ ] 3.2 Paso `CheckFeedFreshness` al final de cada ciclo de `PollMarketRates`, por workspace en la misma unidad de trabajo (episodio + outbox + puerto), consultas secuenciales sobre el mismo cliente (TC-FX-PROVIDER-038, TC-FX-PROVIDER-039)
- [ ] 3.3 Hecho de muestra retenida en la ingesta (outbox + puerto) (TC-FX-PROVIDER-040, TC-NOTIFICATIONS-FX-004)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand-only `fx.rate_feed_episode` (RLS forzada, índice único parcial, `platform.workspace_scoped_table`); CHECK de tipos de notificación si existe; timestamp posterior a la última de `main`
- [ ] 4.2 Config `FX_FEED_STALE_ALERT_AFTER` en el contrato único; `pnpm config:docs`
- [ ] 4.3 Portabilidad: sección `fx-rate-feed-episodes`
- [ ] 4.4 Cableado del puerto en el worker; el arranque no registra colas `events.notifications.*` nuevas y el presupuesto de conexiones no cambia (TC-NOTIFICATIONS-FX-009, TC-PLATFORM-EVENTS-018 en verde)
- [ ] 4.5 Tests de integración con providers simulados y `FixedClock`; `pnpm test:integration` dos veces en verde

## 5. API y EVENTOS

- [ ] 5.1 OpenAPI: `NotificationType` con los tres tipos, destinos de enlace, `FxRatePairStatus.openEpisode`; `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas
- [ ] 5.2 `contracts/events/fx/RateFeedStale.v1`, `RateFeedRecovered.v1`, `RateAnomalyRetained.v1` con ejemplos; tests de contrato de eventos; README de eventos

## 6. UI

- [ ] 6.1 Textos de los tres tipos en el centro de notificaciones (es/en/pt), enlace al estado de tasas automáticas y a la revisión de la tasa; episodio abierto visible en el estado por par; axe

## 7. TESTS AUTOMATIZADOS y E2E

- [ ] 7.1 E2E: con el provider simulado caído y el reloj avanzado más de 6 h, el OWNER ve la alerta de obsolescencia; al volver la tasa, la de recuperación; una muestra anómala genera la alerta y desde su enlace se confirma (TC-NOTIFICATIONS-FX-008); con `PF_E2E_PROJECT`
- [ ] 7.2 Regresión: TC-NOTIFICATIONS-\*, TC-FX-PROVIDER-001..037, TC-PLATFORM-EVENTS-018

## 8. DOCS

- [ ] 8.1 docs/11 (tres eventos), docs/10 (`NotificationType`), docs/01 FR-NOTIFY-004 (tasa obsoleta, recuperada y anómala: OWNER y EDITOR), docs/config-reference.md
- [ ] 8.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `openspec validate add-rate-feed-alerts --strict`
