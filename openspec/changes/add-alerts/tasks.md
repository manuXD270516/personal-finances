# Tareas

> Requiere aplicados: `add-event-outbox`, `add-workspace-identity`, `add-audit-trail`, `add-api-conventions` y **`add-budgets`** (evento `planning.BudgetThresholdReached.v1`). El grupo del aviso de cierre pendiente requiere además `add-month-closing` (sibling pf-p2a). No iniciar la implementación con preguntas abiertas de design.md sin resolver que afecten el grupo (docs/DESIGN-GATE.md).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner la spec `notifications/alerts` y las preguntas abiertas 1–8 de design.md; registrar decisiones en docs/31 (Phase 2) y verificar con `openspec validate add-alerts --strict`
- [ ] 1.2 Revisar TC-NOTIFICATIONS-INAPP-001..007, TC-NOTIFICATIONS-DEDUP-001..002, TC-NOTIFICATIONS-EMAIL-001..007, TC-NOTIFICATIONS-I18N-001..002 y TC-NOTIFICATIONS-PREFS-001..003 contra los scenarios (`FixedClock`, TZ America/La_Paz); pasar a `ready`/`confirmed`; `pnpm traceability:check` sin Must sin TC
- [ ] 1.3 Acordar con `add-month-closing` (pf-p2a) nombre, payload y momento de `planning.MonthClosePending.v1` (pregunta 4) y publicar su JSON Schema

## 2. DOMAIN (TDD)

- [ ] 2.1 `NotificationTypeCatalog` (destinatarios por tipo, `dedupeKey`, severidad, enlace) y `Notification` (transiciones UNREAD→READ→ARCHIVED idempotentes): tests primero de TC-NOTIFICATIONS-INAPP-001, -003, -004, -007 y TC-NOTIFICATIONS-DEDUP-002
- [ ] 2.2 `QuietHours` (cruce de medianoche, TZ del usuario, siguiente instante permitido) y `NotificationPreferences` (defaults, opt-in de detalles): tests primero de TC-NOTIFICATIONS-PREFS-001..003; PBT: `notBefore` nunca cae dentro del horario de silencio y nunca es anterior a "ahora"
- [ ] 2.3 Selección de idioma y variante de plantilla (`basic`/`detailed`): tests primero de TC-NOTIFICATIONS-I18N-001, -002 y TC-NOTIFICATIONS-EMAIL-001, -002 (lista de términos prohibidos en `basic`)

## 3. APPLICATION

- [ ] 3.1 `NotifyFromEvent` con inbox + `ON CONFLICT DO NOTHING` por `dedupe_key` y alta de entregas solo si la notificación es nueva; consumidores `notifications.budget-threshold` y `notifications.month-close-pending`: tests de TC-NOTIFICATIONS-DEDUP-001 y TC-NOTIFICATIONS-INAPP-002
- [ ] 3.2 `DispatchEmailDelivery` (claim con lease, silencio, email verificado, envío, `SENT`/`RETRY`/`FAILED`/`SUPPRESSED`): tests con doble de `EmailSender` de TC-NOTIFICATIONS-EMAIL-005, -006, -007
- [ ] 3.3 `MarkAsRead`, `MarkAllAsRead`, `Archive`, `UpdatePreferences` (auditado), `ListNotifications` (render en locale), `GetUnreadCount`; ampliación aditiva `WorkspaceRecipientsQuery` en `@pf/identity/contracts` con test de contrato

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand del schema `notifications` (4 tablas, RLS forzada por workspace y por usuario para `pf_app`, grants, índices, `platform.workspace_scoped_table`); tests de integración: TC-NOTIFICATIONS-INAPP-006 (RLS por usuario y workspace), unicidad de `dedupe_key` con dos workers concurrentes (TC-NOTIFICATIONS-DEDUP-001)
- [ ] 4.2 `SmtpEmailSender` (nodemailer) y `NoneEmailSender`; config `EMAIL_DRIVER`, `SMTP_*`, `EMAIL_FROM`, `APP_PUBLIC_URL`, `NOTIFY_*` en el schema de configuración, `.env.example`, Compose (Mailpit) y `compose.prod.yaml` (`none`); `pnpm config:docs`; test de integración contra Mailpit (Testcontainers `axllent/mailpit`) de TC-NOTIFICATIONS-EMAIL-004 y -005
- [ ] 4.3 Plantillas es/en/pt (`subject`/`text`/`html`, `basic`/`detailed`) y test de catálogo (todas las claves en los tres idiomas, sin términos prohibidos en `basic`)
- [ ] 4.4 Jobs pg-boss `notifications.email-dispatch` (encolado en la misma transacción, `singletonKey = deliveryId`, `startAfter`), barrido de pendientes y `notifications.purge` (retención); métricas y logs sin PII (test canario de redacción)

## 5. API

- [ ] 5.1 Endpoints de design.md § Contratos con problem+json, `If-Match` en preferencias y `ETag` del contador; tests de API con TC-NOTIFICATIONS-INAPP-003, -004, -005, -006 y validación contra el OpenAPI consolidado

## 6. UI

- [ ] 6.1 Campana con contador en el app shell (consulta periódica + al enfocar), bandeja con filtros, marcar leída/todas/archivar, enlaces al recurso con aviso si ya no existe; textos y fechas/montos vía i18n (es/en/pt) — TC-NOTIFICATIONS-INAPP-005
- [ ] 6.2 Página de preferencias (tipo × canal, incluir detalles en email con advertencia de privacidad, horario de silencio) y ruta `/notificaciones/{id}` que exige sesión (TC-NOTIFICATIONS-EMAIL-003)

## 7. TESTS automatizados y E2E

- [ ] 7.1 E2E Playwright con el stack `pfos-e2e` (Mailpit incluido): presupuesto "Restaurantes" 600.00 BOB, gastos hasta 90 %, notificación in-app y un único email en Mailpit (API de Mailpit) sin montos; abrir el enlace del email sin sesión ⇒ login ⇒ notificación
- [ ] 7.2 Test de extremo a extremo de reentrega: publicar dos veces el mismo `BudgetThresholdReached` y reiniciar el worker durante el despacho ⇒ una notificación y un email (TC-NOTIFICATIONS-DEDUP-001, TC-NOTIFICATIONS-EMAIL-005)

## 8. DOCUMENTACIÓN y cierre

- [ ] 8.1 Actualizar docs/04 §3.16, docs/05 §2.16 (tipos de Phase 2), docs/08 §5.15 (tablas as-built), docs/10 (rutas `notifications`), docs/11 (consumidores), docs/12 §13.3 (variante `basic`/`detailed`), docs/19 (Mailpit para notificaciones), config-reference y un runbook "email de notificaciones" (diagnóstico de entregas fallidas)
- [ ] 8.2 Actualizar estados de automatización de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict` y `pnpm traceability:check`
