import {
  notificationLocaleOf,
  renderEmail,
  type EmailVariant,
  type NotificationState,
  type RenderNames,
} from '../domain/index.js';
import {
  PermanentEmailError,
  RetryableEmailError,
  type DeliveryState,
  type DispatchDeps,
  type SuppressionReason,
} from './ports/index.js';
import { targetNameIn } from './target-name.js';

export type DispatchOutcome = 'sent' | 'retry' | 'failed' | 'suppressed' | 'deferred' | 'noop';

/** Márgenes del barrido (decisión 7): una entrega solo se considera perdida pasado este tiempo desde `not_before`. */
const SWEEP_GRACE_MS = 60_000;
const SWEEP_LIMIT = 100;
const MARK_SENT_ATTEMPTS = 3;

interface Prepared {
  readonly notification: NotificationState;
}

/**
 * `DispatchEmailDelivery` (openspec add-alerts, design decisión 7): envía a lo sumo UN email aceptado por entrega.
 *
 *  1. *Claim* atómico con lease (transacción corta): si no actualiza filas —otra instancia la tiene o ya se envió—
 *     termina sin hacer nada. Es lo que hace inocuos los reintentos del trabajo y las instancias concurrentes.
 *  2. Fuera de toda transacción (nunca se retiene una conexión durante la E/S de red): canal habilitado, miembro,
 *     preferencia vigente, horario de silencio vigente (se reevalúa por si el usuario lo cambió), email verificado,
 *     render en el idioma del destinatario (`basic` salvo opt-in) y envío con `Message-ID` determinista.
 *  3. Resultado en una transacción corta: `SENT` con el id del proveedor; error reintentable ⇒ `RETRY` con backoff
 *     exponencial hasta `NOTIFY_EMAIL_MAX_ATTEMPTS`, luego `FAILED` + métrica; rechazo permanente ⇒ `FAILED`.
 *
 * Residuo documentado: si el proceso cae entre la aceptación del proveedor y el `UPDATE … SENT`, el lease expira y
 * se reenvía (SMTP no deduplica); el `Message-ID` constante permite a los clientes agrupar el duplicado.
 *
 * El in-app nunca depende de este flujo. Los logs llevan solo ids opacos: jamás la dirección ni el asunto.
 */
export class DispatchEmailDelivery {
  constructor(private readonly deps: DispatchDeps) {}

  async run(input: { readonly workspaceId: string; readonly deliveryId: string }): Promise<DispatchOutcome> {
    const { deps } = this;
    const { workspaceId } = input;
    const claimed = await deps.uow.run(workspaceId, async () => {
      const now = deps.clock.now();
      return deps.deliveries.claim({
        workspaceId,
        id: input.deliveryId,
        now: now.toString(),
        leaseUntil: now.plusMillis(deps.config.leaseMs).toString(),
      });
    });
    if (!claimed) return 'noop';
    return this.deliver(claimed);
  }

  /** Reencola las entregas vencidas cuyo trabajo se perdió (barrido cada 5 min, decisión 7). */
  sweep(workspaceId: string): Promise<number> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const cutoff = deps.clock.now().plusMillis(-SWEEP_GRACE_MS);
      const due = await deps.deliveries.due(workspaceId, cutoff.toString(), SWEEP_LIMIT);
      for (const delivery of due) {
        await deps.scheduler.schedule({
          deliveryId: delivery.id,
          workspaceId,
          startAfter: null,
          first: false,
        });
      }
      return due.length;
    });
  }

  private async deliver(delivery: DeliveryState): Promise<DispatchOutcome> {
    const { deps } = this;
    const { workspaceId, id: deliveryId } = delivery;

    if (deps.sender.driver === 'none') return this.suppress(delivery, 'CHANNEL_DISABLED');

    let accepted: { readonly providerMessageId: string };
    try {
      const prepared = await this.load(delivery);
      if (!prepared) return await this.suppress(delivery, 'NOTIFICATION_GONE');
      const { notification } = prepared;

      const members = await deps.recipients.activeMembers(workspaceId);
      const member = members.find((m) => m.userId === notification.userId);
      if (!member) return await this.suppress(delivery, 'NOT_MEMBER');

      const prefs = await deps.uow.run(workspaceId, () =>
        deps.preferences.load(workspaceId, notification.userId),
      );
      if (!prefs.isEnabled(notification.type, 'EMAIL')) {
        return await this.suppress(delivery, 'PREFERENCE_DISABLED');
      }

      // El horario de silencio vigente manda (el usuario pudo cambiarlo desde que se creó la entrega).
      const now = deps.clock.now();
      const quiet = prefs.quietHours;
      if (quiet?.contains(now, member.timeZone)) {
        return await this.defer(delivery, quiet.nextAllowed(now, member.timeZone).toString());
      }

      const to = await deps.recipients.emailFor(notification.userId);
      if (!to) return await this.suppress(delivery, 'NO_EMAIL');

      const variant: EmailVariant = prefs.includeDetailsInEmail ? 'detailed' : 'basic';
      const names = variant === 'detailed' ? await this.namesOf(notification) : { targetName: null };
      const rendered = renderEmail({
        locale: notificationLocaleOf(member.locale),
        variant,
        messageKey: notification.messageKey,
        params: notification.params,
        names,
        notificationUrl: `${deps.config.appPublicUrl}/notificaciones/${notification.id}`,
        preferencesUrl: `${deps.config.appPublicUrl}/preferencias`,
      });
      accepted = await deps.sender.send({
        to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        messageId: `<${deliveryId}@${deps.config.messageIdDomain}>`,
        idempotencyKey: deliveryId,
        listUnsubscribeUrl: `${deps.config.appPublicUrl}/preferencias`,
      });
    } catch (err) {
      return this.fail(delivery, err);
    }

    // El proveedor ya aceptó: un fallo al registrarlo NO debe provocar otro envío (se reintenta solo el registro).
    await this.markSent(delivery, accepted.providerMessageId);
    return 'sent';
  }

  private load(delivery: DeliveryState): Promise<Prepared | null> {
    const { deps } = this;
    return deps.uow.run(delivery.workspaceId, async () => {
      const notification = await deps.notifications.findById(delivery.workspaceId, delivery.notificationId);
      return notification ? { notification } : null;
    });
  }

  /** Nombre vigente del objetivo, solo para la variante `detailed` (nunca viaja en el hecho de origen). */
  private async namesOf(notification: NotificationState): Promise<RenderNames> {
    const { params } = notification;
    const kind = params['targetKind'];
    const id = params['targetId'];
    if (typeof kind !== 'string' || typeof id !== 'string') return { targetName: null };
    const tree = await this.deps.catalog.categoryTree({
      userId: notification.userId,
      workspaceId: notification.workspaceId,
    });
    return { targetName: targetNameIn(tree, kind, id) };
  }

  private suppress(delivery: DeliveryState, reason: SuppressionReason): Promise<DispatchOutcome> {
    const { deps } = this;
    return deps.uow.run(delivery.workspaceId, async () => {
      await deps.deliveries.markSuppressed({
        id: delivery.id,
        reason,
        now: deps.clock.now().toString(),
      });
      deps.metrics.emailDelivery('suppressed');
      deps.logger.info(
        { deliveryId: delivery.id, notificationId: delivery.notificationId, reason },
        'email delivery suppressed',
      );
      return 'suppressed' as const;
    });
  }

  private defer(delivery: DeliveryState, notBefore: string): Promise<DispatchOutcome> {
    const { deps } = this;
    return deps.uow.run(delivery.workspaceId, async () => {
      await deps.deliveries.release({ id: delivery.id, notBefore, now: deps.clock.now().toString() });
      await deps.scheduler.schedule({
        deliveryId: delivery.id,
        workspaceId: delivery.workspaceId,
        startAfter: new Date(notBefore),
        first: false,
      });
      return 'deferred' as const;
    });
  }

  private async fail(delivery: DeliveryState, err: unknown): Promise<DispatchOutcome> {
    const { deps } = this;
    const permanent = err instanceof PermanentEmailError;
    const code =
      err instanceof RetryableEmailError || err instanceof PermanentEmailError ? err.code : 'INTERNAL_ERROR';
    return deps.uow.run(delivery.workspaceId, async () => {
      const now = deps.clock.now();
      if (permanent || delivery.attempts >= deps.config.maxAttempts) {
        await deps.deliveries.markFailed({ id: delivery.id, errorCode: code, now: now.toString() });
        deps.metrics.emailDelivery('failed');
        deps.logger.warn(
          {
            deliveryId: delivery.id,
            notificationId: delivery.notificationId,
            attempts: delivery.attempts,
            code,
          },
          'email delivery failed',
        );
        return 'failed' as const;
      }
      const backoff = deps.config.backoffMs;
      const wait =
        backoff[Math.min(delivery.attempts, backoff.length) - 1] ?? backoff[backoff.length - 1] ?? 60_000;
      const notBefore = now.plusMillis(wait);
      await deps.deliveries.markRetry({
        id: delivery.id,
        notBefore: notBefore.toString(),
        errorCode: code,
        now: now.toString(),
      });
      await deps.scheduler.schedule({
        deliveryId: delivery.id,
        workspaceId: delivery.workspaceId,
        startAfter: notBefore.toDate(),
        first: false,
      });
      deps.metrics.emailDelivery('retry');
      deps.logger.info(
        {
          deliveryId: delivery.id,
          notificationId: delivery.notificationId,
          attempts: delivery.attempts,
          code,
        },
        'email delivery will be retried',
      );
      return 'retry' as const;
    });
  }

  private async markSent(delivery: DeliveryState, providerMessageId: string): Promise<void> {
    const { deps } = this;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MARK_SENT_ATTEMPTS; attempt += 1) {
      try {
        await deps.uow.run(delivery.workspaceId, async () => {
          await deps.deliveries.markSent({
            id: delivery.id,
            provider: deps.sender.driver,
            providerMessageId,
            now: deps.clock.now().toString(),
          });
        });
        deps.metrics.emailDelivery('sent');
        deps.logger.info(
          { deliveryId: delivery.id, notificationId: delivery.notificationId, attempts: delivery.attempts },
          'email delivery sent',
        );
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}
