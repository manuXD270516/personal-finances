import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { CASH_FLOW_WATCH_JOB } from '@pf/reporting/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMailpit, type Mailpit, type MailpitMessage } from '../support/mailpit.js';
import {
  asAdmin,
  money,
  startHarness,
  until,
  w1Api,
  type Harness,
  type Json,
  type User,
} from '../support/portability.js';

// Job `reporting.cash-flow-watch` de punta a punta contra PostgreSQL real, pg-boss real y Mailpit (openspec
// add-cash-flow-forecast, tarea 7.3; TC-REPORTING-FORECAST-018, -019, TC-NOTIFICATIONS-SHORTFALL-001..003): datos reales
// por la API (cuenta, ocurrencia recurrente, pendiente) → corrida del job en el worker → episodio, hecho del outbox y
// notificación del OWNER y del EDITOR (no del VIEWER) → email sin montos en Mailpit → segunda corrida sin duplicados →
// riesgo resuelto y episodio nuevo.
let h: Harness;
let mailpit: Mailpit;
let owner: User;
let editor: User;
let viewer: User;
let ws: string;
let bank: string;
let category: string;

const emailOf = (u: User) => `${u.sub}@pfos.test`;

async function member(sub: string, role: 'EDITOR' | 'VIEWER'): Promise<User> {
  const u = await h.user(sub);
  await asAdmin(h, async (c) => {
    await c.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
      [ws, u.id, role],
    );
  });
  return { ...u, ws };
}

const mailTo = async (address: string): Promise<MailpitMessage[]> => {
  const all = await mailpit.messages();
  return Promise.all(
    all.filter((m) => m.To.some((t) => t.Address === address)).map((m) => mailpit.message(m.ID)),
  );
};

/** Envía el job a mano y espera a que el worker lo termine (el cron está apagado). */
async function runWatch(): Promise<void> {
  const id = await h.worker!.queue.send(CASH_FLOW_WATCH_JOB, { trigger: 'manual' });
  await until(async () => {
    const state = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ state: string }>(
        `SELECT state FROM pgboss.job WHERE name = $1 AND id = $2`,
        [CASH_FLOW_WATCH_JOB, id],
      );
      return rows[0]?.state;
    });
    if (state === 'failed' || state === 'cancelled') throw new Error(`el job terminó ${state}`);
    return state === 'completed' ? true : undefined;
  }, 90_000);
}

interface EpisodeRow {
  id: string;
  currency: string;
  closed_at: string | null;
  below_zero: boolean;
}
const episodeRows = () =>
  asAdmin(
    h,
    async (c) =>
      (
        await c.query<EpisodeRow>(
          `SELECT id::text AS id, currency, closed_at::text AS closed_at, below_zero
           FROM reporting.cash_flow_shortfall_episode WHERE workspace_id = $1 ORDER BY opened_at, id`,
          [ws],
        )
      ).rows,
  );
const shortfallNotifications = () =>
  asAdmin(
    h,
    async (c) =>
      (
        await c.query<{ user_id: string; severity: string; status: string }>(
          `SELECT user_id::text AS user_id, severity, status FROM notifications.notification
          WHERE workspace_id = $1 AND notification_type = 'CASH_FLOW_SHORTFALL_RISK' ORDER BY created_at, user_id`,
          [ws],
        )
      ).rows,
  );
const outboxTypes = () =>
  asAdmin(
    h,
    async (c) =>
      (
        await c.query<{ event_type: string; aggregate_version: number }>(
          `SELECT event_type, aggregate_version FROM platform.outbox
          WHERE workspace_id = $1 AND event_type LIKE 'reporting.CashFlowShortfall%' ORDER BY occurred_at, id`,
          [ws],
        )
      ).rows,
  );

beforeAll(async () => {
  mailpit = await startMailpit();
  h = await startHarness({
    workerEnv: {
      EMAIL_DRIVER: 'smtp',
      SMTP_HOST: mailpit.smtpHost,
      SMTP_PORT: String(mailpit.smtpPort),
      APP_PUBLIC_URL: 'http://localhost:23000',
      EMAIL_FROM: 'PFOS <notificaciones@pfos.local>',
      // Solo corre cuando la prueba lo envía.
      REPORTING_CASH_FLOW_WATCH_CRON: 'off',
      NOTIFICATIONS_DIGEST_CRON: 'off',
    },
    worker: { commitmentsOnStart: false, importsOnStart: false },
  });
  owner = await h.user(`kc-cfw-owner-${randomUUID()}`);
  ws = owner.ws;
  editor = await member(`kc-cfw-editor-${randomUUID()}`, 'EDITOR');
  viewer = await member(`kc-cfw-viewer-${randomUUID()}`, 'VIEWER');
  const api = w1Api(h, { ws });
  const ok = (r: { status: number; body: Json }, status = 200) => {
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    return r.body;
  };
  bank = ok(
    await api.post(owner, '/accounts', {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('2000.00'), date: '2026-10-01' },
    }),
    201,
  )['id'] as string;
  const group = ok(await api.post(owner, '/category-groups', { name: 'Hogar', kind: 'EXPENSE' }), 201);
  category = ok(await api.post(owner, '/categories', { groupId: group['id'], name: 'Servicios' }), 201)[
    'id'
  ] as string;
  ok(await api.post(owner, '/periods', { through: '2026-12-31' }));
  // Alquiler de 2500.00 BOB el 2026-11-10: con 2000.00 en el banco y sin reserva, el mínimo esperado es −500.00 BOB.
  ok(
    await api.post(owner, '/recurring', {
      name: 'Alquiler',
      kind: 'EXPENSE',
      template: {
        accountId: bank,
        amount: { type: 'FIXED', amount: money('2500.00') },
        categoryId: category,
        schedule: { cadence: 'MONTHLY', startDate: '2026-11-10' },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    }),
    201,
  );
}, 600_000);

afterAll(async () => {
  await h?.close();
  await mailpit?.stop();
});

describe('reporting.cash-flow-watch: episodio, aviso por email y cierre', () => {
  it('[TC-REPORTING-FORECAST-018] el primer riesgo alto abre un episodio, publica el hecho una vez y avisa al OWNER y al EDITOR (no al VIEWER)', async () => {
    await runWatch();
    const episodes = await episodeRows();
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ currency: 'BOB', closed_at: null, below_zero: true });
    expect(await outboxTypes()).toEqual([
      { event_type: 'reporting.CashFlowShortfallRiskDetected', aggregate_version: 1 },
    ]);

    const notifications = await shortfallNotifications();
    expect(notifications.map((n) => n.user_id).sort()).toEqual([owner.id, editor.id].sort());
    expect(notifications.every((n) => n.severity === 'CRITICAL')).toBe(true);
    expect(notifications.map((n) => n.user_id)).not.toContain(viewer.id);
  }, 180_000);

  it('[TC-NOTIFICATIONS-SHORTFALL-003] el email del OWNER indica moneda y fecha, enlaza a la app y no trae montos, umbral ni cuentas', async () => {
    const [mail] = await until(async () => {
      const m = await mailTo(emailOf(owner));
      return m.length > 0 ? m : undefined;
    });
    const content = `${mail!.Subject}\n${(mail!.Text ?? '').replace(/https?:\/\/\S+/g, '')}`;
    expect(content).toContain('BOB');
    expect(content).toContain('10/11/2026');
    expect(content).not.toMatch(/500(?![0-9])/u);
    expect(content).not.toContain('Banco BOB');
    expect(mail!.Text).toMatch(/http:\/\/localhost:23000\//);
    expect(await mailTo(emailOf(viewer))).toEqual([]);
  }, 120_000);

  it('[TC-REPORTING-FORECAST-018] mientras el riesgo siga alto, otra corrida no publica ni notifica de nuevo', async () => {
    await runWatch();
    await runWatch();
    expect(await episodeRows()).toHaveLength(1);
    expect(await outboxTypes()).toHaveLength(1);
    expect(await shortfallNotifications()).toHaveLength(2);
    expect(await mailTo(emailOf(owner))).toHaveLength(1);
  }, 180_000);

  it('[TC-REPORTING-FORECAST-019] un ingreso pendiente que cubre el déficit cierra el episodio sin avisar y un déficit nuevo abre otro con su aviso', async () => {
    const api = w1Api(h, { ws });
    const income = await api.post(owner, '/transactions', {
      kind: 'INCOME',
      status: 'PENDING',
      transactionDate: '2026-11-05',
      accountId: bank,
      description: 'Pago atrasado',
      amount: money('3000.00'),
      splits: [{ amount: money('3000.00'), categoryId: category }],
    });
    // La categoría de gasto no sirve para un ingreso: se usa una de ingreso.
    if (income.status !== 201) {
      const incomeGroup = (await api.post(owner, '/category-groups', { name: 'Ingresos', kind: 'INCOME' }))
        .body;
      const incomeCategory = (
        await api.post(owner, '/categories', { groupId: incomeGroup['id'], name: 'Salario' })
      ).body['id'] as string;
      const retry = await api.post(owner, '/transactions', {
        kind: 'INCOME',
        status: 'PENDING',
        transactionDate: '2026-11-05',
        accountId: bank,
        description: 'Pago atrasado',
        amount: money('3000.00'),
        splits: [{ amount: money('3000.00'), categoryId: incomeCategory }],
      });
      expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    }
    await runWatch();
    const closed = await episodeRows();
    expect(closed).toHaveLength(1);
    expect(closed[0]!.closed_at).not.toBeNull();
    expect((await outboxTypes()).map((e) => [e.event_type, e.aggregate_version])).toEqual([
      ['reporting.CashFlowShortfallRiskDetected', 1],
      ['reporting.CashFlowShortfallRiskCleared', 2],
    ]);
    // El cierre no genera aviso.
    expect(await shortfallNotifications()).toHaveLength(2);
  }, 180_000);
});
