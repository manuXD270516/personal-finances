import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { MAILPIT_IMAGE } from './images.js';

export interface MailpitMessageSummary {
  readonly ID: string;
  readonly MessageID: string;
  readonly Subject: string;
  readonly To: readonly { readonly Address: string }[];
}

export interface MailpitMessage extends MailpitMessageSummary {
  readonly Text: string;
  readonly HTML: string;
}

/** Mailpit efímero (Testcontainers) con su API HTTP: los emails de las notificaciones se capturan aquí. */
export interface Mailpit {
  readonly smtpHost: string;
  readonly smtpPort: number;
  /** Mensajes recibidos (resumen), más recientes primero. */
  messages(): Promise<readonly MailpitMessageSummary[]>;
  message(id: string): Promise<MailpitMessage>;
  /** Cabeceras completas del mensaje (`Message-ID`, `List-Unsubscribe`, …). */
  headers(id: string): Promise<Record<string, readonly string[]>>;
  clear(): Promise<void>;
  stop(): Promise<void>;
}

export async function startMailpit(): Promise<Mailpit> {
  const container: StartedTestContainer = await new GenericContainer(MAILPIT_IMAGE)
    .withEnvironment({
      MP_SMTP_AUTH_ACCEPT_ANY: '1',
      MP_SMTP_AUTH_ALLOW_INSECURE: '1',
      MP_MAX_MESSAGES: '500',
    })
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp('/readyz', 8025).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();
  const api = `http://${container.getHost()}:${container.getMappedPort(8025)}/api/v1`;
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${api}${path}`, init);
    if (!res.ok) throw new Error(`mailpit ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    smtpHost: container.getHost(),
    smtpPort: container.getMappedPort(1025),
    async messages() {
      return (await json<{ messages: MailpitMessageSummary[] }>('/messages?limit=500')).messages;
    },
    message: (id) => json<MailpitMessage>(`/message/${id}`),
    headers: (id) => json<Record<string, readonly string[]>>(`/message/${id}/headers`),
    async clear() {
      await fetch(`${api}/messages`, { method: 'DELETE' });
    },
    async stop() {
      await container.stop();
    },
  };
}
