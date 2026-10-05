# Diseño

## Contexto

NOTIFY (`notifications`, `@pf/notifications`, contexto genérico; docs/05 §2.16, docs/04 §3.16) traduce hechos publicados en notificaciones por canal, con preferencias, deduplicación, reintentos y bandeja in-app; **no** decide reglas de alerta (el productor emite el hecho: `planning.BudgetThresholdReached.v1` lo decide y deduplica `add-budgets`). Relación docs/06 n.º 21 (Planning → Notify, OHS/PL, asíncrona). Entrega asíncrona por el outbox transaccional + pg-boss + inbox (ADR-0008 con su enmienda, docs/31 D30, `platform/event-delivery`). Privacidad: docs/12 §13.1 (sin montos, emails ni descripciones en logs) y §13.3 ("emails sin montos ni descripciones"); docs/08 §5.15 (tablas) y §13.1 (retención 12 meses). i18n: NFR-USAB-001/002 (es primero; en y pt listos). Local/CI: Mailpit ya está en Compose (`axllent/mailpit`, SMTP 21025, UI 28025) y es solo de desarrollo en producción (`compose.prod.yaml`, perfil `dev-only`). Motivación: proposal.md — Why.

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Notify | AR `Notification {id, workspaceId, userId, type, severity, messageKey, params, link, dedupeKey, sourceEventId, status (UNREAD\|READ\|ARCHIVED), createdAt, readAt?, archivedAt?}`; entidad `NotificationDelivery {channel EMAIL, status, notBefore, attempts, leaseUntil?, providerMessageId?, lastErrorCode?}`; AR `NotificationPreferences {userId, workspaceId, byType: {type → {IN_APP, EMAIL}}, quietHours?, includeDetailsInEmail}`; VOs `NotificationType`, `DedupeKey`, `QuietHours` (inicio/fin `HH:mm`, cruza medianoche), `NotificationLocale` (`es\|en\|pt`) | domain | Nuevo |
| Notify | `NotificationTypeCatalog`: por tipo → evento origen, política de destinatarios, `dedupeKey(payload)`, severidad, `link(payload)`, claves de plantilla | domain | Nuevo (extensible por fase) |
| Notify | `NotifyFromEvent` (consumidores `notifications.budget-threshold`, `notifications.month-close-pending`), `DispatchEmailDelivery`, `MarkAsRead`, `MarkAllAsRead`, `Archive`, `UpdatePreferences`, `PurgeExpiredNotifications`; queries `ListNotifications`, `GetUnreadCount`, `GetPreferences` | application | Nuevo |
| Notify | Puertos `NotificationRepository`, `PreferencesRepository`, `RecipientsQuery` (→ `@pf/identity/contracts`), `TargetNameQuery` (→ `@pf/classification/contracts`, nombres al presentar), `EmailSender`, `TemplateRenderer`, `JobQueue`, `Clock`, `UnitOfWork` | application/infrastructure | Nuevo |
| Identity | `WorkspaceRecipientsQuery.activeMembers(workspaceId)` → `{userId, role, locale, timeZone}`; `emailFor(userId)` → email verificado o `null` (solo lo usa el despacho de email) | contracts | Ampliación aditiva |

## Objetivos / No objetivos

**Objetivos:** una notificación por (destinatario, hecho) bajo reentregas y concurrencia; email como máximo una vez aceptado por notificación; email sin datos financieros por defecto; textos en es/en/pt; el in-app nunca depende del email; Mailpit en local/CI y proveedor intercambiable en producción.

**No objetivos:** digest, push, webhook, tiempo real (SSE), tipos de Phases 3–7, plantillas editables por el usuario, rastreo de aperturas/clics (nunca: privacidad).

## Decisiones

1. **Destinatarios.** `BUDGET_THRESHOLD`: todos los miembros activos del workspace (OWNER, EDITOR, VIEWER: todos pueden leer presupuestos, docs/10 §roles). `MONTH_CLOSE_PENDING`: OWNER y EDITOR (pueden cerrar, docs/10). Se resuelven al procesar el evento con `RecipientsQuery` (miembros con membresía activa en ese momento).
2. **Idempotencia en dos capas (INV-028, FR-NOTIFY-005).** El consumidor registra `(consumer, event_id)` en `platform.inbox` en su transacción; además `notifications.notification` tiene UNIQUE `(workspace_id, user_id, dedupe_key)` e inserta con `ON CONFLICT DO NOTHING`. `dedupe_key`: `budget-threshold:<periodId>:<targetKind>:<targetId>:<threshold>` (la misma clave de negocio del productor) y `month-close-pending:<periodId>`. Dos eventos distintos del mismo hecho (p. ej. republicación manual) no duplican. Las entregas por email se insertan **solo** si la notificación se insertó, con UNIQUE `(notification_id, channel)`.
3. **Contenido sin texto congelado.** Se guarda `message_key` + `params` (ids, umbral, `alsoCrossed`, montos como string decimal + moneda, periodo) — no `title/body` (docs/08 §5.15 se ajusta). La API renderiza en el locale del perfil del usuario (`/me.locale`: `es-*`→`es`, `en-*`→`en`, `pt-*`→`pt`, otro→`es`) con el catálogo de mensajes de `@pf/notifications`, resolviendo nombres actuales (categoría/grupo/tag, nombres traducibles de categorías de sistema por locale) en la lectura: cambiar el locale o renombrar una categoría cambia el texto mostrado. Montos con el formato del locale (NFR-USAB-002, sin float). Severidad: `INFO` (< 100 %), `WARNING` (≥ 100 % y cierre pendiente).
4. **Enlace.** `link = {kind: BUDGET_LINE, periodId, budgetId, targetKind, targetId}` o `{kind: PERIOD_CLOSE, periodId}`; la web lo traduce a ruta (`/presupuestos/2026-11?objetivo=…`, `/periodos/2026-10/cierre`). Si la línea ya no existe, la ruta del plan muestra el aviso "ya no disponible" (la notificación no se modifica).
5. **Privacidad y RLS.** RLS forzada por `workspace_id`; para `pf_app` la política de lectura/actualización agrega `user_id = current_setting('app.user_id')::uuid` (fail-closed con `PF002`, D19); `pf_worker` inserta para cualquier miembro del workspace del evento. Cualquier acceso a una notificación ajena ⇒ `RESOURCE_NOT_FOUND` (indistinguible de inexistente). Marcar leída/archivar no se audita (no es dato financiero ni configuración; alto volumen) — pregunta 7; los cambios de preferencias **sí** (configuración, FR-AUDIT-001).
6. **Canal email: puerto `EmailSender`.** `send({to, subject, text, html, messageId, idempotencyKey, listUnsubscribeUrl}) → {providerMessageId} | RetryableError | PermanentError`. Adapters de Phase 2: `smtp` (nodemailer; local/CI → Mailpit `SMTP_HOST=mailpit`/`localhost:21025`; producción → relay SMTP del proveedor que se elija) y `none` (entrega `SUPPRESSED` con motivo `CHANNEL_DISABLED`, sin error). Selección por `EMAIL_DRIVER` (`smtp` por defecto en `local`/`ci`/`dev`; `none` por defecto en `staging`/`production` hasta decidir el proveedor, pregunta 1). Un adapter HTTP (con `Idempotency-Key` del proveedor) se agrega con la decisión de proveedor sin tocar el dominio.
7. **Despacho del email con entrega única.** Al crear la notificación se inserta la entrega `PENDING` con `not_before` (ahora, o el fin del horario de silencio) y se encola en la **misma transacción** el job `notifications.email-dispatch` (pg-boss en la misma BD, `singletonKey = deliveryId`, `startAfter = not_before`). `DispatchEmailDelivery`: (a) *claim* atómico `UPDATE … SET status='SENDING', attempts=attempts+1, lease_until=now()+2 min WHERE id=$1 AND status IN ('PENDING','RETRY') AND (lease_until IS NULL OR lease_until < now())` — si no actualiza filas, termina (otro worker la tiene o ya se envió); (b) si cae dentro del horario de silencio vigente, reprograma; (c) resuelve email verificado (si no hay ⇒ `SUPPRESSED NO_EMAIL`), renderiza y envía con `Message-ID: <deliveryId@{dominio de EMAIL_FROM}>` e `idempotencyKey = deliveryId`; (d) marca `SENT` con `provider_message_id`. Un job repetido sobre una entrega `SENT` no hace nada. Error reintentable ⇒ `RETRY` con backoff exponencial (1 min, 5 min, 25 min, 2 h) hasta `NOTIFY_EMAIL_MAX_ATTEMPTS = 5`, luego `FAILED` + métrica `notifications_email_deliveries_total{status="failed"}`; error permanente (5xx de destinatario) ⇒ `FAILED` inmediato. Un barrido cada 5 min reencola entregas `PENDING`/`RETRY` vencidas cuyo job se perdió. **Residuo:** si el proceso cae entre la aceptación del proveedor y el `UPDATE … SENT`, el lease expira y se reenvía; con SMTP no hay deduplicación del lado del proveedor, por eso el `Message-ID` es constante (los clientes de correo agrupan duplicados) y el adapter HTTP futuro usará la clave de idempotencia del proveedor (Riesgos).
8. **Plantillas e i18n.** Archivos versionados `infrastructure/templates/{es,en,pt}/{type}.{subject,text,html}` (texto plano + HTML simple, sin imágenes remotas, sin píxeles de seguimiento), con escapado; dos variantes por tipo: `basic` (sin detalles: "Una línea de tu presupuesto de 2026-11 alcanzó el 90 %") y `detailed` (opt-in: objetivo y montos). Asuntos: es "Tienes una alerta de presupuesto", en "You have a budget alert", pt "Você tem um alerta de orçamento"; cierre pendiente: es "Tienes un mes pendiente de cierre", en "You have a month pending close", pt "Você tem um mês pendente de fechamento". Pie con enlace a preferencias (y cabecera `List-Unsubscribe` a la página de preferencias). Test de catálogo: toda clave existe en los tres idiomas.
9. **Enlace del email.** `APP_PUBLIC_URL` + `/notificaciones/{notificationId}`: solo ruta e id opaco (UUIDv7), sin tokens, sin "magic links"; la web exige sesión (BFF, NFR-SEC-001) y redirige tras el login.
10. **Preferencias.** `notification_preference (workspace_id, user_id, notification_type, channel, enabled)`: la ausencia de fila = activado (default: in-app y email activos); `user_setting (workspace_id, user_id, quiet_hours_start, quiet_hours_end, include_details_in_email default false)`. Horario de silencio interpretado en la zona horaria del usuario (`iam.user.time_zone`, D23) al calcular `not_before` y de nuevo al despachar (si el usuario cambió su horario). Silencio solo difiere el email; el in-app se crea siempre al procesar el evento.
11. **Retención.** Job diario `notifications.purge` borra notificaciones (y sus entregas) con `created_at` > `NOTIFY_RETENTION` (12 meses, docs/08 §13.1). Las tablas de notificaciones no son append-only (no son hechos financieros).
12. **Observabilidad.** Métricas `notifications_created_total{type}`, `notifications_email_deliveries_total{status}`, lag evento→notificación (histograma); logs solo con ids opacos (`notificationId`, `deliveryId`, `workspaceId`), nunca direcciones de email, asuntos con detalles ni montos (docs/12 §13.1, test "canario" de redacción).
13. **Cierre de mes pendiente.** El hecho lo decide y publica Planning (`add-month-closing`), una vez por periodo: nombre provisional `planning.MonthClosePending.v1 {periodId, periodLabel, periodEnd, pendingSince}` (pregunta 4). NOTIFY solo lo traduce.

### Modelo de datos (expand-only, schema `notifications`)

| Tabla | Columnas principales | Unique / Check / Índices | RLS / grants |
|---|---|---|---|
| `notification` | `id`, `workspace_id`, `user_id`, `notification_type`, `severity`, `message_key`, `params jsonb`, `link jsonb`, `dedupe_key`, `source_event_id`, `status` (`UNREAD\|READ\|ARCHIVED`), `created_at`, `read_at`, `archived_at` | UNIQUE `(workspace_id, user_id, dedupe_key)`; índice `(workspace_id, user_id, status, created_at DESC)` | WS + `user_id = app.user_id` para `pf_app` (SELECT, UPDATE de `status/read_at/archived_at`); `pf_worker` INSERT, SELECT, DELETE (purga) |
| `notification_delivery` | `id`, `workspace_id`, `notification_id` FK, `channel` (`EMAIL`), `status` (`PENDING\|SENDING\|RETRY\|SENT\|FAILED\|SUPPRESSED`), `suppression_reason`, `not_before`, `attempts`, `lease_until`, `provider`, `provider_message_id`, `last_error_code`, `sent_at` | UNIQUE `(notification_id, channel)`; CHECK `attempts >= 0`; índice `(status, not_before) WHERE status IN ('PENDING','RETRY')` | WS; `pf_worker` SELECT/INSERT/UPDATE/DELETE; `pf_app` sin acceso (la API expone solo el estado agregado) |
| `notification_preference` | `workspace_id`, `user_id`, `notification_type`, `channel` (`IN_APP\|EMAIL`), `enabled`, `version`, `updated_at` | PK `(workspace_id, user_id, notification_type, channel)` | WS + `user_id = app.user_id` para `pf_app`; `pf_worker` SELECT |
| `user_setting` | `workspace_id`, `user_id`, `quiet_hours_start time`, `quiet_hours_end time`, `include_details_in_email boolean`, `version` | PK `(workspace_id, user_id)`; CHECK ambos horarios nulos o ambos no nulos y distintos | ídem |

Ninguna tabla guarda direcciones de email (se resuelven al despachar). Registro de las cuatro en `platform.workspace_scoped_table` (purga demo, ADR-0026). docs/08 §5.15 se actualiza (`DISMISSED` → `ARCHIVED`, `title/body` → `message_key/params`, `user_setting`).

## Contratos

**`contracts/openapi/finance-api.v1.yaml`** (tag `notifications`, `x-openspec-capability: notifications/alerts`; todas "self": cualquier rol, solo sobre las propias):

| Operación | Método y ruta | Notas |
|---|---|---|
| `listNotifications` | `GET W/notifications?status=UNREAD\|READ\|ARCHIVED&cursor=&limit=` | Por defecto `UNREAD` + `READ`; orden `createdAt` desc; `Notification {id, type, severity, title, body, messageKey, params, link, status, createdAt, readAt, emailStatus?}` (título/cuerpo renderizados en el locale del usuario) |
| `getUnreadNotificationCount` | `GET W/notifications/unread-count` | `{unread}`; `ETag` |
| `markNotificationRead` | `POST W/notifications/{notificationId}/read` | Idempotente; 404 `RESOURCE_NOT_FOUND` si no es propia |
| `markAllNotificationsRead` | `POST W/notifications/read-all` | `{updated}` |
| `archiveNotification` | `POST W/notifications/{notificationId}/archive` | Idempotente |
| `getNotificationPreferences` / `updateNotificationPreferences` | `GET\|PUT W/notification-preferences` | `{types: [{type, inApp, email}], quietHours: {start, end} \| null, includeDetailsInEmail}`; `If-Match`; 400 `VALIDATION_FAILED` (horario inválido) |

**Eventos consumidos:** `contracts/events/planning/BudgetThresholdReached.v1.schema.json` (de `add-budgets`) y `MonthClosePending.v1` (de `add-month-closing`). **Contratos entre módulos:** `@pf/identity/contracts` agrega `WorkspaceRecipientsQuery` (aditivo); `@pf/classification/contracts` ya expone nombres por ids (`categoriesByIds`).

**Configuración** (config-reference, `api` + `worker`): `EMAIL_DRIVER` (`smtp|none`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` (secreto), `EMAIL_FROM`, `APP_PUBLIC_URL`, `NOTIFY_EMAIL_MAX_ATTEMPTS` (5), `NOTIFY_RETENTION` (`12mo`). `.env.example` y Compose apuntan `SMTP_*` a Mailpit; `compose.prod.yaml` fija `EMAIL_DRIVER=none` hasta la decisión de proveedor.

## Riesgos / Trade-offs

- [Email duplicado en la ventana de caída entre aceptación del proveedor y `SENT` (SMTP no deduplica)] → ventana de milisegundos, `Message-ID` constante, lease de 2 min; adapter HTTP con clave de idempotencia cuando se elija proveedor. El in-app (canal de referencia) sí es exactamente una vez.
- [Proveedor SMTP lento o caído bloquea el worker] → cola propia `notifications.email-dispatch` con concurrencia acotada y timeout del adapter; otros consumidores no se afectan.
- [Fuga de datos por email (RISK-010)] → variante `basic` por defecto, sin nombres ni montos; test que verifica el cuerpo del email en Mailpit contra una lista de prohibidos; sin direcciones de email en BD de NOTIFY ni en logs.
- [Notificaciones de un miembro que dejó el workspace] → RLS por membresía activa (sin acceso); la purga las elimina a los 12 meses.
- [Sobre-ingeniería (RISK-005)] → un solo canal externo, sin SSE ni digest; catálogo de tipos como tabla en código, no motor de reglas.

## Plan de migración

Expand-only: `CREATE SCHEMA notifications`, las cuatro tablas con RLS forzada y políticas, grants por rol, índices, registro en `platform.workspace_scoped_table`; sin datos que migrar. Despliegue: primero migración, luego worker (consumidores) y API; el consumidor procesa los `BudgetThresholdReached` pendientes en la cola desde su creación (los eventos publicados antes de existir el consumidor no se reprocesan: no hay histórico en Phase 2). Rollback: revertir despliegue; tablas pueden quedar.

**Dependencias:**
- Requiere: `add-event-outbox` (inbox, colas por consumidor, dead-letter), `add-workspace-identity` (miembros, roles, locale, zona horaria, email verificado; se amplía su contrato público), `add-budgets` (evento `planning.BudgetThresholdReached.v1`), `add-api-conventions`, `add-audit-trail`.
- Requiere de `add-month-closing` (sibling pf-p2a) el hecho de cierre pendiente (pregunta 4); sin él, el requirement "Aviso de cierre de mes pendiente" queda bloqueado (el resto del change no).
- Export de workspace (sibling pf-p2c): decidir si incluye preferencias de notificación (recomendado sí; las notificaciones no, son derivadas).

## Preguntas abiertas

1. **Proveedor de email de producción** (ADR-0027 VPS + Compose, presupuesto USD 10–20/mes, D51). **Recomendación:** elegirlo en el change de despliegue con un ADR corto ("proveedor de email transaccional"): uno con relay SMTP **y** API HTTP con `Idempotency-Key`, plan gratuito para bajo volumen y región cercana; mientras tanto producción con `EMAIL_DRIVER=none` (solo in-app).
2. **Email activado por defecto.** **Recomendación:** activado para ambos tipos (un solo usuario quiere enterarse) con detalles desactivados; el usuario lo apaga en preferencias.
3. **VIEWER como destinatario de umbrales.** **Recomendación:** sí (puede ver presupuestos); el cierre pendiente solo OWNER/EDITOR.
4. **Hecho de cierre pendiente.** **Recomendación:** que `add-month-closing` publique `planning.MonthClosePending.v1` una vez por periodo, **3 días** después de `period_end` si el periodo sigue sin cerrar (configurable), con dedupe por periodo; NOTIFY solo lo traduce. Coordinar nombre y payload con pf-p2a.
5. **Aviso de violación de invariante** (FR-NOTIFY-004, "OWNER, 1→2"). **Recomendación:** change pequeño posterior cuando el job de integridad del ledger publique `ledger.IntegrityViolationDetected.v1`; tipo `CRITICAL` que ignora el horario de silencio. Phase 1 ya lo cubre con log/métrica.
6. **Filtro de email por umbral** (docs/08 sugería "umbral 80 100" en preferencias). **Recomendación:** no en Phase 2 (solo activar/desactivar por tipo y canal); si el owner lo pide, `settings.minThresholdForEmail` por tipo.
7. **Auditar lectura/archivo de notificaciones.** **Recomendación:** no auditar (no es dato financiero ni de configuración); sí auditar cambios de preferencias.
8. **Retención.** **Recomendación:** confirmar 12 meses (docs/08 §13.1) para todas, archivadas incluidas.
