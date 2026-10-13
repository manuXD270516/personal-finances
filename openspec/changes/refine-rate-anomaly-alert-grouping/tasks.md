# Tareas

> Requiere aplicado `add-rate-feed-alerts` (#128). Sin consumidores, colas ni conexiones nuevas (D249). Se archiva después de `add-rate-feed-alerts`: antes, `openspec archive` rechaza el MODIFIED porque el requirement aún no está en la spec principal. Las preguntas abiertas de design.md no bloquean: se implementan las recomendaciones.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar el delta de `notifications/alerts`; `pnpm exec openspec validate refine-rate-anomaly-alert-grouping --strict`
- [ ] 1.2 Revisar TC-NOTIFICATIONS-FX-010..023 contra los scenarios (12.80 / 12.05 − 1 = +6.22 %; 12.70 / 12.00 − 1 = +5.83 %; 12.90 / 12.10 − 1 = +6.61 %; 03:30Z = 23:30 y 11:00Z = 07:00 en America/La_Paz); pasarlos a `ready` y `requirement_status: confirmed`
- [ ] 1.3 Actualizar TC-NOTIFICATIONS-FX-004 (1 muestra pendiente, mensaje v2) y TC-NOTIFICATIONS-FX-005 (email de anomalía "una o más tasas", sin cantidad) y sus tests

## 2. DOMAIN (TDD)

- [ ] 2.1 `AnomalyGroupResolver` puro en FX test-first: islas por `(created_at, id)` y `decided_at`, ancla, pendientes, `reviewRateId`, `peak` (mayor variación absoluta, empate ⇒ la más reciente) (TC-NOTIFICATIONS-FX-012, TC-NOTIFICATIONS-FX-013, TC-NOTIFICATIONS-FX-014); PBT con timeout explícito: un único grupo vigente por par, el ancla no cambia mientras la isla no se interrumpe y el resultado no depende del orden de entrada (TC-NOTIFICATIONS-FX-023)
- [ ] 2.2 Plan de NOTIFY del tipo `FX_RATE_ANOMALY_RETAINED` con `RateAnomalyGroupFact`: `dedupeKey` por ancla, mensaje `notifications.fx_rate_anomaly_retained.v2`, enlace `FX_RATE` a `reviewRateId`; validación del hecho (TC-NOTIFICATIONS-FX-010)
- [ ] 2.3 Plantillas v2 es/en/pt (in-app con plural ICU; email `basic` "una o más tasas" sin valores, monedas, providers ni cantidad; `detailed` con el estado del grupo) conservando el render v1 (TC-NOTIFICATIONS-FX-019, TC-NOTIFICATIONS-FX-020, TC-NOTIFICATIONS-FX-018)

## 3. APPLICATION

- [ ] 3.1 `@pf/notifications/contracts`: `RateAnomalyGroupFact`, variante `FX_RATE_ANOMALY_RETAINED` del hecho con esa carga y `NotificationIntakeOutcome.refreshed`; `pnpm arch:check`
- [ ] 3.2 `NotificationIntake`: crear o actualizar por destinatario para este tipo (sin email al actualizar, sin cambiar estado de lectura ni fecha de creación, sin retroceder por `lastRetainedAt`); los demás tipos siguen con `insertIfAbsent` (TC-NOTIFICATIONS-FX-011, TC-NOTIFICATIONS-FX-016, TC-NOTIFICATIONS-FX-017, TC-NOTIFICATIONS-FX-021)
- [ ] 3.3 `SampleRecorder`: evento por muestra sin cambios; bloqueo consultivo por workspace y `now` tras el lock; un aviso por par con muestras retenidas nuevas al final de la unidad de trabajo, consultas secuenciales (TC-NOTIFICATIONS-FX-010, TC-NOTIFICATIONS-FX-011, TC-NOTIFICATIONS-FX-015)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand-only: índice parcial `fx.exchange_rate (workspace_id, base_currency, quote_currency, created_at DESC, id DESC) WHERE anomaly_flagged`; verificar si `pf_worker` puede actualizar `params`, `message_key` y `link` de `notifications.notification` y, si no, `GRANT UPDATE` mínimo en la misma migración; timestamp posterior a la última de `main`
- [ ] 4.2 `PgExchangeRateRepository.retainedOfPair` (de la más reciente hacia atrás hasta cerrar la isla vigente) y `PgNotificationRepository.insertOrRefresh` (`ON CONFLICT … DO UPDATE … WHERE notification_type = 'FX_RATE_ANOMALY_RETAINED'` y `lastRetainedAt` no menor; devuelve si insertó)
- [ ] 4.3 Integración con providers simulados y `FixedClock`: salto con tres feeds, respaldo en el mismo ciclo, ciclos siguientes, revisión parcial, grupo nuevo, varios pares, ciclo reprocesado, aviso v1 existente (TC-NOTIFICATIONS-FX-010..018); `pnpm test:integration` dos veces en verde
- [ ] 4.4 Email con Mailpit: un solo email por grupo y estado al enviarse tras el horario de silencio (TC-NOTIFICATIONS-FX-020, TC-NOTIFICATIONS-FX-021, TC-NOTIFICATIONS-FX-022)

## 5. API y EVENTOS

- [ ] 5.1 Descripción de `NotificationLink.fxRateId` en OpenAPI y de `contracts/events/fx/RateAnomalyRetained.v1.schema.json` (aviso agrupado por par, sin cambio de esquema); `pnpm contract:lint` y `pnpm contract:breaking` sin rupturas

## 6. UI

- [ ] 6.1 Comprobar que el centro de notificaciones muestra el aviso v2 (título con cantidad, cuerpo con la mayor variación y providers) y el v1, y que el enlace lleva a la muestra pendiente más antigua en Tasas → Proveedores; sin cambios de rutas

## 7. TESTS AUTOMATIZADOS y E2E

- [ ] 7.1 Test de API (`fx-feed-alerts.api.test.ts`): salto con tres muestras ⇒ un aviso por destinatario, tres eventos y VIEWER sin aviso; ciclo siguiente ⇒ mismo aviso actualizado (TC-NOTIFICATIONS-FX-010, TC-NOTIFICATIONS-FX-012)
- [ ] 7.2 Regresión: TC-NOTIFICATIONS-FX-001..009, TC-NOTIFICATIONS-EMAIL-\*, TC-NOTIFICATIONS-PREFS-\*, TC-FX-PROVIDER-001..041, TC-PLATFORM-EVENTS-018

## 8. DOCS

- [ ] 8.1 docs/11 (`fx.RateAnomalyRetained.v1`: aviso agrupado por par), docs/01 FR-NOTIFY-004 (aviso por grupo), docs/08 (índice parcial); registrar la decisión del owner que revierte D234 en el documento de decisiones que corresponda
- [ ] 8.2 Estados de los TC a `automated`; `pnpm traceability:check`, `pnpm format:check`, `pnpm exec openspec validate refine-rate-anomaly-alert-grouping --strict`
