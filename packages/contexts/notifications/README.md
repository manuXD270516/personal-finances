# @pf/notifications — bounded context NOTIFY

Centro de notificaciones in-app, canal email y preferencias (openspec `add-alerts`; capability `notifications/alerts`).
**Solo traduce hechos publicados** (`planning.BudgetThresholdReached.v1`, `planning.MonthClosePending.v1`) en
notificaciones por destinatario: no decide reglas de negocio.

- `domain/`: catálogo de tipos (destinatarios, clave de deduplicación, severidad, enlace), `Notification`, horario de
  silencio, preferencias, catálogo de mensajes es/en/pt y render in-app / email (variantes `basic` y `detailed`).
- `application/`: `NotifyFromEvent` (consumidores idempotentes: inbox + `dedupe_key`), `DispatchEmailDelivery`
  (entrega única con lease), bandeja (`InboxService`/`InboxQueries`), `PreferencesService` (auditado), purga.
- `infrastructure/`: repositorios sobre PostgreSQL (RLS por workspace y por usuario), `SmtpEmailSender` (nodemailer),
  `NoneEmailSender`, trabajos pg-boss.
- `interface/`: controllers de `/notifications*` y `/notification-preferences`, módulo Nest, consumidores y trabajos del
  worker.

Privacidad (RISK-010): las tablas no guardan direcciones de email (se resuelven al despachar), los logs solo llevan
ids opacos y el email no incluye montos ni nombres salvo opt-in de detalles.
