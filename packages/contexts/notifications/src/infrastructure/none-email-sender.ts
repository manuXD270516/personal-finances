import { PermanentEmailError, type EmailSender } from '../application/ports/index.js';

/**
 * Adaptador `none` (`EMAIL_DRIVER=none`, docs/33 D87): el canal email está deshabilitado por entorno. El despacho
 * detecta el `driver` y registra la entrega como `SUPPRESSED`/`CHANNEL_DISABLED` sin llamar a `send`; si alguien lo
 * invocara igualmente, falla de forma definitiva (nunca envía).
 */
export class NoneEmailSender implements EmailSender {
  readonly driver = 'none' as const;

  send(): Promise<{ readonly providerMessageId: string }> {
    return Promise.reject(new PermanentEmailError('CHANNEL_DISABLED'));
  }
}
