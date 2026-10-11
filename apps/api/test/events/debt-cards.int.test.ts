import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { EventConsumerDefinition, EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createWorkerRuntime, type WorkerRuntime } from '../../src/worker/create-worker-runtime.js';
import { connect, inTx } from '../support/db.js';
import { baseEnv, capturingLogger, discardStaleEventBacklog, workerConfig } from '../support/harness.js';
import { startMailpit, type Mailpit, type MailpitMessage } from '../support/mailpit.js';
import { money, startHarness, until, type Harness, type User } from '../support/portability.js';

// Tarjetas de crédito de punta a punta con el worker real (openspec add-credit-cards, tareas 3.7, 3.8, 3.11 y 7.3):
// un movimiento en la cuenta de la tarjeta ⇒ outbox → relay → consumidor `debt.card-activity` ⇒ hecho de umbral ⇒
// consumidor de NOTIFY ⇒ UNA notificación `CARD_UTILIZATION` para OWNER y EDITOR (no para VIEWER) y su email sin
// montos (TC-DEBT-CARD-021, -035); y el job `debt.card-daily` ⇒ `debt.CardPaymentDue.v1` ⇒ `CARD_PAYMENT_DUE`
// (TC-DEBT-CARD-034). API y worker comparten un reloj fijo en America/La_Paz; el SMTP es un Mailpit real.
const deps = inject('deps');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let h: Harness;
let clock: FixedClock;
let workerPool: Pool;
let mailpit: Mailpit;
const setDay = (date: string) => clock.set(Instant.parse(`${date}T16:00:00Z`));

interface Team {
  readonly owner: User;
  readonly editor: User;
  readonly viewer: User;
  readonly ws: string;
}

const emailOf = (u: User) => `${u.sub}@pfos.test`;

async function join(owner: User, member: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
          [owner.ws, member.id, role],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  return { ...member, ws: owner.ws };
}

async function team(label: string): Promise<Team> {
  const owner = await h.user(`kc-cards-w-${label}-owner-${randomUUID()}`);
  const editor = await join(owner, await h.user(`kc-cards-w-${label}-editor-${randomUUID()}`), 'EDITOR');
  const viewer = await join(owner, await h.user(`kc-cards-w-${label}-viewer-${randomUUID()}`), 'VIEWER');
  return { owner, editor, viewer, ws: owner.ws };
}

const api = (u: User, path: string) => `/api/v1/workspaces/${u.ws}${path}`;
const post = (u: User, path: string, body: unknown) =>
  h.call('POST', api(u, path), { token: u.token, body, headers: { 'idempotency-key': randomUUID() } });

async function creditCardAccount(u: User, name: string, currency: string, owed: string): Promise<string> {
  const r = await post(u, '/accounts', {
    name,
    type: 'CREDIT_CARD',
    currency,
    openingBalance: { amount: money(owed, currency), date: '2026-10-01' },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body['id'] as string;
}

async function registerCard(u: User, accountId: string, currency: string, limit: string) {
  const r = await post(u, '/credit-cards', {
    name: 'Visa Oro',
    statementDay: 25,
    dueDay: 15,
    accounts: [
      {
        accountId,
        creditLimit: money(limit, currency),
        minimumRule: { type: 'FIXED', amount: money('25.00', currency) },
      },
    ],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; accounts: { id: string }[] };
}

interface Row {
  user_id: string;
  notification_type: string;
  dedupe_key: string;
  severity: string;
  params: Record<string, unknown>;
  link: Record<string, unknown>;
}

/** Notificaciones de un tipo, vistas como `pf_worker` con el contexto RLS del workspace. */
async function notificationsOf(ws: string, type: string): Promise<Row[]> {
  const client = await workerPool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(
      `SELECT set_config('app.workspace_id', $1, true), set_config('app.user_id', '', true)`,
      [ws],
    );
    const { rows } = await client.query<Row>(
      `SELECT user_id, notification_type, dedupe_key, severity, params, link
         FROM notifications.notification WHERE notification_type = $1 ORDER BY user_id`,
      [type],
    );
    await client.query('ROLLBACK');
    return rows;
  } finally {
    client.release();
  }
}

async function outboxOf(ws: string, eventType: string): Promise<EventEnvelope[]> {
  const { rows } = await workerPool.query<{ envelope: EventEnvelope }>(
    'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = $2 ORDER BY sequence',
    [ws, eventType],
  );
  return rows.map((r) => r.envelope);
}

const mailTo = async (address: string): Promise<MailpitMessage[]> => {
  const all = await mailpit.messages();
  return Promise.all(
    all.filter((m) => m.To.some((t) => t.Address === address)).map((m) => mailpit.message(m.ID)),
  );
};
const withoutUrls = (value: string) => value.replace(/https?:\/\/\S+/g, '');

async function startWorker(options: { jobsOnStart: boolean }): Promise<WorkerRuntime> {
  return createWorkerRuntime(
    workerConfig(
      baseEnv(deps, {
        EMAIL_DRIVER: 'smtp',
        SMTP_HOST: mailpit.smtpHost,
        SMTP_PORT: String(mailpit.smtpPort),
        APP_PUBLIC_URL: 'http://localhost:23000',
        EMAIL_FROM: 'PFOS <notificaciones@pfos.local>',
      }),
    ),
    capturingLogger('finance-worker', 'worker').logger,
    {
      clock,
      ledgerMaintenanceOnStart: false,
      fxGapFillOnStart: false,
      lifecycleBackfillOnStart: false,
      planningPeriodsOnStart: false,
      // También gobierna el arranque de `debt.card-daily` (emisión y recordatorios al iniciar).
      commitmentsOnStart: options.jobsOnStart,
      relay: { pollIntervalMs: 200 },
      notifications: { scheduleCrons: false, sweepOnStart: false },
    },
  );
}

beforeAll(async () => {
  clock = new FixedClock(Instant.parse('2026-10-20T16:00:00Z'));
  // Aislamiento entre archivos: el backlog que dejaron otros archivos no debe competir con estos hechos.
  await discardStaleEventBacklog(deps, [
    'planning.BudgetThresholdReached',
    'planning.MonthClosePending',
    'debt.CreditUtilizationThresholdReached',
    'debt.CardPaymentDue',
    'debt.CardStatementIssued',
  ]);
  workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
  mailpit = await startMailpit();
  h = await startHarness({ worker: false, apiEnv: {} });
  clock = h.clock as FixedClock;
  setDay('2026-10-20');
}, 240_000);

afterAll(async () => {
  await h?.close();
  await mailpit?.stop();
  await workerPool?.end();
});

describe('tarjetas: del movimiento a la notificación (debt + notifications)', () => {
  it('[TC-DEBT-CARD-021] [TC-DEBT-CARD-035] una compra que cruza 30 % y 80 % notifica UNA vez a OWNER y EDITOR, no al VIEWER, y el email no trae montos', async () => {
    setDay('2026-10-20');
    const t = await team('util');
    const usd = await creditCardAccount(t.owner, 'Visa Oro USD', 'USD', '200.00');
    const card = await registerCard(t.owner, usd, 'USD', '1000.00');
    const worker = await startWorker({ jobsOnStart: false });
    try {
      // 20.00 % → 85.00 % con una compra de 650.00 USD (cruza el 30.00 % y el 80.00 %).
      const purchase = await post(t.owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-20',
        accountId: usd,
        amount: money('650.00', 'USD'),
        description: 'Laptop (aviso)',
      });
      expect(purchase.status, JSON.stringify(purchase.body)).toBe(201);

      const rows = await until(async () => {
        const r = await notificationsOf(t.ws, 'CARD_UTILIZATION');
        return r.length >= 2 ? r : undefined;
      });
      expect(rows.map((r) => r.user_id).sort()).toEqual([t.owner.id, t.editor.id].sort());
      expect(rows.some((r) => r.user_id === t.viewer.id)).toBe(false);
      for (const r of rows) {
        expect(r.dedupe_key).toBe(`card-utilization:${card.id}:ACCOUNT:${usd}:80.00:1`);
        expect(r.link).toMatchObject({ kind: 'CREDIT_CARD', cardId: card.id });
      }
      // Un único hecho de umbral (80.00 %) que también cruzó el 30.00 %.
      const facts = await outboxOf(t.ws, 'debt.CreditUtilizationThresholdReached');
      expect(facts).toHaveLength(1);
      expect(facts[0]!.payload).toMatchObject({ threshold: '80.00', alsoCrossed: ['30.00'] });

      // Email: uno por destinatario (OWNER y EDITOR), ninguno para el VIEWER, sin montos ni moneda ni tarjeta.
      const owner = await until(async () => {
        const m = await mailTo(emailOf(t.owner));
        return m.length > 0 ? m : undefined;
      });
      const editor = await until(async () => {
        const m = await mailTo(emailOf(t.editor));
        return m.length > 0 ? m : undefined;
      });
      expect(owner).toHaveLength(1);
      expect(editor).toHaveLength(1);
      expect(owner[0]!.Subject).toBe('Tienes un aviso de uso de tarjeta');
      const content = `${owner[0]!.Subject}\n${withoutUrls(owner[0]!.Text)}\n${withoutUrls(owner[0]!.HTML)}`;
      expect(content).toMatch(/80 %/u);
      for (const amount of [/\b650\b/u, /\b850\b/u, /\b1[ .,]?000\b/u, /USD/u, /Visa Oro/u]) {
        expect(content).not.toMatch(amount);
      }
      expect(await mailTo(emailOf(t.viewer))).toHaveLength(0);

      // El mismo hecho entregado otra vez (otro eventId) no crea otra notificación ni otro email.
      const def = worker.subscriptions
        .definitions()
        .find((d) => d.consumer === 'notifications.card-utilization') as EventConsumerDefinition;
      expect(def).toBeDefined();
      expect(await worker.consumers.deliver(def, facts[0]!)).toBe('duplicate');
      expect(await worker.consumers.deliver(def, { ...facts[0]!, eventId: randomUUID() })).toBe('applied');
      await sleep(1_500);
      expect(await notificationsOf(t.ws, 'CARD_UTILIZATION')).toHaveLength(2);
      expect(await mailTo(emailOf(t.owner))).toHaveLength(1);
      expect(await mailTo(emailOf(t.editor))).toHaveLength(1);
      // Seguir arriba del umbral no genera otro aviso.
      const more = await post(t.owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-20',
        accountId: usd,
        amount: money('10.00', 'USD'),
        description: 'Café (aviso)',
      });
      expect(more.status).toBe(201);
      await sleep(1_500);
      expect(await outboxOf(t.ws, 'debt.CreditUtilizationThresholdReached')).toHaveLength(1);
    } finally {
      await worker.close();
    }
  }, 120_000);

  it('[TC-DEBT-CARD-034] el recordatorio de vencimiento notifica UNA vez a OWNER y EDITOR aunque NOTIFY lo procese dos veces, y el email no muestra montos', async () => {
    setDay('2026-10-20');
    const t = await team('due');
    const bob = await creditCardAccount(t.owner, 'Visa Oro BOB', 'BOB', '1120.50');
    const card = await registerCard(t.owner, bob, 'BOB', '10000.00');
    // El 2026-11-12 (3 días antes del vencimiento) el job de arranque emite el estado del 2026-10-25 y su recordatorio.
    setDay('2026-11-12');
    const worker = await startWorker({ jobsOnStart: true });
    try {
      const rows = await until(async () => {
        const r = await notificationsOf(t.ws, 'CARD_PAYMENT_DUE');
        return r.length >= 2 ? r : undefined;
      });
      expect(rows.map((r) => r.user_id).sort()).toEqual([t.owner.id, t.editor.id].sort());
      for (const r of rows) {
        expect(r.dedupe_key).toBe(`card-due:${card.accounts[0]!.id}:2026-10-25`);
        expect(r.link).toMatchObject({ kind: 'CREDIT_CARD', cardId: card.id });
      }
      const facts = await outboxOf(t.ws, 'debt.CardPaymentDue');
      expect(facts).toHaveLength(1);
      expect(facts[0]!.payload).toMatchObject({ closingDate: '2026-10-25', dueDate: '2026-11-15' });
      const owner = await until(async () => {
        const m = await mailTo(emailOf(t.owner));
        return m.length > 0 ? m : undefined;
      });
      expect(owner).toHaveLength(1);
      expect(owner[0]!.Subject).toBe('Tienes un vencimiento de tarjeta');
      const content = `${owner[0]!.Subject}\n${withoutUrls(owner[0]!.Text)}\n${withoutUrls(owner[0]!.HTML)}`;
      for (const amount of [/\b1[ .,]?120[.,]50\b/u, /\b56[.,]0\d\b/u, /BOB/u, /Visa Oro/u]) {
        expect(content).not.toMatch(amount);
      }
      await until(async () => ((await mailTo(emailOf(t.editor))).length > 0 ? true : undefined));
      expect(await mailTo(emailOf(t.viewer))).toHaveLength(0);
      expect(await notificationsOf(t.ws, 'CARD_PAYMENT_DUE')).toHaveLength(2);

      // NOTIFY procesa el mismo recordatorio dos veces: sigue habiendo una notificación por destinatario.
      const def = worker.subscriptions
        .definitions()
        .find((d) => d.consumer === 'notifications.card-payment-due') as EventConsumerDefinition;
      expect(def).toBeDefined();
      expect(await worker.consumers.deliver(def, facts[0]!)).toBe('duplicate');
      expect(await worker.consumers.deliver(def, { ...facts[0]!, eventId: randomUUID() })).toBe('applied');
      await sleep(1_500);
      expect(await notificationsOf(t.ws, 'CARD_PAYMENT_DUE')).toHaveLength(2);
      expect(await mailTo(emailOf(t.owner))).toHaveLength(1);
      expect(await mailTo(emailOf(t.editor))).toHaveLength(1);
    } finally {
      await worker.close();
    }
  }, 120_000);
});
