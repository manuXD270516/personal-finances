# Tareas

> Requiere aplicados: `add-event-outbox`, `add-workspace-identity`, `add-audit-trail`, `add-api-conventions` y **`add-budgets`** (evento `planning.BudgetThresholdReached.v1`). El grupo del aviso de cierre pendiente requiere además `add-month-closing` (sibling pf-p2a). No iniciar la implementación con preguntas abiertas de design.md sin resolver que afecten el grupo (docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner la spec `notifications/alerts` y las preguntas abiertas 1–8 de design.md (resueltas por el owner el 2026-10-08, docs/33); verificar con `openspec validate add-alerts --strict` — 2026-10-08: preguntas 1–8 resueltas por el owner (docs/33 D87–D93: proveedor de email en el change de despliegue con `EMAIL_DRIVER=none` mientras tanto, email activado con detalles desactivados, VIEWER recibe umbrales, aviso de invariante posterior, sin filtro por umbral, sin auditar lectura/archivo y retención de 12 meses); `openspec validate --all --strict` en verde.
- [x] 1.2 Revisar TC-NOTIFICATIONS-INAPP-001..007, TC-NOTIFICATIONS-DEDUP-001..002, TC-NOTIFICATIONS-EMAIL-001..007, TC-NOTIFICATIONS-I18N-001..002 y TC-NOTIFICATIONS-PREFS-001..003 contra los scenarios (`FixedClock`, TZ America/La_Paz); pasar a `ready`/`confirmed`; `pnpm traceability:check` sin Must sin TC — 2026-10-08: los 21 TC pasan a `automated`; `pnpm traceability:check` sin Must sin TC.
- [x] 1.3 Verificar el consumidor contra `contracts/events/planning/MonthClosePending.v1.schema.json` publicado por `add-month-closing` (contrato consolidado el 2026-10-05) — 2026-10-08: el consumidor se prueba contra los `examples` de `MonthClosePending.v1` y `BudgetThresholdReached.v1` (`consumed-events.contract.test.ts`).

## 2. DOMAIN (TDD)

- [x] 2.1 `NotificationTypeCatalog` (destinatarios por tipo, `dedupeKey`, severidad, enlace) y `Notification` (transiciones UNREAD→READ→ARCHIVED idempotentes): tests primero de TC-NOTIFICATIONS-INAPP-001, -003, -004, -007 y TC-NOTIFICATIONS-DEDUP-002 — 2026-10-08: `type-catalog.test.ts`, `notification.test.ts`.
- [x] 2.2 `QuietHours` (cruce de medianoche, TZ del usuario, siguiente instante permitido) y `NotificationPreferences` (defaults, opt-in de detalles): tests primero de TC-NOTIFICATIONS-PREFS-001..003; PBT: `notBefore` nunca cae dentro del horario de silencio y nunca es anterior a "ahora" — 2026-10-08: `quiet-hours.test.ts` (PBT fast-check), `preferences.test.ts`.
- [x] 2.3 Selección de idioma y variante de plantilla (`basic`/`detailed`): tests primero de TC-NOTIFICATIONS-I18N-001, -002 y TC-NOTIFICATIONS-EMAIL-001, -002 (lista de términos prohibidos en `basic`) — 2026-10-08: `render.test.ts` (catálogo es/en/pt, variantes basic/detailed, términos prohibidos).

## 3. APPLICATION

- [x] 3.1 `NotifyFromEvent` con inbox + `ON CONFLICT DO NOTHING` por `dedupe_key` y alta de entregas solo si la notificación es nueva; consumidores `notifications.budget-threshold` y `notifications.month-close-pending`: tests de TC-NOTIFICATIONS-DEDUP-001 y TC-NOTIFICATIONS-INAPP-002 — 2026-10-08: `notify-from-event.test.ts`, `notifications.int.test.ts` (2 workers + reentrega).
- [x] 3.2 `DispatchEmailDelivery` (claim con lease, silencio, email verificado, envío, `SENT`/`RETRY`/`FAILED`/`SUPPRESSED`): tests con doble de `EmailSender` de TC-NOTIFICATIONS-EMAIL-005, -006, -007 — 2026-10-08: `dispatch-email-delivery.test.ts` (lease, backoff 1 min/5 min/25 min/2 h, 5 intentos, supresión).
- [x] 3.3 `MarkAsRead`, `MarkAllAsRead`, `Archive`, `UpdatePreferences` (auditado), `ListNotifications` (render en locale), `GetUnreadCount`; ampliación aditiva `WorkspaceRecipientsQuery` en `@pf/identity/contracts` con test de contrato — 2026-10-08: `inbox.test.ts`, `preferences.service.test.ts`, `purge-expired.test.ts`; `WorkspaceRecipientsQuery` en `@pf/identity/contracts` (implementada con el rol de directorio, migración 20261008190000).

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand del schema `notifications` (4 tablas, RLS forzada por workspace y por usuario para `pf_app`, grants, índices, `platform.workspace_scoped_table`); tests de integración: TC-NOTIFICATIONS-INAPP-006 (RLS por usuario y workspace), unicidad de `dedupe_key` con dos workers concurrentes (TC-NOTIFICATIONS-DEDUP-001) — 2026-10-08: migración 20261008190100 (4 tablas, RLS forzada, `notifications.is_row_user`); `pg-notifications.int.test.ts`.
- [x] 4.2 `SmtpEmailSender` (nodemailer) y `NoneEmailSender`; config `EMAIL_DRIVER`, `SMTP_*`, `EMAIL_FROM`, `APP_PUBLIC_URL`, `NOTIFY_*` en el schema de configuración, `.env.example`, Compose (Mailpit) y `compose.prod.yaml` (`none`); `pnpm config:docs`; test de integración contra Mailpit (Testcontainers `axllent/mailpit`) de TC-NOTIFICATIONS-EMAIL-004 y -005 — 2026-10-08: `SmtpEmailSender`/`NoneEmailSender`; variables en config, `.env.example`, Compose y `pfos.env.example`; `pnpm config:docs`; contra Mailpit (Testcontainers) en `notifications.int.test.ts`.
- [x] 4.3 Plantillas es/en/pt (`subject`/`text`/`html`, `basic`/`detailed`) y test de catálogo (todas las claves en los tres idiomas, sin términos prohibidos en `basic`) — 2026-10-08: plantillas como módulos versionados en código (`domain/messages.ts`), no archivos; test de catálogo en `render.test.ts`.
- [x] 4.4 Jobs pg-boss `notifications.email-dispatch` (encolado en la misma transacción, `singletonKey = deliveryId`, `startAfter`), barrido de pendientes y `notifications.purge` (retención); métricas y logs sin PII (test canario de redacción) — 2026-10-08: `notifications-jobs.ts` (email-dispatch, email-sweep cada 5 min, purge diario); métricas OTel y test canario de logs sin email.

## 5. API

- [x] 5.1 Endpoints de design.md § Contratos con problem+json, `If-Match` en preferencias y `ETag` del contador; tests de API con TC-NOTIFICATIONS-INAPP-003, -004, -005, -006 y validación contra el OpenAPI consolidado — 2026-10-08: `notifications.api.test.ts` (+ `getNotification`, aditivo); OpenAPI consolidado, Spectral 0 errores.

## 6. UI

- [x] 6.1 Campana con contador en el app shell (consulta periódica + al enfocar), bandeja con filtros, marcar leída/todas/archivar, enlaces al recurso con aviso si ya no existe; textos y fechas/montos vía i18n (es/en/pt) — TC-NOTIFICATIONS-INAPP-005 — 2026-10-08: campana, bandeja, detalle y destino con línea resaltada/aviso; `notifications.test.tsx`.
- [x] 6.2 Página de preferencias (tipo × canal, incluir detalles en email con advertencia de privacidad, horario de silencio) y ruta `/notificaciones/{id}` que exige sesión (TC-NOTIFICATIONS-EMAIL-003) — 2026-10-08: panel de preferencias en `/preferencias` y ruta `/notificaciones/{id}`.

## 7. TESTS automatizados y E2E

- [x] 7.1 E2E Playwright con el stack `pfos-e2e` (Mailpit incluido): presupuesto "Restaurantes" 600.00 BOB, gastos hasta 90 %, notificación in-app y un único email en Mailpit (API de Mailpit) sin montos; abrir el enlace del email sin sesión ⇒ login ⇒ notificación — 2026-10-08: `tests/e2e/specs/notifications.spec.ts` verde con `pfos-e2e-alerts` (3 pruebas con a11y).
- [x] 7.2 Test de extremo a extremo de reentrega: publicar dos veces el mismo `BudgetThresholdReached` y reiniciar el worker durante el despacho ⇒ una notificación y un email (TC-NOTIFICATIONS-DEDUP-001, TC-NOTIFICATIONS-EMAIL-005) — 2026-10-08: `notifications.int.test.ts` (reentrega + reinicio durante el despacho).

## 8. DOCUMENTACIÓN y cierre

- [x] 8.1 Actualizar docs/04 §3.16, docs/05 §2.16 (tipos de Phase 2), docs/08 §5.15 (tablas as-built), docs/10 (rutas `notifications`), docs/11 (consumidores), docs/12 §13.3 (variante `basic`/`detailed`), docs/19 (Mailpit para notificaciones), config-reference y un runbook "email de notificaciones" (diagnóstico de entregas fallidas) — 2026-10-08: docs 04, 05, 08, 10, 11, 12, 19, config-reference y runbook `notification-email.md`.
- [x] 8.2 Actualizar estados de automatización de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict` y `pnpm traceability:check` — 2026-10-08: estados de TC actualizados, matriz regenerada, validate y traceability en verde.
