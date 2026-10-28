import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import {
  PgOutboxWriter,
  buildEnvelope,
  type DomainEventDraft,
  type EventConsumerDefinition,
  type EventEnvelope,
} from '@pf/platform/events';
import { uuidv7, type Logger } from '@pf/platform/logging';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { identityWorkspaceRecipients } from '@pf/identity/interface/identity.module';
import {
  createEmailSender,
  createNotificationsWorkerRuntime,
  type EmailSender,
} from '@pf/notifications/interface/notifications.module';
import { otelCounters, otelHistograms } from '@pf/platform/otel';
import type { JobQueue } from '@pf/platform/queue';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { createWorkerRuntime, type WorkerRuntime } from '../../src/worker/create-worker-runtime.js';
import { startMailpit, type Mailpit, type MailpitMessage } from '../support/mailpit.js';
import { baseEnv, capturingLogger, discardStaleEventBacklog, workerConfig } from '../support/harness.js';
import { leakPattern } from '../support/leak-matcher.js';

// Notificaciones de punta a punta contra PostgreSQL real, pg-boss real y Mailpit (openspec add-alerts, tareas 4.2, 4.4
// y 7.2): outbox → relay → consumidores `notifications.*` → entrega por email → job `notifications.email-dispatch` →
// SMTP → Mailpit. Productor como `pf_app`; relay, consumidores y despacho como `pf_worker`.
const deps = inject('deps');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let appPool: Pool;
let workerPool: Pool;
let migratorPool: Pool;
let mailpit: Mailpit;
const writer = new PgOutboxWriter(eventSchemaRegistry());
const uow = () => new PgUnitOfWork(appPool);

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 45_000, stepMs = 150): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('until: timeout');
    await sleep(stepMs);
  }
}

interface Member {
  readonly id: string;
  readonly email: string;
  readonly role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

interface Fixture {
  readonly ws: string;
  readonly owner: Member;
  readonly editor: Member;
  readonly viewer: Member;
}

async function provisionMember(label: string, role: Member['role'], locale: string): Promise<Member> {
  const { rows } = await migratorPool.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/notify', $1, $2, $3) AS id`,
    [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID().slice(0, 8)}@demo.pfos.test`, label],
  );
  const id = rows[0]!.id;
  const user = await migratorPool.query<{ email: string }>(
    'UPDATE iam."user" SET locale = $2, time_zone = $3 WHERE id = $1 RETURNING email',
    [id, locale, 'America/La_Paz'],
  );
  return { id, email: user.rows[0]!.email, role };
}

async function fixture(locales: { owner?: string; editor?: string; viewer?: string } = {}): Promise<Fixture> {
  const owner = await provisionMember('owner', 'OWNER', locales.owner ?? 'es-BO');
  const editor = await provisionMember('editor', 'EDITOR', locales.editor ?? 'pt-BR');
  const viewer = await provisionMember('viewer', 'VIEWER', locales.viewer ?? 'fr-FR');
  const ws = randomUUID();
  await uow().run({ userId: owner.id, workspaceId: ws }, async () => {
    const tx = requireSqlExecutor();
    await tx.query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Notify', 'BOB', 'America/La_Paz', 'es-BO')`,
      [ws],
    );
    for (const m of [owner, editor, viewer]) {
      await tx.query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, $3)`,
        [ws, m.id, m.role],
      );
    }
  });
  return { ws, owner, editor, viewer };
}

// ───────────────────────────────────────────────────────────────────────── eventos del productor

const PERIOD = '01928c4e-0000-7000-8000-0000000fa011';
const BUDGET = '01928c4e-0000-7000-8000-0000000fb001';
const LINE = '01928c4e-0000-7000-8000-0000000fb101';
const RESTAURANTS = '01928c4e-0000-7000-8000-0000000ca003';

function thresholdEvent(
  ws: string,
  over: Partial<{ eventId: string; version: number; threshold: string }> = {},
) {
  const draft: DomainEventDraft = {
    eventId: over.eventId ?? uuidv7(),
    eventType: 'planning.BudgetThresholdReached',
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    workspaceId: ws,
    aggregateType: 'Budget',
    aggregateId: uuidv7(),
    aggregateVersion: over.version ?? 1,
    actor: { type: 'SYSTEM', id: null },
    payload: {
      budgetId: BUDGET,
      budgetLineId: LINE,
      periodId: PERIOD,
      periodLabel: '2026-11',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      target: { kind: 'CATEGORY', id: RESTAURANTS },
      threshold: over.threshold ?? '90',
      alsoCrossed: ['50', '75'],
      reference: { amount: '600.00', currency: 'BOB' },
      actual: { amount: '550.00', currency: 'BOB' },
      utilization: '91.7',
      actualComplete: true,
      crossedAt: new Date().toISOString(),
    },
  };
  return draft;
}

function closePendingEvent(ws: string) {
  const draft: DomainEventDraft = {
    eventId: uuidv7(),
    eventType: 'planning.MonthClosePending',
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    workspaceId: ws,
    aggregateType: 'FinancialPeriod',
    aggregateId: uuidv7(),
    aggregateVersion: 2,
    actor: { type: 'SYSTEM', id: null },
    payload: {
      workspaceId: ws,
      periodId: PERIOD,
      periodLabel: '2026-10',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      pendingSince: '2026-11-01',
      delayDays: 3,
    },
  };
  return draft;
}

/** Publica el evento como `pf_app` (misma transacción que un comando): outbox → relay → consumidores. */
async function publish(ws: string, userId: string, draft: DomainEventDraft): Promise<EventEnvelope> {
  return uow().run({ userId, workspaceId: ws }, () => writer.append(draft));
}

// ───────────────────────────────────────────────────────────────────────── worker

async function startWorker(
  env: Record<string, string> = {},
  options: NonNullable<Parameters<typeof createWorkerRuntime>[2]> & { logger?: Logger } = {},
): Promise<WorkerRuntime> {
  const { logger, ...runtimeOptions } = options;
  const log = capturingLogger('finance-worker', 'worker', 'info');
  return createWorkerRuntime(
    workerConfig(
      baseEnv(deps, {
        EMAIL_DRIVER: 'smtp',
        SMTP_HOST: mailpit.smtpHost,
        SMTP_PORT: String(mailpit.smtpPort),
        APP_PUBLIC_URL: 'http://localhost:23000',
        EMAIL_FROM: 'PFOS <notificaciones@pfos.local>',
        ...env,
      }),
    ),
    logger ?? log.logger,
    {
      ledgerMaintenanceOnStart: false,
      fxGapFillOnStart: false,
      lifecycleBackfillOnStart: false,
      planningPeriodsOnStart: false,
      relay: { pollIntervalMs: 200 },
      ...runtimeOptions,
      notifications: { scheduleCrons: false, sweepOnStart: false, ...runtimeOptions.notifications },
    },
  );
}

/** Verificación como `pf_worker` con el contexto RLS del workspace (transacción de solo lectura). */
async function asWorker<T>(ws: string, fn: (q: Pool | PoolClient) => Promise<T>): Promise<T> {
  const client = await workerPool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(
      `SELECT set_config('app.workspace_id', $1, true), set_config('app.user_id', '', true)`,
      [ws],
    );
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
  } finally {
    client.release();
  }
}

const notificationsOf = (ws: string, userId: string) =>
  asWorker(
    ws,
    async (q) =>
      (
        await q.query<{ id: string; status: string; dedupe_key: string }>(
          'SELECT id, status, dedupe_key FROM notifications.notification WHERE user_id = $1',
          [userId],
        )
      ).rows,
  );

const countNotifications = (ws: string) =>
  asWorker(ws, async (q) =>
    Number(
      (await q.query<{ n: string }>('SELECT count(*)::text AS n FROM notifications.notification')).rows[0]!.n,
    ),
  );

interface DeliveryRow {
  id: string;
  notification_id: string;
  status: string;
  attempts: number;
  suppression_reason: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  user_id: string;
}

const deliveriesOf = (ws: string) =>
  asWorker(
    ws,
    async (q) =>
      (
        await q.query<DeliveryRow>(
          `SELECT d.id, d.notification_id, d.status, d.attempts, d.suppression_reason, d.provider_message_id,
                  d.last_error_code, n.user_id
             FROM notifications.notification_delivery d
             JOIN notifications.notification n ON n.workspace_id = d.workspace_id AND n.id = d.notification_id`,
        )
      ).rows,
  );

const mailTo = async (address: string): Promise<MailpitMessage[]> => {
  const all = await mailpit.messages();
  return Promise.all(
    all.filter((m) => m.To.some((t) => t.Address === address)).map((m) => mailpit.message(m.ID)),
  );
};

const withoutUrls = (value: string) => value.replace(/https?:\/\/\S+/g, '');

beforeAll(async () => {
  appPool = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 8 });
  migratorPool = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  // Aislamiento, no lentitud: los hechos de cierre/umbral que dejaron otros archivos (sin relay) generarían
  // notificaciones y emails ajenos que compiten por el despacho SMTP (cola aparte, concurrencia 2) con los de este test.
  await discardStaleEventBacklog(deps);
  mailpit = await startMailpit();
});

afterAll(async () => {
  await mailpit?.stop();
  await Promise.all([appPool?.end(), workerPool?.end(), migratorPool?.end()]);
});

describe('notifications/alerts: de un hecho publicado a un email en Mailpit', () => {
  it('[TC-NOTIFICATIONS-EMAIL-004] [TC-NOTIFICATIONS-INAPP-001] [TC-NOTIFICATIONS-I18N-001] un umbral crea una notificación por miembro y un email en su idioma, SENT con Message-ID determinista', async () => {
    const f = await fixture({ owner: 'en-US', editor: 'pt-BR', viewer: 'es-BO' });
    const worker = await startWorker();
    try {
      await publish(f.ws, f.owner.id, thresholdEvent(f.ws));
      const owners = await until(async () => {
        const m = await mailTo(f.owner.email);
        return m.length > 0 ? m : undefined;
      });
      const editors = await until(async () => {
        const m = await mailTo(f.editor.email);
        return m.length > 0 ? m : undefined;
      });
      const viewers = await until(async () => {
        const m = await mailTo(f.viewer.email);
        return m.length > 0 ? m : undefined;
      });
      expect(owners).toHaveLength(1);
      expect(owners[0]?.Subject).toBe('You have a budget alert');
      expect(editors[0]?.Subject).toBe('Você tem um alerta de orçamento');
      expect(viewers[0]?.Subject).toBe('Tienes una alerta de presupuesto');

      // Una notificación UNREAD por miembro (VIEWER incluido) y una entrega SENT por notificación.
      for (const m of [f.owner, f.editor, f.viewer]) {
        const rows = await until(async () => {
          const r = await deliveriesOf(f.ws);
          const mine = r.filter((d) => d.user_id === m.id);
          return mine.length > 0 && mine.every((d) => d.status === 'SENT') ? mine : undefined;
        });
        expect(rows).toHaveLength(1);
        const [delivery] = rows;
        expect(delivery).toMatchObject({ status: 'SENT', attempts: 1 });
        // Message-ID = <deliveryId@dominio de EMAIL_FROM> y provider_message_id lo registra.
        expect(delivery?.provider_message_id).toBe(`<${delivery?.id}@pfos.local>`);
        const mail = (await mailTo(m.email))[0];
        const headers = await mailpit.headers(mail?.ID ?? '');
        expect(headers['Message-Id']?.[0] ?? headers['Message-ID']?.[0]).toBe(`<${delivery?.id}@pfos.local>`);
        expect(headers['List-Unsubscribe']?.[0]).toBe('<http://localhost:23000/preferencias>');
        const notification = await notificationsOf(f.ws, m.id);
        expect(notification).toHaveLength(1);
        expect(notification[0]?.status).toBe('UNREAD');
        // Enlace: solo la ruta y el id opaco (sin tokens ni consultas).
        expect(mail?.Text).toContain(`http://localhost:23000/notificaciones/${notification[0]?.id}`);
      }
    } finally {
      await worker.close();
    }
  });

  it('[TC-NOTIFICATIONS-EMAIL-001] el email por defecto no contiene categoría, montos ni moneda (asunto, texto y HTML)', async () => {
    const f = await fixture();
    const worker = await startWorker();
    try {
      await publish(f.ws, f.owner.id, thresholdEvent(f.ws));
      const [mail] = await until(async () => {
        const m = await mailTo(f.owner.email);
        return m.length > 0 ? m : undefined;
      });
      const content = `${mail?.Subject}\n${withoutUrls(mail?.Text ?? '')}\n${withoutUrls(mail?.HTML ?? '')}`;
      for (const forbidden of ['Restaurantes', 'BOB']) expect(content).not.toContain(forbidden);
      // Los montos sueltos se buscan con límites: «600» aparece en CSS (font-weight, width) y en ids.
      expect(content).not.toMatch(leakPattern('550', '600'));
      expect(mail?.Text).toContain('Una línea de tu presupuesto de 2026-11 alcanzó el 90 %.');
    } finally {
      await worker.close();
    }
  });

  it('[TC-NOTIFICATIONS-INAPP-007] el cierre pendiente notifica y envía email solo a OWNER y EDITOR, una vez aunque el evento se reentregue', async () => {
    const f = await fixture();
    const worker = await startWorker();
    try {
      const envelope = await publish(f.ws, f.owner.id, closePendingEvent(f.ws));
      await until(async () => ((await mailTo(f.owner.email)).length > 0 ? true : undefined));
      await until(async () => ((await mailTo(f.editor.email)).length > 0 ? true : undefined));
      // Reentrega manual del mismo evento al consumidor (duplicado del inbox).
      const def = worker.subscriptions
        .definitions()
        .find((d) => d.consumer === 'notifications.month-close-pending');
      expect(def).toBeDefined();
      expect(await worker.consumers.deliver(def as EventConsumerDefinition, envelope)).toBe('duplicate');
      await sleep(1_000);
      expect(await countNotifications(f.ws)).toBe(2);
      expect(await mailTo(f.viewer.email)).toHaveLength(0);
      expect((await mailTo(f.owner.email))[0]?.Subject).toBe('Tienes un mes pendiente de cierre');
      expect((await mailTo(f.editor.email))[0]?.Subject).toBe('Você tem um mês pendente de fechamento');
    } finally {
      await worker.close();
    }
  });
});

describe('notifications/alerts: idempotencia y entrega única', () => {
  it('[TC-NOTIFICATIONS-DEDUP-001] el mismo evento entregado dos veces y a dos workers a la vez crea una sola notificación y un solo email', async () => {
    const f = await fixture();
    const a = await startWorker();
    const b = await startWorker();
    try {
      const envelope = buildEnvelope(thresholdEvent(f.ws));
      eventSchemaRegistry().validate(envelope);
      const defA = a.subscriptions.definitions().find((d) => d.consumer === 'notifications.budget-threshold');
      const defB = b.subscriptions.definitions().find((d) => d.consumer === 'notifications.budget-threshold');
      const outcomes = await Promise.all([
        a.consumers.deliver(defA as EventConsumerDefinition, envelope),
        b.consumers.deliver(defB as EventConsumerDefinition, envelope),
        a.consumers.deliver(defA as EventConsumerDefinition, envelope),
        b.consumers.deliver(defB as EventConsumerDefinition, envelope),
      ]);
      expect(outcomes.filter((o) => o === 'applied')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(3);
      // platform.inbox registra el evento una sola vez.
      const inbox = await workerPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM platform.inbox WHERE consumer = 'notifications.budget-threshold' AND event_id = $1`,
        [envelope.eventId],
      );
      expect(Number(inbox.rows[0]?.n)).toBe(1);
      await until(async () => ((await mailTo(f.owner.email)).length > 0 ? true : undefined));
      await sleep(1_500);
      expect(await countNotifications(f.ws)).toBe(3);
      expect(await mailTo(f.owner.email)).toHaveLength(1);
      expect(await deliveriesOf(f.ws)).toHaveLength(3);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  it('[TC-NOTIFICATIONS-DEDUP-002] un segundo evento con otro identificador pero el mismo hecho no crea otra notificación ni otro email', async () => {
    const f = await fixture();
    const worker = await startWorker();
    try {
      await publish(f.ws, f.owner.id, thresholdEvent(f.ws, { version: 1 }));
      await until(async () => ((await mailTo(f.owner.email)).length > 0 ? true : undefined));
      await publish(f.ws, f.owner.id, thresholdEvent(f.ws, { version: 2 }));
      // Un umbral distinto (otra clave de negocio) sí es otro hecho: sirve de testigo de que el segundo se procesó.
      await publish(f.ws, f.owner.id, thresholdEvent(f.ws, { version: 3, threshold: '100' }));
      await until(async () => ((await mailTo(f.owner.email)).length >= 2 ? true : undefined));
      await sleep(1_000);
      expect(await countNotifications(f.ws)).toBe(6);
      expect(await mailTo(f.owner.email)).toHaveLength(2);
    } finally {
      await worker.close();
    }
  });

  it('[TC-NOTIFICATIONS-EMAIL-005] publicar dos veces el hecho y reiniciar el worker durante el despacho deja una notificación y un solo email', async () => {
    const f = await fixture();
    // Envío lento: el reinicio (cierre ordenado) llega con el despacho en vuelo.
    let sending = 0;
    const smtp = createEmailSender({
      driver: 'smtp',
      smtp: {
        host: mailpit.smtpHost,
        port: mailpit.smtpPort,
        secure: false,
        from: 'PFOS <notificaciones@pfos.local>',
      },
    });
    const slow: EmailSender = {
      driver: 'smtp',
      send: async (message) => {
        sending += 1;
        await sleep(800);
        return smtp.send(message);
      },
    };
    const first = await startWorker({}, { emailSender: slow });
    await publish(f.ws, f.owner.id, thresholdEvent(f.ws));
    await until(async () => (sending > 0 ? true : undefined));
    // Reinicio: el cierre ordenado espera al despacho en curso.
    await first.close();
    const second = await startWorker();
    try {
      // El hecho se publica otra vez (otro agregado versionado): mismo objetivo, periodo y umbral.
      await publish(f.ws, f.owner.id, thresholdEvent(f.ws, { version: 2 }));
      await until(async () => {
        const rows = await deliveriesOf(f.ws);
        return rows.length === 3 && rows.every((d) => d.status === 'SENT') ? true : undefined;
      });
      await sleep(1_500);
      expect(await countNotifications(f.ws)).toBe(3);
      expect(await mailTo(f.owner.email)).toHaveLength(1);
      expect(await mailTo(f.editor.email)).toHaveLength(1);
      // Repetir el despacho de una entrega ya aceptada no envía otro email.
      const rows = await deliveriesOf(f.ws);
      for (const d of rows) {
        await Promise.all([
          second.queue.send('notifications.email-dispatch', { workspaceId: f.ws, deliveryId: d.id }),
          second.queue.send('notifications.email-dispatch', { workspaceId: f.ws, deliveryId: d.id }),
        ]);
      }
      await sleep(2_000);
      expect(await mailTo(f.owner.email)).toHaveLength(1);
      expect((await deliveriesOf(f.ws)).every((d) => d.status === 'SENT' && d.attempts === 1)).toBe(true);
    } finally {
      await second.close();
    }
  });
});

describe('notifications/alerts: fallos del proveedor y canal deshabilitado', () => {
  it('[TC-NOTIFICATIONS-EMAIL-006] con el SMTP caído hace 5 intentos, deja la entrega FAILED y la notificación in-app intacta, sin la dirección en los logs', async () => {
    const f = await fixture();
    const log = capturingLogger('finance-worker', 'worker', 'info');
    const worker = await startWorker(
      { SMTP_PORT: '1' }, // puerto cerrado: ECONNREFUSED en cada intento
      { logger: log.logger, notifications: { backoffMs: [50, 50, 50, 50] } },
    );
    try {
      await publish(f.ws, f.owner.id, thresholdEvent(f.ws));
      const failed = await until(async () => {
        const rows = (await deliveriesOf(f.ws)).filter((d) => d.user_id === f.owner.id);
        return rows[0]?.status === 'FAILED' ? rows[0] : undefined;
      }, 60_000);
      expect(failed.attempts).toBe(5);
      expect(failed.last_error_code).toMatch(/^SMTP_/);
      expect((await notificationsOf(f.ws, f.owner.id))[0]?.status).toBe('UNREAD');
      const output = log.lines.join('\n');
      expect(output).not.toContain(f.owner.email);
      expect(output).not.toContain(f.editor.email);
      expect(
        await mailpit.messages().then((m) => m.filter((x) => x.To.some((t) => t.Address === f.owner.email))),
      ).toHaveLength(0);
    } finally {
      await worker.close();
    }
  });

  it('[TC-NOTIFICATIONS-EMAIL-007] con EMAIL_DRIVER=none la entrega queda SUPPRESSED/CHANNEL_DISABLED, sin reintentos y con el in-app creado', async () => {
    const f = await fixture();
    const worker = await startWorker({ EMAIL_DRIVER: 'none' });
    try {
      await publish(f.ws, f.owner.id, thresholdEvent(f.ws));
      const rows = await until(async () => {
        const r = await deliveriesOf(f.ws);
        return r.length === 3 && r.every((d) => d.status === 'SUPPRESSED') ? r : undefined;
      });
      expect(rows.every((d) => d.suppression_reason === 'CHANNEL_DISABLED' && d.attempts === 1)).toBe(true);
      expect(await countNotifications(f.ws)).toBe(3);
      expect(await mailTo(f.owner.email)).toHaveLength(0);
    } finally {
      await worker.close();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────── aviso agrupado de tasas retenidas

/**
 * Email del aviso agrupado de muestras de tasa retenidas (openspec refine-rate-anomaly-alert-grouping, tarea 4.4;
 * TC-NOTIFICATIONS-FX-020, -021 y -022): puerto de entrada REAL de NOTIFY (el que llama el job de providers de FX) sobre
 * PostgreSQL real, despachador real y SMTP real contra Mailpit. La cola es un registro vacío (las entregas se despachan
 * a mano con el reloj en el instante que corresponda, como lo haría el worker al vencer `startAfter`).
 */
describe('notifications/alerts: email único del grupo de tasas retenidas en Mailpit', () => {
  const clock = new FixedClock(Instant.parse('2026-10-14T14:00:00Z'));
  const queue = {
    enqueueInTransaction: () => Promise.resolve(),
  } as unknown as JobQueue;
  const runtime = () =>
    createNotificationsWorkerRuntime({
      pool: workerPool,
      clock,
      queue,
      logger: capturingLogger('finance-worker', 'worker', 'warn').logger,
      recipients: identityWorkspaceRecipients(workerPool),
      catalog: { categoryTree: () => Promise.resolve({ groups: [], categories: [], tags: [] }) },
      sender: createEmailSender({
        driver: 'smtp',
        smtp: {
          host: mailpit.smtpHost,
          port: mailpit.smtpPort,
          secure: false,
          from: 'PFOS <notificaciones@pfos.local>',
        },
      }),
      counters: otelCounters('@pf/notifications'),
      histograms: otelHistograms('@pf/notifications'),
      appPublicUrl: 'http://localhost:23000',
      emailFrom: 'PFOS <notificaciones@pfos.local>',
      maxAttempts: 5,
      retentionMonths: 12,
    });

  const ANCHOR = '01928c4e-0000-7000-8000-00000000a001';
  const PEAK = '01928c4e-0000-7000-8000-00000000a002';
  const BASELINE = '01928c4e-0000-7000-8000-00000000a003';

  /** Hecho del grupo de USDT/BOB con `pending` muestras pendientes y mayor variación 12.90 frente a 12.10 (+6.61 %). */
  const groupFact = (ws: string, pending: number, at: string, firstRetainedAt: string, eventNo: number) =>
    ({
      workspaceId: ws,
      type: 'FX_RATE_ANOMALY_RETAINED' as const,
      factKey: ANCHOR,
      sourceEventId: `01928c4e-0000-7000-8000-00000000b${String(eventNo).padStart(3, '0')}`,
      occurredAt: at,
      payload: {
        anchorRateId: ANCHOR,
        base: 'USDT',
        quote: 'BOB',
        pendingCount: pending,
        retainedCount: pending,
        providers: ['PARALELO_BO'],
        reviewRateId: ANCHOR,
        peak: {
          rateId: PEAK,
          base: 'USDT',
          quote: 'BOB',
          rateType: 'PARALLEL_SELL',
          provider: 'PARALELO_BO',
          value: '12.90',
          baselineRateId: BASELINE,
          baselineValue: '12.10',
          variationPct: '6.6116',
          thresholdPct: '5',
          detectedAt: at,
          timeZone: 'America/La_Paz',
        },
        firstRetainedAt,
        lastRetainedAt: at,
        detectedAt: at,
        timeZone: 'America/La_Paz',
      },
    }) as const;

  const ownerDeliveries = async (f: Fixture) =>
    (await deliveriesOf(f.ws)).filter((d) => d.user_id === f.owner.id);
  const notBeforeOf = (ws: string, deliveryId: string) =>
    asWorker(ws, async (q) => {
      const { rows } = await q.query<{ not_before: Date | null }>(
        'SELECT not_before FROM notifications.notification_delivery WHERE id = $1',
        [deliveryId],
      );
      return rows[0]!.not_before;
    });

  it('[TC-NOTIFICATIONS-FX-020] sin opt-in el email del grupo dice "una o más tasas" y no incluye valores, monedas, provider ni la cantidad', async () => {
    const f = await fixture();
    clock.set(Instant.parse('2026-10-14T14:00:00Z'));
    const rt = runtime();
    const outcome = await rt.intake.notify(
      groupFact(f.ws, 3, '2026-10-14T14:00:00.000Z', '2026-10-14T13:58:00.000Z', 1),
    );
    expect(outcome).toMatchObject({ created: 2, deliveries: 2 });
    const [owner] = await ownerDeliveries(f);
    expect(await rt.dispatch.run({ workspaceId: f.ws, deliveryId: owner!.id })).toBe('sent');
    const [mail] = await mailTo(f.owner.email);
    expect(mail).toBeDefined();
    const content = withoutUrls(`${mail!.Subject}\n${mail!.Text}\n${mail!.HTML}`);
    expect(content).toContain('Una o más tasas automáticas quedaron retenidas');
    for (const secret of ['12.90', '12,90', '12.10', '12,10', '6.61', '6,61', 'USDT', 'BOB', 'paralelo.bo']) {
      expect(content.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
    expect(content).not.toMatch(/(^|[^\d.,])3([^\d.,]|$)/);
    expect(mail!.Text).toMatch(/http:\/\/localhost:23000\/notificaciones\/[0-9a-f-]{36}/);
  }, 60_000);

  it('[TC-NOTIFICATIONS-FX-021] las muestras posteriores del grupo no programan otro email: el OWNER recibe uno solo', async () => {
    const f = await fixture();
    const rt = runtime();
    clock.set(Instant.parse('2026-10-14T14:00:00Z'));
    await rt.intake.notify(groupFact(f.ws, 3, '2026-10-14T14:00:00.000Z', '2026-10-14T14:00:00.000Z', 2));
    for (const [pending, at, no] of [
      [5, '2026-10-14T14:15:00.000Z', 3],
      [8, '2026-10-14T14:30:00.000Z', 4],
    ] as const) {
      clock.set(Instant.parse(at));
      const out = await rt.intake.notify(groupFact(f.ws, pending, at, '2026-10-14T14:00:00.000Z', no));
      expect(out).toEqual({ created: 0, refreshed: 2, deliveries: 0 });
    }
    expect(await ownerDeliveries(f)).toHaveLength(1);
    for (const d of await deliveriesOf(f.ws)) {
      expect(await rt.dispatch.run({ workspaceId: f.ws, deliveryId: d.id })).toBe('sent');
    }
    expect(await mailTo(f.owner.email)).toHaveLength(1);
    expect(await mailTo(f.editor.email)).toHaveLength(1);
    expect(await countNotifications(f.ws)).toBe(2);
  }, 60_000);

  it('[TC-NOTIFICATIONS-FX-022] con silencio de 22:00 a 07:00 el único email del grupo se envía a las 11:00Z con el estado de ese momento (5 muestras)', async () => {
    const f = await fixture();
    // Las preferencias son del propio usuario (RLS): se guardan como `pf_app` con su contexto, como lo haría la API.
    await uow().run({ userId: f.owner.id, workspaceId: f.ws }, () =>
      requireSqlExecutor().query(
        `INSERT INTO notifications.user_setting
           (workspace_id, user_id, quiet_hours_start, quiet_hours_end, include_details_in_email, version)
         VALUES ($1, $2, '22:00', '07:00', true, 1)`,
        [f.ws, f.owner.id],
      ),
    );
    const rt = runtime();
    // 2026-10-13 23:30 en La Paz = 2026-10-14T03:30Z.
    clock.set(Instant.parse('2026-10-14T03:30:00Z'));
    await rt.intake.notify(groupFact(f.ws, 3, '2026-10-14T03:30:00.000Z', '2026-10-14T03:30:00.000Z', 5));
    clock.set(Instant.parse('2026-10-14T05:00:00Z'));
    await rt.intake.notify(groupFact(f.ws, 5, '2026-10-14T05:00:00.000Z', '2026-10-14T03:30:00.000Z', 6));
    const [delivery] = await ownerDeliveries(f);
    expect(delivery).toBeDefined();
    expect((await notBeforeOf(f.ws, delivery!.id))?.toISOString()).toBe('2026-10-14T11:00:00.000Z');
    // Dentro del silencio no sale nada: la entrega no vence hasta `not_before`, así que el despacho no la toma.
    expect(await rt.dispatch.run({ workspaceId: f.ws, deliveryId: delivery!.id })).toBe('noop');
    expect(await mailTo(f.owner.email)).toHaveLength(0);
    // 07:00 en La Paz: sale un único email con el estado vigente.
    clock.set(Instant.parse('2026-10-14T11:00:00Z'));
    expect(await rt.dispatch.run({ workspaceId: f.ws, deliveryId: delivery!.id })).toBe('sent');
    const mails = await mailTo(f.owner.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.Text).toContain('USDT/BOB: 5 tasas automáticas retenidas pendientes de revisión');
  }, 60_000);
});
