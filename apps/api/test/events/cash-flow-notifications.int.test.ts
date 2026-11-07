import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import {
  identityWorkspaceCalendarDirectory,
  identityWorkspaceRecipients,
} from '@pf/identity/interface/identity.module';
import {
  createEmailSender,
  createNotificationsWorkerRuntime,
  type HomeDigestSnapshot,
  type NotificationIntakeFact,
  type NotificationsWorkerRuntime,
} from '@pf/notifications/interface/notifications.module';
import { otelCounters, otelHistograms } from '@pf/platform/otel';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createWorkerRuntime, type WorkerRuntime } from '../../src/worker/create-worker-runtime.js';
import { startMailpit, type Mailpit, type MailpitMessage } from '../support/mailpit.js';
import { baseEnv, capturingLogger, discardStaleEventBacklog, workerConfig } from '../support/harness.js';

// Riesgo de déficit y digest del Home de punta a punta contra PostgreSQL real, pg-boss real y Mailpit
// (add-cash-flow-forecast; TC-NOTIFICATIONS-SHORTFALL-003, TC-NOTIFICATIONS-DIGEST-002 y la parte de NOTIFY de la tarea 7.3):
// entrega directa / job del digest → entrega por email → `notifications.email-dispatch` → SMTP → Mailpit.
const deps = inject('deps');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let appPool: Pool;
let workerPool: Pool;
let migratorPool: Pool;
let mailpit: Mailpit;
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

async function provisionMember(label: string, role: Member['role'], locale: string): Promise<Member> {
  const { rows } = await migratorPool.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/notify-cash', $1, $2, $3) AS id`,
    [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID().slice(0, 8)}@demo.pfos.test`, label],
  );
  const id = rows[0]!.id;
  const user = await migratorPool.query<{ email: string }>(
    'UPDATE iam."user" SET locale = $2, time_zone = $3 WHERE id = $1 RETURNING email',
    [id, locale, 'America/La_Paz'],
  );
  return { id, email: user.rows[0]!.email, role };
}

async function fixture(locales: { owner?: string; editor?: string; viewer?: string } = {}) {
  const owner = await provisionMember('owner', 'OWNER', locales.owner ?? 'es-BO');
  const editor = await provisionMember('editor', 'EDITOR', locales.editor ?? 'en-US');
  const viewer = await provisionMember('viewer', 'VIEWER', locales.viewer ?? 'es-BO');
  const ws = randomUUID();
  await uow().run({ userId: owner.id, workspaceId: ws }, async () => {
    const tx = requireSqlExecutor();
    await tx.query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Cash', 'BOB', 'America/La_Paz', 'es-BO')`,
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

async function startWorker(): Promise<WorkerRuntime> {
  const log = capturingLogger('finance-worker', 'worker', 'info');
  return createWorkerRuntime(
    workerConfig(
      baseEnv(deps, {
        EMAIL_DRIVER: 'smtp',
        SMTP_HOST: mailpit.smtpHost,
        SMTP_PORT: String(mailpit.smtpPort),
        APP_PUBLIC_URL: 'http://localhost:23000',
        EMAIL_FROM: 'PFOS <notificaciones@pfos.local>',
        // El digest solo corre cuando la prueba lo pide.
        NOTIFICATIONS_DIGEST_CRON: 'off',
      }),
    ),
    log.logger,
    {
      ledgerMaintenanceOnStart: false,
      fxGapFillOnStart: false,
      lifecycleBackfillOnStart: false,
      planningPeriodsOnStart: false,
      relay: { pollIntervalMs: 200 },
      notifications: { scheduleCrons: false, sweepOnStart: false },
    },
  );
}

const empty = { counts: {}, percents: {}, dates: {}, states: {}, amounts: {} };
const homeSnapshot = (ws: string): HomeDigestSnapshot => ({
  workspaceId: ws,
  generatedAt: '2026-11-02T12:05:00.000Z',
  timeZone: 'America/La_Paz',
  today: '2026-11-02',
  reportingCurrency: 'BOB',
  questions: (['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'] as const).map((question) => ({
    ...empty,
    question,
    status: 'AVAILABLE' as const,
    counts: question === 'Q8' ? { upcoming7d: 3 } : {},
    percents: question === 'Q6' ? { savingsRate: '41.5' } : {},
    states: question === 'Q5' ? { spendableSign: 'POSITIVE' } : {},
    amounts: question === 'Q5' ? { spendable: { amount: '5521.00', currency: 'BOB' } } : {},
  })),
});

/** NOTIFY del worker sobre el pg-boss del worker en marcha: las entregas las despacha su cola `email-dispatch`. */
function notifyRuntime(worker: WorkerRuntime, clock: FixedClock, ws: string): NotificationsWorkerRuntime {
  const log = capturingLogger('finance-worker', 'worker', 'info');
  return createNotificationsWorkerRuntime({
    pool: workerPool,
    clock,
    queue: worker.queue,
    logger: log.logger,
    recipients: identityWorkspaceRecipients(workerPool),
    catalog: { categoryTree: () => Promise.resolve({ groups: [], categories: [], tags: [] }) },
    sender: createEmailSender({ driver: 'none' }),
    counters: otelCounters('@pf/notifications'),
    histograms: otelHistograms('@pf/notifications'),
    appPublicUrl: 'http://localhost:23000',
    emailFrom: 'PFOS <notificaciones@pfos.local>',
    maxAttempts: 5,
    retentionMonths: 12,
    homeDigest: {
      source: { compose: () => Promise.resolve(homeSnapshot(ws)) },
      calendar: identityWorkspaceCalendarDirectory(workerPool),
    },
  });
}

const shortfall = (ws: string, episodeId: string): NotificationIntakeFact =>
  ({
    workspaceId: ws,
    type: 'CASH_FLOW_SHORTFALL_RISK',
    factKey: episodeId,
    sourceEventId: randomUUID(),
    occurredAt: '2026-10-20T12:25:00.000Z',
    payload: {
      episodeId,
      currency: 'BOB',
      horizonDays: 30,
      firstShortfallDate: '2026-11-01',
      lowest: { amount: '-679.00', currency: 'BOB' },
      lowestDate: '2026-11-01',
      threshold: { amount: '1500.00', currency: 'BOB' },
      belowZero: true,
      detectedAt: '2026-10-20T12:25:00.000Z',
      timeZone: 'America/La_Paz',
    },
  }) as unknown as NotificationIntakeFact;

const mailTo = async (address: string): Promise<MailpitMessage[]> => {
  const all = await mailpit.messages();
  return Promise.all(
    all.filter((m) => m.To.some((t) => t.Address === address)).map((m) => mailpit.message(m.ID)),
  );
};

async function asWorker<T>(ws: string, fn: (q: PoolClient) => Promise<T>): Promise<T> {
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

const withoutUrls = (value: string) => value.replace(/https?:\/\/\S+/g, '');

beforeAll(async () => {
  appPool = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 8 });
  migratorPool = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  await discardStaleEventBacklog(deps);
  mailpit = await startMailpit();
});

afterAll(async () => {
  await mailpit?.stop();
  await Promise.all([appPool?.end(), workerPool?.end(), migratorPool?.end()]);
});

describe('cash-flow-forecast: riesgo de déficit por email', () => {
  it('[TC-NOTIFICATIONS-SHORTFALL-003] el email sin opt-in lleva moneda, fecha y enlace, y nada de montos; con opt-in, el mínimo y el umbral', async () => {
    const f = await fixture();
    const worker = await startWorker();
    try {
      const notify = notifyRuntime(worker, new FixedClock(Instant.parse('2026-10-20T12:25:00Z')), f.ws);
      expect(await notify.intake.notify(shortfall(f.ws, randomUUID()))).toMatchObject({
        created: 2,
        deliveries: 2,
      });
      const [plain] = await until(async () => {
        const m = await mailTo(f.owner.email);
        return m.length > 0 ? m : undefined;
      });
      expect(plain?.Subject).toBe('Riesgo de déficit en tu flujo de caja');
      const content = `${plain?.Subject}\n${withoutUrls(plain?.Text ?? '')}\n${withoutUrls(plain?.HTML ?? '')}`;
      expect(plain?.Text).toContain('BOB');
      expect(plain?.Text).toContain('01/11/2026');
      expect(plain?.Text).toMatch(/http:\/\/localhost:23000\/notificaciones\//);
      expect(content).not.toMatch(/679/);
      expect(content).not.toMatch(/\b1[.,]?500\b/);
      expect(content).not.toContain('Banco BOB');
      // El EDITOR (en-US) lo recibe en inglés; el VIEWER, nada.
      const [english] = await until(async () => {
        const m = await mailTo(f.editor.email);
        return m.length > 0 ? m : undefined;
      });
      expect(english?.Text).toContain('11/01/2026');
      expect(await mailTo(f.viewer.email)).toHaveLength(0);

      // Opt-in de detalles del OWNER: el siguiente episodio muestra el mínimo y el umbral.
      await uow().run({ userId: f.owner.id, workspaceId: f.ws }, async () => {
        await requireSqlExecutor().query(
          `INSERT INTO notifications.user_setting (workspace_id, user_id, include_details_in_email) VALUES ($1, $2, true)`,
          [f.ws, f.owner.id],
        );
      });
      await notify.intake.notify(shortfall(f.ws, randomUUID()));
      const detailed = await until(async () => {
        const m = await mailTo(f.owner.email);
        return m.length > 1 ? m : undefined;
      });
      const rich = detailed.find((m) => /-679,00 BOB/.test(m.Text));
      expect(rich?.Text).toContain('1.500,00 BOB');
    } finally {
      await worker.close();
    }
  });
});

describe('cash-flow-forecast: digest del Home por email', () => {
  it('[TC-NOTIFICATIONS-DIGEST-002] el lunes 08:05 el OWNER y el VIEWER con digest semanal reciben Q1 a Q9; el EDITOR sin digest, nada; el digest no está en el centro', async () => {
    const f = await fixture();
    for (const user of [f.owner, f.viewer]) {
      await uow().run({ userId: user.id, workspaceId: f.ws }, async () => {
        await requireSqlExecutor().query(
          `INSERT INTO notifications.user_setting (workspace_id, user_id, digest_frequency) VALUES ($1, $2, 'WEEKLY')`,
          [f.ws, user.id],
        );
      });
    }
    const worker = await startWorker();
    try {
      const notify = notifyRuntime(worker, new FixedClock(Instant.parse('2026-11-02T12:05:00Z')), f.ws);
      expect(await notify.digest?.run(f.ws)).toEqual({ created: 2, deliveries: 2 });
      expect(await notify.digest?.run(f.ws)).toEqual({ created: 0, deliveries: 0 });
      const [ownerMail] = await until(async () => {
        const m = await mailTo(f.owner.email);
        return m.length > 0 ? m : undefined;
      });
      await until(async () => ((await mailTo(f.viewer.email)).length > 0 ? true : undefined));
      expect(ownerMail?.Subject).toBe('Tu resumen financiero de PFOS');
      for (const title of [
        'Dinero disponible',
        'Ingresos',
        'Gastos',
        'Comprometido del periodo',
        'Disponible para gastar',
        'Ahorro',
        'Frente al periodo anterior',
        'Pagos próximos',
        'Metas',
      ]) {
        expect(ownerMail?.Text).toContain(title);
      }
      // Sin opt-in: ningún monto.
      expect(withoutUrls(ownerMail?.Text ?? '')).not.toMatch(/\b5[.,]?521\b/);
      await sleep(1_000);
      expect(await mailTo(f.editor.email)).toHaveLength(0);
      // El digest nace archivado: ni el centro ni el contador lo muestran.
      const rows = await asWorker(
        f.ws,
        async (q) =>
          (
            await q.query<{ status: string }>(
              `SELECT status FROM notifications.notification WHERE notification_type = 'HOME_DIGEST'`,
            )
          ).rows,
      );
      expect(rows.map((r) => r.status)).toEqual(['ARCHIVED', 'ARCHIVED']);
    } finally {
      await worker.close();
    }
  });
});
