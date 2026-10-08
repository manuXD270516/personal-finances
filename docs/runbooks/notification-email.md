# Runbook — email de notificaciones

> **Estado:** vigente desde `add-alerts` (Phase 2) · **Relacionado:** [config-reference.md](../config-reference.md) (grupo "Notificaciones") · [11-domain-events.md](../11-domain-events.md) (consumidores de NOTIFY) · [12-security.md](../12-security.md) §13.3 · docs/33 D87–D93

Las notificaciones in-app existen desde que el worker procesa el hecho; el **email** es un canal aparte (`notifications.notification_delivery`) con entrega única, reintentos y supresión explícita. Este runbook sirve para diagnosticar "no me llegó el email" sin exponer datos personales.

## 1. Cómo viaja un email

1. `planning.BudgetThresholdReached.v1` / `planning.MonthClosePending.v1` → consumidor `notifications.*` (inbox + `dedupe_key`).
2. Por cada notificación nueva con el canal email activo: fila `notification_delivery` (`PENDING`, `not_before` = ahora o el fin del horario de silencio) y job `notifications.email-dispatch` encolado en la misma transacción.
3. `DispatchEmailDelivery`: claim con lease de 2 min (`SENDING`), comprobaciones (canal, miembro, preferencia vigente, silencio vigente, email verificado), render en el idioma del destinatario (`basic` salvo opt-in) y envío con `Message-ID: <deliveryId@dominio de EMAIL_FROM>`.
4. Resultado: `SENT` (con `provider_message_id`), `RETRY` (espera 1 min, 5 min, 25 min, 2 h), `FAILED` (5 intentos agotados o rechazo permanente) o `SUPPRESSED`.
5. Un barrido cada 5 minutos (`notifications.email-sweep`) reencola las entregas vencidas cuyo job se perdió.

## 2. Estados y qué hacer

| Estado | Motivo (`suppression_reason` / `last_error_code`) | Qué significa y qué hacer |
|---|---|---|
| `SUPPRESSED` | `CHANNEL_DISABLED` | `EMAIL_DRIVER=none` en el entorno (producción hasta elegir proveedor, docs/33 D87). Esperado; solo hay in-app. |
| `SUPPRESSED` | `NO_EMAIL` | El usuario no tiene email verificado en `iam.user`. No se reintenta. |
| `SUPPRESSED` | `NOT_MEMBER` | El destinatario dejó el workspace antes del envío. |
| `SUPPRESSED` | `PREFERENCE_DISABLED` | El usuario apagó el email del tipo después de crearse la entrega. |
| `SUPPRESSED` | `NOTIFICATION_GONE` | La notificación se purgó (retención de 12 meses) antes del envío. |
| `PENDING` con `not_before` futuro | — | Horario de silencio del usuario o job diferido; se envía al terminar. |
| `RETRY` | `SMTP_ECONNREFUSED`, `SMTP_ETIMEDOUT`, `SMTP_4xx`, … | Fallo transitorio del proveedor. Se reintenta solo; revisar `SMTP_HOST`/`SMTP_PORT` y la conectividad del worker. |
| `FAILED` | `SMTP_550` (u otro 5xx) o 5 intentos | Rechazo permanente o proveedor caído. Métrica `notifications_email_deliveries_total{status="failed"}`. La notificación in-app sigue intacta. |
| `SENDING` con `lease_until` vencido | — | El proceso cayó durante el envío. El barrido o el siguiente job la reclama; **residuo documentado**: si el proveedor ya había aceptado el mensaje, SMTP no deduplica y puede llegar un duplicado con el mismo `Message-ID`. |

## 3. Consultas de diagnóstico (rol de operación; sin direcciones de email)

```sql
-- Entregas no resueltas o fallidas de las últimas 24 h (por estado y motivo)
SELECT status, coalesce(suppression_reason, last_error_code) AS motivo, count(*)
  FROM notifications.notification_delivery
 WHERE updated_at > now() - interval '24 hours' AND status <> 'SENT'
 GROUP BY 1, 2 ORDER BY 3 DESC;

-- Una entrega concreta (id opaco; nunca hay dirección de email en estas tablas)
SELECT id, notification_id, status, attempts, not_before, lease_until, provider_message_id, last_error_code
  FROM notifications.notification_delivery WHERE id = '<deliveryId>';
```

La tabla requiere el contexto RLS del workspace (`SET LOCAL app.workspace_id`) con el rol `pf_worker`. Los logs del worker usan `deliveryId` y `notificationId`; **nunca** buscan por dirección ni asunto.

## 4. Acciones

- **Reintentar una entrega `FAILED`** tras arreglar el proveedor: no hay comando de reenvío en Phase 2 (por diseño, evitar duplicados). Si hace falta, crear una incidencia; el in-app ya informó al usuario.
- **Cambiar de proveedor** (change de despliegue): agregar un adapter de `EmailSender` (HTTP con `Idempotency-Key` del proveedor) y fijar `EMAIL_DRIVER`/`SMTP_*`/`EMAIL_FROM`/`APP_PUBLIC_URL` en `/etc/pfos/pfos.env`. Las credenciales SMTP nunca se versionan.
- **Dead-letter del consumidor** (`events.notifications.*.dlq`, tabla `platform.dead_letter`): un payload mal formado; el productor es PLANNING (revisar el contrato `contracts/events/planning/*.schema.json`).
- **Local / CI**: los correos se capturan en Mailpit (`PF_MAILPIT_UI_PORT`); el E2E consulta su API.
