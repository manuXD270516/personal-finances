import nodemailer from 'nodemailer';
import {
  PermanentEmailError,
  RetryableEmailError,
  type EmailMessage,
  type EmailSender,
} from '../application/ports/index.js';

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  /** TLS implícito (puerto 465); con `false` se usa STARTTLS si el servidor lo ofrece. */
  readonly secure: boolean;
  readonly user?: string | undefined;
  readonly password?: string | undefined;
  /** `EMAIL_FROM`: `Nombre <dirección>` o solo la dirección. */
  readonly from: string;
  /** Tiempo máximo de conexión y saludo (ms); el del socket es el doble. */
  readonly timeoutMs?: number;
}

/** Lo mínimo de nodemailer que usa el adapter (permite un transporte falso en los tests). */
export interface MailTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    messageId: string;
    headers: Record<string, string>;
  }): Promise<{ messageId?: string; rejected?: readonly unknown[] }>;
}

interface SmtpFailure {
  readonly code?: unknown;
  readonly responseCode?: unknown;
}

/** Código estable y sin datos personales: nunca el mensaje del error (puede contener la dirección). */
function codeOf(err: SmtpFailure): string {
  if (typeof err.responseCode === 'number') return `SMTP_${err.responseCode}`;
  return typeof err.code === 'string'
    ? `SMTP_${err.code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)}`
    : 'SMTP_ERROR';
}

/**
 * Clasifica un fallo del transporte: rechazo del destinatario o del mensaje (5xx, salvo la autenticación 535, que es
 * de configuración; `EENVELOPE`, `EMESSAGE`) ⇒ permanente; conexión, timeout, autenticación o 4xx ⇒ reintentable.
 */
export function classifySmtpError(err: unknown): RetryableEmailError | PermanentEmailError {
  if (err instanceof RetryableEmailError || err instanceof PermanentEmailError) return err;
  const failure: SmtpFailure = typeof err === 'object' && err !== null ? (err as SmtpFailure) : {};
  const code = codeOf(failure);
  const responseCode = typeof failure.responseCode === 'number' ? failure.responseCode : undefined;
  if (failure.code === 'EENVELOPE' || failure.code === 'EMESSAGE') return new PermanentEmailError(code);
  if (responseCode !== undefined && responseCode >= 500 && responseCode !== 535) {
    return new PermanentEmailError(code);
  }
  return new RetryableEmailError(code);
}

/**
 * Adaptador `smtp` (nodemailer). En local y CI apunta a Mailpit (`SMTP_HOST`/`SMTP_PORT`); en producción, al relay
 * SMTP del proveedor que se elija (docs/33 D87). `Message-ID` determinista y `List-Unsubscribe` a la página de
 * preferencias; sin píxeles de seguimiento. SMTP no deduplica: la entrega única la garantiza el *claim* con lease.
 */
export class SmtpEmailSender implements EmailSender {
  readonly driver = 'smtp' as const;
  private readonly transport: MailTransport;

  constructor(
    private readonly options: SmtpOptions,
    transport?: MailTransport,
  ) {
    const timeout = options.timeoutMs ?? 15_000;
    this.transport =
      transport ??
      (nodemailer.createTransport({
        host: options.host,
        port: options.port,
        secure: options.secure,
        connectionTimeout: timeout,
        greetingTimeout: timeout,
        socketTimeout: timeout * 2,
        ...(options.user && options.password ? { auth: { user: options.user, pass: options.password } } : {}),
      }) as unknown as MailTransport);
  }

  async send(message: EmailMessage): Promise<{ readonly providerMessageId: string }> {
    try {
      const info = await this.transport.sendMail({
        from: this.options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        messageId: message.messageId,
        headers: { 'List-Unsubscribe': `<${message.listUnsubscribeUrl}>` },
      });
      if ((info.rejected?.length ?? 0) > 0) throw new PermanentEmailError('SMTP_REJECTED');
      return { providerMessageId: info.messageId ?? message.messageId };
    } catch (err) {
      throw classifySmtpError(err);
    }
  }
}
