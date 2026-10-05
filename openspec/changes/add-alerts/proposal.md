# Propuesta: add-alerts

## Why

Un presupuesto solo controla el gasto si avisa a tiempo. docs/24 §5.2 pone en Phase 2 las "notificaciones in-app/email" y su exit criteria exige "alertas de umbral entregadas exactamente una vez". FR-NOTIFY-001..006 (docs/01 §18) piden un centro de notificaciones in-app, canal email (SMTP; Mailpit en local), preferencias por tipo y canal con horario de silencio, tipos incrementales por fase (en Phase 2: umbral de presupuesto y cierre de mes pendiente), idempotencia (inbox + clave de deduplicación de negocio) y emails sin montos salvo opt-in. Este change crea el contexto NOTIFY (`@pf/notifications`, docs/05 §2.16), que **solo traduce hechos publicados** (`planning.BudgetThresholdReached.v1` de `add-budgets` y el hecho de cierre pendiente de `add-month-closing`) en notificaciones, sin decidir reglas de negocio.

## What Changes

- **Centro de notificaciones in-app** por usuario y workspace: estados `UNREAD`/`READ`/`ARCHIVED`, contador de no leídas, marcar leída / todas / archivar, enlace al recurso de origen (con degradación si ya no existe), privacidad por usuario (RLS + filtro por usuario).
- **Tipos de Phase 2:** `BUDGET_THRESHOLD` (todos los miembros activos) y `MONTH_CLOSE_PENDING` (OWNER y EDITOR); catálogo de tipos extensible para Phases 3–7 (FR-NOTIFY-004).
- **Una notificación por hecho de origen:** inbox `(consumer, eventId)` + clave de deduplicación de negocio única por usuario (p. ej. `budget-threshold:<periodo>:<objetivo>:<umbral>`).
- **Canal email** (Should) detrás del puerto `EmailSender`: adapter `smtp` (Mailpit en local/CI; cualquier relay SMTP en producción) y `none` (suprimido); envío **una sola vez** por notificación (entrega con lease, `Message-ID` determinista, sin reenvío tras aceptación), reintentos con backoff (5 intentos) sin afectar el in-app; plantillas versionadas en **es/en/pt** por locale del destinatario (respaldo es).
- **Privacidad del email** (Must): sin montos, saldos, nombres de categorías/cuentas ni descripciones salvo opt-in de "incluir detalles"; enlace a la app autenticada sin tokens.
- **Preferencias** (Should) por tipo × canal, opt-in de detalles y **horario de silencio** (difiere el email, no lo descarta; el in-app se crea en el momento).
- **Fuera de alcance:** digest semanal/mensual (FR-NOTIFY-007, Phase 7), webhook/Telegram (FR-NOTIFY-008), push (FR-NOTIFY-009), tipos de Phases 3–7 (próximos pagos, metas, tarjetas, tasas obsoletas, imports, déficit), aviso de violación de invariante (pregunta 5), tiempo real por SSE/WebSocket (la UI consulta el contador periódicamente), elección del proveedor de email de producción (pregunta 1), alertas operativas de NFR-OBS-005.

## Capabilities

### New Capabilities
- `notifications/alerts`: centro in-app, tipos de Phase 2, deduplicación por hecho, email con privacidad y entrega única, i18n es/en/pt, preferencias y horario de silencio (15 requirements: 9 Must, 6 Should).

### Modified Capabilities
- Ninguna. (Requiere ampliar el contrato público de Identity con la consulta de miembros activos con rol, locale, zona horaria y email verificado; ver design.md § Contratos.)

## Impact

**Specs impactadas:** crea `notifications/alerts`. Consume hechos de `planning/budgets` (`add-budgets`) y `planning/month-closing` (`add-month-closing`, sibling pf-p2a); lee `identity/workspace-membership` y `identity/authentication` (miembros, roles, locale, zona horaria, email), `security/access-control`, `platform/event-delivery` (inbox, colas, dead-letter).

**Componentes/contextos impactados:** nuevo contexto NOTIFY `@pf/notifications`: domain AR `Notification`, `NotificationPreferences`, VO `NotificationType`, `QuietHours`, `DedupeKey`, `NotificationLocale`, registro `NotificationTypeCatalog`; application `NotifyFromEvent` (consumidores `notifications.budget-threshold` y `notifications.month-close-pending`), `DispatchEmailDelivery`, `MarkAsRead`, `MarkAllAsRead`, `Archive`, `UpdatePreferences`, queries `ListNotifications`, `GetUnreadCount`, `GetPreferences`; infrastructure repositorios Kysely, `SmtpEmailSender` (nodemailer), `NoneEmailSender`, `TemplateRenderer` (plantillas es/en/pt), jobs pg-boss. Identity: query pública `WorkspaceRecipientsQuery`. `apps/api` (controllers `notifications`, `notification-preferences`), `apps/worker` (consumidores, despacho de email, purga), `apps/web` (campana con contador, bandeja, preferencias), `deploy/compose` (variables `SMTP_*` apuntando a Mailpit; producción con `EMAIL_DRIVER=none` hasta elegir proveedor).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — nuevas `GET W/notifications`, `GET W/notifications/unread-count`, `POST W/notifications/{notificationId}/read`, `POST W/notifications/read-all`, `POST W/notifications/{notificationId}/archive`, `GET|PUT W/notification-preferences` (todas "self"); schemas `Notification`, `NotificationPreferences`. Detalle en design.md § Contratos.

**Tablas impactadas:** nuevo schema `notifications`: `notifications.notification`, `notifications.notification_delivery`, `notifications.notification_preference`, `notifications.user_setting`; `platform.inbox`; lectura vía contrato de `iam.user`/`iam.membership`.

**Eventos impactados:** ninguno producido. Consume `planning.BudgetThresholdReached.v1` (`add-budgets`) y `planning.MonthClosePending.v1` (nombre provisional; lo publica `add-month-closing`, ver design.md pregunta 4).

**Migraciones requeridas:** expand, no destructiva: `CREATE SCHEMA notifications`, cuatro tablas con RLS forzada por `workspace_id` (y por `user_id` para lectura de `pf_app`), grants (`pf_worker` inserta notificaciones y entregas; `pf_app` lee y actualiza estado propio), índices de bandeja y de entregas pendientes, registro en `platform.workspace_scoped_table`. Variables nuevas en config-reference (`EMAIL_DRIVER`, `SMTP_*`, `EMAIL_FROM`, `APP_PUBLIC_URL`, `NOTIFY_EMAIL_MAX_ATTEMPTS`, `NOTIFY_RETENTION`).

**Test cases:** AÑADIDOS — TC-NOTIFICATIONS-INAPP-001..007, TC-NOTIFICATIONS-DEDUP-001..002, TC-NOTIFICATIONS-EMAIL-001..007, TC-NOTIFICATIONS-I18N-001..002, TC-NOTIFICATIONS-PREFS-001..003 (21). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** ningún comportamiento previo cambia. Nuevos consumidores en el worker (lag del outbox, NFR-PERF-008: p95 ≤ 5 s del evento a la notificación in-app) y nuevo servicio externo (SMTP) en el camino del worker: su caída no debe bloquear otros consumidores (colas por consumidor). El stack local y de CI ya levanta Mailpit; E2E agrega su verificación.

**Riesgos introducidos:** RISK-010 (privacidad: emails sin detalles por defecto, sin direcciones de email en logs ni en tablas de notificación, enlaces sin tokens), RISK-022 (consistencia eventual: notificación con lag; DLQ observable), RISK-005 (sobre-ingeniería: un solo canal externo con dos adapters; sin SSE ni digest), RISK-007 (costo del proveedor de email en producción; `none` por defecto hasta decidir).

**Invariantes afectadas:** INV-025 (aislamiento por workspace) e INV-028 (consumidores idempotentes). No toca dinero, ledger, FX ni periodos (los montos que muestra vienen del hecho de origen, sin recálculo).
